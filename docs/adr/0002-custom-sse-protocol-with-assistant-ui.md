---
status: accepted
---

# Custom SSE stage-event protocol, consumed by an assistant-ui adapter

The rebuilt CourseHub frontend streams *process transparency* (intent fusion → routing → tool calls → answer), not tokens: the backend pipeline produces complete answers and has no LLM-level streaming, and adding it would touch the verified pipeline core. We therefore add a `POST /chat/stream` SSE endpoint at the API layer only, emitting a small repo-internal event vocabulary (`run_started`, `memory_recalled`, `intent_recognized`, `routing_decided`, `tool_call_started/finished`, `answer`, `done`, `error`) whose fields mirror what the pipeline already computes (`ChatResponse` debug fields, typed tool telemetry). The pipeline publishes protocol-neutral typed telemetry; only the API maps those signals to SSE event names. The React frontend consumes the protocol through an [assistant-ui](https://github.com/assistant-ui/assistant-ui) `LocalRuntime` + custom `ChatModelAdapter` — the one candidate from a 2026-08 survey that is MIT-licensed, actively maintained, component-shaped (not a full app), ships first-class collapsible tool-call UI and multi-thread support, and imposes zero constraints on the backend wire format. Both sides of the protocol live in this repo, so the contract is enforced by tests (pytest on event order and `answer`/`/chat` parity; Vitest whole-tree fixture streams on the adapter), not by an external standard.

## Considered options

- **AG-UI protocol + CopilotKit**: rejected for now — strongest multi-agent event semantics and an official FastAPI SDK, but it means reshaping our events into a foreign schema with known gaps (agent attribution), and full brand customization requires rebuilding the UI headless against a premium-tiered feature boundary. Interop with other frontends, its main payoff, is not a need here.
- **Vercel AI SDK stream protocol + AI Elements**: rejected — protocol and tool components fit, but multi-agent display and the conversation sidebar are DIY, at which point assistant-ui offers more for the same custom-adapter cost.
- **Full applications (LibreChat, LobeChat)**: rejected — custom endpoints must impersonate OpenAI's chat.completions format, flattening the stage timeline this frontend exists to show; LobeChat's community license additionally restricts rebranded derivatives.
- **Token-level streaming now**: rejected — requires streaming through the LLM client, agents, and orchestrator; deferred as an additive upgrade (`answer_delta` events alongside the existing vocabulary).

## Consequences

- The event vocabulary is a private API contract: changing its API mapping requires updating the spec (`docs/specs/coursehub-frontend.md` §3.1), both test suites, and the frontend display-name mapping; the pipeline remains unaware of SSE event names.
- The `answer` event arrives whole; the typewriter reveal is presentation, and honest process transparency comes from the stage events being real.
- Adopting AG-UI later is a bridge exercise (our events map onto `STEP_*`/`TOOL_CALL_*`), not a rewrite; adding token deltas is additive and non-breaking.
- The frontend is committed to React and assistant-ui's runtime abstractions; replacing the UI library means rewriting the adapter and thread persistence, though the SSE protocol itself is UI-agnostic.
