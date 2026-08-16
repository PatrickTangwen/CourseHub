# Add A Worker Composition Root

The hosted Core App Backend will use a dedicated Cloudflare Worker composition root while the existing Node and Docker `server.ts` composition remains available for local validation. Both roots share domain behavior and external contract tests, but assemble runtime-specific adapters for HTTP lifecycle, App DB access, sessions and limiters, Published Snapshot storage, configuration, and TLS; inherited CourseTable modules are not bundled into the first Worker deployment.
