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

## Backups

Everything is two things: `aegis.db` and `attachments/`. SQLite in WAL mode
should be copied with `sqlite3 aegis.db ".backup out.db"` rather than `cp`,
which can catch a write mid-flight. Back up the attachment directory alongside
it — a database referencing files that no longer exist is worse than neither.

Restore is a matter of putting both back and starting the container.

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
- **No encryption at rest.** SQLite writes plaintext. Use full-disk or
  volume-level encryption that is FIPS 140-2 validated; do not assume the
  filesystem default qualifies.
- **Single instance.** Rate limiting is in-process memory, and SQLite is one
  writer. Fine for one agency; a second instance needs a shared limiter store
  and a different database.
- **No secrets management.** There are no application secrets yet beyond TLS
  material. When there are, they belong in a secret store, not the environment.
- **Personnel screening, physical security, incident response and the audit
  review process** are all required by CJIS and none of them are software.
