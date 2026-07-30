import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export type Batch369BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  getCastManaSpendSource: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
  getConditionalSubjectCard: (params: Batch369BulkParams) => any | null;
  getReferencedObject: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
  controlledCreatures: (nextState: GameState, controllerId: PlayerID) => any[];
  getGraveyardCards: (nextState: GameState, controllerId: PlayerID) => any[];
  getControllerLife: (nextState: GameState, controllerId: PlayerID) => number | null;
  parseSmallNumberWord: (text: string) => number | null;
  objectHasType: (object: any, type: string) => boolean;
  isPermanentAttacking: (perm: any) => boolean;
  cardMatchesChosenColor: (card: any, chosenColor: string) => boolean;
  contextualCardsFrom: (params: Batch369BulkParams) => any[];
  movedCardsFrom: (params: Batch369BulkParams) => any[];
  objectHasAnyCounters: (object: any) => boolean;
  getCreaturePower: (perm: any) => number;
  getEnchantedCreatureFromAura: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
};

function getDefendingPlayerId(
  nextState: GameState,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID
): string | null {
  const source = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );
  const fromCtx = String(
    (ctx as any)?.defendingPlayerId ??
      ctx.selectorContext?.targetOpponentId ??
      ctx.selectorContext?.targetPlayerId ??
      (ctx as any)?.thatPlayerId ??
      ''
  ).trim();
  if (fromCtx) return fromCtx;
  const fromSource = String((source as any)?.defendingPlayerId ?? (source as any)?.attacking ?? '').trim();
  return fromSource || null;
}

function typeLineHasSubtype(typeLine: string, subtype: string): boolean {
  const tl = String(typeLine || '').toLowerCase();
  const word = String(subtype || '').toLowerCase();
  if (!word) return false;
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(tl);
}

function countControlledSubtype(
  nextState: GameState,
  playerId: string,
  subtype: string
): number | null {
  const battlefield = getProcessedBattlefield(nextState) as any[];
  if (!Array.isArray(battlefield)) return null;
  let count = 0;
  for (const perm of battlefield) {
    if (String(perm?.controller || '').trim() !== String(playerId || '').trim()) continue;
    const tl = getExecutorTypeLineLower(perm);
    if (!tl.includes('creature')) continue;
    if (typeLineHasSubtype(tl, subtype)) count += 1;
  }
  return count;
}

function defenderControlsNoColoredPermanents(
  nextState: GameState,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  color: string,
  cardMatchesChosenColor: (card: any, chosenColor: string) => boolean
): boolean | null {
  const defendingPlayerId = getDefendingPlayerId(nextState, ctx, controllerId);
  if (!defendingPlayerId) return null;
  const battlefield = getProcessedBattlefield(nextState) as any[];
  let sawPermanent = false;
  for (const perm of battlefield) {
    if (String(perm?.controller || '').trim() !== defendingPlayerId) continue;
    sawPermanent = true;
    if (cardMatchesChosenColor(perm, color)) return false;
    const colors = getColorsFromObject(perm);
    const letter = color.toLowerCase().charAt(0);
    const map: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    if (colors.includes(map[color.toLowerCase()] ?? letter.toUpperCase())) return false;
  }
  return sawPermanent ? true : true;
}

function readSpectaclePaid(nextState: GameState, ctx: OracleIRExecutionContext, getReferencedObject: Batch369BulkParams['getReferencedObject']): boolean | null {
  const readFrom = (candidate: any): boolean | null => {
    if (!candidate || typeof candidate !== 'object') return null;
    const altId = candidate?.alternateCostId ?? candidate?.card?.alternateCostId;
    if (typeof altId === 'string' && altId.length > 0) {
      return String(altId).toLowerCase() === 'spectacle';
    }
    const raw =
      candidate?.spectacleCostPaid ??
      candidate?.paidSpectacleCost ??
      candidate?.castWithSpectacle ??
      candidate?.card?.spectacleCostPaid ??
      candidate?.card?.paidSpectacleCost;
    return typeof raw === 'boolean' ? raw : null;
  };
  const source = getReferencedObject(nextState, ctx);
  const fromSource = readFrom(source);
  if (typeof fromSource === 'boolean') return fromSource;
  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (targetSpellId) {
    const stackItem = ((nextState as any)?.stack || []).find(
      (entry: any) => String(entry?.id || '').trim() === targetSpellId
    );
    const fromStack = readFrom(stackItem);
    if (typeof fromStack === 'boolean') return fromStack;
  }
  const stackItemFromCtx = (ctx as any)?.stackItem;
  const fromCtx = readFrom(stackItemFromCtx);
  if (typeof fromCtx === 'boolean') return fromCtx;
  return null;
}

function evaluateWallOnlyBlocking(params: Batch369BulkParams): boolean | null {
  const { normalizedRaw, nextState, ctx } = params;
  if (
    normalizedRaw !==
    'at least one other wall creature is blocking that creature and no non-wall creatures are blocking that creature'
  ) {
    return null;
  }
  const thatId = String(
    (ctx as any)?.thatCreatureId ??
      ctx.targetCreatureId ??
      ctx.targetPermanentId ??
      ctx.selectorContext?.targetCreatureId ??
      ''
  ).trim();
  if (!thatId) return null;

  const blockerIds: string[] = Array.isArray((ctx as any)?.blockingCreatureIds)
    ? ((ctx as any).blockingCreatureIds as string[])
    : [];
  const computedBlockerIds: string[] = [];
  if (!blockerIds.length) {
    const that = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, thatId);
    const blockedBy = (that as any)?.blockedBy;
    if (Array.isArray(blockedBy)) {
      for (const bid of blockedBy) {
        const id = String(bid ?? '').trim();
        if (id) computedBlockerIds.push(id);
      }
    } else {
      for (const perm of getProcessedBattlefield(nextState) as any[]) {
        const raw = (perm as any)?.blocking;
        if (!raw) continue;
        const ids = Array.isArray(raw) ? raw : [raw];
        if (ids.some((x: any) => String(x ?? '').trim() === thatId)) {
          const id = String((perm as any)?.id ?? '').trim();
          if (id) computedBlockerIds.push(id);
        }
      }
    }
  }

  const finalBlockerIds = blockerIds.length ? blockerIds : computedBlockerIds;
  if (!finalBlockerIds.length) return null;

  const source = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );
  const excludeId = String((source as any)?.id ?? ctx.sourceId ?? '').trim();
  let anyOtherWall = false;
  let anyNonWall = false;
  let sawAll = true;
  for (const bid of finalBlockerIds) {
    const b = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, String(bid));
    if (!b) {
      sawAll = false;
      continue;
    }
    const tl = getExecutorTypeLineLower(b);
    if (!tl.includes('creature')) continue;
    if (typeLineHasSubtype(tl, 'wall')) {
      if (!excludeId || String((b as any)?.id ?? '').trim() !== excludeId) anyOtherWall = true;
    } else {
      anyNonWall = true;
    }
  }
  if (anyNonWall) return false;
  if (!anyOtherWall) return sawAll ? false : null;
  return sawAll ? true : null;
}

export function evaluateBatch369BulkConditionalClause(params: Batch369BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  {
    const lifeLessMatch = normalizedRaw.match(/^your life total is less than (\d+)$/i);
    if (lifeLessMatch) {
      const threshold = Number.parseInt(String(lifeLessMatch[1] || ''), 10);
      const life = params.getControllerLife(nextState, controllerId);
      if (life === null || !Number.isFinite(threshold)) return null;
      return life < threshold;
    }
  }

  if (
    normalizedRaw === "it had power greater than this creature's power" ||
    normalizedRaw === "it had power greater than drizzt's power"
  ) {
    const moved = params.movedCardsFrom(params);
    const dead =
      moved[0] ??
      params.contextualCardsFrom(params)[0] ??
      (ctx.targetPermanentId
        ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, String(ctx.targetPermanentId))
        : null);
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!dead || !source) return null;
    const deadPower = params.getCreaturePower(dead);
    const sourcePower = params.getCreaturePower(source);
    return deadPower > sourcePower;
  }

  if (normalizedRaw === 'a land you controlled was put into a graveyard from the battlefield this turn') {
    const map = (nextState as any)?.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return v === true ? true : v === false ? false : false;
    }
    return map === undefined ? null : false;
  }

  if (normalizedRaw === 'defending player controls no walls') {
    const defendingPlayerId = getDefendingPlayerId(nextState, ctx, controllerId);
    if (!defendingPlayerId) return null;
    const count = countControlledSubtype(nextState, defendingPlayerId, 'wall');
    return count === null ? null : count === 0;
  }

  {
    const exactLifeMatch = normalizedRaw.match(/^you have exactly (one|\d+|[a-z]+) life$/i);
    if (exactLifeMatch) {
      const target = params.parseSmallNumberWord(String(exactLifeMatch[1] || ''));
      const life = params.getControllerLife(nextState, controllerId);
      if (target === null || life === null) return null;
      return life === target;
    }
  }

  {
    const wallResult = evaluateWallOnlyBlocking(params);
    if (wallResult !== null) return wallResult;
  }

  {
    const itsOrTypesMatch = normalizedRaw.match(/^it'?s (?:a|an) (.+)$/i);
    if (itsOrTypesMatch) {
      const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
      if (!ref) return false;
      const types = String(itsOrTypesMatch[1] || '')
        .split(/\s*,\s*|\s+or\s+/)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
      return types.some((typeName) => params.objectHasType(ref, typeName.replace(/^an?\s+/, '')));
    }
  }

  if (normalizedRaw === 'enchanted creature is a wolf or werewolf') {
    const enchanted = params.getEnchantedCreatureFromAura(nextState, ctx);
    if (!enchanted) return null;
    const tl = getExecutorTypeLineLower(enchanted);
    return typeLineHasSubtype(tl, 'wolf') || typeLineHasSubtype(tl, 'werewolf');
  }

  if (normalizedRaw === "that creature's power is greater than this creature's") {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId ? battlefield.find((p) => String(p?.id || '').trim() === sourceId) : null;
    const refId = String(
      ctx.targetCreatureId ??
        ctx.targetPermanentId ??
        ctx.selectorContext?.targetCreatureId ??
        ctx.selectorContext?.targetPermanentId ??
        ''
    ).trim();
    const ref = refId ? battlefield.find((p) => String(p?.id || '').trim() === refId) : null;
    if (!source || !ref) return null;
    return params.getCreaturePower(ref) > params.getCreaturePower(source);
  }

  if (normalizedRaw === 'a creature card was put into your graveyard from anywhere this turn') {
    const map = (nextState as any)?.creatureCardPutIntoYourGraveyardThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? v : false;
    }
    return null;
  }

  if (normalizedRaw === "that player didn't cast a creature spell this turn") {
    const thatPlayerId = String(
      (ctx as any)?.thatPlayerId ?? (ctx as any).targetPlayerId ?? (ctx as any).referencedPlayerId ?? ''
    ).trim();
    if (!thatPlayerId) return null;
    const spells = (nextState as any)?.spellsCastThisTurn;
    if (!Array.isArray(spells)) return null;
    const playerSpells = spells.filter(
      (spell: any) => String(spell?.casterId || spell?.controller || '').trim() === thatPlayerId
    );
    if (playerSpells.length === 0) return true;
    let unknown = false;
    for (const spell of playerSpells) {
      const tl = getExecutorTypeLineLower(spell?.card ?? spell);
      if (tl.includes('creature')) return false;
      if (!tl) unknown = true;
    }
    return unknown ? null : true;
  }

  if (normalizedRaw === 'you control a green or white permanent') {
    return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const colors = getColorsFromObject(perm);
      return colors.includes('G') || colors.includes('W');
    });
  }

  {
    const opponentDrawMatch = normalizedRaw.match(/^an opponent drew (three|\d+|[a-z]+) or more cards this turn$/i);
    if (opponentDrawMatch) {
      const threshold = params.parseSmallNumberWord(String(opponentDrawMatch[1] || ''));
      if (threshold === null) return null;
      const map = (nextState as any)?.cardsDrawnThisTurn;
      if (!map || typeof map !== 'object') return null;
      const opponents = (nextState.players || [])
        .map((p: any) => String(p?.id || '').trim())
        .filter((id: string) => id && id !== String(controllerId || '').trim());
      return opponents.some((id) => {
        const n = Number((map as Record<string, unknown>)[id]);
        return Number.isFinite(n) && n >= threshold;
      });
    }
  }

  if (normalizedRaw === 'exactly one creature is attacking') {
    const map = (nextState as any)?.attackersDeclaredThisCombatByPlayer;
    if (map && typeof map === 'object') {
      let total = 0;
      for (const list of Object.values(map as Record<string, unknown>)) {
        if (Array.isArray(list)) total += list.length;
      }
      return total === 1;
    }
    const attackers = (getProcessedBattlefield(nextState) as any[]).filter((perm) =>
      params.isPermanentAttacking(perm)
    );
    return attackers.length === 1;
  }

  if (normalizedRaw === 'defending player controls no black permanents') {
    return defenderControlsNoColoredPermanents(
      nextState,
      ctx,
      controllerId,
      'black',
      params.cardMatchesChosenColor
    );
  }

  if (normalizedRaw === 'it targets one or more other permanents you control') {
    const sourceId = String(ctx.sourceId || '').trim();
    const stackItem = (ctx as any)?.stackItem;
    const targets: string[] = Array.isArray(stackItem?.targets)
      ? stackItem.targets.map((t: any) => String(t ?? '').trim()).filter(Boolean)
      : stackItem?.targetId
        ? [String(stackItem.targetId).trim()]
        : [];
    if (targets.length === 0) return null;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return targets.some((targetId) => {
      if (sourceId && targetId === sourceId) return false;
      const perm = findObjectByIdInState(nextState, battlefield, targetId);
      return perm && String((perm as any)?.controller || '').trim() === String(controllerId || '').trim();
    });
  }

  if (normalizedRaw === "that creature isn't legendary") {
    const ref = params.getReferencedObject(nextState, ctx);
    if (!ref) return false;
    return !params.objectHasType(ref, 'legendary');
  }

  if (normalizedRaw === 'it has a counter on it') {
    const subject =
      params.getConditionalSubjectCard(params) ??
      params.getReferencedObject(nextState, ctx) ??
      params.contextualCardsFrom(params)[0];
    if (!subject) return null;
    return params.objectHasAnyCounters(subject);
  }

  if (normalizedRaw === 'a player controls more creatures than each other player') {
    const playerIds = (nextState.players || [])
      .map((p: any) => String(p?.id || '').trim())
      .filter(Boolean);
    if (playerIds.length < 2) return false;
    let leaderId: string | null = null;
    let leaderCount = -1;
    let tie = false;
    for (const pid of playerIds) {
      const count = params.controlledCreatures(nextState, pid as PlayerID).length;
      if (count > leaderCount) {
        leaderCount = count;
        leaderId = pid;
        tie = false;
      } else if (count === leaderCount) {
        tie = true;
      }
    }
    return !tie && leaderId !== null && leaderCount > 0;
  }

  if (normalizedRaw === 'this artifact has loyalty counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    const tl = getExecutorTypeLineLower(source);
    if (!tl.includes('artifact')) return false;
    const count = Number(((source as any)?.counters || {}).loyalty ?? 0);
    return Number.isFinite(count) && count > 0;
  }

  if (normalizedRaw === 'that creature was green or white') {
    const moved = params.movedCardsFrom(params);
    const ref = moved[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    const colors = getColorsFromObject(ref);
    return colors.includes('G') || colors.includes('W');
  }

  if (normalizedRaw === 'you control neither creature') {
    const ids = [
      String(ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || '').trim(),
      String((ctx as any)?.targetPermanentId2 || (ctx as any)?.secondTargetPermanentId || '').trim(),
      ...(Array.isArray((ctx as any)?.thoseCreatureIds) ? (ctx as any).thoseCreatureIds : []),
    ].filter(Boolean);
    if (ids.length < 2) return null;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const a = findObjectByIdInState(nextState, battlefield, ids[0]);
    const b = findObjectByIdInState(nextState, battlefield, ids[1]);
    if (!a || !b) return null;
    const ownerA = String((a as any)?.controller || '').trim();
    const ownerB = String((b as any)?.controller || '').trim();
    return ownerA !== String(controllerId || '').trim() && ownerB !== String(controllerId || '').trim();
  }

  if (normalizedRaw === 'there are ten or more creature cards total in all graveyards') {
    let total = 0;
    for (const player of nextState.players || []) {
      const gy = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
      total += gy.filter((card: any) => params.objectHasType(card, 'creature')).length;
    }
    return total >= 10;
  }

  if (normalizedRaw === 'its spectacle cost was paid') {
    return readSpectaclePaid(nextState, ctx, params.getReferencedObject);
  }

  if (
    normalizedRaw ===
    'a creature spell you cast this turn was countered by a spell or ability an opponent controlled'
  ) {
    const map = (nextState as any)?.creatureSpellsCounteredByOpponentThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return v === true ? true : v === false ? false : false;
    }
    return null;
  }

  if (normalizedRaw === "you haven't added mana with this ability this turn") {
    const sourceId = String(ctx.sourceId || '').trim();
    const abilityId = String((ctx as any)?.abilityId ?? (ctx as any)?.activatedAbilityId ?? '0').trim();
    const map = (nextState as any)?.addedManaWithThisAbilityThisTurn;
    if (!map || typeof map !== 'object') return null;
    const perPlayer = (map as Record<string, unknown>)[String(controllerId || '').trim()];
    if (perPlayer && typeof perPlayer === 'object') {
      const key = `${sourceId}:${abilityId}`;
      const hit = (perPlayer as Record<string, unknown>)[key] ?? (perPlayer as Record<string, unknown>)[sourceId];
      return hit !== true;
    }
    return true;
  }

  return null;
}
