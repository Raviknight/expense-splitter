# Invite & connection lifecycle

Written before the code, because these edge cases are where ad-hoc logic goes wrong —
the "re-sending gets declined" bug came from exactly that.

Not in `docs/`, which is published to splitab.app.

## The two objects

There are two, and the user should never have to know which they are using.

| | **Connection** | **Invite** |
|---|---|---|
| Between | two people who **both have accounts** | one person and an **email address** |
| Table | `connections` (requester, addressee) | `invites` (inviter, email, token) |
| Delivery | in-app request | email with a `?invite=<token>` link |

## Routing: one input, no choice

The user types an email address and presses one button. The app decides:

```
look up the address (find_profile_by_email)
├── account exists  → create a CONNECTION request. Send NO email.
└── no account      → create an INVITE and email the link.
```

Why no email to existing users: they'll see the request next time they open the app, and
unsolicited mail is what damages a sending domain's reputation. Why one button: the
previous design had two features both called "invite", and picking the wrong one failed
silently — no email, no error, nothing in any log.

## Connection states

```
        (none)
          │  requester sends
          ▼
      ┌────────┐  addressee accepts   ┌──────────┐
      │pending │ ───────────────────► │ accepted │
      └────────┘                      └──────────┘
        │   │
        │   │ addressee declines      ┌──────────┐
        │   └───────────────────────► │ declined │
        │                             └──────────┘
        │ requester withdraws               │ requester tries again
        ▼                                   │ (after a cool-off)
      (none) ◄──────────────────────────────┘
```

- **withdraw** deletes the row, so it vanishes from the addressee's list. Allowed only
  while `pending`. The existing `cancel own request` policy already permits this.
- **declined is NOT terminal.** Today a declined row sticks around and
  `unique (requester, addressee)` blocks any future request — the reported bug. A retry
  deletes the old row and inserts a fresh `pending` one.
- **accepted is NOT silently undoable.** Disconnecting an accepted connection affects
  shared groups, so it is a separate, explicit action — out of scope here.

### Cool-off after a decline

A decline must not become a way to be pestered. A retry is allowed, but not instantly:
`DECLINE_COOLOFF_HOURS = 24`. Enforced in the app for now; if abuse ever appears it moves
into a database policy, which is the only place it cannot be bypassed.

## Invite states

```
        (none)
          │  inviter sends email
          ▼
      ┌────────┐   recipient signs up with that address   ┌──────────┐
      │pending │ ───────────────────────────────────────► │ accepted │
      └────────┘                                          └──────────┘
          │ inviter withdraws
          ▼
        (none)   ← token stops working immediately
```

- **withdraw** deletes the row. `accept_invite` looks the token up, so a deleted row means
  the link is dead — no separate revocation list needed.
- Needs a DELETE policy on `invites`; there wasn't one, which is why invites could not be
  withdrawn at all (db/17).
- **Accepted invites are never deleted** — they are the audit trail of how someone joined.

## Both appear in one "Pending" list

Previously a sent email invite appeared **nowhere**: no record, no way to chase or cancel.
Sent connection requests and sent invites now show in a single list, each with a
**Withdraw** action, labelled so the difference is visible without being a decision the
user had to make.
