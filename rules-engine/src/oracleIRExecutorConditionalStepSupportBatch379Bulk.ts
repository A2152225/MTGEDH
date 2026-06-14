import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export type Batch379BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  lastDiscardedCards?: readonly any[];
  lastExcessDamageDealtThisWay?: number;
  getConditionalSubjectCard: (params: Batch379BulkParams) => any | null;
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
  movedCardsFrom: (params: Batch379BulkParams) => any[];
  discardedCardsFrom: (params: Batch379BulkParams) => any[];
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

function findNamedControlledPermanent(nextState: GameState, controllerId: PlayerID, name: string): boolean {
  const target = normalizeCardName(name);
  return (getProcessedBattlefield(nextState) as any[]).some((perm) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    return normalizeCardName(perm?.name ?? perm?.card?.name) === target;
  });
}

function resolveEnchantedCreature(
  nextState: GameState,
  ctx: OracleIRExecutionContext,
  getReferencedObject: Batch379BulkParams['getReferencedObject'],
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
  const attachedTo = String((source as any)?.attachedTo || '').trim();
  if (attachedTo) {
    return findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attachedTo);
  }
  return getReferencedObject(nextState, ctx);
}

function playerHasLandInHand(nextState: GameState, playerId: string): boolean {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === playerId);
  const hand = Array.isArray((player as any)?.hand) ? (player as any).hand : [];
  return hand.some((card: any) => getExecutorTypeLineLower(card).includes('land'));
}

function countCreaturesControlledBy(nextState: GameState, playerId: string): number {
  return (getProcessedBattlefield(nextState) as any[]).filter(
    (perm) =>
      String(perm?.controller || '').trim() === playerId && getExecutorTypeLineLower(perm).includes('creature'),
  ).length;
}

function permanentIsNonblackNonland(perm: any): boolean {
  const tl = getExecutorTypeLineLower(perm);
  if (tl.includes('land')) return false;
  const colors = getColorsFromObject(perm);
  if (colors.length === 0) return true;
  return !colors.every((c) => String(c || '').trim().toUpperCase() === 'B');
}

function readCardManaValue(card: any): number | null {
  const mv = getCardManaValue(card);
  return Number.isFinite(mv) ? mv : null;
}

export function evaluateBatch379BulkConditionalClause(params: Batch379BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  if (normalizedRaw === 'that creature entered from a graveyard or you cast it from a graveyard') {
    const flag =
      (ctx as any)?.enteredFromGraveyard ??
      (ctx as any)?.castFromGraveyard ??
      (ctx as any)?.creatureEnteredFromGraveyardOrCastFromGraveyard;
    if (typeof flag === 'boolean') return flag;
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return Boolean((ref as any)?.enteredFromGraveyard ?? (ref as any)?.castFromGraveyard);
  }

  if (normalizedRaw === 'that permanent was blue or black') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    const colors = getColorsFromObject(ref);
    return colors.includes('U') || colors.includes('B');
  }

  if (normalizedRaw === 'no creature got votes') {
    const flag = (ctx as any)?.noCreatureGotVotes ?? (nextState as any)?.noCreatureGotVotes;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'that creature has greater power or toughness than this creature') {
    const target = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!target || !source) return null;
    const targetPower = params.getCreaturePower(target);
    const targetToughness = params.getCreatureToughness(target);
    const sourcePower = params.getCreaturePower(source);
    const sourceToughness = params.getCreatureToughness(source);
    return targetPower > sourcePower || targetToughness > sourceToughness;
  }

  if (normalizedRaw === 'you have no land cards in hand') {
    return !playerHasLandInHand(nextState, String(controllerId || '').trim());
  }

  if (normalizedRaw === 'the exiled card is a god card') {
    const exiled = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!exiled) return null;
    return /\bgod\b/i.test(String((exiled as any)?.type_line ?? (exiled as any)?.card?.type_line ?? ''));
  }

  if (normalizedRaw === 'this permanent attacked this turn') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return Boolean((source as any)?.attackedThisTurn ?? params.isPermanentAttackingFn(source));
  }

  if (normalizedRaw === 'an opponent was dealt 3 or more damage this turn') {
    const map = (nextState as any)?.damageDealtToOpponentsThisTurn;
    if (map && typeof map === 'object') {
      return Object.entries(map as Record<string, unknown>).some(
        ([playerId, amount]) =>
          playerId !== String(controllerId || '').trim() &&
          typeof amount === 'number' &&
          amount >= 3,
      );
    }
    return Boolean((nextState as any)?.opponentWasDealtThreeOrMoreDamageThisTurn);
  }

  if (normalizedRaw === "that creature's toughness is 1 or greater") {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return params.getCreatureToughness(ref) >= 1;
  }

  if (normalizedRaw === 'that player controls a nonblack') {
    const targetId = String(ctx.selectorContext?.targetOpponentId ?? 'p2').trim();
    return (getProcessedBattlefield(nextState) as any[]).some(
      (perm) =>
        String(perm?.controller || '').trim() === targetId && permanentIsNonblackNonland(perm),
    );
  }

  if (normalizedRaw === "you've discarded a card this turn") {
    const count = Number((nextState as any)?.cardsDiscardedThisTurn?.[String(controllerId || '').trim()] ?? NaN);
    if (Number.isFinite(count)) return count >= 1;
    return Boolean((nextState as any)?.discardedACardThisTurn?.[String(controllerId || '').trim()]);
  }

  if (normalizedRaw === 'this creature was dealt damage this turn') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return Boolean((source as any)?.dealtDamageThisTurn ?? (ctx as any)?.thisCreatureWasDealtDamageThisTurn);
  }

  if (normalizedRaw === 'an opponent controls three or more creatures') {
    const playerIds = new Set([
      ...getPlayerIds(nextState),
      ...(getProcessedBattlefield(nextState) as any[])
        .map((perm) => String(perm?.controller || '').trim())
        .filter(Boolean),
    ]);
    return [...playerIds]
      .filter((id) => id !== String(controllerId || '').trim())
      .some((id) => countCreaturesControlledBy(nextState, id) >= 3);
  }

  if (normalizedRaw === 'enchanted creature has flying') {
    const enchanted = resolveEnchantedCreature(nextState, ctx, params.getReferencedObject);
    if (!enchanted) return null;
    return params.objectHasKeyword(enchanted, 'flying');
  }

  if (/^this permanent is a scout/i.test(normalizedRaw)) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return params.objectHasType(source, 'scout');
  }

  if (
    normalizedRaw ===
    'you had another cleric, rogue, warrior, or wizard enter the battlefield under your control this turn'
  ) {
    const flag = (ctx as any)?.anotherPartyClassEnteredThisTurn ?? (ctx as any)?.partyClassEnteredThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'excess damage was dealt to a permanent this way') {
    const excess = Number(
      params.lastExcessDamageDealtThisWay ??
        (ctx as any)?.lastExcessDamageDealtThisWay ??
        (ctx as any)?.excessDamageDealtToPermanentThisWay ??
        NaN,
    );
    return Number.isFinite(excess) ? excess > 0 : null;
  }

  if (normalizedRaw === 'that creature is attacking') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return params.isPermanentAttackingFn(ref);
  }

  if (
    normalizedRaw ===
    '{g} was spent to cast this spell, and creatures you control gain flying until end of turn if {u} was spent to cast this spell'
  ) {
    const gSpent = (ctx as any)?.greenManaSpentToCastThisSpell ?? (ctx as any)?.gWasSpentToCastThisSpell;
    const uSpent = (ctx as any)?.blueManaSpentToCastThisSpell ?? (ctx as any)?.uWasSpentToCastThisSpell;
    if (typeof gSpent === 'boolean' && typeof uSpent === 'boolean') return gSpent && uSpent;
    if (typeof gSpent === 'boolean') return gSpent;
    return null;
  }

  if (normalizedRaw === '{g} was spent to cast this spell') {
    const flag = (ctx as any)?.greenManaSpentToCastThisSpell ?? (ctx as any)?.gWasSpentToCastThisSpell;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === '{u} was spent to cast this spell') {
    const flag = (ctx as any)?.blueManaSpentToCastThisSpell ?? (ctx as any)?.uWasSpentToCastThisSpell;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === "it didn't have decayed" || normalizedRaw === 'it did not have decayed') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    if (!ref) return null;
    if ((ref as any)?.hadDecayed === true) return false;
    if ((ref as any)?.hadDecayed === false) return true;
    return !params.objectHasKeyword(ref, 'decayed');
  }

  if (normalizedRaw === 'this creature has fewer than three +1/+1 counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return getCounterCount(source, '+1/+1') < 3;
  }

  if (normalizedRaw === 'you control each creature on the battlefield with the greatest power') {
    const creatures = (getProcessedBattlefield(nextState) as any[]).filter((perm) =>
      params.objectHasType(perm, 'creature'),
    );
    if (creatures.length === 0) return true;
    const maxPower = Math.max(...creatures.map((perm) => params.getCreaturePower(perm)));
    const tied = creatures.filter((perm) => params.getCreaturePower(perm) === maxPower);
    return tied.every(
      (perm) => String(perm?.controller || '').trim() === String(controllerId || '').trim(),
    );
  }

  if (normalizedRaw === 'a creature card left your graveyard this turn') {
    const count = Number(
      (nextState as any)?.creatureCardsLeftGraveyardThisTurn?.[String(controllerId || '').trim()] ?? NaN,
    );
    return Number.isFinite(count) ? count >= 1 : Boolean((nextState as any)?.creatureCardLeftYourGraveyardThisTurn);
  }

  if (normalizedRaw === 'its mana value was 1 or greater') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    const mv = ref ? readCardManaValue(ref) : null;
    return mv === null ? null : mv >= 1;
  }

  if (
    normalizedRaw === "you haven't cast a spell this turn" ||
    normalizedRaw === 'you have not cast a spell this turn'
  ) {
    const count = Number((nextState as any)?.spellsCastThisTurnByPlayer?.[String(controllerId || '').trim()] ?? NaN);
    if (Number.isFinite(count)) return count === 0;
    const spells = (nextState as any)?.spellsCastThisTurn;
    if (Array.isArray(spells)) {
      return !spells.some(
        (s: any) => String(s?.casterId || s?.controller || '').trim() === String(controllerId || '').trim(),
      );
    }
    return null;
  }

  if (normalizedRaw === 'an artifact or creature spell is countered this way') {
    const kind = String((ctx as any)?.lastCounteredSpellKind ?? (ctx as any)?.counteredSpellType ?? '').toLowerCase();
    if (kind === 'artifact' || kind === 'creature') return true;
    if ((ctx as any)?.artifactOrCreatureSpellCounteredThisWay === true) return true;
    if ((ctx as any)?.artifactOrCreatureSpellCounteredThisWay === false) return false;
    return null;
  }

  if (normalizedRaw === 'you have exactly thirteen cards in your hand') {
    return params.getPlayerHandCount(nextState, controllerId) === 13;
  }

  if (normalizedRaw === 'that creature had a +1/+1 counter on it') {
    const snapshots = (ctx as any)?.lastDestroyedCreatures ?? params.movedCardsFrom(params);
    const ref = Array.isArray(snapshots) ? snapshots[snapshots.length - 1] : snapshots;
    if (!ref) return null;
    if ((ref as any)?.hadPlusOneCounter === true) return true;
    if ((ref as any)?.hadPlusOneCounter === false) return false;
    return getCounterCount(ref, '+1/+1') >= 1;
  }

  if (normalizedRaw === "that player or that planeswalker's controller has more life than you") {
    const targetId = String(ctx.selectorContext?.targetOpponentId ?? 'p2').trim();
    const targetLife = params.getControllerLife(nextState, targetId as PlayerID);
    const yourLife = params.getControllerLife(nextState, controllerId);
    if (targetLife === null || yourLife === null) return null;
    return targetLife > yourLife;
  }

  if (normalizedRaw === "a card would be put into an opponent's graveyard from anywhere") {
    const flag = (ctx as any)?.cardWouldEnterOpponentGraveyard;
    return typeof flag === 'boolean' ? flag : true;
  }

  if (normalizedRaw === 'an opponent cast a blue and/or black spell this turn') {
    const flag = (nextState as any)?.opponentCastBlueOrBlackSpellThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (
    normalizedRaw ===
    'a noncreature permanent under your control was destroyed this turn by a spell or ability an opponent controlled'
  ) {
    const flag =
      (nextState as any)?.noncreaturePermanentDestroyedByOpponentThisTurn?.[String(controllerId || '').trim()];
    if (typeof flag === 'boolean') return flag;
    return Boolean((nextState as any)?.noncreaturePermanentDestroyedByOpponentThisTurn);
  }

  if (normalizedRaw === "this spell's madness cost was paid") {
    const flag =
      (ctx as any)?.madnessCostWasPaid ??
      (ctx as any)?.castWithMadness ??
      ctx.alternateCostPaid;
    if (flag === true) return true;
    if (flag === false) return false;
    return null;
  }

  if (normalizedRaw === 'it was enchanted') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    if (!ref) return null;
    if ((ref as any)?.wasEnchanted === true) return true;
    if ((ref as any)?.wasEnchanted === false) return false;
    return Boolean((ref as any)?.isEnchanted);
  }

  if (normalizedRaw === 'it was equipped') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    if (!ref) return null;
    if ((ref as any)?.wasEquipped === true) return true;
    if ((ref as any)?.wasEquipped === false) return false;
    return Boolean((ref as any)?.isEquipped ?? (ref as any)?.attachedEquipment?.length);
  }

  if (normalizedRaw === 'you both own and control this permanent and a creature named bruna') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    const owner = String(source?.owner ?? source?.controller ?? controllerId).trim();
    const controller = String(source?.controller ?? controllerId).trim();
    if (owner !== String(controllerId || '').trim() || controller !== String(controllerId || '').trim()) {
      return false;
    }
    return findNamedControlledPermanent(nextState, controllerId, 'Bruna') ||
      (getProcessedBattlefield(nextState) as any[]).some((perm) => {
        if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
        return normalizeCardName(perm?.name ?? perm?.card?.name).startsWith('bruna');
      });
  }

  return null;
}
