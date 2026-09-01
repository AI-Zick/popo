# Aegis RMS

A law-enforcement records management system built around the premise that the
report writing is the hard part, and that most RMS software makes it harder
than it needs to be.

This repository is a working prototype of the **incident / case report** module:
the screen an officer spends the most time in. It stores data in the browser, so
it runs with nothing but `npm install`.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # validation rule suite
npm run build    # typecheck + production build
```

Three sample reports are seeded on first load. The one marked **2026-000431** is
deliberately half-finished — it is the fastest way to see the validation surface
behave on a real, incomplete case.

## What it does differently

### The report adapts to the offense

Offense codes are data, not branching logic. Each entry in
`src/domain/codes.ts` carries the structural facts about that offense:

```ts
{ code: '220', label: 'Burglary / Breaking & Entering', category: 'property',
  isBurglary: true, requiresProperty: true }
```

Choosing *Burglary* makes the method-of-entry and premises-entered fields
appear, and adds a property-record requirement. Choosing *Motor Vehicle Theft*
instead requires a vehicle with a plate or VIN. The form tells you this up
front, before you have filled anything in, rather than at submission time.

### Errors know where they live, and how to fix themselves

Every validation issue carries a field path, a plain-language message, a
remediation tip, and — where there is an unambiguous correct action — an
executable quick fix:

```ts
{
  severity: 'error',
  path: 'persons[per7f2].injuries',
  title: 'Injury type is required',
  message: 'A victim of a violent offense must have an injury recorded.',
  tip: 'If the victim was not hurt, select "None". Leaving it blank reads as an
        unanswered question and will bounce back from records.',
  quickFix: { label: 'Set to "None"', apply: (draft) => { /* … */ } },
}
```

The path is what makes *"take me there"* work: the store keeps a registry of
mounted fields, so jumping to an issue switches to the right section, scrolls
the field into view, focuses it, and flashes it — including for records that a
quick fix has only just created. `F8` walks to the next unresolved item from
anywhere in the app.

### The tips are written for 3am

The messages explain *why*, not just *what*. Exceptional clearance spells out
all four conditions that have to hold. "Unfounded" says it means the offense
never happened, not that it went unsolved. Method of entry explains that a
stolen key is No Force. This is the knowledge that otherwise lives in a records
clerk's head and reaches the officer as a rejected report two weeks later.

### Errors surface when they are useful

A blank field you have not reached yet is not an error. Inline errors appear
once you have touched a field, jumped to it, or attempted to submit. The
right-hand panel always shows the full picture, split into **Must fix** (blocks
submission) and **Review** (worth a second look, but will not stop you).

### One person, one record

Identity lives in a Master Name Index and is referenced by every report that
involves that person; only the *involvement* — role, injuries, charges, what
they were wearing — is stored on the incident. Add a suspect today and they are
available to every officer tomorrow, as a witness, a victim or anything else.

De-duplication is deliberately tiered, because a false merge is far worse than a
duplicate. Putting one person's criminal history onto another is close to
impossible to unpick once reports and charges have accumulated against it:

- **A hit on a unique identifier** — SSN, driver licence plus state, state ID —
  links automatically, with an undo.
- **Anything weaker** is *proposed*, never applied. Candidates are scored on
  name similarity (Jaro-Winkler plus a phonetic key, so `Whitfeild` still finds
  `Whitfield`), date-of-birth proximity that tells a typo from a different date,
  address, and phone — then shown with the evidence for and against.
- **Contradicting evidence caps the tier.** A differing SSN, or a `Jr`/`Sr`
  suffix mismatch, bars an automatic link however well the rest agrees — that
  case is usually a father and son, not a duplicate.

Name alone never links anything.

### One place, one record

Locations work the same way, for the same reason. Type an address the agency has
been to and you get **one** option — with whatever officers and dispatch have
left on it: the gate code, who to call after hours, which entrance actually
opens, the dog in the back.

Addresses differ from people in one useful way: they have a canonical form.
`612 North Marion Street` and `612 N Marion St` are not merely *similar*, they
are the same string once standardised — so matching normalises first and only
falls back to fuzzy scoring for what normalisation cannot reach, like a misspelt
street. An exact normalised address in the same city reuses the existing record
without asking. Two houses on the same street never merge.

Places are searchable by what officers actually call them (`marion storage`),
not just by address.

**A storage facility is one location, not four hundred.** Sites with numbered
units — storage, apartment blocks, motels — are a single record, and the unit
number lives on each incident. Otherwise the index fills with near-identical
addresses and the gate code ends up on whichever one you did not open.

Access notes are masked until deliberately revealed, and notes older than a year
are flagged for re-check — a gate code from 2019 is worse than no gate code.

**Officers add notes; they cannot take them away.** What a previous shift worked
out at 0300 should not vanish because someone found it inconvenient or thought
it was wrong. Withdrawing a note needs `notes.retract`, which supervisors and
records staff hold by role, and which can be granted to a named officer without
promoting them — the "and those designated" case.

Withdrawal is not deletion. The note, its author, who withdrew it and why are all
kept; it simply stops showing on the location. "Who removed the gate code, and
when" is a question that gets asked after something goes wrong at an address.

### Sign-in — and what it is not

**This is not yet a security boundary, and the app says so on its own sign-in
screen.** Passwords are hashed with PBKDF2-HMAC-SHA256 at OWASP's iteration
floor, salted per record, compared in constant time, and never stored in
readable form. But the check runs in the browser, where the person being
verified controls the code doing the verifying — anyone can bypass it with dev
tools.

What exists is the correct *mechanism*, written as pure functions over explicit
state with no browser assumptions, so moving verification behind an API is a
relocation rather than a rewrite. Argon2id should replace PBKDF2 on the server;
the stored format carries its own parameters so records upgrade in place.

The parts that are already right:

- **Failures are indistinguishable.** Wrong password, unknown username and
  deactivated account all return one message, because saying which was wrong
  tells an attacker which usernames exist. A missing account still does the
  hashing work so it cannot answer faster and reveal itself by timing.
- **Five failures locks the account for fifteen minutes**, per account rather
  than per password.
- **Sessions expire twice over** — thirty minutes idle, twelve hours absolute.
  Activity pushes the idle window back and never the absolute one, because a
  car laptop gets left unattended and a shift has to end.
- **Issued passwords must be changed.** An administrator creating an account
  gets a temporary password shown once; the holder cannot keep it.
- **Policy favours length over composition.** Twelve characters minimum, no
  obvious passwords, nothing containing the username or name — and no mandate
  to include a symbol, which only ever produces `P@ssw0rd`.

### Audit log

Append-only and hash-chained: every entry carries the hash of the one before
it, so altering or removing one breaks every hash after it and the log says
exactly where. That is not unfalsifiable — anyone who can rewrite the whole
chain can rewrite history — but it does stop quiet, selective edits, which is
the realistic threat.

Sign-ins and failures, lockouts, account changes, report submissions, and every
note added, withdrawn or restored are recorded. So is **reading a restricted
note**: looking up a gate code is an access event in its own right.

Reading the log is its own permission, deliberately separate from account
management — the people who review access are not always the people who grant
it.

### Accounts

Provisioning is two-tier. An **agency administrator** sets up accounts for their
own officers; the **vendor** sets up the administrator when a new agency comes
on. Account management can also be designated to a named officer without
promoting them, the same mechanism as note withdrawal.

The rule underneath is that nobody hands out more authority than they hold:

- **Roles** can only be assigned at or below the actor's own level. An agency
  administrator cannot create a vendor account.
- **Designated permissions** can only be passed on if the actor holds them. An
  administrator cannot designate someone to provision new agencies.
- **Reaching upward is refused.** An administrator cannot edit or deactivate a
  vendor account.
- **The agency cannot lock itself out.** Nobody may deactivate their own
  account, and the last account that can manage accounts cannot be switched off.

The form hides options the actor cannot use, and the store re-checks every write
against the same guards — a hidden option is not a guard. Accounts are
deactivated rather than deleted, because an officer who has left still authored
reports that must keep resolving to a person.

### Proximity

Locations carry coordinates, and matching uses them — carefully. Pins are placed
by hand and are good to perhaps twenty metres, while neighbouring houses are
about that far apart. So distance **corroborates a match the text already
suggests, or argues against one, but never establishes one**: two records whose
pins nearly coincide score higher, two a mile apart stop matching however alike
their names, and proximity alone returns nothing.

Above all, **differing house numbers cap the result at a suggestion** no matter
how close the pins are. 1142 and 1150 Ashwood Lane are twenty-five metres apart
and are not the same address. The test suite pins that case specifically.

Search results are ranked by distance from the jurisdiction centre, and the
picker shows how far away each place is.

### Jurisdiction and coordinates

Setup takes the agency's name, ORI and jurisdiction, plus two boundary layers as
GeoJSON: the outer city or county limit, and the patrol areas within it. Both
already exist — county GIS, the CAD vendor or the 911 addressing authority has
them, because dispatch draws its map from the same files.

Loading them buys three things:

- **New locations default to the jurisdiction**, so nobody types the same town
  four hundred times a year.
- **The patrol area is derived, not recalled.** Drop a pin and the beat fills
  itself by point-in-polygon. It is stored on the shared location record, so
  it is answered once for every future report at that address.
- **Calls outside the boundary are flagged** — fine for mutual aid, worth
  catching when it is a typo.

The map is drawn from the agency's own polygons as inline SVG. No tile server,
no API key, no basemap request: crime-scene coordinates are not sent to a third
party on every keystroke. Agencies say what they call their patrol areas — beat,
zone, district, sector — and the app uses that word throughout.

There is deliberately **no automatic address-to-coordinate geocoding**. Sending
every incident address to a commercial geocoder is a data-sharing decision an
agency should make consciously, and most already hold authoritative address
points from their 911/NG911 addressing authority that are better than anything a
public geocoder returns. Coordinates come from dropping a pin, and the seam for
a local geocoder is a single call site.

### Provenance

Identity fields record where their value came from and whether an officer
confirmed it. A registered owner is not necessarily the driver and an address on
file is not necessarily current, so a value returned by a licence query is shown
as unconfirmed until someone verifies it against the person in front of them.

## Architecture

```
src/
  domain/         Types and reference data. Offense codes carry the flags
                  that drive conditional validation; `matching.ts` and
                  `locationMatching.ts` hold the resolution scoring for
                  people and places.
  validation/
    engine.ts     Issue/Rule types, the runner, field-path helpers.
    rules/        Rules by area — incident, offenses, persons, property,
                  vehicles, narrative. Each is (context) => Issue[].
  state/          Store, browser persistence, seed data.
  components/     Field primitives that render their own issues, and the
                  issue panel.
  features/       Dashboard and the incident editor's seven sections.
```

A rule is a plain function, which is what lets cross-record checks — "this
victim is related to that offender, so this is a domestic" — stay readable:

```ts
export const rule: Rule = (ctx) =>
  ctx.anyOffense('requiresVehicle') && ctx.vehicles.length === 0
    ? [{ /* issue */ }]
    : [];
```

Rules never throw into the UI; a rule that fails is logged and skipped, because
a bug in validation must never stop an officer from writing a report.

## Rule coverage

Roughly 60 rules across six areas, modelled on the NIBRS structural edits that
state submissions actually reject on:

- **Timing** — occurrence after report, inverted date ranges, future dates
- **Clearance** — cleared-by-arrest with no arrestee, exceptional clearance
  reasons, unfounded cases lacking explanation
- **Offense structure** — burglary entry detail, weapon requirements, criminal
  activity for drug and weapon offenses, attempted-homicide rejection
- **Victims** — individual victim required for crimes against persons,
  victim-to-offender relationships, injury consistency, juvenile handling
- **Property** — loss types, theft values, narcotics detail, arson requiring
  burned property, structures that cannot be stolen
- **Vehicles** — MVT requiring a vehicle, VIN validity, tow destinations
- **Narrative** — length, people named in the report but absent from the story,
  arrests with no rights advisement

Each is covered by `src/validation/__tests__/rules.test.ts`, including a
property test asserting that every quick fix actually clears the issue it is
attached to.

## Deliberately not here yet

This is one module, not a system. Absent: a real backend and database, auth and
role-based access, the supervisor review queue as a working screen, a master
vehicle index, supplements and case management, evidence and chain of custody,
CAD integration, and the actual NIBRS export.

Most importantly, **the security boundary is still missing.** Sign-in, hashing,
sessions, lockout and the audit log are all implemented correctly, but they run
in the browser, so none of them constrains a determined user. Moving
`credentials.ts` and `session.ts` behind an API — with the session id in an
httpOnly cookie and the audit log written server-side — is what turns this from
a faithful model into actual security. Everything above is written to make that
a relocation rather than a rewrite. Merging two identities that are
*already* separate records is not built either — only linking at entry time. The validation
engine is written to move to a server unchanged — it is a pure function of the
incident.
