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

export type Batch377BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  lastDiscardedCards?: readonly any[];
  lastExcessDamageDealtThisWay?: number;
  getConditionalSubjectCard: (params: Batch377BulkParams) => any | null;
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
  movedCardsFrom: (params: Batch377BulkParams) => any[];
  discardedCardsFrom: (params: Batch377BulkParams) => any[];
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

function getSacrificedCreaturePower(params: Batch377BulkParams): number | null {
  const snapshots = Array.isArray((params.ctx as any)?.lastSacrificedPermanents)
    ? ((params.ctx as any).lastSacrificedPermanents as any[])
    : params.movedCardsFrom(params);
  const creature = snapshots.find((entry) => params.objectHasType(entry, 'creature')) ?? snapshots[0];
  if (!creature) return null;
  return params.getCreaturePower(creature);
}

function getMostCommonColorLetters(nextState: GameState): string[] {
  const counts: Record<string, number> = {};
  for (const perm of getProcessedBattlefield(nextState) as any[]) {
    for (const color of getColorsFromObject(perm)) {
      const letter = String(color || '').trim().toUpperCase();
      if (!letter) continue;
      counts[letter] = (counts[letter] || 0) + 1;
    }
  }
  const values = Object.values(counts);
  if (values.length === 0) return [];
  const max = Math.max(...values);
  return Object.entries(counts)
    .filter(([, count]) => count === max)
    .map(([letter]) => letter);
}

function permanentSharesAnyColor(perm: any, colors: string[]): boolean {
  if (colors.length === 0) return false;
  const permColors = getColorsFromObject(perm).map((c) => String(c || '').trim().toUpperCase());
  return permColors.some((c) => colors.includes(c));
}

function countControlledSubtype(
  nextState: GameState,
  playerId: string,
  subtype: string,
): number {
  const needle = String(subtype || '').trim().toLowerCase();
  return (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
    if (String(perm?.controller || '').trim() !== playerId) return false;
    return getExecutorTypeLineLower(perm).includes(needle);
  }).length;
}

function controllerTurnStat(
  nextState: GameState,
  controllerId: PlayerID,
  key: string,
): boolean | number | null {
  const map = (nextState as any)?.[key];
  if (!map || typeof map !== 'object') return null;
  const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v;
  return null;
}

function getTopGraveyardCard(nextState: GameState, playerId: string): any | null {
  const player = (nextState.players || []).find(
    (p: any) => String(p?.id || '').trim() === String(playerId || '').trim(),
  ) as any;
  const gy = Array.isArray(player?.graveyard) ? player.graveyard : [];
  return gy.length > 0 ? gy[gy.length - 1] : null;
}

function countFaceDownControlled(nextState: GameState, controllerId: PlayerID): number {
  return (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    return Boolean((perm as any)?.faceDown ?? (perm as any)?.isFaceDown);
  }).length;
}

function countTotalCountersOnArtifactsAndCreatures(
  nextState: GameState,
  controllerId: PlayerID,
): number {
  let total = 0;
  for (const perm of getProcessedBattlefield(nextState) as any[]) {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    const tl = getExecutorTypeLineLower(perm);
    if (!tl.includes('artifact') && !tl.includes('creature')) continue;
    const counters = (perm as any)?.counters;
    if (!counters || typeof counters !== 'object') continue;
    for (const value of Object.values(counters as Record<string, unknown>)) {
      const n = Number(value);
      if (Number.isFinite(n)) total += n;
    }
  }
  return total;
}

function countLandsOnBattlefield(nextState: GameState): number {
  return (getProcessedBattlefield(nextState) as any[]).filter((perm) =>
    getExecutorTypeLineLower(perm).includes('land'),
  ).length;
}

function countLandsControlledBy(nextState: GameState, playerId: string): number {
  return (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
    if (String(perm?.controller || '').trim() !== playerId) return false;
    return getExecutorTypeLineLower(perm).includes('land');
  }).length;
}

export function evaluateBatch377BulkConditionalClause(params: Batch377BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  if (normalizedRaw === "its power is less than or equal to the sacrificed creature's power") {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    const sacPower = getSacrificedCreaturePower(params);
    if (!ref || sacPower === null) return null;
    return params.getCreaturePower(ref) <= sacPower;
  }

  if (normalizedRaw === "its power is greater than the sacrificed creature's power") {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    const sacPower = getSacrificedCreaturePower(params);
    if (!ref || sacPower === null) return null;
    return params.getCreaturePower(ref) > sacPower;
  }

  if (normalizedRaw === 'you control more creatures of that type than each other player') {
    const chosenType = String(
      ctx.chosenCreatureType ??
        ctx.selectorContext?.chosenCreatureType ??
        (ctx as any)?.chosenType ??
        'goblin',
    )
      .trim()
      .toLowerCase();
    const yours = countControlledSubtype(nextState, controllerId, chosenType);
    return getPlayerIds(nextState)
      .filter((id) => id !== String(controllerId || '').trim())
      .every((id) => yours > countControlledSubtype(nextState, id, chosenType));
  }

  if (
    normalizedRaw ===
    'that permanent shares a color with the most common color among all permanents or a color tied for most common'
  ) {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return permanentSharesAnyColor(ref, getMostCommonColorLetters(nextState));
  }

  if (normalizedRaw === 'that player has 5 or less life') {
    const targetId = String(
      ctx.selectorContext?.targetPlayerId ?? ctx.selectorContext?.targetOpponentId ?? 'p2',
    ).trim();
    const life = params.getControllerLife(nextState, targetId as PlayerID);
    return life === null ? null : life <= 5;
  }

  if (normalizedRaw === 'cards with five or more different mana values are exiled with this permanent') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    const mvs = new Set<number>();
    const exiled = (source as any)?.exiledCards ?? (source as any)?.cardsExiledWithThis ?? [];
    if (Array.isArray(exiled)) {
      for (const card of exiled) {
        const mv = Number((card as any)?.manaValue ?? (card as any)?.cmc ?? NaN);
        if (Number.isFinite(mv)) mvs.add(mv);
      }
    }
    const count = Number((source as any)?.exiledDistinctManaValueCount ?? mvs.size);
    return Number.isFinite(count) ? count >= 5 : mvs.size >= 5;
  }

  if (normalizedRaw === "it's not a spirit" || normalizedRaw === 'it is not a spirit') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return !params.objectHasType(ref, 'spirit');
  }

  if (normalizedRaw === "{c} wasn't spent to cast it" || normalizedRaw === '{c} was not spent to cast it') {
    const spent = Number((ctx as any)?.colorlessManaSpentToCast ?? (ctx as any)?.manaSpentToCast?.C ?? NaN);
    if (Number.isFinite(spent)) return spent === 0;
    const flag = (ctx as any)?.colorlessManaWasNotSpentToCast;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'exactly three colors of mana were spent to activate this ability') {
    const colors = (ctx as any)?.colorsOfManaSpentToActivate ?? (ctx as any)?.manaColorsSpentToActivate;
    if (Array.isArray(colors)) return colors.filter(Boolean).length === 3;
    const count = Number((ctx as any)?.colorCountSpentToActivate ?? NaN);
    return Number.isFinite(count) ? count === 3 : null;
  }

  if (normalizedRaw === 'this card is exiled with an egg counter on it') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return getCounterCount(ref, 'egg') >= 1;
  }

  if (normalizedRaw === 'an outlaw was sacrificed this way') {
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : params.movedCardsFrom(params);
    return snapshots.some((entry) => {
      const tl = getExecutorTypeLineLower(entry);
      return (
        tl.includes('assassin') ||
        tl.includes('mercenary') ||
        tl.includes('pirate') ||
        tl.includes('rogue') ||
        tl.includes('warlock')
      );
    });
  }

  if (normalizedRaw === "the top card of target player's graveyard is a creature card") {
    const targetId = String(
      ctx.selectorContext?.targetPlayerId ?? ctx.selectorContext?.targetOpponentId ?? 'p2',
    ).trim();
    const top = getTopGraveyardCard(nextState, targetId);
    return top ? params.objectHasType(top, 'creature') : false;
  }

  if (normalizedRaw === 'this enchantment has four or more quest counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return getCounterCount(source, 'quest') >= 4;
  }

  if (normalizedRaw === 'target opponent has more cards in hand than you') {
    const targetId = String(ctx.selectorContext?.targetOpponentId ?? 'p2').trim();
    return params.getPlayerHandCount(nextState, targetId as PlayerID) > params.getPlayerHandCount(nextState, controllerId);
  }

  if (normalizedRaw === 'they attacked you and/or a planeswalker you control') {
    const flag =
      (ctx as any)?.theyAttackedYouOrYourPlaneswalkerThisTurn ??
      (nextState as any)?.theyAttackedYouOrYourPlaneswalkerThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'this creature attacked this turn') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return Boolean((source as any)?.attackedThisTurn ?? params.isPermanentAttackingFn(source));
  }

  if (normalizedRaw === 'defending player is poisoned') {
    const targetId = String((ctx as any)?.defendingPlayerId ?? 'p2').trim();
    const poison = Number((nextState as any)?.poisonCounters?.[targetId] ?? NaN);
    if (Number.isFinite(poison)) return poison > 0;
    return Boolean((nextState as any)?.defendingPlayerIsPoisoned?.[targetId]);
  }

  if (normalizedRaw === 'a player has one or fewer cards in hand') {
    return getPlayerIds(nextState).some(
      (id) => params.getPlayerHandCount(nextState, id as PlayerID) <= 1,
    );
  }

  if (normalizedRaw === 'they control fewer lands than you') {
    const targetId = String(ctx.selectorContext?.targetOpponentId ?? 'p2').trim();
    return countLandsControlledBy(nextState, targetId) < countLandsControlledBy(nextState, controllerId);
  }

  if (normalizedRaw === 'an opponent gained life this turn') {
    const map = (nextState as any)?.lifeGainedThisTurnByOpponents;
    if (map && typeof map === 'object') {
      return Object.values(map as Record<string, unknown>).some(
        (v) => v === true || (typeof v === 'number' && v > 0),
      );
    }
    return Boolean((nextState as any)?.opponentGainedLifeThisTurn);
  }

  if (
    normalizedRaw === 'that opponent reveals exactly the chosen number of cards of the chosen color'
  ) {
    const flag = (ctx as any)?.opponentRevealedExactChosenColorCount;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'an opponent protects it') {
    const flag = (ctx as any)?.opponentProtectedBattle ?? (ctx as any)?.opponentProtectsIt;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === "it wasn't put onto the battlefield with this ability") {
    const flag = (ctx as any)?.wasNotPutOntoBattlefieldWithThisAbility;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'you put a counter on this creature this turn') {
    const v = controllerTurnStat(nextState, controllerId, 'countersPutOnThisCreatureThisTurn');
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    return null;
  }

  if (normalizedRaw === 'they discarded a nonland card') {
    const discarded = params.discardedCardsFrom(params);
    const card = discarded[discarded.length - 1];
    if (!card) return null;
    return !params.objectHasType(card, 'land');
  }

  if (normalizedRaw === 'you gained and lost life this turn') {
    const gained = Number((nextState as any)?.lifeGainedThisTurn?.[String(controllerId || '').trim()] ?? 0);
    const lost = Number((nextState as any)?.lifeLostThisTurn?.[String(controllerId || '').trim()] ?? 0);
    return gained > 0 && lost > 0;
  }

  if (normalizedRaw === "it wasn't cast this way" || normalizedRaw === 'it was not cast this way') {
    const flag = (ctx as any)?.wasNotCastThisWay ?? (ctx as any)?.spellWasNotCastThisWay;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (
    normalizedRaw === 'there are thirty or more counters among artifacts and creatures you control'
  ) {
    const count = Number((ctx as any)?.totalCountersOnArtifactsAndCreaturesYouControl ?? NaN);
    return Number.isFinite(count)
      ? count >= 30
      : countTotalCountersOnArtifactsAndCreatures(nextState, controllerId) >= 30;
  }

  if (normalizedRaw === 'it dealt combat damage to a player this turn') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (ref && (ref as any)?.dealtCombatDamageToPlayerThisTurn === true) return true;
    const flag = (ctx as any)?.dealtCombatDamageToPlayerThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'its toughness was less than 1') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return params.getCreatureToughness(ref) < 1;
  }

  if (normalizedRaw === 'an opponent lost 3 or more life this turn') {
    const map = (nextState as any)?.lifeLostThisTurn;
    if (!map || typeof map !== 'object') return null;
    return Object.entries(map as Record<string, unknown>).some(
      ([playerId, amount]) =>
        playerId !== String(controllerId || '').trim() &&
        typeof amount === 'number' &&
        amount >= 3,
    );
  }

  if (normalizedRaw === 'at least two creatures named wolves of the hunt you control') {
    const count = (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      return normalizeCardName(perm?.name ?? perm?.card?.name) === 'wolves of the hunt';
    }).length;
    return count >= 2;
  }

  if (normalizedRaw === 'there are seven or more lands on the battlefield') {
    return countLandsOnBattlefield(nextState) >= 7;
  }

  if (normalizedRaw === 'you control no face-down permanents') {
    return countFaceDownControlled(nextState, controllerId) === 0;
  }

  return null;
}
