import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import { getLeaveBattlefieldDestination } from '../../shared/src/leaveBattlefieldReplacement';
import type { OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { SimpleBattlefieldSelector, SimplePermanentType } from './oracleIRExecutorBattlefieldParser';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';

export function resolveTapOrUntapTargetIds(
  state: GameState,
  target: OracleObjectSelector | any,
  ctx: OracleIRExecutionContext
): string[] {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const explicitPermanentId = String(ctx.targetPermanentId || '').trim();
  if (explicitPermanentId) {
    const matched = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === explicitPermanentId);
    return matched ? [explicitPermanentId] : [];
  }

  const explicitCreatureId = String(ctx.targetCreatureId || '').trim();
  if (explicitCreatureId) {
    const matched = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === explicitCreatureId);
    return matched ? [explicitCreatureId] : [];
  }

  if (target?.kind !== 'raw') return [];
  const text = String(target?.text || '').trim().toLowerCase();
  if (!text) return [];

  if (text === 'target permanent' && battlefield.length === 1) {
    return [String((battlefield[0] as any)?.id || '').trim()].filter(Boolean);
  }

  if (text === 'target creature') {
    const creatures = battlefield.filter(perm => hasExecutorClass(perm, 'creature'));
    if (creatures.length === 1) {
      return [String((creatures[0] as any)?.id || '').trim()].filter(Boolean);
    }
  }

  return [];
}

export function applyTapOrUntapToBattlefield(
  state: GameState,
  targetIds: readonly string[],
  choice: 'tap' | 'untap'
): GameState {
  const wanted = new Set(targetIds.map(id => String(id || '').trim()).filter(Boolean));
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  for (let idx = 0; idx < battlefield.length; idx += 1) {
    const perm = battlefield[idx] as any;
    const permanentId = String(perm?.id || '').trim();
    if (!wanted.has(permanentId)) continue;
    battlefield[idx] = {
      ...perm,
      tapped: choice === 'tap',
    } as any;
  }

  return { ...(state as any), battlefield } as any;
}

function cleanBattlefieldAfterRemovingIds(
  kept: readonly BattlefieldPermanent[],
  removedIds: ReadonlySet<string>
): BattlefieldPermanent[] {
  return kept.map(p => {
    const next: any = { ...p };
    if (typeof next.attachedTo === 'string' && removedIds.has(next.attachedTo)) next.attachedTo = undefined;
    if (Array.isArray(next.attachments)) next.attachments = next.attachments.filter((id: any) => !removedIds.has(String(id)));
    if (Array.isArray(next.attachedEquipment)) {
      next.attachedEquipment = next.attachedEquipment.filter((id: any) => !removedIds.has(String(id)));
      next.isEquipped = Boolean(next.attachedEquipment.length > 0);
    }
    if (Array.isArray(next.blocking)) next.blocking = next.blocking.filter((id: any) => !removedIds.has(String(id)));
    if (Array.isArray(next.blockedBy)) next.blockedBy = next.blockedBy.filter((id: any) => !removedIds.has(String(id)));
    return next;
  });
}

export function permanentMatchesSelector(
  perm: BattlefieldPermanent,
  sel: SimpleBattlefieldSelector,
  ctx: OracleIRExecutionContext
): boolean {
  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };
  const normalizedControllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const permanentControllerId = normalizeId((perm as any)?.controller);

  if (sel.controllerFilter === 'you') {
    if (!permanentControllerId || permanentControllerId !== normalizedControllerId) return false;
  }

  if (sel.controllerFilter === 'opponents') {
    if (!permanentControllerId || permanentControllerId === normalizedControllerId) return false;
  }

  if (sel.types.includes('permanent')) return true;
  if (sel.types.includes('nonland_permanent')) return hasExecutorClass(perm, 'permanent') && !hasExecutorClass(perm, 'land');

  return sel.types.some(t => {
    switch (t) {
      case 'creature':
        return hasExecutorClass(perm, 'creature');
      case 'artifact':
        return hasExecutorClass(perm, 'artifact');
      case 'enchantment':
        return hasExecutorClass(perm, 'enchantment');
      case 'land':
        return hasExecutorClass(perm, 'land');
      case 'planeswalker':
        return hasExecutorClass(perm, 'planeswalker');
      case 'battle':
        return hasExecutorClass(perm, 'battle');
      case 'vehicle':
        return hasExecutorClass(perm, 'vehicle');
      default:
        return false;
    }
  });
}

export function permanentMatchesType(perm: BattlefieldPermanent, type: SimplePermanentType): boolean {
  switch (type) {
    case 'permanent':
      return true;
    case 'nonland_permanent':
      return hasExecutorClass(perm, 'permanent') && !hasExecutorClass(perm, 'land');
    case 'creature':
      return hasExecutorClass(perm, 'creature');
    case 'artifact':
      return hasExecutorClass(perm, 'artifact');
    case 'enchantment':
      return hasExecutorClass(perm, 'enchantment');
    case 'land':
      return hasExecutorClass(perm, 'land');
    case 'planeswalker':
      return hasExecutorClass(perm, 'planeswalker');
    case 'battle':
      return hasExecutorClass(perm, 'battle');
    case 'vehicle':
      return hasExecutorClass(perm, 'vehicle');
    default:
      return false;
  }
}

export function finalizeBattlefieldRemoval(
  state: GameState,
  removed: readonly BattlefieldPermanent[],
  removedIds: ReadonlySet<string>,
  kept: readonly BattlefieldPermanent[],
  destination: 'graveyard' | 'exile',
  verbPastTense: string
): { state: GameState; log: string[] } {
  const cleanedKept = cleanBattlefieldAfterRemovingIds(kept, removedIds);

  const players = state.players.map(p => ({ ...p } as any));
  let redirectedToExile = 0;
  for (const perm of removed) {
    if ((perm as any).isToken) continue;
    const ownerId = perm.owner;
    const player = players.find(pp => pp.id === ownerId);
    if (!player) continue;

    const actualDestination = getLeaveBattlefieldDestination(perm, destination);
    if (actualDestination === 'exile' && destination !== 'exile') redirectedToExile += 1;

    if (actualDestination === 'graveyard') {
      const gy = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
      gy.push(buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'graveyard'));
      player.graveyard = gy;
    } else {
      const ex = Array.isArray(player.exile) ? [...player.exile] : [];
      ex.push(buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'exile'));
      player.exile = ex;
    }
  }

  const log =
    removed.length > 0
      ? [
          `${verbPastTense} ${removed.length} permanent(s) from battlefield${
            redirectedToExile > 0 ? ` (${redirectedToExile} exiled instead)` : ''
          }`,
        ]
      : [];
  return { state: { ...state, battlefield: cleanedKept as any, players: players as any } as any, log };
}

export function moveMatchingBattlefieldPermanents(
  state: GameState,
  selector: SimpleBattlefieldSelector,
  ctx: OracleIRExecutionContext,
  destination: 'graveyard' | 'exile'
): { state: GameState; log: string[] } {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  const removedIds = new Set<string>();
  const removed: BattlefieldPermanent[] = [];
  const kept: BattlefieldPermanent[] = [];

  for (const perm of battlefield) {
    if (permanentMatchesSelector(perm, selector, ctx)) {
      removed.push(perm);
      removedIds.add(perm.id);
    } else {
      kept.push(perm);
    }
  }

  const verb = destination === 'graveyard' ? 'destroyed' : 'exiled';
  return finalizeBattlefieldRemoval(state, removed, removedIds, kept, destination, verb);
}

export function bounceMatchingBattlefieldPermanentsToOwnersHands(
  state: GameState,
  selector: SimpleBattlefieldSelector,
  ctx: OracleIRExecutionContext
): { state: GameState; log: string[] } {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  const removedIds = new Set<string>();
  const removed: BattlefieldPermanent[] = [];
  const kept: BattlefieldPermanent[] = [];

  for (const perm of battlefield) {
    if (permanentMatchesSelector(perm, selector, ctx)) {
      removed.push(perm);
      removedIds.add(perm.id);
    } else {
      kept.push(perm);
    }
  }

  if (removed.length === 0) return { state, log: [] };

  const cleanedKept = cleanBattlefieldAfterRemovingIds(kept, removedIds);

  const players = state.players.map(p => ({ ...p } as any));
  let redirectedToExile = 0;
  for (const perm of removed) {
    if ((perm as any).isToken) continue;
    const ownerId = perm.owner;
    const player = players.find(pp => pp.id === ownerId);
    if (!player) continue;
    const actualDestination = getLeaveBattlefieldDestination(perm, 'hand');
    if (actualDestination === 'exile') {
      redirectedToExile += 1;
      const exile = Array.isArray(player.exile) ? [...player.exile] : [];
      exile.push(buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'exile'));
      player.exile = exile;
      continue;
    }

    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    hand.push(buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'hand'));
    player.hand = hand;
  }

  const log = [
    `returned ${removed.length} permanent(s) to owners' hands${
      redirectedToExile > 0 ? ` (${redirectedToExile} exiled instead)` : ''
    }`,
  ];
  return { state: { ...state, battlefield: cleanedKept as any, players: players as any } as any, log };
}

export function moveBattlefieldPermanentsByIdToOwnersHands(
  state: GameState,
  permanentIds: readonly string[]
): { state: GameState; log: string[] } {
  const wanted = new Set(permanentIds.map(id => String(id || '').trim()).filter(Boolean));
  if (wanted.size === 0) return { state, log: [] };

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const removedIds = new Set<string>();
  const removed: BattlefieldPermanent[] = [];
  const kept: BattlefieldPermanent[] = [];

  for (const perm of battlefield) {
    const permanentId = String((perm as any)?.id || '').trim();
    if (wanted.has(permanentId)) {
      removed.push(perm);
      removedIds.add(permanentId);
    } else {
      kept.push(perm);
    }
  }

  if (removed.length === 0) return { state, log: [] };

  const cleanedKept = cleanBattlefieldAfterRemovingIds(kept, removedIds);
  const players = state.players.map(p => ({ ...p } as any));
  let redirectedToExile = 0;
  for (const perm of removed) {
    if ((perm as any).isToken) continue;
    const ownerId = perm.owner;
    const player = players.find(pp => pp.id === ownerId);
    if (!player) continue;

    const actualDestination = getLeaveBattlefieldDestination(perm, 'hand');
    if (actualDestination === 'exile') {
      redirectedToExile += 1;
      const exile = Array.isArray(player.exile) ? [...player.exile] : [];
      exile.push(buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'exile'));
      player.exile = exile;
      continue;
    }

    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    hand.push(buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'hand'));
    player.hand = hand;
  }

  return {
    state: { ...state, battlefield: cleanedKept as any, players: players as any } as any,
    log: [
      `returned ${removed.length} permanent(s) to owners' hands${
        redirectedToExile > 0 ? ` (${redirectedToExile} exiled instead)` : ''
      }`,
    ],
  };
}
