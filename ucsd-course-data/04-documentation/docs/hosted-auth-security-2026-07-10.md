# Hosted email authentication security note (2026-07-10)

This note records the hosted verification controls introduced for issue #80.

## Trusted proxy boundary

`TRUSTED_PROXY_CIDRS` is a comma-separated allowlist of reverse-proxy address
ranges. It defaults to empty, which means the API trusts no proxy and derives
the request source from the direct socket. In that mode, a client-provided
`X-Forwarded-For` header has no effect.

Only add the exact internal address or CIDR ranges from which the deployed API
actually receives proxy connections. Do not add client networks or a broad
internet range. When the API port is published directly, leave the setting
empty. If the proxy topology changes, update this allowlist before relying on
forwarded client addresses.

## Verification request and guessing budgets

The defaults are:

- `VERIFICATION_SOURCE_LIMIT=5` and
  `VERIFICATION_SOURCE_WINDOW_SECONDS=900` for email-send requests per source.
- `VERIFICATION_GLOBAL_LIMIT=100` and
  `VERIFICATION_GLOBAL_WINDOW_SECONDS=900` for the total provider send budget.
- `VERIFICATION_ATTEMPT_SOURCE_LIMIT=20` and
  `VERIFICATION_ATTEMPT_SOURCE_WINDOW_SECONDS=900` for code attempts per source.
- `VERIFICATION_ATTEMPT_EMAIL_LIMIT=5` and
  `VERIFICATION_ATTEMPT_EMAIL_WINDOW_SECONDS=900` for code attempts per email.

Source and email identifiers are HMAC-digested before becoming Redis keys. A
successful code consumption clears only that email's guessing budget; the
source budget remains bounded for the rest of its window.

The request-source budget is checked before code generation or any database
reservation. The global provider budget is charged only after a reservation is
created and immediately before the provider send, so cooldown and pending
responses do not consume delivery capacity.

## Ambiguous delivery

Verification reservations are durable and move through `pending`, `sent`, and
`failed` states. A definitive provider rejection becomes `failed` and may be
retried subject to the send budgets. A transport error, process interruption,
or database acknowledgement failure leaves the reservation `pending` until
the code expires. The same code remains consumable if the email arrived, and a
replacement email/code is not generated during that interval.
