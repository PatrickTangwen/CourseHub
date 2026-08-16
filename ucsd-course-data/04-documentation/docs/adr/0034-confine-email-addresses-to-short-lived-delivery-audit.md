# Confine Email Addresses To A Short Lived Delivery Audit

Full UCSD email addresses may appear in a maintainer-only App DB Email Delivery Audit for delivery support and expire after seven days. Cloudflare logs, Sentry, GitHub Actions, and ordinary application logs use only a masked address plus an environment-specific HMAC reference and never contain full email, verification codes or hashes, cookies, sessions, request bodies, connection strings, or secrets; this preserves per-recipient troubleshooting without distributing identity data across general telemetry systems.
