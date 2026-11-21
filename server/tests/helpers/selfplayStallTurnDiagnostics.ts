// server/tests/helpers/selfplayStallTurnDiagnostics.ts
//
// Origin: new helper for liveGameHarness.ts (advanceLiveGame, turn-stalled branch).
// Public entry symbols: formatTurnStallDiagnostics.
//
// A "turn-stalled" game has an empty stack and an empty prompt queue, yet the turn never ends, so
// the board line alone does not say why. This adds who has passed priority, the combat
// declarations, and the last saved events (what the engine kept doing while going nowhere).

import { getEvents } from '../../src/db/index.js';

const MAX_EVENTS = 24;

function describeEvent(event: any): string {
  const payload = (event?.payload || {}) as Record<string, unknown>;
  const detail = [
    payload.playerId ? `@${String(payload.playerId)}` : '',
    payload.cardName ? String(payload.cardName) : '',
    payload.abilityId ? String(payload.abilityId) : '',
    payload.effectType ? String(payload.effectType) : '',
  ].filter(Boolean).join(' ');
  return detail ? `${String(event?.type || '?')}(${detail})` : String(event?.type || '?');
}

/** One line: priority passes, combat declarations, and the tail of the event log (run-length compressed). */
export function formatTurnStallDiagnostics(game: any, gameId?: string): string {
  const state = (game?.state || {}) as any;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];

  const passed = state.priorityPassedBy instanceof Set
    ? [...state.priorityPassedBy]
    : Array.isArray(state.priorityPassedBy) ? state.priorityPassedBy : [];
  const attackers = battlefield
    .filter((perm) => perm && perm.attacking)
    .map((perm) => `${String(perm.card?.name || '?')}->${String(perm.attacking)}${perm.blockedBy?.length ? `[blockedBy ${perm.blockedBy.length}]` : ''}`);
  const blockers = battlefield
    .filter((perm) => perm && (perm.blocking?.length || typeof perm.blocking === 'string'))
    .map((perm) => String(perm.card?.name || '?'));

  let tail = '';
  if (gameId) {
    try {
      const events = getEvents(gameId).slice(-MAX_EVENTS).map(describeEvent);
      const runs: string[] = [];
      for (const entry of events) {
        const last = runs[runs.length - 1];
        const match = last?.match(/^(.*) x(\d+)$/);
        if (last === entry) runs[runs.length - 1] = `${entry} x2`;
        else if (match && match[1] === entry) runs[runs.length - 1] = `${entry} x${Number(match[2]) + 1}`;
        else runs.push(entry);
      }
      tail = runs.join(' | ');
    } catch {
      tail = '';
    }
  }

  return [
    `priorityPassedBy=[${passed.join(',')}]`,
    `attackersDeclared=${String(state.attackersDeclared ?? state.attackersDeclaredThisCombat ?? '?')}`,
    `blockersDeclaredBy=[${(Array.isArray(state.blockersDeclaredBy) ? state.blockersDeclaredBy : []).join(',')}]`,
    `attackers=[${attackers.join(', ')}]`,
    `blockers=[${blockers.join(', ')}]`,
    `lastEvents=[${tail}]`,
  ].join(' ');
}
