import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export type Batch378BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  lastDiscardedCards?: readonly any[];
  lastExcessDamageDealtThisWay?: number;
  getConditionalSubjectCard: (params: Batch378BulkParams) => any | null;
  getReferencedObject: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
  controlledCreatures: (nextState: GameState, controllerId: PlayerID) => any[];
  getGraveyardCards: (nextState: GameState, controllerId: PlayerID) => any[];
  getControllerLife: (nextState: GameState, playerId: PlayerID) => number | null;
  parseSmallNumberWord: (text: string) => number | null;
  objectHasType: (object: any, type: string) => boolean;
  objectHasKeyword: (object: any, keyword: string) => boolean;
  getPlayerHandCount: (nextState: GameState, playerId: PlayerID) => number;
  getCreaturePower: (perm: any) => number;
  getCreatureToughness: (perm: any) => number;
  movedCardsFrom: (params: Batch378BulkParams) => any[];
  discardedCardsFrom: (params: Batch378BulkParams) => any[];
  isPermanentAttackingFn: (perm: any) => boolean;
};

function getCounterCount(object: any, counterName: string): number {
  const counters = (object as any)?.counters;
  if (!counters || typeof counters !== 'object') return 0;
  const target = String(counterName || '').trim().toLowerCase();
  for (const [key, value] of Object.entries(counters as Record<string, unknown>)) {
    if (String(key || '').trim().toLowerCase() !== target) continue;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeCardName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'");
}

function getPlayerIds(nextState: GameState): string[] {
  return (nextState.players || [])
    .map((p: any) => String(p?.id || '').trim())
    .filter(Boolean);
}

function getCardTypes(card: any): string[] {
  const tl = getExecutorTypeLineLower(card);
  return ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery', 'tribal'].filter(
    (type) => tl.includes(type),
  );
}

function readAlternateCostPaid(ctx: OracleIRExecutionContext, costRaw?: string): boolean | null {
  if (ctx.alternateCostPaid === true) return true;
  if (ctx.alternateCostPaid === false) return false;
  const paidCost = String((ctx as any)?.paidAlternateCostRaw ?? '').trim();
  if (costRaw && paidCost) return paidCost.toLowerCase() === costRaw.toLowerCase();
  return null;
}

function resolveEnchantedPermanent(
  nextState: GameState,
  ctx: OracleIRExecutionContext,
  getReferencedObject: Batch378BulkParams['getReferencedObject'],
): any | null {
  const enchantedId = String(
    (ctx as any)?.enchantedPermanentId ?? ctx.targetPermanentId ?? ctx.targetCreatureId ?? '',
  ).trim();
  if (enchantedId) {
    const found = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, enchantedId);
    if (found) return found;
  }
  const source = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
  );
  const attachedTo = String((source as any)?.attachedTo || (source as any)?.enchantedPermanentId || '').trim();
  if (attachedTo) {
    return findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attachedTo);
  }
  return getReferencedObject(nextState, ctx);
}

function resolveEnchantedEquipment(
  nextState: GameState,
  ctx: OracleIRExecutionContext,
  getReferencedObject: Batch378BulkParams['getReferencedObject'],
): any | null {
  const source = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
  );
  if (source && getExecutorTypeLineLower(source).includes('equipment')) return source;
  return getReferencedObject(nextState, ctx);
}

function findNamedControlledPermanent(nextState: GameState, controllerId: PlayerID, name: string): boolean {
  const target = normalizeCardName(name);
  return (getProcessedBattlefield(nextState) as any[]).some((perm) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    return normalizeCardName(perm?.name ?? perm?.card?.name) === target;
  });
}

export function evaluateBatch378BulkConditionalClause(params: Batch378BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  if (normalizedRaw === 'it has four or more quest counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return getCounterCount(source, 'quest') >= 4;
  }

  if (normalizedRaw === "you've cast another instant or sorcery spell this turn") {
    const flag =
      (ctx as any)?.castAnotherInstantOrSorceryThisTurn ??
      (nextState as any)?.castAnotherInstantOrSorceryThisTurn?.[String(controllerId || '').trim()];
    if (typeof flag === 'boolean') return flag;
    const count = Number((nextState as any)?.instantAndSorcerySpellsCastThisTurn?.[String(controllerId || '').trim()] ?? NaN);
    return Number.isFinite(count) ? count >= 2 : null;
  }

  if (normalizedRaw === 'its power is 2') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return params.getCreaturePower(ref) === 2;
  }

  if (normalizedRaw === 'that creature has flying') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return params.objectHasKeyword(ref, 'flying');
  }

  if (normalizedRaw === "this spell is the first spell you've cast this game") {
    const count = Number((nextState as any)?.spellsCastThisGame?.[String(controllerId || '').trim()] ?? NaN);
    if (Number.isFinite(count)) return count === 0;
    const flag = (ctx as any)?.isFirstSpellCastThisGame;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'that opponent has more life than another of your opponents') {
    const targetId = String(ctx.selectorContext?.targetOpponentId ?? 'p2').trim();
    const targetLife = params.getControllerLife(nextState, targetId as PlayerID);
    if (targetLife === null) return null;
    const opponentIds = getPlayerIds(nextState).filter(
      (id) => id !== String(controllerId || '').trim() && id !== targetId,
    );
    if (opponentIds.length === 0) return false;
    return opponentIds.some((id) => {
      const life = params.getControllerLife(nextState, id as PlayerID);
      return life !== null && targetLife > life;
    });
  }

  if (normalizedRaw === 'enchanted equipment is attached to a creature') {
    const equipment = resolveEnchantedEquipment(nextState, ctx, params.getReferencedObject);
    if (!equipment) return null;
    const attachedTo = String((equipment as any)?.attachedTo || '').trim();
    if (!attachedTo) return false;
    const bearer = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attachedTo);
    return bearer ? params.objectHasType(bearer, 'creature') : false;
  }

  if (normalizedRaw === 'they were cast using web-slinging') {
    const flag = (ctx as any)?.castUsingWebSlinging ?? (ctx as any)?.spellsCastUsingWebSlingingThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'defending player has two or fewer cards in hand') {
    const targetId = String((ctx as any)?.defendingPlayerId ?? 'p2').trim();
    return params.getPlayerHandCount(nextState, targetId as PlayerID) <= 2;
  }

  if (normalizedRaw === 'an opponent searched their library this turn') {
    const flag = (nextState as any)?.opponentSearchedLibraryThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === "a creature card with flying was exiled with this creature's delve ability") {
    const flag = (ctx as any)?.delveExiledFlyingCreature;
    if (typeof flag === 'boolean') return flag;
    const exiled = (ctx as any)?.cardsExiledForDelve ?? (ctx as any)?.lastExiledCards ?? [];
    if (Array.isArray(exiled)) {
      return exiled.some(
        (card) => params.objectHasType(card, 'creature') && params.objectHasKeyword(card, 'flying'),
      );
    }
    return null;
  }

  if (normalizedRaw === 'that player discards an artifact card this way') {
    const discarded = params.discardedCardsFrom(params);
    const card = discarded[discarded.length - 1];
    if (!card) return null;
    return params.objectHasType(card, 'artifact');
  }

  if (normalizedRaw === 'an opponent lost 2 or more life this turn') {
    const map = (nextState as any)?.lifeLostThisTurn;
    if (!map || typeof map !== 'object') return null;
    return Object.entries(map as Record<string, unknown>).some(
      ([playerId, amount]) =>
        playerId !== String(controllerId || '').trim() &&
        typeof amount === 'number' &&
        amount >= 2,
    );
  }

  if (normalizedRaw === 'this enchantment has three or more quest counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return getCounterCount(source, 'quest') >= 3;
  }

  if (normalizedRaw === 'you guessed correctly for a card named this permanent') {
    const flag = (ctx as any)?.guessedCorrectlyForCardNamedThisPermanent;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'there are cards exiled with this enchantment') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    const count = Number((source as any)?.exiledCardCount ?? (source as any)?.cardsExiledWithThis?.length ?? NaN);
    return Number.isFinite(count) ? count > 0 : null;
  }

  if (normalizedRaw === 'there were three or more card types among the sacrificed permanents') {
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : params.movedCardsFrom(params);
    const types = new Set<string>();
    for (const card of snapshots) {
      for (const type of getCardTypes(card)) types.add(type);
    }
    return types.size >= 3;
  }

  if (normalizedRaw === "a creature died under an opponent's control this turn") {
    const map = (nextState as any)?.creaturesDiedUnderOpponentControlThisTurn;
    if (map && typeof map === 'object') {
      return Object.values(map as Record<string, unknown>).some(
        (v) => v === true || (typeof v === 'number' && v > 0),
      );
    }
    return Boolean((nextState as any)?.creatureDiedUnderOpponentControlThisTurn);
  }

  if (normalizedRaw === 'damage would be dealt to you') {
    return true;
  }

  if (normalizedRaw === 'an opponent is the monarch') {
    const monarch = String((nextState as any)?.monarch ?? '').trim();
    return monarch.length > 0 && monarch !== String(controllerId || '').trim();
  }

  if (normalizedRaw === 'there are three or more omen counters on this creature') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return getCounterCount(source, 'omen') >= 3;
  }

  if (normalizedRaw === "it's the first time +1/+1 counters have been put on that permanent this turn") {
    const flag = (ctx as any)?.firstTimePlusOneCountersPutOnThatPermanentThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'the sacrificed permanent was a vehicle') {
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : params.movedCardsFrom(params);
    const perm = snapshots[snapshots.length - 1];
    return perm ? params.objectHasType(perm, 'vehicle') : null;
  }

  if (normalizedRaw === 'a goblin is sacrificed this way') {
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : params.movedCardsFrom(params);
    return snapshots.some((entry) => params.objectHasType(entry, 'goblin'));
  }

  if (normalizedRaw === 'the {2}{u} cost was paid') {
    return readAlternateCostPaid(ctx, '{2}{U}');
  }

  if (normalizedRaw === "that cost wasn't paid" || normalizedRaw === 'that cost was not paid') {
    if (ctx.alternateCostPaid === false) return true;
    if (ctx.alternateCostPaid === true) return false;
    return null;
  }

  if (normalizedRaw === 'this creature is enchanted') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    const sourceId = String((source as any)?.id || ctx.sourceId || '').trim();
    if (!sourceId) return null;
    return (getProcessedBattlefield(nextState) as any[]).some((perm) => {
      const tl = getExecutorTypeLineLower(perm);
      if (!tl.includes('aura') && !tl.includes('enchantment')) return false;
      return String((perm as any)?.attachedTo || '').trim() === sourceId;
    });
  }

  if (normalizedRaw === 'the discarded card was a zombie card') {
    const discarded = params.discardedCardsFrom(params);
    const card = discarded[discarded.length - 1];
    if (!card) return null;
    return params.objectHasType(card, 'zombie');
  }

  if (normalizedRaw === 'one or more permanents were sacrificed to activate it') {
    const flag = (ctx as any)?.permanentsSacrificedToActivateAbility;
    if (typeof flag === 'boolean') return flag;
    const count = Number((ctx as any)?.permanentsSacrificedToActivateCount ?? NaN);
    return Number.isFinite(count) ? count > 0 : null;
  }

  if (normalizedRaw === "you've drawn three or more cards this turn") {
    const drawn = Number((nextState as any)?.cardsDrawnThisTurn?.[String(controllerId || '').trim()] ?? NaN);
    return Number.isFinite(drawn) ? drawn >= 3 : null;
  }

  if (normalizedRaw === 'an opponent has no cards in hand') {
    return getPlayerIds(nextState)
      .filter((id) => id !== String(controllerId || '').trim())
      .some((id) => params.getPlayerHandCount(nextState, id as PlayerID) === 0);
  }

  if (normalizedRaw === "they aren't attacking you" || normalizedRaw === 'they are not attacking you') {
    const flag = (ctx as any)?.theyAreNotAttackingYou;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (
    normalizedRaw ===
    'you both own and control this permanent and an artifact named the mightstone and weakstone'
  ) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    const owner = String(source?.owner ?? source?.controller ?? controllerId).trim();
    const controller = String(source?.controller ?? controllerId).trim();
    if (owner !== String(controllerId || '').trim() || controller !== String(controllerId || '').trim()) {
      return false;
    }
    return findNamedControlledPermanent(nextState, controllerId, 'The Mightstone and Weakstone');
  }

  if (normalizedRaw === "equipped creature didn't deal combat damage to a creature this turn") {
    const flag = (ctx as any)?.equippedCreatureDidNotDealCombatDamageToCreatureThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (
    normalizedRaw ===
    'you control no permanents other than this enchantment and have no cards in hand'
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const others = (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const id = String(perm?.id || '').trim();
      return !sourceId || id !== sourceId;
    });
    return others.length === 0 && params.getPlayerHandCount(nextState, controllerId) === 0;
  }

  if (
    normalizedRaw ===
    'an opponent had three or more cards put into their graveyard from anywhere this turn'
  ) {
    const map = (nextState as any)?.cardsPutIntoGraveyardFromAnywhereThisTurn;
    if (map && typeof map === 'object') {
      return Object.entries(map as Record<string, unknown>).some(
        ([playerId, count]) =>
          playerId !== String(controllerId || '').trim() &&
          typeof count === 'number' &&
          count >= 3,
      );
    }
    return Boolean((nextState as any)?.opponentHadThreeOrMoreCardsPutIntoGraveyardThisTurn);
  }

  return null;
}
