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

export type Batch380BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  lastDiscardedCards?: readonly any[];
  lastExcessDamageDealtThisWay?: number;
  getConditionalSubjectCard: (params: Batch380BulkParams) => any | null;
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
  movedCardsFrom: (params: Batch380BulkParams) => any[];
  discardedCardsFrom: (params: Batch380BulkParams) => any[];
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

function targetOpponentCanSacrificeNonland(nextState: GameState, targetPlayerId: string): boolean {
  return (getProcessedBattlefield(nextState) as any[]).some((perm) => {
    if (String(perm?.controller || '').trim() !== targetPlayerId) return false;
    const typeLine = getExecutorTypeLineLower(perm);
    if (typeLine.includes('land')) return false;
    if (Boolean((perm as any)?.isToken) || /\btoken\b/i.test(typeLine)) return false;
    return true;
  });
}

function cardIsAllColors(card: any): boolean {
  const colors = getColorsFromObject(card);
  return colors.includes('W') && colors.includes('U') && colors.includes('B') && colors.includes('R') && colors.includes('G');
}

export function evaluateBatch380BulkConditionalClause(params: Batch380BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx, lastActionOutcome } = params;

  if (normalizedRaw === 'you discarded it this turn') {
    const flag = (ctx as any)?.discardedItThisTurn ?? (ctx as any)?.youDiscardedItThisTurn;
    if (typeof flag === 'boolean') return flag;
    const discarded = params.discardedCardsFrom(params);
    return discarded.length > 0;
  }

  if (normalizedRaw === "it isn't a creature card" || normalizedRaw === 'it is not a creature card') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return !params.objectHasType(ref, 'creature');
  }

  if (normalizedRaw === 'the sacrificed permanent was an artifact') {
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : params.movedCardsFrom(params);
    const perm = snapshots[snapshots.length - 1];
    return perm ? params.objectHasType(perm, 'artifact') : null;
  }

  if (normalizedRaw === 'it enters as a creature') {
    const flag = (ctx as any)?.entersAsCreature ?? (ctx as any)?.itEntersAsCreature;
    if (typeof flag === 'boolean') return flag;
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    if (!ref) return null;
    return params.objectHasType(ref, 'creature');
  }

  if (normalizedRaw === 'a white creature dies this way') {
    const died = (ctx as any)?.lastCreaturesDiedThisWay ?? params.movedCardsFrom(params);
    const pool = Array.isArray(died) ? died : died ? [died] : [];
    return pool.some((card) => {
      if (!params.objectHasType(card, 'creature')) return false;
      const colors = getColorsFromObject(card);
      return colors.includes('W') || getExecutorTypeLineLower(card).includes('white');
    });
  }

  if (normalizedRaw === 'the sacrificed creature was legendary') {
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : params.movedCardsFrom(params);
    const perm = snapshots[snapshots.length - 1];
    if (!perm) return null;
    return params.objectHasType(perm, 'legendary') || getExecutorTypeLineLower(perm).includes('legendary');
  }

  if (normalizedRaw === "it isn't your main phase" || normalizedRaw === 'it is not your main phase') {
    const phase = String((nextState as any)?.phase ?? '').trim().toLowerCase();
    const turnPlayer = String((nextState as any)?.turnPlayer ?? (nextState as any)?.activePlayerId ?? '').trim();
    const isYourMain =
      turnPlayer === String(controllerId || '').trim() &&
      (phase === 'main1' || phase === 'main2' || phase === 'main');
    if (phase) return !isYourMain;
    const flag = (nextState as any)?.isNotYourMainPhase?.[String(controllerId || '').trim()];
    return typeof flag === 'boolean' ? flag : null;
  }

  if (
    normalizedRaw ===
    'a creature or planeswalker an opponent controlled was dealt excess damage this turn'
  ) {
    const flag =
      (nextState as any)?.opponentPermanentDealtExcessDamageThisTurn ??
      (nextState as any)?.creatureOrPlaneswalkerOpponentControlledDealtExcessDamageThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === "you're the defending player" || normalizedRaw === 'you are the defending player') {
    const flag = (ctx as any)?.isDefendingPlayer ?? (ctx as any)?.youAreTheDefendingPlayer;
    if (typeof flag === 'boolean') return flag;
    const defendingId = String((nextState as any)?.defendingPlayerId ?? 'p2').trim();
    return defendingId === String(controllerId || '').trim();
  }

  if (normalizedRaw === 'that card was all colors') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    if ((ref as any)?.wasAllColors === true) return true;
    if ((ref as any)?.wasAllColors === false) return false;
    return cardIsAllColors(ref);
  }

  if (normalizedRaw === 'a permanent was put into your hand from the battlefield this turn') {
    const count = Number(
      (nextState as any)?.permanentsPutIntoHandFromBattlefieldThisTurn?.[String(controllerId || '').trim()] ?? NaN,
    );
    return Number.isFinite(count) ? count > 0 : Boolean((nextState as any)?.permanentPutIntoHandFromBattlefieldThisTurn);
  }

  if (
    normalizedRaw ===
    'there is an elf card in your graveyard and this creature has a -1/-1 counter on it'
  ) {
    const hasElf = params.getGraveyardCards(nextState, controllerId).some((card) => params.objectHasType(card, 'elf'));
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return hasElf && getCounterCount(source, '-1/-1') >= 1;
  }

  if (normalizedRaw === "they can't" || normalizedRaw === 'they cannot') {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.stepKind === 'sacrifice' && lastActionOutcome?.kind === 'applied') return false;
    const targetId = String(ctx.selectorContext?.targetOpponentId ?? 'p2').trim();
    return !targetOpponentCanSacrificeNonland(nextState, targetId);
  }

  if (normalizedRaw === 'that equipment was attached to a creature') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    if (!ref) return null;
    const attachedTo = String((ref as any)?.attachedTo || (ref as any)?.wasAttachedTo || '').trim();
    if (!attachedTo) return Boolean((ref as any)?.wasAttachedToCreature);
    const bearer = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attachedTo);
    return bearer ? params.objectHasType(bearer, 'creature') : Boolean((ref as any)?.wasAttachedToCreature);
  }

  if (normalizedRaw === "you haven't played it" || normalizedRaw === 'you have not played it') {
    const flag = (ctx as any)?.hasNotPlayedIt ?? (ctx as any)?.youHaveNotPlayedIt;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'you control no creatures with decayed') {
    return !(getProcessedBattlefield(nextState) as any[]).some(
      (perm) =>
        String(perm?.controller || '').trim() === String(controllerId || '').trim() &&
        params.objectHasKeyword(perm, 'decayed'),
    );
  }

  if (normalizedRaw === "you didn't activate a loyalty ability of a planeswalker this turn") {
    const flag = (nextState as any)?.activatedLoyaltyAbilityThisTurn?.[String(controllerId || '').trim()];
    if (typeof flag === 'boolean') return !flag;
    const count = Number((nextState as any)?.loyaltyAbilitiesActivatedThisTurn?.[String(controllerId || '').trim()] ?? NaN);
    return Number.isFinite(count) ? count === 0 : null;
  }

  if (normalizedRaw === "two or more permanents you don't control have an aim counter on them") {
    const count = (getProcessedBattlefield(nextState) as any[]).filter(
      (perm) =>
        String(perm?.controller || '').trim() !== String(controllerId || '').trim() &&
        getCounterCount(perm, 'aim') >= 1,
    ).length;
    return count >= 2;
  }

  if (normalizedRaw === 'that player discards a card this way') {
    const discarded = params.discardedCardsFrom(params);
    return discarded.length > 0;
  }

  if (normalizedRaw === 'you lost 2 or more life this turn') {
    const lost = Number((nextState as any)?.lifeLostThisTurn?.[String(controllerId || '').trim()] ?? NaN);
    return Number.isFinite(lost) ? lost >= 2 : null;
  }

  if (normalizedRaw === 'the creature the opponent controls is dealt excess damage this way') {
    const excess = Number(
      params.lastExcessDamageDealtThisWay ??
        (ctx as any)?.lastExcessDamageDealtThisWay ??
        (ctx as any)?.opponentCreatureExcessDamageThisWay ??
        NaN,
    );
    return Number.isFinite(excess) ? excess > 0 : null;
  }

  if (normalizedRaw === 'each opponent chose silence') {
    const flag = (ctx as any)?.eachOpponentChoseSilence ?? (nextState as any)?.eachOpponentChoseSilence;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'each opponent chose snitch') {
    const flag = (ctx as any)?.eachOpponentChoseSnitch ?? (nextState as any)?.eachOpponentChoseSnitch;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'it has fewer than four +1/+1 counters on it') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return getCounterCount(ref, '+1/+1') < 4;
  }

  if (normalizedRaw === 'this creature is monstrous') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return Boolean((source as any)?.monstrous ?? (source as any)?.isMonstrous);
  }

  if (normalizedRaw === 'you have 50 or more life') {
    const life = params.getControllerLife(nextState, controllerId);
    return life === null ? null : life >= 50;
  }

  if (
    normalizedRaw.startsWith(
      'target player discards a card unless they put a card from their hand on top of their library',
    )
  ) {
    return Boolean(
      (ctx as any)?.playerDiscardedThisWay ?? params.discardedCardsFrom(params).length > 0,
    );
  }

  return null;
}
