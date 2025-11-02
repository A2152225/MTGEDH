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

Testing
- Start with vitest for rules engine