# Aegis RMS

A law-enforcement records management system built around the premise that the
report writing is the hard part, and that most RMS software makes it harder
than it needs to be.

This repository is a working prototype of the **incident / case report** module:
the screen an officer spends the most time in. It stores data in the browser, so
it runs with nothing but `npm install`.

## Running it

Two processes — an API and the web client.

```bash
npm install

npm run server   # terminal 1 — API on :4000, creates data/aegis.db on first run
npm run dev      # terminal 2 — client on :5173, proxies /api to the server

npm test             # domain and validation suites
npm run build        # typecheck + production build
npm run typecheck:server
```

Sign in with any of the seeded accounts listed on the sign-in screen. The
database is a single SQLite file at `data/aegis.db`; delete it to start over.

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

## The server

There is a real API and a real database, so the shared indexes are actually
shared: a note one officer writes at a location is on the next officer's screen,
on a different machine, because both are reading the same record.

`server/` is Express over SQLite through Node's built-in driver — no native
build, no service to run alongside. It imports the domain modules from `src/`
**unchanged**: `credentials.ts`, `session.ts`, `auth.ts` and `audit.ts` were
written as pure functions over explicit state precisely so this move would be a
relocation rather than a rewrite, and it was.

Records read by shape — users, credentials, sessions, audit — have real
columns. Records only ever fetched whole and searched loosely — incidents,
people, locations — are JSON documents with the few columns needed to find
them. That is stage-appropriate rather than ideal: the domain model is still
moving, and a migration per field would slow that down.

The client still writes whole collections back on a debounce. Coarse, and the
seam to narrow when it stops owning domain logic — the schema does not change
when it does.

### Search

Officers search far more than they write. *"Have we dealt with this guy
before?"*, *"what do we know about this address?"*, *"whose plate is that?"* —
asked from a car, at 2am, with one hand. Everything good already in this system
was worth nothing while the only way to reach it was to open a report you were
not writing.

**Ctrl-K from anywhere**, or `/` when you are not already typing. Type, arrow,
Enter — no pointer needed, because half the time there isn't a spare hand.
People, places, vehicles, reports and crash reports, grouped.

**An inverted index, not a scan.** Tokens are extracted once when the data
changes; a keystroke intersects posting lists. An agency with 200,000 people in
the name index cannot afford to lowercase and substring-match every one of them
on every character, and the difference does not show up until it is somebody's
Tuesday.

Four decisions worth naming:

- **Indexing is generous, querying is precise.** `2026-000418` is *stored* as
  `2026`, `000418` and `2026000418`, so any fragment finds it. But a *query*
  with no whitespace is one identifier and collapses to its joined form —
  because every query term has to match, and splitting `4AC-7821` into `4ac`
  AND `7821` finds nothing against a plate stored as `4AC7821`. The two
  spellings of a plate now behave identically.
- **More words narrow, they don't widen.** Two words means both. That is what
  people expect and what makes a two-word search useful on a large index.
- **Cautions ride on the result row.** An officer-safety flag is *why* somebody
  searched a name at 2am; it does not belong one click further in.
- **Some things are deliberately unfindable.** Social security numbers are not
  in the token list at all — being able to reverse-look-up a person from
  fragments of one is not a feature. Neither are restricted location notes: a
  gate code must not be findable by typing it.

A person or place has no screen of its own yet, so a hit opens the most recent
report it appears on — and the row says *which*, so the jump is never a
surprise.

### The case list is the home page

The first screen is not a menu. It is four counts an officer or a supervisor
actually asks at the start of a shift — **my open cases**, **sent back to me**,
**waiting on review** (a supervisor's whole department, an officer's own), and
**approved** — and each tile *is* the filter for what it counts. Reading the
number and getting to the reports behind it are the same click, so there is
nothing to hunt for after reading it.

Under that: the same list, narrowed by chip, sorted by recently worked on,
oldest incident, or case number, and searchable by case number, last name,
street, or offense. A report with blocking problems carries a *"3 to fix"*
badge — but only while it is still yours to fix, because telling someone a
read-only report has errors is telling them about a job they cannot do.

Supervisors get a **review queue** tab alongside it, aged longest-wait-first.

### Supervisor review

A report goes up, and comes back either approved or with what needs fixing.
The part that matters is the coming back: *"do it again"* costs an officer a
shift, *"the victim's date of birth is missing"* costs them a minute. So a
return carries a reason plus notes pinned to sections.

**Those notes reach the officer through the same panel as validation
problems** — same section badges, same *Take me there*, plus *Mark done*.
A supervisor's note and a missing required field are, to the person fixing
them, the same kind of thing: something specific, attached to a place in the
report, that has to be dealt with. Folding them into one list meant they
inherited the whole mechanism for free.

**Nobody approves their own report.** That is the entire point of a review
step; without it the queue is a formality, and the first time it matters is the
first time someone needs a report to say something it should not. Enforced
server-side, not in the browser. A reviewer's own report still appears in their
queue, marked and unactionable, so it is visibly waiting on someone else.

The queue ages: longest wait first, flagged overdue past 72 hours. A report is
read-only while it is with a supervisor or after approval — a supervisor can
reopen an approved one, and the approval stays in the history rather than being
erased.

### Reading the narrative

The officer types the story anyway, and nearly every coded field is already in
it — the time, the plate, the value of the laptop, whether the door was forced.
Re-typing that into boxes is a large part of what makes these systems feel like
punishment. So the narrative is read as it is written, and what it appears to
say shows up beside it.

**Nothing is ever entered for you, and that is the whole design.** A police
report is evidence. A field the officer did not enter, appearing over their
name and badge number, is a statement they did not make in a document a
prosecutor relies on and a defence attorney will cross-examine them about.
*"The software filled that in"* is not an answer anyone wants to give on a
stand. So every finding is a suggestion, carrying the exact words it came from,
accepted one at a time. There is no "accept all".

Accepting confirms **in place** rather than jumping to the field — an earlier
version navigated on every accept, which is right for one suggestion and
unusable for seven. The card names the field and the section it went to, with
*show me* and *undo* next to it, so nothing changes out of sight and nobody
loses their place.

Two readers, and the order matters:

- **Patterns, on this machine.** Times written as `2200 hours`, labelled
  plates, VINs by their shape (17 characters, never I, O or Q), phone numbers,
  dollar figures, tow destinations, forced-entry language on a burglary, named
  weapons, and — the highest-value one — people the narrative names who are
  **already in the Master Name Index but not on this report**. It only ever
  proposes people the agency already knows, so it cannot invent a human being.
  No network call, no configuration, nothing leaves the building, and the same
  narrative always gives the same suggestions.

- **A model, off by default.** Better at what patterns cannot reach: intent,
  resolving *"the male"* to a person, noticing that paragraph four describes a
  second offense. It is off because a narrative is criminal justice information
  — names, dates of birth, what a victim said happened to them, often a
  juvenile — and sending it to a third party is a CJIS decision for the
  agency's CJIS Systems Officer and their counsel, not a default in a config
  file. It needs `AEGIS_AI_EXTRACTION=1` **and** a key. Until then the pattern
  reader is what an agency gets, and it is not a stub.

Three guards, because an extractor that is confidently wrong is worse than none:

1. **Grounding.** Every finding carries a quote, and a finding whose quote does
   not appear in the narrative is discarded before it is shown. For the pattern
   reader that is a tautology; for the model it is the hallucination guard — an
   invented fact cannot be quoted from text that does not contain it.
2. **A closed field list.** The model returns *data*, not code, against
   `EXTRACTABLE_FIELDS`. Anything naming a field outside it is dropped, so
   nothing arriving over the wire can reach a field nobody chose to expose.
3. **A human.** Applying is a click, and it is reversible.

What the report already says is marked rather than hidden — showing that the
system read the narrative and agreed is worth more than a list that silently
shrinks. Sending a narrative to the model is logged as an access event.

### Supplements

A report has a terminal state; a case does not. The original is written at 3am
and approved the next morning, and then the case keeps moving: the lab comes
back a week later, a detective picks it up, an arrest happens in March on a
January burglary.

None of that is a *correction*. Without supplements the only way to record it is
to reopen the report, which reverses a supervisor's approval and rewrites a
document that was accurate when it was signed. That is how a system loses the
distinction between "the officer got it wrong" and "we learned something new" —
and that distinction is what a defence attorney will spend an afternoon on.

**A supplement never edits the report it hangs from.** It is its own document,
numbered within the case (`2026-000418 S2`, which is how an officer says it),
with its own author, its own review, and its own place in the audit chain. Any
officer can write one, not just the original author — a detective picking up
someone else's case is the point.

**Who may supplement, and when, turns on who is asking.** Two different things
were being conflated:

- An **assisting officer** documenting their own part. Three units respond to a
  burglary; one writes the report and the other two record what *they* did —
  who they canvassed, what they processed. They cannot edit the primary's
  report, because it is the primary's sworn statement, and making them wait for
  it to clear review means writing it from memory a week later. They may
  supplement immediately, at any status.
- The **author** adding to their own report. Here the restriction holds: until
  it is approved, new information belongs in the report itself. Otherwise there
  is a way to route material around review — file a thin report, get it
  approved, put the substance in a supplement — and nobody can say which
  document the case rests on.

A **disposition change** still needs the report approved either way. An
assisting officer can file their part before the report clears review, but
nobody closes a case whose report a supervisor has not signed.

**The one thing a supplement may reach out and change is the case's
disposition**, and only when a supervisor approves it. A case cleared by an
arrest in March has to actually read as cleared; a clearance buried in a
narrative nobody parses never reaches the state, and the agency's published
figures say the crime was never solved. So the change is a declared field, the
supervisor is warned that approving it moves the case, and:

- **Only the most recent approved decision stands.** Two detectives filing
  conflicting dispositions a week apart is real, and the answer is the latest
  decision with both visible in the history.
- **Returning or reopening takes the change back off.** The case reverts to
  what the report itself said — not to whatever the previous supplement
  decided. Leaving it cleared after the decision was withdrawn would be the
  worst outcome available: the paperwork says one thing and the statistics
  another, and nobody notices until the annual return.
- **Clearing by arrest needs the arrest named.** Usually it was booked under
  its own case number weeks later, so a reference to it is what is actually
  available — requiring an arrestee on the *original* report would be wrong.

Supplements queue for review alongside reports — a supervisor asks "what is
waiting on me", not "what reports are waiting on me" — and separation of duties
does not relax because the document is shorter. Approved supplements print with
the case file; a case handed to a prosecutor without its follow-ups reads as
though nothing happened after the first shift.

### Crash reports, and not retyping what was already run

A crash report is a separate document from an incident report, not a section of
one. They answer different questions for different readers: an incident report
describes a crime for a prosecutor and feeds NIBRS; a crash report describes a
collision for a state highway safety office and two insurance adjusters, and
feeds the state crash file. They meet when a crash is also a crime — a DUI, a
hit and run, a fatality — and that produces **both**, linked, because squeezing
one into the other loses half of each.

It is built around **units**. A unit is one vehicle plus its driver and
occupants, numbered 1, 2, 3, which is how a crash is written, diagrammed and
argued about ("unit 2 failed to yield"). Pedestrians and cyclists are units
too, because the state form counts them that way and the alternative is a
special case in every rule.

**Severity is derived, not typed.** An officer who marks a crash "minor" and
then records a fatality on unit 2 has produced a report the state rejects and —
far worse — one that does not trigger the response a fatality requires. The
header and the occupants cannot disagree.

#### The scene diagram

Every state crash form has a diagram box, and it is the part of the report a
jury actually looks at. It is also the part officers dread, because the tools
they get are either a photograph of a hand sketch or a CAD program that takes
an afternoon.

The target is **two minutes, on a trackpad, at 0300**, and that drove every
decision:

- **Stamps, not drawing.** Nobody sketches a car with a mouse. Pick a stamp,
  click the canvas, turn it with `R`.
- **The units come pre-labelled from the report.** The officer has already said
  there is a 2011 Silverado and a 2018 Altima; the palette offers
  *Unit 1 — 2011 Chevrolet Silverado* and picks a pickup body for it. The
  diagram and the report cannot end up disagreeing about which car is unit 1,
  and the numbered badge stays upright however the vehicle is turned — a "2"
  rotated 180° reads as a different number.
- **Vector, not a picture.** Stored as shapes, so it reopens editable, prints
  at the printer's resolution, and costs a couple of kilobytes instead of a
  megabyte of PNG.
- **One component draws the editor and the paper**, so what the officer
  arranged is exactly what a jury sees.

Freehand marks are thinned on release — a pointer emits several hundred points
for one skid mark, of which a dozen matter, and the rest would bloat every save
and slow every later render for no visible difference.

Two performance decisions worth naming. **Dragging never touches the store**:
the moving shape lives in local state until the pointer comes up, so a drag
re-renders one `<g>` rather than the report, the validation panel and the
inbound feed sixty times a second. And **one history entry per drag**, not one
per pointer event, so undo steps back to where the shape was rather than
crawling it across the canvas.

It says *"not to scale"* on the printed sheet. A scene diagram shows relative
position and direction of travel; anything measured comes from a total station
and a reconstruction team, and implying otherwise puts numbers in front of a
jury that nobody took.

#### What dispatch and the registries already know

By the time an officer opens the report they have read the plate over the
radio, had the registration come back, and run two licences. Every one of those
is structured data that a records system then asks them to type again, at the
roadside, in the rain. That is where the transcription errors come from, and it
is most of why the job feels like data entry.

So returns are stored as they arrived and sit beside the report:

```
CF-2026-0417 · Motor vehicle crash — injuries unknown     [Use the time and place]
  "Caller reports two vehicles, one blocking the northbound lane."

2011 Chevrolet Silverado · 4AC7821                        [Add as a unit]

Samuel Okafor · DOB 1988-11-04
  ⚠ Licence status: SUSPENDED       [Driver of Unit 1] [Driver of Unit 2] [Passenger]
```

Four things about that panel are load-bearing:

- **The alert comes first.** A suspended licence or an expired registration is
  usually the reason the query was run. Filling it silently into a field would
  waste the one piece of information the officer actually needed.
- **The registered owner is not the driver.** The owner is a fact about the
  car; who was driving is a fact about the crash. A system that quietly files
  one as the other produces reports naming people who were asleep at home. The
  owner comes across with the vehicle, as a person on the report; saying they
  were driving is a separate click.
- **Everything filled is marked unverified.** A licence return says what the
  state has on file — the address may be three moves out of date, and the photo
  may not be the person holding it. Fields land carrying `dmv` provenance and
  read *"DMV return · not confirmed with this person"* until an officer says
  otherwise, using the same strip that has been there since provenance went in.
- **The call record only fills what is blank.** Dispatch's address is where the
  *caller* said it was; what the officer saw standing there wins.

The returns are also evidence of what was known when. A registration showing an
owner who had sold the car two weeks earlier is not an error in the report — it
is what the state's system said at 0230, and the stored return is what proves
that later.

#### The integration itself

`POST /api/inbound` takes one return or a batch, in a documented shape.
**Nothing here speaks a real CAD vendor's protocol, and nothing talks to NCIC
or NLETS** — those are vendor-specific, and NCIC access is federally controlled
and certified per agency. Connecting a real system means writing an adapter
that posts to that endpoint.

That is deliberately the same bet as the state NIBRS packs: push the awkward,
vendor-specific part to the edge, and keep the report module from ever needing
to know which CAD an agency bought.

### Officer activity reports

What a sergeant runs before a shift review, what a chief runs before a council
meeting, and what an officer runs when their evaluation is coming up. One
officer or several, a single date or a range, and **only the sections asked
for** — "traffic stops alone" and "everything" are both real requests, and a
report that always shows everything is one nobody reads.

Sections: traffic stops, citations and warnings, reports, supplements, arrests,
offenses, property, and case status. Printable, with the same portal mechanics
as the case report.

**Traffic stops needed their own record first.** An officer runs twenty stops a
shift and writes two reports; every trace of the other eighteen lives in CAD or
a notebook. An activity report built only from incident reports therefore shows
an officer who spent the night on traffic as having done nothing, which is both
wrong and the fastest way to make supervisors stop trusting the numbers. So a
stop is a lightweight record of its own — time defaults to now, location is
free text because officers describe stops by landmark, everything else
optional. It has to be fast or it does not get filed, and then the report on
top of it is wrong.

**Arrests are counted by the arresting officer**, which meant adding one. An
assisting unit makes the arrest and the primary writes it up constantly;
counting by report author credits the wrong person. Older records with no
arresting officer fall back to the report's author rather than being dropped,
so the agency total stays right.

Two rules run through the whole thing:

- **A zero is a fact, not a gap.** An officer who did nothing on Tuesday shows
  a 0, not an empty row. A report that silently omits people makes every number
  in it unverifiable — the reader cannot tell absence from omission.
- **Every table says where its number came from**, printed underneath it.
  "Arrests by report author" and "arrests by arresting officer" are different
  numbers, and a page of counts with no basis is a page that gets argued with
  in a grievance a year later.

Officers can run it on themselves without any permission. Another officer's
figures are a personnel record and need review permission — who may read whose
activity is not a UI decision.

### The paper copy

Prosecutors, defence counsel and courts work from paper. **Print** renders the
whole report in a fixed order — every section, with the coded values spelled
out, because `20` means nothing to anyone outside the system — and the footer
records who printed it and when.

PDF is the browser's own print-to-PDF. That keeps the layout engine the same
one the officer previewed and avoids shipping a second renderer whose output
nobody checks. The sheet is portalled out of the application and the app is
taken out of the printed document entirely, so the first page is the report
rather than a screenshot of a sidebar.

**Printing a report is an access event** and is logged as one. A report is a
disclosure of everything in it.

### NIBRS submission

Approved reports, written as the file a state's collection system reads.

**One engine, a pack of data per state.** The alternative — a branch or a
codebase per state — means every bug fix is fifty cherry-picks and a security
patch is a fifty-agency coordination problem. It is also a large part of why
the incumbents are what they are. What actually differs between states is a
table of numbers, so it is stored as a table of numbers:

```
extract.ts   incident → named values.  National. Never varies.
states/      which values, in what order, how wide.  Data, per state.
format.ts    layout + values → a line.  Shared.
xml.ts       layout + values → an element.  The other transport.
```

Working a victim's age out from a date of birth is the same arithmetic in
Columbia and in Concord. Writing that age into columns 56-57 rather than 58-59
is a table. So extraction is national and shared, and a state pack is a file of
widths.

Two are implemented, chosen because they differ in the ways that stress the
design:

- **South Carolina** (SCIBRS, run by SLED) — fixed width, a submission header
  record carrying the batch counts, a state agency code on every record
  alongside the ORI, a wider case-number field, and the state statute cite
  required on offenses and arrest charges.
- **New Hampshire** (NHIBRS, Department of Safety / State Police) — **XML**,
  and resident status on the victim record, which the national layout does not
  collect.

They share every line of extraction, every national validation rule, and the
whole rest of the system. **The transport is a renderer, not a fork.** An
agency in a state with no pack falls back to the FBI's national layout, and
the screen says so rather than letting the fallback pass for a state
submission.

**Required fields are declared in the layout, and the validation is generated
from it.** Marking South Carolina's statute cite `required: true` is the entire
act of adding the check — the officer is told while the report is still open,
rather than the records clerk being told six weeks later by a rejection report.
Writing the requirement down twice would guarantee the two drift, and the
direction they drift in is the bad one: the file gets a column nobody was asked
to fill.

Those state warnings do not block the report. A report that is complete by
federal standards can be filed; it is held out of the *submission* until the
state's own fields are answered, which is the right place for the
disagreement.

**What is held back is named, with the reason.** The failure mode of every
records system is a report that quietly never gets counted and surfaces a year
later as a hole in the annual return. So: *still a draft*, *sent back for
correction*, *2 unresolved validation problems*, *1 state requirement not met*.

A blank field goes out as spaces, never zeroes. An age of `00` is a claim the
person is a newborn, and a premises-entered count of `00` on an offense that
has no such count is a claim the state's edit checks reject. In XML the same
types resolve differently — a date is `2026-08-27` rather than `20260827` —
which is a renderer's job, not a state's.

**Every profile is marked unverified, on the screen.** The layouts are this
system's reading of the record, not a transcription of a published
specification, and no profile claims otherwise until somebody has walked one
column by column. The export screen prints the layout as a column table for
exactly that purpose. A file that is the right shape in the wrong dialect gets
rejected in bulk, weeks later.

Downloading is logged, with the profile and the case count.

### Two people, one report

Every record carries a version. A save sends the version it was based on, and
if someone else has saved in between the server **refuses** and returns their
copy — nothing is silently overwritten. The refusal surfaces as a banner naming
who saved first; retrying automatically would be exactly the overwrite this
exists to prevent.

Alongside that, opening a report takes an **advisory lock** — the dashboard
shows *"M. Reyes is editing"* and the editor warns before you start typing.
It is deliberately breakable: a lock nobody can clear strands a case when its
holder goes home with the laptop.

Verified in two browsers: A and B both edited the same narrative, B's save was
refused with A's text intact.

### Attachments

Photographs, PDFs, audio and plain text up to 25 MB, on the report. They are
evidence, so they behave like it:

- **Hashed on ingest.** The SHA-256 taken at upload is shown on the card and
  rechecked on every view. Corrupt the stored file and the badge turns to
  *Altered since upload* with a warning not to rely on it.
- **Withdrawn, never deleted** — the same rule as location notes, needing the
  same permission.
- **Every open is logged.** Viewing a scene photograph is an access event.

Body-worn video is refused with an explanation: it belongs in a dedicated
evidence system, and accepting it here would imply retention and disclosure
workflows this does not have.

### Sign-in

**This is now a real boundary.** Passwords are verified by the server, the
session id is an httpOnly `SameSite=Strict` cookie the page cannot read, and
every route re-decides authorisation from the session the server issued. What
the browser knows about roles and permissions only decides what to *render*.

Passwords are hashed with PBKDF2-HMAC-SHA256 at OWASP's iteration floor, salted
per record, compared in constant time, and never leave the server in any form.
Argon2id is the better algorithm; the stored format carries its own parameters
so records can be upgraded in place at next sign-in.

The parts that make it hold:

- **Permissions are enforced server-side.** An officer POSTing to `/api/users`
  gets 403 regardless of what their browser is showing, and the audit log is
  simply absent from their `/api/state` response.
- **Over-reaching requests are refused, not downgraded.** An administrator
  asking to create a vendor account gets 403 with the reason — an earlier pass
  silently created an officer instead, which is safe but dishonest.
- **Deactivating an account ends its sessions immediately**, rather than at
  next expiry.
- **Timeouts are the server's**, so closing the laptop does not extend them.

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

Written by the server, from the session it resolved — an actor name is
something the server knows, never something a request claimed. Appends are
serialised, because two concurrent requests chaining from the same tail would
fork the chain.

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

### Provenance, and how old it is

Every identity field records where its value came from — officer, DMV return,
interstate query, migrated record — and whether an officer confirmed it against
the person in front of them. A registered owner is not necessarily the driver
and an address on file is not necessarily current, so a report has to be able
to tell what was observed from what the state had on file.

**And it records when.** An address is not a fact, it is a fact *as at a date*.
Every edit to a person's contact details is stamped, and the age is shown
wherever the value is:

```
Address   88 Marion St            🕑 4 years old   Still current
Phone     (205) 555-0193          🕑 4 years old   Still current
```

Under three months it is quiet. Under a year it says so and moves on. Past a
year it turns amber and offers **Still current** — which re-stamps the date
without retyping, because the common case is an officer looking at an old
value, confirming it with the person in front of them, and having nothing to
change.

This is not cosmetic. A warrant served at a four-year-old address is served on
whoever lives there now. A next-of-kin call to a disconnected number is a
death notification that does not happen. A victim who cannot be reached for a
follow-up becomes a case closed for lack of cooperation they were never asked
for.

**An unknown date is shown as unknown, never as fresh.** A record migrated from
a previous system with no provenance could be twenty years old, and saying
nothing invites the reader to assume it is current — which is precisely the
failure this exists to prevent.

The age travels to paper too, because whoever serves the warrant is reading the
sheet and not the screen:

```
1. Okafor, Samuel — Victim (Individual)
   88 Marion St, Cedar Falls (current) · (205) 555-0193 (4 years old)
```

Location notes work the same way and always have: a gate code past a year is
badged *needs a re-check* with a one-click confirm, and the age shown is the
age of the last confirmation rather than of the note — a code written in 2021
and checked last week is current, and saying "3 years ago" next to it teaches
people to distrust something that was just verified.

## Architecture

```
src/
  domain/         Types and reference data. Offense codes carry the flags
                  that drive conditional validation; `matching.ts` and
                  `locationMatching.ts` hold the resolution scoring for
                  people and places.
    extraction/   Reading the narrative. `patterns.ts` is the offline
                  reader, `suggest.ts` does grounding and applying. Nothing
                  here writes a field — it only proposes.
    nibrs/        The state submission. `extract.ts` is national and shared,
                  `states/` is one data file per state, `format.ts` and
                  `xml.ts` are the two transports. All pure functions, so the
                  same code runs in the browser for a preview and on the
                  server for the real file.
  validation/
    engine.ts     Issue/Rule types, the runner, field-path helpers.
    rules/        Rules by area — incident, offenses, persons, property,
                  vehicles, narrative. Each is (context) => Issue[].
  state/          Store, browser persistence, seed data.
  components/     Field primitives that render their own issues, and the
                  issue panel.
  features/       Case list, the incident editor's eight sections, review,
                  setup, the printable report and the NIBRS export.
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

Absent: a master vehicle index, case management beyond the case file itself,
migration from an existing records system, and geocoding. Crash reports are not yet written to a state
crash file; that is the same per-state layout problem the NIBRS packs solve,
and it should reuse them.

CAD and MDT integration is defined but not connected: the ingest contract and
the whole autofill path exist and are exercised, but no adapter for any real
CAD, and no NCIC or NLETS link. Supplements carry a narrative and a disposition change but cannot
yet add structured people, property or vehicles to a case — an arrest is
described and referenced rather than recorded as an arrestee record, which is
the next piece of that work.

Activity reports count what the system holds. Traffic stops are entered by hand
here; in a real deployment most would arrive from CAD or the MDT, and until
that integration exists a stop nobody logs is a stop that never happened as far
as the report is concerned — which the printed footer says plainly.

Deployment is covered in `DEPLOYMENT.md`, including what it deliberately does
not do. The short version: **no MFA**, which CJIS requires for access to
criminal justice information, and **no encryption at rest**. Both are called
out rather than approximated — bolting on TOTP without enrolment and recovery
would look like compliance without being it.

Narrative reading by a model is written and wired but **has not been run
against a live key** — the offline pattern reader is what has been exercised
end to end. The model path needs a real evaluation set before anyone should
trust its precision, and precision is the only thing that matters: an extractor
that is wrong one time in ten teaches officers to ignore all of it.

Still single-instance: rate limiting lives in process memory and SQLite takes
one writer. Fine for one agency, wrong for a county. Merging two identities that
are *already* separate records is not built either — only linking at entry time.

The NIBRS export is generated in the browser from the same pure functions the
server can call, and is a submission *file*, not a submission: there is no
transmission, no acknowledgement handling, and no reconciliation of what the
state rejected. Two state packs exist and **neither has been checked against
its published specification** — that is stated on the screen, not just here.
Forty-eight states have no pack; adding one is a file of widths and a line in
the registry, but somebody still has to read the state's spec, and no
architecture removes that.
