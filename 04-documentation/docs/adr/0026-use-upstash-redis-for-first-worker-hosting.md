# Use Upstash Redis For The First Worker Hosting

The first Cloudflare Worker-hosted App Backend will preserve the existing Redis session and verification-limit semantics through an Upstash Redis REST adapter rather than moving state into Durable Objects. This adds an external managed dependency but keeps the first hosted migration focused on replacing the runtime access boundary instead of redesigning session ownership, TTLs, and authentication rate-limit algorithms; Durable Objects remain a later option.
