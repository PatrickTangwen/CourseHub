# Isolate Hosted Environment State

Staging and production will use separate App DB, session store, R2 buckets, Hyperdrive binding, Resend key, session secret, backup credential, and deployment identity even when the resources live under the same provider accounts and deploy the same code. The first hosted phase creates staging resources only; production remains unconfigured and login-disabled rather than borrowing staging state or credentials.
