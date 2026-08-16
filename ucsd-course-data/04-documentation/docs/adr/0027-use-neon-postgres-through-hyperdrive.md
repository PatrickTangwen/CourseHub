# Use Neon Postgres Through Hyperdrive

The first Cloudflare-hosted App Backend will keep the App DB on Neon PostgreSQL and access it at runtime through Cloudflare Hyperdrive. This preserves the existing PostgreSQL schema and versioned Drizzle migrations while allowing the low-traffic staging database to begin on Neon's free, scale-to-zero tier; migrations and backups remain separate controlled operations that connect directly to Neon rather than running through request handling.
