# Deployment

What the code does, and what it cannot do for you.

## What is built in

- **TLS.** Set `AEGIS_TLS_KEY` and `AEGIS_TLS_CERT` and the server listens on
  HTTPS directly. If TLS terminates at a reverse proxy instead, set
  `AEGIS_TRUST_PROXY=1` so client addresses are read from `X-Forwarded-For`.
- **It refuses to start insecurely.** `NODE_ENV=production` with neither TLS nor
  a trusted proxy exits with an explanation rather than serving session cookies
  over plaintext.
- **Security headers** on every response: a strict CSP with no inline scripts,
  `frame-ancestors 'none'`, `nosniff`, `no-referrer`, and `Cache-Control:
  no-store` so case numbers and names do not sit in a proxy cache. HSTS once TLS
  is on.
- **Rate limiting** on sign-in (10/min per address) and password change (5/min).
  Per-account lockout already slows guessing at one username; this slows an
  attacker spreading attempts across many.
- **One origin in production.** The API serves the built client, so the session
  cookie needs no cross-site relaxation.
- **Graceful shutdown**, so a deploy does not truncate a report mid-save, and a
  `/api/health` endpoint that reveals nothing.
- **Request logging** that records method, route shape, status and duration —
  never query strings or bodies, because an access log that quotes URLs
  eventually quotes a name into a file with weaker protection than the database.

## Running it

```bash
docker compose up -d --build
```

Put your certificate and key in `./certs` as `server.crt` and `server.key`, or
comment those environment lines out and terminate TLS at a proxy.

Without Docker:

```bash
npm ci && npm run build
NODE_ENV=production AEGIS_TLS_KEY=/path/key.pem AEGIS_TLS_CERT=/path/cert.pem \
  AEGIS_DATA_DIR=/var/lib/aegis npx tsx server/index.ts
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Listen port |
| `AEGIS_DATA_DIR` | `data` | Database and attachment files |
| `AEGIS_DB` | `<data>/aegis.db` | SQLite file |
| `AEGIS_TLS_KEY` / `AEGIS_TLS_CERT` | — | Serve HTTPS directly |
| `AEGIS_TRUST_PROXY` | — | `1` when TLS terminates upstream |
| `AEGIS_SERVE_CLIENT` | on in production | Serve `dist/` from the API |
| `AEGIS_FEEDBACK_URL` | the vendor | Override, or `off` to send nowhere |
| `AEGIS_FEEDBACK_KEY` | — | This agency's feedback signing key |

### Feedback, and what crosses the wire

This is the only outbound path in the system, so it is documented in full.

Feedback is **sent by default**, to the address built into the release. A
channel every customer has to configure before it works reports nothing from
the sites least likely to configure it, which are the ones whose problems most
need hearing — so the default is on, and switching it off is a decision you
make rather than one you inherit:

```
AEGIS_FEEDBACK_URL=off
```

With it off, feedback is written to your own database and goes nowhere; an
administrator exports it from **Setup → Feedback**. Officers are told which of
those two is happening, on the form itself, before they write anything.

Each request is signed with `AEGIS_FEEDBACK_KEY`, issued to your agency at
provisioning, over the request body and its timestamp. The receiver rejects
anything unsigned, signed with another agency's key, or more than five minutes
old — so nobody can post as you, and a captured request cannot be replayed. If
the key is ever exposed, ask for a new one: revoking yours affects no other
agency. The server refuses to start in production if the address is not `https`,
and warns at startup if there is no key.

Delivery is retried on failure, backing off from one minute to twice a day, and
survives a restart. Nothing is lost because the receiver was down, and nobody
has to notice a badge on a settings screen.

What goes in that request:

- what the officer typed, minus any social security number, which the server
  removes whether or not the browser did;
- their name, badge role, and your agency name and ORI;
- which screen they were on, which field they had been in (`incident.reportedAt`
  — the path, never the value), the build, and their browser.

What does not: any part of a report, any person, any case number. The context
is structural by construction and there is a test that fails if a field capable
of carrying record content is added to it.

Every send is written to the audit log as `feedback.sent`, so what has left the
building is answerable from your own records rather than the vendor's, and every
item stays in your database whether or not it was forwarded.

### Sending email

One thing is sent by email and nothing else: the link that lets somebody set a
new password when they have forgotten theirs. Host, port, From address and the
address of this installation are set on the agency setup screen. The relay
password is not — it is `AEGIS_SMTP_PASSWORD` in the environment, because
everything on that screen is written to the database, and a database is copied
to backups and restored onto other machines.

```
AEGIS_SMTP_PASSWORD=...     # only if the relay needs authentication
```

Until the mail settings are complete the sign-in screen offers no password
reset at all, which is deliberate: an offer that goes nowhere leaves somebody
locked out at two in the morning waiting for an email that was never coming.
Administrators can still issue passwords, and the console command below still
works.

## When the administrator is locked out

An agency with one administrator who forgets their password, on an installation
with no mail server, cannot be administered at all — no accounts, no
permissions, no approvals. The way back is a command on the server console,
where access to the machine is what authenticates you:

```
npm run recover -- --list
npm run recover -- --user rvance --reason "Sole admin locked out, ticket 412"
```

It issues that account a temporary password, ends its sessions, cancels any
outstanding reset link, and prints the password once. The account must change
it at next sign-in.

Two things it deliberately does not do. It will not create an account, change a
role or grant a permission — it restores access to authority that already
exists rather than manufacturing any. And it does not touch the second factor,
which is still required afterwards; if the phone is gone too, that needs a
recovery code, or another administrator once this one is back in.

Every run writes an audit entry attributed to "Server console" with the reason
you gave, sealed into the same hash chain as everything else. Break-glass that
leaves no trace is a back door, so there is no way to run this quietly.

## Backups

Two commands, and the second one is the point.

```
npm run backup -- --to /var/backups/aegis
npm run restore -- --from /var/backups/aegis/aegis-2026-09-05T15-29-42-225Z
```

`backup` writes a timestamped directory holding the database, both file
directories — `attachments/` and `photos/`, not just the one — and a manifest
of what it should contain. It uses SQLite's `VACUUM INTO`, so the copy comes
from a single read transaction and the server does not have to be stopped;
`cp` on a live database can catch one page written and its partner not.

Then it reads the copy back. Not the original: the copy. It checks SQLite's own
integrity, that every table holds the row count the manifest recorded, that the
audit chain still verifies end to end, and that every attachment and photograph
the database references is present with the digest it expects. It exits
non-zero if any of that fails, so a scheduled job that has been writing rubbish
since March shows up as a failed job rather than a directory full of files.

Run `npm run backup -- --check <directory>` against the backup you intend to
rely on, on a schedule. A backup nobody has read is a hypothesis with a
filename.

`restore` verifies before it writes anything, and refuses over an existing
database unless given `--force`. Stop the server first. Everybody signed in
when the backup was taken is signed out afterwards.

### The rehearsal

Done on 5 September 2026, against a seeded installation with a record written
immediately before the backup was taken:

| Step | Result |
| --- | --- |
| Backup, server running | 0.6s, verified |
| Backup with one audit row altered | Refused: "the audit chain in the copy does not verify" |
| Restore of that altered backup | Refused before writing anything |
| Restore over a live directory without `--force` | Refused |
| Restore into an empty directory | 0.6s |
| Sign in to the restored installation | Password and authenticator both worked |
| The record written just before the backup | Present |
| Audit chain on the restored copy | Verifies |

Those numbers are from a small database. Re-time it on a real one, and write
the number down where whoever is on call can find it — the useful thing about
a rehearsal is knowing how long the outage will be before you are in one.

## When something goes wrong

Errors thrown out of a route no longer vanish. Each gets a six-character
reference, which is what the officer sees — "quote 2E0868 if you report it" —
rather than a stack trace, which tells an attacker about the software and the
officer nothing.

They go three places. `<data>/faults.log`, one JSON object per line. The
console, so whatever collects container output has them. And `/api/health`
reports a running count, so anything already polling that can alert on it
climbing without any of the configuration below.

```
AEGIS_ALERT_URL=https://...   # optional; a short notice is POSTed here
```

Point it at whatever you already watch. The requirement is that somebody is
told, not that this software is the one telling them. Sending is fire and
forget and never awaited by a request: an alerting endpoint that is down must
not make the failure it is being told about any worse.

An unhandled rejection is recorded and the process carries on. An uncaught
exception is recorded and the process stops, which is Node's own guidance and
the honest position — the process is in a state nobody reasoned about, and a
supervisor restarting it is safer than it continuing to serve records from
that state. Run this under something that restarts it.

### What the error log holds, and what it must not

Request bodies, query strings and path parameters are never written. The route
pattern is recorded instead of the path, and identifiers are stripped out of
messages and stack traces before they are stored.

That last part matters more than it looks. **The error log is not in the purge
registry.** Nothing in it is removed when a court orders a record destroyed, so
anything about a person that reaches it outlives the expungement of the record
it came from. The stripping catches identifiers; it cannot catch a name
somebody interpolated into an error message. Treat the file accordingly: it is
operational, not evidential, and it should be rotated and discarded on a
schedule like any other log.

## Upgrading

The database records every schema change it has been through, in
`schema_migrations`, with the name and the time. Changes run once, in order, in
a transaction — a half-applied schema change is the one failure that leaves an
installation neither on the old shape nor the new.

Downgrades are refused. Starting an older build against a database that has been
through a change it has never heard of throws before anything is read: running
today's code against tomorrow's shape is how a rollback becomes a corruption.
The message says what to do — deploy the newer build, or restore a backup taken
before the upgrade, which is one more reason for the backup to have been
rehearsed.

Take a backup before upgrading. It is thirty seconds and it is the difference
between a rollback and an incident.

## Taking everything out

A backup is a SQLite file for putting back into this software. An export is for
reading in something else.

```
npm run export -- --to /tmp/leaving
```

One JSON file per collection, both file directories, a README explaining the
shape, and a `checksums.txt` covering every file written. Records are unwrapped
from their storage rows, and the index columns the database searches on are
dropped rather than emitted a second time under a different spelling.

The table list comes from the database itself rather than from a list somebody
maintains, so a collection added next year is in the export the day it exists.
The failure mode is exporting something unnecessary, which is visible; not
quietly leaving a table behind, which is not.

Four things are deliberately left out, and the README says so: password hashes,
authenticator secrets, live sessions, and who had a report open. None of it
describes anybody — it is how this installation recognises people at the
keyboard, it is worthless anywhere else, and a directory of password hashes is
the one thing an export could do to make an agency less safe rather than more
free.

Every file a record points at is checked to be in the export by digest, and the
command exits non-zero if any are missing. A directory of JSON referencing
photographs that are not in it is worse than nothing, because it reads as
complete.

## What this does not do

Read this part.

- **No CJIS-eligible hosting.** Compliance is a property of where this runs,
  who has access, and how they were screened — not of the code. Expect AWS
  GovCloud, Azure Government, or on-premises, with a signed CJIS addendum from
  whoever holds the hardware.
- **MFA is TOTP, not phishing-resistant.** Time-based codes from an
  authenticator app, with enrolment and recovery built rather than bolted on:
  the agency-wide requirement is a setting, a password-only session is refused
  by every route, and clearing somebody's factor needs account-management
  authority, a written reason, and lands in the audit log. What that does not
  give you is phishing resistance — a code typed into a convincing fake sign-in
  page can be replayed inside its thirty seconds. WebAuthn is the follow-on, and
  a CJIS assessor may ask for it depending on how the access is characterised.
- **No encryption at rest.** SQLite writes plaintext, so what protects the
  records is the volume they sit on. Use full-disk or volume-level encryption
  that is FIPS 140-2 validated, and do not assume the hosting provider's
  default qualifies. The setup screen records who confirmed this and on what
  date, and says on its face that it is taking their word for it — the software
  cannot see the disk it runs on and does not pretend to. Until somebody
  confirms it, the readiness screen treats it as blocking.
- **Single instance.** Rate limiting is in-process memory, and SQLite is one
  writer. Fine for one agency; a second instance needs a shared limiter store
  and a different database.
- **No secrets management.** The two secrets are TLS material and
  `AEGIS_SMTP_PASSWORD`, both from the environment. Nothing secret is written
  to the database — an installation that stored the mail password there before
  this was fixed has it removed the next time the server starts. When there are
  more secrets they belong in a secret store rather than the environment.
- **Personnel screening, physical security, incident response and the audit
  review process** are all required by CJIS and none of them are software.
