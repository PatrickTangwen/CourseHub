# Use Only The Staging Product Origin

Hosted staging traffic will enter only through `staging.sungridplanner.com`; the default `workers.dev` endpoint is disabled as a public route and the private R2 buckets do not expose `r2.dev`. This preserves the single-origin cookie, WAF, cache, and acceptance boundary and prevents an untested provider URL from bypassing product-domain controls.
