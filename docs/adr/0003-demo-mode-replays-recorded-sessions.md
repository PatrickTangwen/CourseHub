---
status: accepted
---

# Demo Mode replays recorded sessions through the real frontend

The public GitHub Pages demo is not a separate site: it is the production frontend built in a dedicated Vite demo mode, with its API boundary (`chatApi` / `chatAdapter` / dev-panel fetches) swapped at build time for fixtures recorded from a real local deployment — full SSE stage streams with their timings (replayed with proportionally compressed pacing) plus snapshots of the dev-panel endpoints. We chose this because "identical to the real UI" is only sustainable when the demo and the app share every component, and because recordings are the honest content: the frontend's strict stage decoder validates them, and the answers shown are answers the system actually gave. The typewriter reveal needs no faking — production itself receives the answer whole and animates it, so the demo reuses the exact same presentation code.

## Considered options

- **Independent static replica**: rejected — "fully consistent UI" decays with every frontend change; two implementations of one look.
- **Live hosted backend (e.g. a free Space) behind the Pages frontend**: rejected — no longer static, adds cost, cold starts, and an external availability dependency to a portfolio page.
- **Hand-written fixtures**: rejected — the strict decoder makes fabricated streams brittle, and fabricated answers undermine the claim the demo exists to make.

## Consequences

- Recordings are a snapshot: changing the SSE vocabulary or `ChatAnswer` shape requires re-capturing. The strict decoder makes staleness loud rather than silent.
- Demo-only UI is confined to outside the app shell (the honesty banner) and the data-source boundary (the Demo Notice); everything below the banner is the real app.
- Deploying to Pages imposes two small, generally-correct changes on the main app: base-aware pathname handling and a `404.html` SPA fallback.
