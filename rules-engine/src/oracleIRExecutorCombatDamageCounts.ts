import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';

function getCombatDamagedPlayerIds(state: GameState): string[] {
  const tracker = (state as any)?.creaturesThatDealtDamageToPlayer;
  if (!tracker || typeof tracker !== 'object') return [];

  return Object.entries(tracker)
    .filter(([, entry]) => entry && typeof entry === 'object' && Object.keys(entry as any).length > 0)
    .map(([playerId]) => String(playerId));
}

export function countOpponentsDealtCombatDamageThisTurn(
  state: GameState,
  controller: PlayerID,
): number {
  const players = Array.isArray(state?.players) ? state.players : [];
  const opponentIds = new Set(
    players
      .map((player: any) => String(player?.id || ''))
      .filter((playerId: string) => playerId && playerId !== String(controller)),
  );

  return getCombatDamagedPlayerIds(state).filter((playerId) => opponentIds.has(playerId)).length;
}

export function countPlayersDealtCombatDamageThisTurn(state: GameState): number {
  return getCombatDamagedPlayerIds(state).length;
}

export function countOpponentsDealtCombatDamageBySourceOrSubtypeThisTurn(
  state: GameState,
  controller: PlayerID,
  options: {
    sourcePermanentId?: string;
    sourceName?: string;
    subtype?: string;
  },
): number {
  const tracker = (state as any)?.creaturesThatDealtDamageToPlayer;
  if (!tracker || typeof tracker !== 'object') return 0;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const players = Array.isArray(state?.players) ? state.players : [];
  const opponentIds = new Set(
    players
      .map((player: any) => String(player?.id || ''))
      .filter((playerId: string) => playerId && playerId !== String(controller)),
  );

  const sourcePermanentId = String(options.sourcePermanentId || '').trim();
  const sourceName = String(options.sourceName || '').trim().toLowerCase();
  const subtype = String(options.subtype || '').trim().toLowerCase();

  let count = 0;
  for (const playerId of opponentIds) {
    const entry = (tracker as any)?.[String(playerId)];
    if (!entry || typeof entry !== 'object') continue;

    const matched = Object.entries(entry as Record<string, any>).some(([creatureId, data]) => {
      const damageSourceName = String((data as any)?.creatureName || '').trim().toLowerCase();
      if (sourcePermanentId && String(creatureId) === sourcePermanentId) {
        return true;
      }
      if (sourceName && damageSourceName === sourceName) {
        return true;
      }
      if (!subtype) {
        return false;
      }

      const permanent = battlefield.find((candidate: any) => String(candidate?.id || '') === String(creatureId));
      if (!permanent || String(permanent?.controller || '') !== String(controller)) {
        return false;
      }

      const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
      return typeLine.includes(subtype);
    });

    if (matched) {
      count += 1;
    }
  }

  return count;
}

function parseCombatDamageByClause(
  clauseRaw: string,
  ctx?: OracleIRExecutionContext,
): { sourcePermanentId?: string; sourceName?: string; subtype?: string } {
  const clause = normalizeOracleText(String(clauseRaw || '')).trim();
  const parts = clause.split(/\s+or\s+/).map((part) => part.trim()).filter(Boolean);
  const sourceNameLower = String(ctx?.sourceName || '').trim().toLowerCase();
  const sourceId = String(ctx?.sourceId || '').trim();

  let subtype = '';
  let includesSource = false;

  for (const part of parts) {
    const normalizedPart = part.toLowerCase();
    if (
      normalizedPart === sourceNameLower
      || normalizedPart === 'this permanent'
      || normalizedPart === 'this creature'
      || normalizedPart === 'this source'
    ) {
      includesSource = true;
      continue;
    }

    const subtypeMatch = part.match(/^a[n]?\s+([a-z-]+)$/i);
    if (subtypeMatch) {
      subtype = String(subtypeMatch[1] || '').trim().toLowerCase();
    }
  }

  return {
    sourcePermanentId: includesSource ? sourceId : '',
    sourceName: includesSource ? sourceNameLower : '',
    subtype,
  };
}

export function tryEvaluateCombatDamageReferenceCount(
  state: GameState,
  controllerId: PlayerID,
  rawInput: string,
  ctx?: OracleIRExecutionContext,
): number | null {
  const raw = normalizeOracleText(String(rawInput || ''))
    .replace(/^x is\s+/i, '')
    .replace(/^the number of\s+/i, 'the number of ')
    .trim();
  if (!raw) return null;

  if (/^the number of opponents (?:who|that) were dealt combat damage this turn$/i.test(raw)) {
    return countOpponentsDealtCombatDamageThisTurn(state, controllerId);
  }

  if (/^(?:a card for each |1 for each )?players? who were dealt combat damage this turn$/i.test(raw)) {
    return countPlayersDealtCombatDamageThisTurn(state);
  }

  const bySourceMatch = raw.match(
    /^the number of (?:your )?opponents (?:who|that) were dealt combat damage by (.+) this turn$/i,
  );
  if (bySourceMatch) {
    const options = parseCombatDamageByClause(String(bySourceMatch[1] || ''), ctx);
    return countOpponentsDealtCombatDamageBySourceOrSubtypeThisTurn(state, controllerId, options);
  }

  return null;
}

/**
 * Optional "you may pay X life, where X is [combat-damage count]".
 * X=0 is a legal value but a no-op (pay 0, draw 0) — callers should skip the prompt.
 */
export function isNoOpOptionalCombatDamagePayLife(
  state: GameState,
  controllerId: PlayerID,
  effectText: string,
  ctx?: OracleIRExecutionContext,
): boolean {
  const raw = normalizeOracleText(String(effectText || ''));
  if (!/\byou may pay x life\b/i.test(raw)) return false;
  const whereMatch = raw.match(/where x is\s+(.+?)(?:\.|$)/i);
  if (!whereMatch) return false;
  const counted = tryEvaluateCombatDamageReferenceCount(
    state,
    controllerId,
    String(whereMatch[1] || '').trim(),
    ctx,
  );
  return counted === 0;
}
