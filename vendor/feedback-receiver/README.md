# Feedback receiver

The other end of `AEGIS_FEEDBACK_URL`. **This runs on your infrastructure, not
an agency's** — it is the only part of this repository that does.

An agency's server posts each piece of feedback here, signed with that agency's
own key. This verifies the signature, stores the item, and emails you.

## Why not email straight from the agency's server

Because the credentials would have to live on a box you do not control. Anyone
with shell on an agency server could then send mail as you. A per-agency
webhook key can be revoked on its own and is worth nothing anywhere else.

It would also hand the agency control of the channel — relaying through their
mail server means their IT can read, delay or block it, which is the thing the
direct path exists to avoid. And a police network's outbound filtering may
quarantine mail to an external address anyway.

## Deploying it

Ten minutes, and free at any volume a records system will produce.

```bash
cd vendor/feedback-receiver
npm install

# Two stores: the signing keys, and everything received.
npx wrangler kv namespace create KEYS
npx wrangler kv namespace create FEEDBACK
# Paste both printed ids into wrangler.toml.

# Where you want to hear about it. Neither is written to the repo.
npx wrangler secret put RESEND_KEY      # from resend.com — the free tier is plenty
npx wrangler secret put NOTIFY_EMAIL    # your inbox

# Set FROM_EMAIL in wrangler.toml to a verified sender on your own domain.
npx wrangler deploy
```

`deploy` prints the URL. Put it in `VENDOR_FEEDBACK_URL` in `server/vendor.ts`,
and every install built after that forwards by default.

## Adding an agency

Feedback from an agency with no key is refused, so this is part of provisioning
one:

```bash
KEY=$(openssl rand -hex 32)
npx wrangler kv key put --binding=KEYS "AL0010200" "$KEY"   # their ORI
echo "AEGIS_FEEDBACK_KEY=$KEY"                              # goes in their environment
```

To cut one agency off — a decommissioned install, a key you think has leaked —
delete that one key. Nothing else is affected:

```bash
npx wrangler kv key delete --binding=KEYS "AL0010200"
```

## Reading what came in

Email is the notification. The store is the record, and it survives a mail
outage:

```bash
npx wrangler kv key list --binding=FEEDBACK          # newest last; keys sort by time
npx wrangler kv key get --binding=FEEDBACK "<key>"
```

## What arrives

Exactly what `DEPLOYMENT.md` promises agencies: what the officer typed minus any
social security number, who they are, their agency, and structural context —
screen, field *path* (never its value), build, browser. No part of a report, no
person, no case number.

If you ever widen that, widen `DEPLOYMENT.md` in the same commit. Agencies are
shown that page to decide whether to leave forwarding on, and a promise that
quietly stops being true is worse than never having made it.

## What it deliberately does not do

**Reply.** The mailbox is one-way. An answer goes back through the agency's own
feedback screen so the officer sees it against the thing they raised, which is
what makes them report the next one. Replying by email reaches somebody who
never sees it.

**Deduplicate.** Two agencies hitting one fault arrive as two items. Within an
agency, officers second an existing entry rather than writing a second, so the
volume that reaches you is already close to one per distinct problem.

**Retry.** It does not need to. The agency's server keeps trying on any non-2xx,
backing off to twice a day, so an outage here delays feedback rather than losing
it.
