/**
 * socket/join-handlers/index.ts
 *
 * Internal table of contents for clusters extracted out of
 * server/src/socket/join.ts. Named re-exports only - no implementations,
 * no `export *`. Leaves must never import join.ts or this index.
 *
 * The public/compatibility barrel stays socket/join.ts.
 */

// Zone defaults plus authoritative game.state.zones / intervening-if tracker seed.
export { defaultPlayerZones, ensureStateZonesForPlayers } from "./joinEnsureStateZones.js";
