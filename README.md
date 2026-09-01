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
CAD integration, and the actual NIBRS export. Geocoding is absent, so locations
match on text alone rather than on proximity. Merging two identities that are
*already* separate records is not built either — only linking at entry time. The validation
engine is written to move to a server unchanged — it is a pure function of the
incident.
