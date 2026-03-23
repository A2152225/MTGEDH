# MTGEDH Architecture (Initial)

- Server: Express + Socket.IO authoritative game state
- Client: Vite + React + TS; never assumes hidden info
- Shared: Type contracts and event definitions
- Rules Engine: Pure, deterministic modules acting on immutable state

Server Principles
- Filter hidden info per participant before emitting
- Minimal state diffs over Socket.IO
- SQLite for persistence; simple schemas
- Scryfall via official API; add caching later

Client Principles
- Read-only spectator mode
- Explicit pass/respond priority controls
- No hidden info assumptions

Rules Engine
- Pure functions only
- Commander tax and modular mechanics

Oracle IR Executor
- `rules-engine/src/oracleIRExecutor.ts` remains the main orchestration entrypoint for Oracle IR step execution.
- Step families are being split into focused helper modules to reduce executor size without changing behavior.
- Current extracted modules include battlefield step handlers, move-zone handlers, damage handlers, token handlers, goad handlers, choose-mode handlers, P/T-modifier handlers, shared creature-step utilities, `modify_pt where-X` lookup helpers, class/count parsing plus greatest/least aggregation helpers, mana/color evaluation utilities, commander/command-zone helpers, shared player/state lookup helpers, and shared execution-context/source-target reference helpers.
- When extending Oracle IR execution, prefer adding logic to the focused handler/helper module that matches the step family before growing the main executor again.

Testing
- Start with vitest for rules engine
