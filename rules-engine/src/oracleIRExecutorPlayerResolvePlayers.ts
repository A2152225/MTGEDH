// Extracted from oracleIRExecutorPlayerUtils.ts.
// Cluster: resolvePlayers, resolvePlayersFromDamageTarget, and exclusive
// player-selector helpers (life-total / raw-text / land-count / owner-controller).
// Public entries: resolvePlayers, resolvePlayersFromDamageTarget,
// countControlledLands, listEligibleChooseOpponentIds,
// isThatOwnerOrControllerSelector, isThoseOpponentsSelector.

import type { GameState, PlayerID } from '../../shared/src';
import type { OraclePlayerSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  resolveReferencedObjectPlayerIds,
  type ReferencedObjectRuntime,
} from './oracleIRExecutorReferenceUtils';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';

function resolvePlayerByLifeTotal(state: GameState, mode: 'most' | 'least'): readonly PlayerID[] {
  const entries = (state.players || [])
    .map((player: any) => ({
      id: String(player?.id || '').trim(),
      life: Number(player?.life ?? 0),
    }))
    .filter(entry => Boolean(entry.id));
  if (entries.length === 0) return [];

  const targetLife =
    mode === 'most'
      ? Math.max(...entries.map(entry => entry.life))
      : Math.min(...entries.map(entry => entry.life));
  const matches = entries.filter(entry => entry.life === targetLife).map(entry => entry.id as PlayerID);
  return matches.length === 1 ? matches : matches.slice(0, 1);
}

function resolvePlayersFromRawSelectorText(
  state: GameState,
  rawText: string,
  ctx: OracleIRExecutionContext
): readonly PlayerID[] {
  const normalized = String(rawText || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!normalized) return [];

  if (normalized === 'the player with the most life') return resolvePlayerByLifeTotal(state, 'most');
  if (normalized === 'the player with the lowest life total') return resolvePlayerByLifeTotal(state, 'least');
  if (normalized === "the exiled card's owner" || normalized === 'the exiled cards owner') {
    return resolvePlayers(state, { kind: 'owner_of_source' }, ctx);
  }

  return resolvePlayersFromDamageTarget(state, { kind: 'raw', text: rawText }, ctx);
}

export function resolvePlayers(
  state: GameState,
  selector: OraclePlayerSelector,
  ctx: OracleIRExecutionContext,
  runtime?: ReferencedObjectRuntime
): readonly PlayerID[] {
  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };

  const controllerId = normalizeId(ctx.controllerId) ?? ctx.controllerId;
  const hasValidController = (state.players || []).some((player: any) => normalizeId(player?.id) === controllerId);
  const opponents = hasValidController
    ? (state.players || [])
        .map((player: any) => normalizeId(player?.id))
        .filter((id: PlayerID | undefined): id is PlayerID => Boolean(id) && id !== controllerId)
    : [];
  const opponentIdSet = new Set(opponents);
  const allPlayerIds = new Set(
    (state.players || [])
      .map((player: any) => normalizeId(player?.id))
      .filter((id: PlayerID | undefined): id is PlayerID => Boolean(id))
  );

  const dedupe = (ids: readonly PlayerID[]): readonly PlayerID[] => {
    const out: PlayerID[] = [];
    const seen = new Set<PlayerID>();
    for (const id of ids) {
      const normalized = normalizeId(id);
      if (!normalized || !allPlayerIds.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  };

  const dedupeOpponents = (ids: readonly PlayerID[]): readonly PlayerID[] =>
    dedupe(ids).filter(id => opponentIdSet.has(id));

  switch (selector.kind) {
    case 'you':
      return hasValidController ? [controllerId] : [];
    case 'any_player':
      return state.players.map(p => p.id);
    case 'each_player':
      return state.players.map(p => p.id);
    case 'each_opponent':
      return opponents;
    case 'any_number_of_target_opponents': {
      const chosenTargets = Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? dedupeOpponents(ctx.selectorContext.chosenObjectIds as PlayerID[])
        : [];
      if (chosenTargets.length > 0) return chosenTargets;
      const bound = normalizeId(ctx.selectorContext?.targetOpponentId);
      if (bound && opponentIdSet.has(bound)) return [bound];
      return opponents;
    }
    case 'any_number_of_target_players': {
      const chosenTargets = Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? dedupe(ctx.selectorContext.chosenObjectIds as PlayerID[])
        : [];
      if (chosenTargets.length > 0) return chosenTargets;
      const bound = normalizeId(ctx.selectorContext?.targetPlayerId) ?? normalizeId(ctx.selectorContext?.targetOpponentId);
      if (bound && allPlayerIds.has(bound)) return [bound];
      return [];
    }
    case 'you_and_target_opponent': {
      const target = normalizeId(ctx.selectorContext?.targetOpponentId) ?? normalizeId(ctx.selectorContext?.targetPlayerId);
      const opponent = target && opponentIdSet.has(target) ? target : opponents.length === 1 ? opponents[0] : undefined;
      return opponent ? dedupe([controllerId, opponent]) : (hasValidController ? [controllerId] : []);
    }
    case 'you_and_target_player': {
      const target = normalizeId(ctx.selectorContext?.targetPlayerId) ?? normalizeId(ctx.selectorContext?.targetOpponentId);
      const player = target && allPlayerIds.has(target) ? target : opponents.length === 1 ? opponents[0] : undefined;
      return player ? dedupe([controllerId, player]) : (hasValidController ? [controllerId] : []);
    }
    case 'each_of_those_opponents': {
      const contextual = ctx.selectorContext?.eachOfThoseOpponents;
      if (Array.isArray(contextual) && contextual.length > 0) {
        return dedupeOpponents(contextual as PlayerID[]);
      }
      return opponents.length === 1 ? [opponents[0]] : [];
    }
    case 'target_opponent': {
      const bound = normalizeId(ctx.selectorContext?.targetOpponentId);
      if (bound && opponentIdSet.has(bound)) return [bound];
      const boundPlayer = normalizeId(ctx.selectorContext?.targetPlayerId);
      if (boundPlayer && opponentIdSet.has(boundPlayer)) return [boundPlayer];
      return opponents.length === 1 ? [opponents[0]] : [];
    }
    case 'enchanted_player': {
      const bound = normalizeId(ctx.selectorContext?.targetPlayerId);
      if (bound && allPlayerIds.has(bound)) return [bound];

      const sourceId = String(ctx.sourceId || '').trim();
      if (sourceId) {
        const sourcePermanent = (state.battlefield || []).find(
          (permanent: any) => String(permanent?.id || '').trim() === sourceId
        ) as any;
        const attachedTo = String(
          sourcePermanent?.attachedTo ||
            sourcePermanent?.enchanting ||
            sourcePermanent?.enchantedPlayerId ||
            ''
        ).trim();
        if (attachedTo && allPlayerIds.has(attachedTo as PlayerID)) {
          return [attachedTo as PlayerID];
        }
      }
      return [];
    }
    case 'target_player': {
      const bound =
        normalizeId(ctx.targetPlayerId) ??
        normalizeId(ctx.selectorContext?.targetPlayerId);
      if (bound && allPlayerIds.has(bound)) return [bound];
      const boundOpponent =
        normalizeId(ctx.selectorContext?.targetOpponentId) ??
        normalizeId(ctx.targetOpponentId);
      if (boundOpponent && allPlayerIds.has(boundOpponent)) return [boundOpponent];
      const boundSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
      if (boundSpellId) {
        const stackItem = (state.stack || []).find((item: any) => String(item?.id || '').trim() === boundSpellId) as any;
        const spellControllerId = normalizeId(stackItem?.controller || stackItem?.owner);
        if (spellControllerId && allPlayerIds.has(spellControllerId)) {
          return [spellControllerId];
        }
      }
      return opponents.length === 1 ? [opponents[0]] : [];
    }
    case 'owner_of_moved_cards':
      return resolveReferencedObjectPlayerIds(state, ctx, 'controller', runtime);
    case 'controller_of_referenced_object':
      return resolveReferencedObjectPlayerIds(state, ctx, 'controller', runtime);
    case 'owner_of_referenced_object':
      return resolveReferencedObjectPlayerIds(state, ctx, 'owner', runtime);
    case 'owner_of_source': {
      const movedCards = Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : [];
      const sacrificed = Array.isArray(ctx.lastSacrificedPermanents) ? ctx.lastSacrificedPermanents : [];
      for (const entry of [...sacrificed, ...movedCards].reverse()) {
        const ownerId = normalizeId((entry as any)?.owner || (entry as any)?.controller);
        if (ownerId && allPlayerIds.has(ownerId)) return [ownerId];
      }
      const sourceId = String(ctx.sourceId || '').trim();
      if (sourceId) {
        for (const player of state.players || []) {
          const playerId = normalizeId((player as any)?.id);
          if (!playerId) continue;
          for (const zone of ['battlefield', 'graveyard', 'hand', 'exile', 'library'] as const) {
            if (zone === 'battlefield') {
              const permanent = (state.battlefield || []).find(
                (entry: any) => String(entry?.id || '').trim() === sourceId
              ) as any;
              if (permanent) {
                const ownerId = normalizeId(permanent?.owner || permanent?.controller);
                if (ownerId && allPlayerIds.has(ownerId)) return [ownerId];
              }
              continue;
            }
            const cards = zone === 'library'
              ? (Array.isArray((player as any)?.library) ? (player as any).library : [])
              : Array.isArray((player as any)?.[zone])
                ? (player as any)[zone]
                : [];
            if (cards.some((card: any) => String(card?.id || '').trim() === sourceId)) {
              return [playerId];
            }
          }
        }
      }
      return hasValidController ? [controllerId] : [];
    }
    case 'high_bidder': {
      const bound = normalizeId((ctx as any).highBidderPlayerId ?? ctx.selectorContext?.highBidderPlayerId);
      if (bound && allPlayerIds.has(bound)) return [bound];
      return hasValidController ? [controllerId] : [];
    }
    case 'source_controller': {
      const sourceId = String(ctx.sourceId || '').trim();
      if (sourceId) {
        const permanent = (state.battlefield || []).find(
          (entry: any) => String(entry?.id || '').trim() === sourceId
        ) as any;
        const sourceController = normalizeId(permanent?.controller || permanent?.controllerId);
        if (sourceController && allPlayerIds.has(sourceController)) return [sourceController];
      }
      const bound = normalizeId(ctx.selectorContext?.targetPlayerId);
      if (bound && allPlayerIds.has(bound)) return [bound];
      return hasValidController ? [controllerId] : [];
    }
    case 'each_player_who_controls_the_most': {
      const filter = String((selector as any).filter || 'creatures')
        .replace(/[.]+$/g, '')
        .trim()
        .toLowerCase();
      const counts = new Map<PlayerID, number>();
      for (const permanent of (state.battlefield || []) as any[]) {
        const typeLine = String(permanent?.type_line || permanent?.typeLine || '').toLowerCase();
        if (filter.includes('creature') && !typeLine.includes('creature')) continue;
        const owner = normalizeId(permanent?.controller || permanent?.controllerId);
        if (!owner || !allPlayerIds.has(owner)) continue;
        counts.set(owner, (counts.get(owner) || 0) + 1);
      }
      if (counts.size === 0) return hasValidController ? [controllerId] : [];
      const max = Math.max(...counts.values());
      return [...counts.entries()].filter(([, count]) => count === max).map(([id]) => id);
    }
    case 'each_controller_of_those':
      return [];
    case 'unknown':
    default: {
      const rawText =
        (selector as any).kind === 'raw'
          ? String((selector as any).text || '')
          : String((selector as any).raw || '');
      if (!rawText) return [];
      return resolvePlayersFromRawSelectorText(state, rawText, ctx);
    }
  }
}

export function countControlledLands(state: GameState, playerId: string): number {
  const id = String(playerId || '').trim();
  if (!id) return 0;
  return (state.battlefield || []).filter((permanent: any) => (
    String(permanent?.controller || '').trim() === id && hasExecutorClass(permanent, 'land')
  )).length;
}

export function listEligibleChooseOpponentIds(
  state: GameState,
  controllerId: string,
  raw: string,
): PlayerID[] {
  const you = String(controllerId || '').trim();
  const opponents = (state.players || [])
    .map((player: any) => String(player?.id || '').trim())
    .filter((id: string) => Boolean(id) && id !== you) as PlayerID[];
  if (!/who\s+controls\s+more\s+lands\s+than\s+you/i.test(String(raw || ''))) {
    return opponents;
  }
  const yourLands = countControlledLands(state, you);
  return opponents.filter((id) => countControlledLands(state, id) > yourLands);
}

export function resolvePlayersFromDamageTarget(
  state: GameState,
  target: { readonly kind: 'raw'; readonly text: string } | { readonly kind: 'unknown'; readonly raw: string },
  ctx: OracleIRExecutionContext
): readonly PlayerID[] {
  if (target.kind !== 'raw') return [];

  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };
  const allPlayerIds = new Set(
    (state.players || [])
      .map((player: any) => normalizeId(player?.id))
      .filter((id: PlayerID | undefined): id is PlayerID => Boolean(id))
  );

  const t = String(target.text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\.!]$/, '');
  if (!t) return [];

  if (t === 'you') return resolvePlayers(state, { kind: 'you' }, ctx);
  // Bare "target" is how truncated ability text (and some test stubs) spell any-target.
  if (t === 'any target' || t === 'target') {
    // Permanent bindings also set targetPlayerId for pronoun resolution; prefer the
    // chosen permanent when the cast target was a battlefield object.
    const boundPermanentId = normalizeId(ctx.targetPermanentId)
      || normalizeId(ctx.selectorContext?.targetPermanentId);
    if (boundPermanentId) return [];

    const targetPlayerId = normalizeId(ctx.selectorContext?.targetPlayerId)
      ?? normalizeId(ctx.targetPlayerId);
    if (targetPlayerId && allPlayerIds.has(targetPlayerId)) return [targetPlayerId];

    const targetOpponentId = normalizeId(ctx.selectorContext?.targetOpponentId)
      ?? normalizeId(ctx.targetOpponentId);
    if (targetOpponentId && allPlayerIds.has(targetOpponentId)) return [targetOpponentId];
  }
  if (t === 'target player') return resolvePlayers(state, { kind: 'target_player' }, ctx);
  if (t === 'target opponent') return resolvePlayers(state, { kind: 'target_opponent' }, ctx);
  if (
    t === 'that player' ||
    t === 'he or she' ||
    t === 'him or her' ||
    t === 'they' ||
    t === 'its controller' ||
    t === 'its owner' ||
    isThatOwnerOrControllerSelector(t)
  ) {
    if (t === 'its owner' || /(?:^| )owner$/.test(t)) {
      return resolvePlayers(state, { kind: 'owner_of_referenced_object' }, ctx);
    }
    return resolvePlayers(state, { kind: 'controller_of_referenced_object' }, ctx);
  }
  if (t === 'defending player' || t === 'the defending player') {
    return resolvePlayers(state, { kind: 'target_opponent' }, ctx);
  }
  if (t === 'that opponent') return resolvePlayers(state, { kind: 'target_opponent' }, ctx);
  if (isThoseOpponentsSelector(t)) return resolvePlayers(state, { kind: 'each_of_those_opponents' }, ctx);
  if (t === 'each player') return resolvePlayers(state, { kind: 'each_player' }, ctx);
  if (t === 'each of your opponents' || t === 'each of the opponents') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  if (t === 'each opponent') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  if (t === 'your opponents') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  if (t === 'all opponents' || t === 'all of your opponents' || t === 'all of the opponents') {
    return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  }
  if (t === 'all your opponents') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);

  return [];
}

export function isThatOwnerOrControllerSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[â€™]/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:that|the) [a-z0-9][a-z0-9 -]*'s (?:controller|owner)$/i.test(s);
}

export function isThoseOpponentsSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[â€™]/g, "'")
    .trim()
    .toLowerCase();
  return s === 'each of those opponents' || s === 'those opponents' || s === 'all of those opponents' || s === 'all those opponents';
}
