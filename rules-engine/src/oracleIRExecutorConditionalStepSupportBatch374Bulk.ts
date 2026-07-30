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

export type Batch374BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  lastDiscardedCards?: readonly any[];
  getConditionalSubjectCard: (params: Batch374BulkParams) => any | null;
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
  movedCardsFrom: (params: Batch374BulkParams) => any[];
  discardedCardsFrom: (params: Batch374BulkParams) => any[];
  isPermanentAttackingFn: (perm: any) => boolean;
  cardMatchesChosenColor: (card: any, chosenColor: string) => boolean;
};

function getPlayerIds(nextState: GameState): string[] {
  return (nextState.players || [])
    .map((p: any) => String(p?.id || '').trim())
    .filter(Boolean);
}

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

function permanentHasColor(perm: any, letter: string): boolean {
  const colors = getColorsFromObject(perm);
  return colors.some((c) => String(c || '').trim().toUpperCase() === letter.toUpperCase());
}

function countControlledColors(nextState: GameState, controllerId: PlayerID): number {
  const seen = new Set<string>();
  for (const perm of getProcessedBattlefield(nextState) as any[]) {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    for (const color of getColorsFromObject(perm)) {
      const normalized = String(color || '').trim().toUpperCase();
      if (normalized) seen.add(normalized);
    }
  }
  return seen.size;
}

function getCardTypes(card: any): string[] {
  const typeLine = getExecutorTypeLineLower(card);
  const types = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery', 'tribal'];
  return types.filter((type) => typeLine.includes(type));
}

function sharesCardType(a: any, b: any): boolean {
  const aTypes = getCardTypes(a);
  const bTypes = getCardTypes(b);
  return aTypes.some((type) => bTypes.includes(type));
}

function resolveEnchantedPermanent(nextState: GameState, ctx: OracleIRExecutionContext, getReferencedObject: Batch374BulkParams['getReferencedObject']): any | null {
  const enchantedId = String(
    (ctx as any)?.enchantedPermanentId ??
      ctx.targetPermanentId ??
      ctx.targetCreatureId ??
      ''
  ).trim();
  if (enchantedId) {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const found = findObjectByIdInState(nextState, battlefield, enchantedId);
    if (found) return found;
  }
  const source = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );
  const attachedTo = String((source as any)?.attachedTo || (source as any)?.enchantedPermanentId || '').trim();
  if (attachedTo) {
    return findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attachedTo);
  }
  return getReferencedObject(nextState, ctx);
}

export function evaluateBatch374BulkConditionalClause(params: Batch374BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  if (
    normalizedRaw ===
    'you removed a creature card with flying from the draft with cards named this permanent'
  ) {
    const flag = (ctx as any)?.draftRemovedFlyingCreatureWithSameName;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (
    /^\{u\} was spent to cast this spell, and creatures you control get .+ if \{r\} was spent to cast this spell$/i.test(
      normalizedRaw
    )
  ) {
    const uSpent = (ctx as any)?.blueManaSpentToCast === true || (ctx as any)?.manaSpentToCast?.U === true;
    const rSpent = (ctx as any)?.redManaSpentToCast === true || (ctx as any)?.manaSpentToCast?.R === true;
    if (uSpent && rSpent) return true;
    if ((ctx as any)?.blueManaSpentToCast === false || (ctx as any)?.redManaSpentToCast === false) return false;
    return null;
  }

  if (/^\{u\} was spent to cast this spell$/i.test(normalizedRaw)) {
    const flag = (ctx as any)?.blueManaSpentToCast ?? (ctx as any)?.manaSpentToCast?.U;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (/^\{r\} was spent to cast this spell$/i.test(normalizedRaw)) {
    const flag = (ctx as any)?.redManaSpentToCast ?? (ctx as any)?.manaSpentToCast?.R;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'this permanent has one or more +1/+1 counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    return getCounterCount(source, '+1/+1') >= 1;
  }

  if (normalizedRaw === 'you control a black or red permanent') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return battlefield.some((perm) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      return permanentHasColor(perm, 'B') || permanentHasColor(perm, 'R');
    });
  }

  if (normalizedRaw === 'you control a black permanent and a red permanent') {
    let hasBlack = false;
    let hasRed = false;
    for (const perm of getProcessedBattlefield(nextState) as any[]) {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) continue;
      if (permanentHasColor(perm, 'B')) hasBlack = true;
      if (permanentHasColor(perm, 'R')) hasRed = true;
      if (hasBlack && hasRed) return true;
    }
    return false;
  }

  {
    const flipMatch = normalizedRaw.match(/^you win (one|two|three|\d+|[a-z]+) or more flips$/i);
    if (flipMatch) {
      const threshold = params.parseSmallNumberWord(String(flipMatch[1] || ''));
      if (threshold === null) return null;
      const won = Number(
        (ctx as any)?.coinFlipsWonThisResolution ??
          (ctx as any)?.flipsWonThisAbility ??
          (ctx as any)?.coinFlipsWon ??
          NaN
      );
      return Number.isFinite(won) ? won >= threshold : null;
    }
  }

  if (normalizedRaw === 'this creature is an angel' || normalizedRaw === 'this permanent is an angel') {
    const source =
      params.getConditionalSubjectCard(params) ??
      getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      );
    if (!source) return null;
    return params.objectHasType(source, 'angel');
  }

  if (normalizedRaw === 'that mana is spent to cast a non-human creature spell') {
    const flag =
      (ctx as any)?.manaSpentOnNonHumanCreatureSpell ??
      (ctx.selectorContext as any)?.manaSpentOnNonHumanCreatureSpell;
    if (typeof flag === 'boolean') return flag;
    const spell = (ctx as any)?.stackItem ?? params.getReferencedObject(nextState, ctx);
    const tl = getExecutorTypeLineLower(spell);
    return tl.includes('creature') && !tl.includes('human');
  }

  if (normalizedRaw === 'this mana is spent to cast a creature spell') {
    const flag =
      ctx.manaSpentOnCreatureSpell ??
      (ctx.selectorContext as any)?.manaSpentOnCreatureSpell ??
      (ctx as any)?.manaSpentOnCreatureSpell;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (
    normalizedRaw ===
    'the amount of mana spent to cast that spell is greater than this permanent\'s power'
  ) {
    const spent = Number(
      (ctx as any)?.manaSpentToCastTargetSpell ??
        (ctx as any)?.lastManaSpentToCast ??
        (ctx as any)?.referenceSpellManaValue ??
        NaN
    );
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source || !Number.isFinite(spent)) return null;
    return spent > params.getCreaturePower(source);
  }

  if (normalizedRaw === 'the sacrificed permanent was a commander') {
    const flag = (ctx as any)?.sacrificedPermanentWasCommander;
    if (typeof flag === 'boolean') return flag;
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : [];
    if (snapshots.length === 0) return null;
    return snapshots.some((entry) => Boolean((entry as any)?.isCommander ?? (entry as any)?.commander));
  }

  if (normalizedRaw === 'any player pays {2}') {
    const flag = (ctx as any)?.anyPlayerPaidTwo ?? (ctx as any)?.unlessPayWasPaid;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'there are five colors among permanents you control') {
    return countControlledColors(nextState, controllerId) >= 5;
  }

  if (normalizedRaw === 'an enchantment was put into your graveyard from the battlefield this turn') {
    const map = (nextState as any)?.enchantmentPutIntoGraveyardFromBattlefieldThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0 : null;
    }
    return null;
  }

  if (normalizedRaw === 'you attacked with exactly one other creature this combat') {
    const sourceId = String(ctx.sourceId || '').trim();
    const attackers = (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      if (!params.isPermanentAttackingFn(perm)) return false;
      const id = String(perm?.id || '').trim();
      return !sourceId || id !== sourceId;
    });
    return attackers.length === 1;
  }

  if (normalizedRaw === 'that creature is white or blue') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return permanentHasColor(ref, 'W') || permanentHasColor(ref, 'U');
  }

  if (normalizedRaw === 'you roll a 6' || normalizedRaw === "you've rolled a 6 this turn") {
    const roll = Number((ctx as any)?.lastDieRollResult ?? (ctx as any)?.lastDieRoll?.result ?? NaN);
    if (Number.isFinite(roll)) return roll === 6;
    const map = (nextState as any)?.rolledSixThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? v : null;
    }
    return null;
  }

  if (
    normalizedRaw ===
    'enchanted permanent is a creature with the greatest power among creatures on the battlefield'
  ) {
    const enchanted = resolveEnchantedPermanent(nextState, ctx, params.getReferencedObject);
    if (!enchanted || !params.objectHasType(enchanted, 'creature')) return false;
    const enchantedPower = params.getCreaturePower(enchanted);
    let greatest = enchantedPower;
    for (const perm of getProcessedBattlefield(nextState) as any[]) {
      if (!params.objectHasType(perm, 'creature')) continue;
      greatest = Math.max(greatest, params.getCreaturePower(perm));
    }
    return enchantedPower >= greatest;
  }

  if (normalizedRaw === "there's a creature or lesson card in your graveyard") {
    const gy = params.getGraveyardCards(nextState, controllerId);
    return gy.some((card) => {
      const tl = getExecutorTypeLineLower(card);
      return tl.includes('creature') || tl.includes('lesson');
    });
  }

  if (normalizedRaw === 'this permanent was kicked') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    return Boolean((source as any)?.wasKicked ?? (source as any)?.card?.wasKicked);
  }

  if (normalizedRaw === 'there are fewer than six creature cards in your graveyard') {
    const count = params.getGraveyardCards(nextState, controllerId).filter((card) =>
      params.objectHasType(card, 'creature')
    ).length;
    return count < 6;
  }

  if (normalizedRaw === 'it shares a card type with the card exiled this way') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    const exiled = params.movedCardsFrom(params)[0] ?? (ctx as any)?.lastExiledCards?.[0];
    if (!ref || !exiled) return null;
    return sharesCardType(ref, exiled);
  }

  if (normalizedRaw === "you don't put it onto the battlefield" || normalizedRaw === 'you did not put it onto the battlefield') {
    const flag = (ctx as any)?.didNotPutExiledCardOntoBattlefield;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (
    normalizedRaw ===
    'that player has no cards in hand and this enchantment has two or more quest counters on it'
  ) {
    const targetId = String(
      ctx.selectorContext?.targetPlayerId ?? ctx.selectorContext?.targetOpponentId ?? ''
    ).trim();
    if (!targetId) return null;
    const handEmpty = params.getPlayerHandCount(nextState, targetId as PlayerID) === 0;
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const quest = source ? getCounterCount(source, 'quest') : 0;
    return handEmpty && quest >= 2;
  }

  if (normalizedRaw === 'that spell targets a commander you control') {
    const flag = (ctx as any)?.spellTargetsCommanderYouControl;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === "it's not a vehicle" || normalizedRaw === 'it is not a vehicle') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return !params.objectHasType(ref, 'vehicle');
  }

  if (normalizedRaw === 'that creature had to attack this combat') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    if ((ref as any)?.mustAttackThisCombat === true || (ref as any)?.hadToAttackThisCombat === true) return true;
    if ((ref as any)?.mustAttackThisCombat === false || (ref as any)?.hadToAttackThisCombat === false) return false;
    return null;
  }

  if (normalizedRaw === 'it comes up heads') {
    const result = String((ctx as any)?.lastCoinFlipResult ?? '').trim().toLowerCase();
    if (result === 'heads') return true;
    if (result === 'tails') return false;
    if (typeof ctx.wonCoinFlip === 'boolean') return ctx.wonCoinFlip;
    return null;
  }

  if (normalizedRaw === 'the discarded card was a land card') {
    const discarded = params.discardedCardsFrom(params);
    const card = discarded[discarded.length - 1];
    if (!card) return null;
    return params.objectHasType(card, 'land');
  }

  if (normalizedRaw === 'this creature has two or fewer judgment counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    return getCounterCount(source, 'judgment') <= 2;
  }

  if (normalizedRaw === "you've been dealt damage by two or more creatures this turn") {
    const count = Number((nextState as any)?.creaturesThatDealtDamageToYouThisTurn?.[String(controllerId || '').trim()] ?? NaN);
    return Number.isFinite(count) ? count >= 2 : null;
  }

  if (normalizedRaw === "you didn't lose life this turn" || normalizedRaw === 'you did not lose life this turn') {
    const map = (nextState as any)?.lifeLostThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      if (typeof v === 'number') return v === 0;
      if (typeof v === 'boolean') return !v;
    }
    return null;
  }

  if (normalizedRaw === 'that land was legendary') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return params.objectHasType(ref, 'legendary') || getExecutorTypeLineLower(ref).includes('legendary');
  }

  if (normalizedRaw === 'that player controls a plains') {
    const targetId = String(
      ctx.selectorContext?.targetPlayerId ?? ctx.selectorContext?.targetOpponentId ?? ''
    ).trim();
    if (!targetId) return null;
    return (getProcessedBattlefield(nextState) as any[]).some((perm) => {
      if (String(perm?.controller || '').trim() !== targetId) return false;
      return getExecutorTypeLineLower(perm).includes('plains');
    });
  }

  if (normalizedRaw === 'three or more cards have been exiled with this artifact') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const count = Number((source as any)?.exiledCardCount ?? (source as any)?.cardsExiledWithThis?.length ?? NaN);
    return Number.isFinite(count) ? count >= 3 : null;
  }

  if (normalizedRaw === 'defending player controls no glimmer creatures') {
    const defendingId = String((ctx as any)?.defendingPlayerId ?? ctx.selectorContext?.targetOpponentId ?? 'p2').trim();
    const glimmerCreatures = (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
      if (String(perm?.controller || '').trim() !== defendingId) return false;
      if (!params.objectHasType(perm, 'creature')) return false;
      return getExecutorTypeLineLower(perm).includes('glimmer');
    });
    return glimmerCreatures.length === 0;
  }

  if (normalizedRaw === 'the discarded card was an artifact card') {
    const discarded = params.discardedCardsFrom(params);
    const card = discarded[discarded.length - 1];
    if (!card) return null;
    return params.objectHasType(card, 'artifact');
  }

  if (normalizedRaw === 'one or more players being attacked are poisoned') {
    const map = (nextState as any)?.poisonedPlayersBeingAttacked;
    if (Array.isArray(map)) return map.length > 0;
    if (typeof map === 'boolean') return map;
    return null;
  }

  if (normalizedRaw === 'defending player controls more lands than you') {
    const defendingId = String((ctx as any)?.defendingPlayerId ?? ctx.selectorContext?.targetOpponentId ?? 'p2').trim();
    const countLands = (playerId: string) =>
      (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
        if (String(perm?.controller || '').trim() !== playerId) return false;
        return params.objectHasType(perm, 'land');
      }).length;
    return countLands(defendingId) > countLands(String(controllerId || '').trim());
  }

  if (normalizedRaw === 'you have three or fewer cards in hand') {
    return params.getPlayerHandCount(nextState, controllerId) <= 3;
  }

  if (normalizedRaw === 'an assassin crewed it this turn') {
    const flag = (ctx as any)?.assassinCrewedItThisTurn ?? (ctx as any)?.crewedByAssassinThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'that creature has infect') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return params.objectHasKeyword(ref, 'infect');
  }

  if (normalizedRaw === "you've cast a noncreature spell this turn") {
    const map = (nextState as any)?.noncreatureSpellsCastThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0 : null;
    }
    return null;
  }

  if (
    normalizedRaw ===
    "you haven't cast a spell from your hand this turn and this creature doesn't have a flying counter on it"
  ) {
    const map = (nextState as any)?.spellsCastFromHandThisTurn;
    const castFromHand =
      map && typeof map === 'object'
        ? (map as Record<string, unknown>)[String(controllerId || '').trim()]
        : undefined;
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const flyingCounter = source ? getCounterCount(source, 'flying') : 0;
    if (castFromHand === true) return false;
    if (castFromHand === false && flyingCounter === 0) return true;
    if (typeof castFromHand === 'number' && castFromHand === 0 && flyingCounter === 0) return true;
    return null;
  }

  if (normalizedRaw === 'you sacrificed one or more permanents this turn') {
    const map = (nextState as any)?.permanentsSacrificedThisTurnByController;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0 : null;
    }
    return null;
  }

  if (normalizedRaw === "that player didn't cast a spell this turn") {
    const targetId = String(
      ctx.selectorContext?.targetPlayerId ?? ctx.selectorContext?.targetOpponentId ?? ''
    ).trim();
    if (!targetId) return null;
    const map = (nextState as any)?.spellsCastThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[targetId];
      if (typeof v === 'number') return v === 0;
      if (typeof v === 'boolean') return !v;
    }
    return null;
  }

  if (normalizedRaw === 'one or more cards were put into exile this turn') {
    const map = (nextState as any)?.cardsPutIntoExileThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0 : null;
    }
    return null;
  }

  if (normalizedRaw === 'the spell is countered this way') {
    return params.lastActionOutcome?.kind === 'applied' ? true : params.lastActionOutcome ? false : null;
  }

  if (normalizedRaw === "it's attacking" || normalizedRaw === 'it is attacking') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return params.isPermanentAttackingFn(ref) || Boolean((ref as any)?.attacking);
  }

  if (normalizedRaw === 'two cards that share a card type were milled this way') {
    const milled = Array.isArray((ctx as any)?.lastMilledCards) ? (ctx as any).lastMilledCards : params.movedCardsFrom(params);
    if (!Array.isArray(milled) || milled.length < 2) return false;
    for (let i = 0; i < milled.length; i += 1) {
      for (let j = i + 1; j < milled.length; j += 1) {
        if (sharesCardType(milled[i], milled[j])) return true;
      }
    }
    return false;
  }

  if (normalizedRaw === 'another human entered the battlefield under your control this turn') {
    const map = (nextState as any)?.humansEnteredBattlefieldUnderControlThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0 : null;
    }
    return null;
  }

  if (normalizedRaw === 'it was blocked this turn') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    if ((ref as any)?.wasBlockedThisTurn === true || (ref as any)?.blockedThisTurn === true) return true;
    if ((ref as any)?.wasBlockedThisTurn === false || (ref as any)?.blockedThisTurn === false) return false;
    return null;
  }

  return null;
}
