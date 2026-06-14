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

export type Batch376BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  lastDiscardedCards?: readonly any[];
  lastExcessDamageDealtThisWay?: number;
  getConditionalSubjectCard: (params: Batch376BulkParams) => any | null;
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
  movedCardsFrom: (params: Batch376BulkParams) => any[];
  discardedCardsFrom: (params: Batch376BulkParams) => any[];
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

function cardMatchesHistoric(card: any): boolean {
  const tl = getExecutorTypeLineLower(card);
  return tl.includes('artifact') || tl.includes('legendary') || tl.includes('saga');
}

function readCardManaValue(card: any): number | null {
  const mv = Number(card?.manaValue ?? card?.cmc ?? card?.card?.manaValue ?? card?.card?.cmc ?? NaN);
  return Number.isFinite(mv) ? mv : null;
}

function getPlayerIds(nextState: GameState): string[] {
  return (nextState.players || [])
    .map((p: any) => String(p?.id || '').trim())
    .filter(Boolean);
}

function countControlledSubtype(nextState: GameState, playerId: string, subtype: string): number {
  const needle = String(subtype || '').trim().toLowerCase();
  return (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
    if (String(perm?.controller || '').trim() !== playerId) return false;
    return getExecutorTypeLineLower(perm).includes(needle);
  }).length;
}

function resolveEnchantedPermanent(
  nextState: GameState,
  ctx: OracleIRExecutionContext,
  getReferencedObject: Batch376BulkParams['getReferencedObject'],
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

function countAurasEnchanting(nextState: GameState, enchantedId: string): number {
  if (!enchantedId) return 0;
  return (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
    const tl = getExecutorTypeLineLower(perm);
    if (!tl.includes('aura') && !tl.includes('enchantment')) return false;
    const attachedTo = String((perm as any)?.attachedTo || (perm as any)?.enchantedPermanentId || '').trim();
    return attachedTo === enchantedId;
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

function readAlternateCostPaid(ctx: OracleIRExecutionContext, costRaw?: string): boolean | null {
  if (ctx.alternateCostPaid === true) return true;
  if (ctx.alternateCostPaid === false) return false;
  const paidCost = String((ctx as any)?.paidAlternateCostRaw ?? (ctx as any)?.modalCostPaidRaw ?? '').trim();
  if (costRaw && paidCost) {
    return paidCost.toLowerCase() === costRaw.toLowerCase() ? true : false;
  }
  const flag = (ctx as any)?.modalCostWasPaid ?? (ctx as any)?.kickerWasPaid;
  return typeof flag === 'boolean' ? flag : null;
}

function cardIsMulticolored(card: any): boolean {
  const colors = card?.colors ?? card?.card?.colors ?? card?.color_identity ?? card?.card?.color_identity;
  if (Array.isArray(colors)) return colors.filter(Boolean).length >= 2;
  const colorIdentity = String(card?.colorIdentity ?? card?.card?.colorIdentity ?? '');
  if (colorIdentity.length >= 2) return true;
  return false;
}

export function evaluateBatch376BulkConditionalClause(params: Batch376BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  if (normalizedRaw === 'it was historic') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return cardMatchesHistoric(ref);
  }

  if (normalizedRaw === "this land isn't a creature" || normalizedRaw === 'this land is not a creature') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    const land = source ?? params.getConditionalSubjectCard(params);
    if (!land) return null;
    return !params.objectHasType(land, 'creature');
  }

  if (normalizedRaw === 'you spend this mana to cast your commander') {
    const flag =
      (ctx as any)?.manaSpentToCastCommander ??
      (ctx as any)?.commanderManaSpentOnCommander ??
      ctx.selectorContext?.manaSpentToCastCommander;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'no creatures died this turn') {
    const global = (nextState as any)?.creatureDiedThisTurn;
    if (typeof global === 'boolean') return !global;
    const map = (nextState as any)?.creaturesDiedThisTurnByController;
    if (map && typeof map === 'object') {
      return !Object.values(map as Record<string, unknown>).some(
        (v) => v === true || (typeof v === 'number' && v > 0),
      );
    }
    return null;
  }

  if (normalizedRaw === 'a player controls more wizards than each other player') {
    const ids = getPlayerIds(nextState);
    if (ids.length < 2) return null;
    const counts = ids.map((id) => countControlledSubtype(nextState, id, 'wizard'));
    const max = Math.max(...counts);
    if (max === 0) return false;
    const leaders = counts.filter((c) => c === max);
    return leaders.length === 1;
  }

  if (normalizedRaw === 'you cast it during your main phase') {
    const flag =
      (ctx as any)?.castDuringMainPhase ??
      (ctx as any)?.castDuringYourMainPhase ??
      (nextState as any)?.castDuringMainPhaseThisTurn?.[String(controllerId || '').trim()];
    if (typeof flag === 'boolean') return flag;
    return true;
  }

  if (normalizedRaw === 'that mana is spent on a multicolored creature spell') {
    const creatureSpell =
      (ctx as any)?.manaSpentOnMulticoloredCreatureSpell ??
      (ctx as any)?.manaSpentOnCreatureSpell;
    if (typeof creatureSpell === 'boolean') return creatureSpell;
    const spell = (ctx as any)?.lastCastSpell ?? params.getReferencedObject(nextState, ctx);
    if (spell && params.objectHasType(spell, 'creature')) return cardIsMulticolored(spell);
    return null;
  }

  if (normalizedRaw === 'excess damage was dealt to a creature this way') {
    const excess = Number(
      params.lastExcessDamageDealtThisWay ??
        (ctx as any)?.lastExcessDamageDealtThisWay ??
        (ctx as any)?.excessDamageDealtToCreatureThisWay ??
        NaN,
    );
    return Number.isFinite(excess) ? excess > 0 : null;
  }

  if (normalizedRaw === 'you sacrificed a food this turn') {
    const v = controllerTurnStat(nextState, controllerId, 'foodSacrificedThisTurn');
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    return null;
  }

  if (normalizedRaw === 'it has mana value 3 or less') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    const mv = ref ? readCardManaValue(ref) : null;
    return mv === null ? null : mv <= 3;
  }

  if (normalizedRaw === 'the {1}{b} cost was paid') {
    return readAlternateCostPaid(ctx, '{1}{B}');
  }

  if (normalizedRaw === 'the {3}{g} cost was paid') {
    return readAlternateCostPaid(ctx, '{3}{G}');
  }

  if (normalizedRaw === 'the {2}{r}{r} cost was paid') {
    return readAlternateCostPaid(ctx, '{2}{R}{R}');
  }

  if (normalizedRaw === 'that permanent or card has a time counter on it') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return getCounterCount(ref, 'time') >= 1;
  }

  if (normalizedRaw === "it's your combat phase" || normalizedRaw === 'it is your combat phase') {
    const phase = String((nextState as any)?.phase ?? (nextState as any)?.currentPhase ?? '').toLowerCase();
    if (phase.includes('combat')) {
      const active = String((nextState as any)?.activePlayerId ?? (nextState as any)?.turnPlayerId ?? '').trim();
      return !active || active === String(controllerId || '').trim();
    }
    const flag = (nextState as any)?.isYourCombatPhase?.[String(controllerId || '').trim()];
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'you have a card in hand') {
    return params.getPlayerHandCount(nextState, controllerId) >= 1;
  }

  if (normalizedRaw === 'you win the bidding') {
    const flag = (ctx as any)?.wonBidding ?? (ctx as any)?.youWinTheBidding;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'its madness cost was paid') {
    const flag =
      (ctx as any)?.madnessCostWasPaid ??
      (ctx as any)?.castWithMadness ??
      ctx.alternateCostPaid;
    if (flag === true) return true;
    if (flag === false) return false;
    return null;
  }

  if (normalizedRaw === 'sidar jabari is in the command zone or on the battlefield') {
    const needle = 'sidar jabari';
    const onBf = (getProcessedBattlefield(nextState) as any[]).some((perm) =>
      normalizeCardName(perm?.name ?? perm?.card?.name).includes(needle),
    );
    if (onBf) return true;
    for (const player of nextState.players || []) {
      const command = (player as any)?.commandZone ?? (player as any)?.commander;
      const cards = Array.isArray(command) ? command : command ? [command] : [];
      if (
        cards.some((card: any) => normalizeCardName(card?.name ?? card?.card?.name).includes(needle))
      ) {
        return true;
      }
    }
    return false;
  }

  if (normalizedRaw === 'this creature is enchanted by two or more auras') {
    const enchanted = resolveEnchantedPermanent(nextState, ctx, params.getReferencedObject);
    const enchantedId = String((enchanted as any)?.id || ctx.sourceId || '').trim();
    if (!enchantedId) return null;
    return countAurasEnchanting(nextState, enchantedId) >= 2;
  }

  if (normalizedRaw === 'a werewolf is dealt damage this way') {
    const damaged = (ctx as any)?.lastDamagedCards ?? params.movedCardsFrom(params);
    if (Array.isArray(damaged) && damaged.length > 0) {
      return damaged.some((card) => params.objectHasType(card, 'werewolf'));
    }
    const flag = (ctx as any)?.werewolfDealtDamageThisWay;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'x is 1') {
    const x = Number(ctx.xValue ?? (ctx as any)?.chosenX ?? NaN);
    return Number.isFinite(x) ? x === 1 : null;
  }

  if (normalizedRaw === 'x is 3') {
    const x = Number(ctx.xValue ?? (ctx as any)?.chosenX ?? NaN);
    return Number.isFinite(x) ? x === 3 : null;
  }

  if (normalizedRaw === 'enchanted creature has toxic') {
    const enchanted = resolveEnchantedPermanent(nextState, ctx, params.getReferencedObject);
    if (!enchanted) return null;
    return params.objectHasKeyword(enchanted, 'toxic');
  }

  if (normalizedRaw === 'there are no charge counters on this vehicle') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return getCounterCount(source, 'charge') === 0;
  }

  if (normalizedRaw === 'at least eight mana was spent to cast it') {
    const spent = Number((ctx as any)?.manaSpentToCastIt ?? (ctx as any)?.lastManaSpentToCast ?? NaN);
    if (Number.isFinite(spent)) return spent >= 8;
    const flag = (ctx as any)?.atLeastEightManaSpentToCast;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === "you've drawn more than one card this turn") {
    const drawn = Number((nextState as any)?.cardsDrawnThisTurn?.[String(controllerId || '').trim()] ?? NaN);
    return Number.isFinite(drawn) ? drawn > 1 : null;
  }

  if (normalizedRaw === 'you sacrificed a permanent this way') {
    const flag = (ctx as any)?.youSacrificedPermanentThisWay ?? (ctx as any)?.controllerSacrificedThisWay;
    if (typeof flag === 'boolean') return flag;
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? (ctx as any).lastSacrificedPermanents
      : [];
    return snapshots.some(
      (entry: any) => String(entry?.controller || entry?.controllerId || controllerId).trim() === String(controllerId || '').trim(),
    );
  }

  if (normalizedRaw === 'another elf entered the battlefield under your control this turn') {
    const v = controllerTurnStat(nextState, controllerId, 'elvesEnteredBattlefieldUnderControlThisTurn');
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    return null;
  }

  if (normalizedRaw === 'a saproling was sacrificed this way') {
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? (ctx as any).lastSacrificedPermanents
      : params.movedCardsFrom(params);
    return snapshots.some((entry: any) => params.objectHasType(entry, 'saproling'));
  }

  if (normalizedRaw === 'it was dealt noncombat damage this turn') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (ref && (ref as any)?.wasDealtNoncombatDamageThisTurn === true) return true;
    const flag = (ctx as any)?.targetWasDealtNoncombatDamageThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (
    normalizedRaw ===
    "this spell's additional cost was paid and the revealed card is the chosen type"
  ) {
    const paid =
      (ctx as any)?.optionalAdditionalCostWasPaid ??
      (ctx as any)?.additionalCostWasPaid ??
      ctx.alternateCostPaid;
    const matchesType = (ctx as any)?.revealedCardMatchesChosenType;
    if (typeof paid === 'boolean' && typeof matchesType === 'boolean') return paid && matchesType;
    if (paid === false || matchesType === false) return false;
    return null;
  }

  if (normalizedRaw === 'kaito entered this turn') {
    const flag = (ctx as any)?.kaitoEnteredThisTurn ?? (nextState as any)?.kaitoEnteredThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'this artifact has five or more charge counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
    );
    if (!source) return null;
    return getCounterCount(source, 'charge') >= 5;
  }

  return null;
}
