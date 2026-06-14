import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield, isPermanentAttacking } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export type Batch375BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  lastDiscardedCards?: readonly any[];
  getConditionalSubjectCard: (params: Batch375BulkParams) => any | null;
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
  movedCardsFrom: (params: Batch375BulkParams) => any[];
  discardedCardsFrom: (params: Batch375BulkParams) => any[];
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

function findNamedControlledPermanent(nextState: GameState, controllerId: PlayerID, name: string): boolean {
  const target = normalizeCardName(name);
  return (getProcessedBattlefield(nextState) as any[]).some((perm) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    const permName = normalizeCardName(perm?.name ?? perm?.card?.name);
    return permName === target;
  });
}

function countControlledDescriptor(nextState: GameState, controllerId: PlayerID, descriptor: string): number {
  const needle = String(descriptor || '').trim().toLowerCase();
  return (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    return getExecutorTypeLineLower(perm).includes(needle);
  }).length;
}

function countBasicLandTypesForPlayer(nextState: GameState, playerId: string): number {
  const types = new Set<string>();
  for (const perm of getProcessedBattlefield(nextState) as any[]) {
    if (String(perm?.controller || '').trim() !== playerId) continue;
    const tl = getExecutorTypeLineLower(perm);
    if (!tl.includes('land')) continue;
    if (tl.includes('plains')) types.add('plains');
    if (tl.includes('island')) types.add('island');
    if (tl.includes('swamp')) types.add('swamp');
    if (tl.includes('mountain')) types.add('mountain');
    if (tl.includes('forest')) types.add('forest');
  }
  return types.size;
}

function cardManaCostContainsX(card: any): boolean {
  const cost = String(card?.mana_cost ?? card?.manaCost ?? card?.card?.mana_cost ?? '').toUpperCase();
  return cost.includes('{X}') || cost.includes('{x}');
}

function readCardManaValue(card: any): number | null {
  const mv = Number(card?.manaValue ?? card?.cmc ?? card?.card?.manaValue ?? card?.card?.cmc ?? NaN);
  return Number.isFinite(mv) ? mv : null;
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

export function evaluateBatch375BulkConditionalClause(params: Batch375BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  if (
    normalizedRaw ===
    'you both own and control this creature and a creature named midnight scavengers'
  ) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    const sourceId = String(source?.id || ctx.sourceId || '').trim();
    const owner = String(source?.owner ?? source?.ownerId ?? source?.controller ?? controllerId).trim();
    const controller = String(source?.controller ?? controllerId).trim();
    if (owner !== String(controllerId || '').trim() || controller !== String(controllerId || '').trim()) {
      return false;
    }
    return findNamedControlledPermanent(nextState, controllerId, 'Midnight Scavengers');
  }

  if (normalizedRaw === 'its mana cost contains {x}') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return cardManaCostContainsX(ref);
  }

  if (normalizedRaw === 'any of those creatures have power or toughness equal to the chosen number') {
    const chosen = Number(
      ctx.selectorContext?.chosenNumber ??
        (ctx as any)?.chosenNumber ??
        ctx.xValue ??
        NaN
    );
    if (!Number.isFinite(chosen)) return null;
    const creatures = params.movedCardsFrom(params).filter((card) => params.objectHasType(card, 'creature'));
    const pool =
      creatures.length > 0
        ? creatures
        : (getProcessedBattlefield(nextState) as any[]).filter((perm) => params.objectHasType(perm, 'creature'));
    return pool.some(
      (perm) => params.getCreaturePower(perm) === chosen || params.getCreatureToughness(perm) === chosen
    );
  }

  if (
    normalizedRaw === "it isn't a creature or vehicle" ||
    normalizedRaw === 'it is not a creature or vehicle'
  ) {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return !params.objectHasType(ref, 'creature') && !params.objectHasType(ref, 'vehicle');
  }

  if (normalizedRaw === 'it has a +1/+1 counter on it') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return getCounterCount(ref, '+1/+1') >= 1;
  }

  if (normalizedRaw === 'this enchantment has ten or more luck counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    return getCounterCount(source, 'luck') >= 10;
  }

  if (normalizedRaw === 'an opponent lost life last turn') {
    const map = (nextState as any)?.opponentLostLifeLastTurn;
    if (map && typeof map === 'object') {
      return Object.values(map as Record<string, unknown>).some((v) => v === true || (typeof v === 'number' && v > 0));
    }
    return null;
  }

  if (normalizedRaw === 'a face-down creature entered the battlefield under your control this turn') {
    const flag =
      ctx.faceDownPermanentEnteredThisTurnUnderYourControl ??
      ctx.selectorContext?.faceDownPermanentEnteredThisTurnUnderYourControl ??
      (nextState as any)?.faceDownCreaturesEnteredUnderControlThisTurn?.[String(controllerId || '').trim()];
    if (typeof flag === 'boolean') return flag;
    if (typeof flag === 'number') return flag > 0;
    return null;
  }

  if (normalizedRaw === 'you chose a creature other than galadriel as your ring-bearer') {
    const ringBearerId = String(
      ctx.chosenRingBearerId ??
        ctx.selectorContext?.chosenRingBearerId ??
        (nextState.players.find((p) => p.id === controllerId) as any)?.ringBearerId ??
        ''
    ).trim();
    if (!ringBearerId) return null;
    const bearer = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, ringBearerId);
    const bearerName = normalizeCardName((bearer as any)?.name ?? (bearer as any)?.card?.name);
    return bearerName !== 'galadriel' && bearerName !== "galadriel of lothlórien";
  }

  if (normalizedRaw === 'that player controls one or more lands with contested counters on them') {
    const targetId = String(
      ctx.selectorContext?.targetPlayerId ?? ctx.selectorContext?.targetOpponentId ?? 'p2'
    ).trim();
    return (getProcessedBattlefield(nextState) as any[]).some((perm) => {
      if (String(perm?.controller || '').trim() !== targetId) return false;
      if (!params.objectHasType(perm, 'land')) return false;
      return getCounterCount(perm, 'contested') >= 1;
    });
  }

  if (normalizedRaw === 'this artifact has a charge counter on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    return getCounterCount(source, 'charge') >= 1;
  }

  if (normalizedRaw === "the sacrificed creature's toughness was 4 or greater") {
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : params.movedCardsFrom(params);
    const creature = snapshots.find((entry) => params.objectHasType(entry, 'creature')) ?? snapshots[0];
    if (!creature) return null;
    return params.getCreatureToughness(creature) >= 4;
  }

  if (/^there are four or more basic land types among lands that player controls$/i.test(normalizedRaw)) {
    const targetId = String(
      ctx.selectorContext?.targetPlayerId ?? ctx.selectorContext?.targetOpponentId ?? 'p2'
    ).trim();
    return countBasicLandTypesForPlayer(nextState, targetId) >= 4;
  }

  if (normalizedRaw === 'that land had a nonbasic land type') {
    const land = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!land) return null;
    const tl = getExecutorTypeLineLower(land);
    if (!tl.includes('land')) return false;
    return !/\bbasic\b/.test(tl);
  }

  if (
    normalizedRaw === "you didn't put the revealed card onto the battlefield this way" ||
    normalizedRaw === 'you did not put the revealed card onto the battlefield this way'
  ) {
    const flag = (ctx as any)?.didNotPutRevealedCardOntoBattlefieldThisWay;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === "you've cast a spell with mana value 4 or greater this turn") {
    const v = controllerTurnStat(nextState, controllerId, 'spellsCastWithManaValueFourOrGreaterThisTurn');
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    const mv = Number((ctx as any)?.lastCastSpellManaValue ?? NaN);
    return Number.isFinite(mv) ? mv >= 4 : null;
  }

  if (normalizedRaw === 'you discarded a card this turn') {
    const v = controllerTurnStat(nextState, controllerId, 'cardsDiscardedThisTurn');
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    return null;
  }

  if (/^the result is equal to or less than the number of robots you control$/i.test(normalizedRaw)) {
    const roll = Number((ctx as any)?.lastDieRollResult ?? (ctx as any)?.lastDieRoll?.result ?? NaN);
    if (!Number.isFinite(roll)) return null;
    return roll <= countControlledDescriptor(nextState, controllerId, 'robot');
  }

  if (normalizedRaw === "you've drawn two or more cards this turn") {
    const drawn = Number((nextState as any)?.cardsDrawnThisTurn?.[String(controllerId || '').trim()] ?? NaN);
    return Number.isFinite(drawn) ? drawn >= 2 : null;
  }

  if (normalizedRaw === 'you have 200 or more cards in your library') {
    const player = (nextState.players || []).find(
      (p: any) => String(p?.id || '').trim() === String(controllerId || '').trim()
    ) as any;
    const library = Array.isArray(player?.library) ? player.library : [];
    return library.length >= 200;
  }

  if (normalizedRaw === 'at least seven red mana was spent to cast this spell') {
    const spent = Number((ctx as any)?.redManaSpentToCast ?? (ctx as any)?.manaSpentToCast?.R ?? NaN);
    if (Number.isFinite(spent)) return spent >= 7;
    const flag = (ctx as any)?.atLeastSevenRedManaSpentToCast;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'its mana value is less than or equal to the number of allies you control') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    const mv = ref ? readCardManaValue(ref) : null;
    if (mv === null) return null;
    return mv <= countControlledDescriptor(nextState, controllerId, 'ally');
  }

  if (normalizedRaw === 'you were the monarch as the turn began') {
    const flag =
      (ctx as any)?.wasMonarchAsTurnBegan ??
      (nextState as any)?.wasMonarchAsTurnBegan?.[String(controllerId || '').trim()];
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'damage from a black source is prevented this way') {
    const flag =
      (ctx as any)?.blackDamagePreventedThisWay ??
      (ctx as any)?.lastPreventedDamageSourceColor ??
      (ctx as any)?.damagePreventedFromBlackSourceThisWay;
    if (flag === 'B' || flag === 'black') return true;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'your devotion to white and black is seven or greater') {
    const devotion = Number(
      (nextState as any)?.devotionToWhiteAndBlack?.[String(controllerId || '').trim()] ??
        (ctx as any)?.devotionToWhiteAndBlack ??
        NaN
    );
    return Number.isFinite(devotion) ? devotion >= 7 : null;
  }

  if (normalizedRaw === 'it had mana value 3 or less') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (ref) {
      const mv = readCardManaValue(ref);
      if (mv !== null) return mv <= 3;
    }
    const movedId = String((ref as any)?.id || params.movedCardsFrom(params)[0]?.id || '').trim();
    if (movedId) {
      for (const player of nextState.players || []) {
        for (const zone of ['exile', 'hand', 'graveyard'] as const) {
          const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
          const found = cards.find((card: any) => String(card?.id || '').trim() === movedId);
          if (found) {
            const zoneMv = readCardManaValue(found);
            if (zoneMv !== null) return zoneMv <= 3;
          }
        }
      }
    }
    const ledgerMv = readCardManaValue(params.movedCardsFrom(params)[0]);
    return ledgerMv === null ? null : ledgerMv <= 3;
  }

  if (normalizedRaw === 'it has the same name as a card in your graveyard') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    const refName = normalizeCardName((ref as any)?.name ?? (ref as any)?.card?.name);
    if (!refName) return null;
    return params.getGraveyardCards(nextState, controllerId).some(
      (card) => normalizeCardName(card?.name ?? card?.card?.name) === refName
    );
  }

  if (
    normalizedRaw === "the discarded card wasn't a land card" ||
    normalizedRaw === 'the discarded card was not a land card'
  ) {
    const discarded = params.discardedCardsFrom(params);
    const card = discarded[discarded.length - 1];
    if (!card) return null;
    return !params.objectHasType(card, 'land');
  }

  if (normalizedRaw === "the discovered card's mana value is less than 10") {
    const mv = Number(
      (ctx as any)?.lastDiscoveredCardManaValue ??
        readCardManaValue((ctx as any)?.lastDiscoveredCard) ??
        NaN
    );
    return Number.isFinite(mv) ? mv < 10 : null;
  }

  if (normalizedRaw === 'there are three or more cards exiled with this permanent') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const count = Number((source as any)?.exiledCardCount ?? (source as any)?.cardsExiledWithThis?.length ?? NaN);
    return Number.isFinite(count) ? count >= 3 : null;
  }

  if (normalizedRaw === 'this artifact has fewer than three charge counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    return getCounterCount(source, 'charge') < 3;
  }

  if (normalizedRaw === 'you control a demon or devil') {
    return (getProcessedBattlefield(nextState) as any[]).some((perm) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const tl = getExecutorTypeLineLower(perm);
      return tl.includes('demon') || tl.includes('devil');
    });
  }

  if (normalizedRaw === 'a phyrexian died under your control this turn') {
    const v = controllerTurnStat(nextState, controllerId, 'phyrexiansDiedUnderControlThisTurn');
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    return null;
  }

  if (normalizedRaw === 'at least seven mana was spent to cast it') {
    const spent = Number((ctx as any)?.manaSpentToCastIt ?? (ctx as any)?.lastManaSpentToCast ?? NaN);
    if (Number.isFinite(spent)) return spent >= 7;
    const flag = (ctx as any)?.atLeastSevenManaSpentToCast;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === "you've cast three or more instant and sorcery spells this turn") {
    const v = controllerTurnStat(nextState, controllerId, 'instantAndSorcerySpellsCastThisTurn');
    if (typeof v === 'number') return v >= 3;
    if (typeof v === 'boolean') return v;
    return null;
  }

  if (normalizedRaw === 'you cycled two or more cards this turn') {
    const v = controllerTurnStat(nextState, controllerId, 'cardsCycledThisTurn');
    if (typeof v === 'number') return v >= 2;
    if (typeof v === 'boolean') return v;
    return null;
  }

  return null;
}
