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
| `AEGIS_FEEDBACK_URL` | — | Where officer feedback is posted. Off by default |

### `AEGIS_FEEDBACK_URL`, and what crosses the wire

This is the only setting that sends anything out of your network, so it is off
until you set it, and the server refuses to start in production if it is not
`https`.

With it unset, feedback is written to your own database and goes nowhere. An
administrator exports it from **Setup → Feedback** and sends the file on. That
is the right default for an agency with no outbound path, and it means nothing
leaves without somebody deciding it should.

With it set, each piece of feedback is POSTed as JSON when it is written. What
goes in that request:

- what the officer typed, minus any social security number, which the server
  removes whether or not the browser did;
- their name, badge role, and your agency name and ORI;
- which screen they were on, which field they had been in (`incident.reportedAt`
  — the path, never the value), the build, and their browser.

What does not: any part of a report, any person, any case number. The context
is structural by construction and there is a test that fails if a field capable
of carrying record content is added to it.

Every send is written to the audit log as `feedback.sent`, so what has left the
building is answerable from your own records rather than the vendor's.

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
- **No MFA.** CJIS requires advanced authentication for access to criminal
  justice information. Passwords alone do not satisfy it. This is the largest
  remaining gap and it is deliberate — bolting on TOTP without an enrolment and
  recovery process would look like compliance without being it.
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
