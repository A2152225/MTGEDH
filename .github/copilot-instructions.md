# MTGEDH - Copilot Coding Agent Instructions

## Repository Overview

**MTGEDH** is a web-based platform for playing Magic: The Gathering online with up to 8 players. TypeScript monorepo with 4 workspaces: server (Node.js + Express + Socket.IO), client (React), shared (types), rules-engine (MTG rules automation). SQLite database, 132+ test files (2353 tests, 17 known failures). Node.js 18+, npm 9+.

## Critical Build & Validation Commands

### Installation (ALWAYS RUN FIRST)
```bash
npm install  # ~10s, may show 3 high severity vulnerabilities (non-blocking)
```

### Build
```bash
npm run build  # ~5s: Server (tsc), Client (vite build), Shared/rules-engine (no build)
```

### Type Checking
```bash
npm run typecheck --workspace=server|client|shared|rules-engine
```

### Testing
```bash
npm test  # ~10s: Server/client=typecheck, rules-engine=vitest (2353 tests)
```
**17 pre-existing test failures** (actions.test.ts, gameAutomation.test.ts) - NOT your responsibility.

### Development
```bash
npm run dev  # Starts server (port 3001) + client (port 3000), auto-reloads
```

### Linting
**No lint scripts configured** - Do NOT run `npm run lint`. Use typecheck instead.

## Project Architecture

### Structure
```
/server          - Backend (Express + Socket.IO)
  /src/state/modules/    - State mutations (turn.ts, stack-mechanics.ts, can-respond.ts)
  /src/state/resolution/ - Resolution Queue system (READ README.md for player interactions!)
  /src/socket/           - Socket handlers (game-actions.ts, resolution.ts, ai.ts)
  /src/GameManager.ts    - Core game state manager
/client          - React frontend
  /src/App.tsx           - Main component (8000+ lines, search carefully)
/rules-engine    - MTG rules automation, AI (6 strategies), simulation
  /src/actions/          - Keyword actions (Rule 701)
  /test/                 - 132 test files
/shared          - Shared types
/docs            - 25+ .md files (rules-engine-integration.md, simulation-guide.md, etc.)
```

### Key Config Files
- `tsconfig.json` - Composite project with workspace references
- `server/tsconfig.json` - ESNext modules, `strict: false`
- `.env.example` - PORT, DEBUG_STATE (0/1/2), SQLITE_FILE, SCRYFALL_BASE_URL
- `ecosystem.config.cjs` - PM2 production config

### Game State (accessed via `game.state`)
- `players`, `stack`, `turn`, `phase`, `activePlayer`, `manaPool`, `commanderZone`

## Development Workflow

### Making Changes
1. Read `/server/src/state/resolution/README.md` for player interactions
2. Run `npm install` after pulling changes
3. Make minimal, surgical changes
4. Test: `npm run dev` → browser at `http://localhost:3000`
5. Build: `npm run build`
6. Test: `npm test` (expect 17 pre-existing failures)

### Adding Player Interactions (CRITICAL)
**ALWAYS use Resolution Queue** (see `/server/src/state/resolution/README.md`):
1. Define step type in `server/src/state/resolution/types.ts`
2. Add step: `ResolutionQueueManager.addStep(gameId, {...})`
3. Handle response in `server/src/socket/resolution.ts`
4. Update client: `client/src/App.tsx` handleResolutionStepPrompt
5. Submit via `submitResolutionResponse` socket event

**NEVER:** Create `handlePending*` functions, custom socket handlers, or module-level Maps/state.

### Debug Logging
```typescript
import { debug } from './utils/debug';
debug(1, '[module] Important');  // DEBUG_STATE >= 1
debug(2, '[module] Detailed');   // DEBUG_STATE >= 2
```
Set in `.env`: `DEBUG_STATE=1` or `2`

## Critical Codebase Conventions

1. **Resolution Queue:** ALWAYS use `ResolutionQueueManager` for player interactions (never `pending*` state fields)
2. **APNAP Ordering:** Use `orderByAPNAP()` for multiplayer turn order
3. **Commander Tax:** Use `taxById` (per-commander), not `commanderTax`
4. **Auto-pass Context:** Use actual `game.libraries` and `state.manaPool` (not empty defaults)
5. **Oracle Text:** Handle both straight (') and curly (') apostrophes
6. **Phyrexian Mana:** Hybrid with 'LIFE:2' using PHYREXIAN_LIFE_COST constant
7. **Event Cleanup:** Register cleanup handlers for ResolutionQueueManager on socket disconnect
8. **Event Replay:** Events via `appendEvent()` need handlers in `applyEvent.ts`
9. **RNG:** `Math.random()` for IDs, `ctx.rng()` for game-state operations (shuffling)
10. **Type Exports:** Export interfaces from card-data-tables.ts when used across modules
11. **TypeScript:** `strict: false` in server, ESNext modules, source maps enabled
12. **Socket.IO:** `io.to(gameId).emit()` to broadcast, call `game.bumpSeq()` after state changes

## Common Issues & Solutions

1. **17 Test Failures:** Pre-existing in actions.test.ts, gameAutomation.test.ts - NOT your fault
2. **npm run lint fails:** No lint configured, use `npm run typecheck` instead
3. **Port in use:** Change PORT in `.env` or kill process: `lsof -i :3001 && kill -9 <PID>`
4. **Database errors:** Delete `data/mtgedh.sqlite`, restart (auto-recreates)
5. **WebSocket issues:** Ensure both client/server running via `npm run dev`
6. **TypeScript errors:** Check imports use `.js` extension, run `npm run typecheck --workspace=<name>`
7. **Client not updating:** Hard refresh (Ctrl+Shift+R), check Vite HMR, restart dev server

## Production Deployment

### PM2 (Recommended)
```bash
npm install -g pm2
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 logs mtgedh-server  # View logs
pm2 restart mtgedh-server
```

### IIS (Windows)
See `SETUP.md` and `docs/iis-setup-guide.md`. Requires: IIS + URL Rewrite + ARR + WebSocket Protocol, PM2, web.config (included), copy client/dist/ to IIS root.

## Key Documentation & Testing

### Must-Read Docs
- `server/src/state/resolution/README.md` - **CRITICAL:** Player interaction patterns
- `docs/rules-engine-integration.md` - Rules engine architecture
- `docs/simulation-guide.md` - AI simulation
- Root .md files - Implementation notes for specific features (AI_MANA_RETENTION_FIX.md, BOUNCE_LAND_IMPLEMENTATION.md, etc.)

### Testing
```bash
npm test                              # All tests (2353, 17 known failures)
npm run dev:test --workspace=rules-engine  # Watch mode
cd rules-engine && npx vitest run test/actions.test.ts  # Specific file
```
**Add tests:** Create `rules-engine/test/featureName.test.ts`, use `describe()`/`it()` blocks (Vitest).

## Trust These Instructions

Validated by running all commands, examining codebase, reviewing docs, testing workflows. **Only search if:**
- Instructions incomplete for your task
- Information contradicts these instructions
- Need implementation details not covered

**For most tasks:** Read above → Check recommended docs → Look at similar code → Make changes → Test with `npm run dev` and `npm test`

## Final Notes

- Small, incremental changes over large refactors
- Test with `npm run dev` before committing
- Update .md files for major features
- Node.js 18+ compatibility
- Never commit secrets
- Consider multiplayer (8 players) in optimizations
- When implementing issues: Fix all root causes, use scalable methods (regex for dynamic detection), add/update UI elements, wire up sockets/emits/handlers, complete start-to-finish, re-use components, compile server+client at end, fix all errors even if unrelated

