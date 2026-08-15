# Use Fixed Thirty Day Hosted Sessions

Hosted UCSD email-login sessions will expire thirty days after verification and will not roll forward on ordinary requests. The browser receives a host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookie and the Upstash record receives the same fixed TTL; this replaces the local stack's one-year default for hosted use, limits the exposure window of a lost session, and avoids write amplification from sliding expiration.
