# Architecture notes

Target shape of the system and the constraints that drive it. Written down
because several of these decisions have to be made before the schema hardens,
not after.

## Topology

The RMS is **web-based**. CAD (dispatch) and the MDT are **native applications**,
not browser apps.

That split is deliberate and it forces one rule: these systems talk over a
**versioned HTTP API**, never a shared database.

Legacy suites are miserable largely because CAD, MDT and RMS all read and write
one vendor database. Every schema change becomes a coordinated upgrade of three
products, so nothing ever changes. An API boundary means the RMS schema can
evolve behind a stable contract, and a third-party CAD can be swapped in without
touching RMS internals.

The MDT being native is the right call for a second reason: **patrol cars lose
connectivity**. An MDT must keep working through a dead zone and reconcile
afterward, which means a local store and a sync protocol. That is painful in a
browser and natural in a native app.

### Validation runs in more than one place

`src/validation/` is a pure function of the incident — no DOM, no network, no
storage. That is load-bearing, not incidental:

- the **browser** runs it for live feedback while typing
- the **server** runs it as the authority on submission, because a client can
  always be bypassed
- the **MDT** needs the same answers offline, before it can reach the server

All three must agree. The server is the source of truth; ship the rules to the
other two rather than reimplementing them. A rule that exists in two hand-written
copies will diverge, and the divergence will surface as reports that pass on the
laptop and fail at the state.

## Migration from prior systems

The goal is comprehensive import from whatever the agency ran before — IMC,
Spillman, PremierOne, Tyler/New World, CSI.

Worth being blunt about the hard part: **the obstacle is rarely the code.** It is
that the outgoing vendor has no incentive to hand over clean data. What arrives
is typically a database backup with an undocumented, heavily denormalized schema,
or ODBC access to a live instance — occasionally nothing better than printed
reports. Budget for archaeology, not for parsing.

Three design consequences, all of which have to be true from the start:

**1. Validation applies at authoring time, never at storage time.**
A 1998 record predates NIBRS and will fail most rules in `src/validation/`.
If import enforces today's rules, the import rejects the agency's own history.
Imported records are stored as-is and *flagged*, never blocked. Only a human
authoring a report today gets the full rule set.

**2. Never discard the source.**
Every imported record keeps its raw source row alongside the mapped result.
A mapping bug found two years later must be fixable by re-running the mapper,
not by going back to a decommissioned server that no longer exists.

**3. Adapters target a canonical import format, not the live schema.**
Per-vendor adapters map into one documented intermediate representation; a
single loader takes it from there. "Any previous system" is achievable as *a
documented format plus a mapping tool* — so a new system is days of work, not
months — rather than as a promise of universal support out of the box. Ship
adapters for the handful of systems that actually matter; let the format cover
the rest.

Every import run should emit a data-quality report: what mapped, what did not,
what was ambiguous. Silent partial imports are how agencies lose history without
noticing.

## Traffic stop pre-fill

Ambition: data pulled during a vehicle stop flows into the report instead of
being retyped.

Technically this is close. The MDT already queries NCIC/NLETS/state DMV during a
stop and receives **structured** responses — plate, VIN, registered owner,
licence status. Capturing that return and offering it as pre-fill is
straightforward once the MDT and RMS share an API.

The real constraints are legal, not technical, and they cut differently by data
type:

- **Registration and licence returns** — reasonable to use as pre-fill for a
  report the officer is actively writing.
- **Criminal history (CHRI) / NCIC hot-file returns** — governed by the CJIS
  Security Policy and generally may not be retained in a local RMS beyond the
  transaction. Pre-filling a report from a rap sheet is not a feature to build.

So the realistic target is: **pre-fill identity and vehicle fields, never
criminal history.**

### What this changes in the schema now

Pre-filled data is not the same as officer-observed data, and a report has to be
able to say which is which. Person and vehicle records need:

- **provenance** per field — officer-typed, DMV return, prior RMS record
- **a verified flag** — did the officer confirm this against the person in front
  of them, or is it just what the state had on file?

A registered owner is not necessarily the driver. An address on file is not
necessarily current. Recording a DMV value as though the officer observed it
makes the report say something untrue, and that surfaces in cross-examination.

Retrofitting provenance later means touching every person and vehicle write path,
so it is cheaper to design for now even though nothing populates it yet.

## CJIS compliance

Web-based is normal and fine — but for criminal justice information it is not
merely "put it on a server." Expect to need:

- advanced authentication (MFA) for any access to CJI
- FIPS 140-2 validated encryption, in transit and at rest
- personnel screening for anyone with access, including contractors
- immutable audit logging of every view and change of CJI
- hosting either on-premises or in a CJIS-eligible cloud (AWS GovCloud,
  Azure Government) with a signed CJIS addendum

This is the largest non-obvious cost in the project and it drives the hosting
decision, so it belongs in the plan early rather than during procurement.

**Audit is a schema decision.** "Who viewed this record, and when" cannot be
bolted on convincingly after the fact; the access path has to be built to record
it from the beginning.
