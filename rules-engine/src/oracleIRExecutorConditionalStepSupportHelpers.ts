/**
 * Origin: oracleIRExecutorConditionalStepSupport.ts
 * Cluster: shared types and helpers for evaluateConditionalWrapperCondition clause families
 * Public: ConditionalCondition, LastActionOutcome, resolveUnlessPayInnerCondition, parseSmallNumberWord, and other clause helpers
 */
import type { GameState, PlayerID } from '../../shared/src';
import { isCreatureTypeWord, normalizeCreatureTypeWord } from '../../shared/src/creatureTypes';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { checkRolledDoubles } from './dieRoll';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield, getSourceBattlefieldPermanent } from './oracleIRExecutorCreatureStepUtils';
import { getCounterCountOnObject, findObjectByIdInState, getCreatureSubtypeKeys } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { resolveReferencedObject } from './oracleIRExecutorReferenceUtils';
import { collectContextualCardsLedgerFirst } from './oracleIRLedgerCardAccess';
import {
  topCardSharesCreatureTypeWithControlledCreature,
  topCardSharesCreatureTypeWithSource,
} from './oracleIRExecutorConditionalStepShareTypeHelpers';

const EXILE_THIS_WAY_STEP_KINDS = new Set<OracleEffectStep['kind']>([
  'exile',
  'exile_top',
  'impulse_exile_top',
  'move_zone',
]);

function movedCardsFromCtx(ctx: OracleIRExecutionContext, lastMovedCards?: readonly any[]): any[] {
  return collectContextualCardsLedgerFirst(ctx, { lastMovedCards }) as any[];
}

function hasRecentExileOutcome(outcome: LastActionOutcome, movedCards: readonly any[]): boolean {
  return Boolean(outcome?.stepKind && EXILE_THIS_WAY_STEP_KINDS.has(outcome.stepKind)) || movedCards.length > 0;
}

type ConditionalCondition =
  | Extract<OracleEffectStep, { kind: 'conditional' }>['condition']
  | { readonly kind: 'unless'; readonly raw: string };

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

function readCreaturePowerForUnless(permanent: any): number {
  for (const candidate of [
    permanent?.effectivePower,
    permanent?.power,
    permanent?.basePower,
    permanent?.card?.power,
  ]) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function resolveUnlessPayScalerMultiplier(
  scalerPhrase: string,
  nextState: GameState,
  controllerId: PlayerID,
  ctx: OracleIRExecutionContext,
): number | null {
  const phrase = String(scalerPhrase || '').trim().toLowerCase();
  if (phrase === 'card in your hand' || phrase === 'cards in your hand') {
    return getYourHandCount(nextState, controllerId);
  }
  if (phrase === '+1/+1 counter on it' || phrase === '+1/+1 counters on it') {
    const source = getSourceBattlefieldPermanent(nextState, ctx);
    if (!source) return 0;
    return getCounterCountOnObject(source, '+1/+1') ?? 0;
  }
  if (phrase === 'other creature you control' || phrase === 'other creatures you control') {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = getProcessedBattlefield(nextState);
    return battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId || (sourceId && permanentId === sourceId)) return false;
      return String(perm?.controller || '').trim() === String(controllerId || '').trim()
        && getExecutorTypeLineLower(perm).includes('creature');
    }).length;
  }
  return null;
}

function playerHandHasMatchingDescriptor(
  nextState: GameState,
  playerId: string,
  descriptorRaw: string,
): boolean {
  const player = (nextState.players || []).find(
    (entry: any) => String(entry?.id || '').trim() === String(playerId || '').trim(),
  ) as any;
  const hand = Array.isArray(player?.hand) ? player.hand : [];
  const descriptor = String(descriptorRaw || '').trim().toLowerCase();
  if (descriptor === 'nonland card' || descriptor === 'a nonland card') {
    return hand.some((card: any) => !matchesCardTypeDescriptor(card, 'land'));
  }
  {
    const typedCard = descriptor.match(/^(?:an? )?([a-z]+) card$/);
    const typedNoun = typedCard ? normalizeCreatureTypeWord(String(typedCard[1] || '')) : null;
    if (typedNoun) {
      return hand.some((card: any) => matchesCardTypeDescriptor(card, typedNoun));
    }
  }
  if (descriptor === 'artifact card' || descriptor === 'an artifact card') {
    return hand.some((card: any) => matchesCardTypeDescriptor(card, 'artifact'));
  }
  if (
    descriptor === 'instant or sorcery card or a creature card with flying'
    || descriptor === 'an instant or sorcery card or a creature card with flying'
  ) {
    return hand.some((card: any) =>
      matchesCardTypeDescriptor(card, 'instant')
      || matchesCardTypeDescriptor(card, 'sorcery')
      || (matchesCardTypeDescriptor(card, 'creature') && matchesCardTypeDescriptor(card, 'flying')),
    );
  }
  return hand.some((card: any) => matchesCardTypeDescriptor(card, descriptor.replace(/^(?:a|an)\s+/, '')));
}

function resolveUnlessPayInnerCondition(
  inner: string,
  ctx: OracleIRExecutionContext,
  nextState?: GameState,
  controllerId?: PlayerID,
): boolean | null | undefined {
  const scaledPayMatch = inner.match(/^you pay (\{[^}]+\}(?:\{[^}]+\})*) for each (.+)$/i);
  if (scaledPayMatch && nextState && controllerId) {
    const multiplier = resolveUnlessPayScalerMultiplier(
      String(scaledPayMatch[2] || '').trim(),
      nextState,
      controllerId,
      ctx,
    );
    if (multiplier === null) return undefined;
    const choice =
      ctx.unlessPaysManaChoice ??
      ctx.selectorContext?.unlessPaysManaChoice;
    if (choice === 'pay') return true;
    if (choice === 'decline') return false;
    return null;
  }

  const manaPayMatch = inner.match(/^you pay (\{[^}]+\}(?:\{[^}]+\})*)$/);
  if (manaPayMatch) {
    const choice =
      ctx.unlessPaysManaChoice ??
      ctx.selectorContext?.unlessPaysManaChoice;
    if (choice === 'pay') return true;
    if (choice === 'decline') return false;
    return null;
  }

  const lifePayMatch = inner.match(/^you pay (\d+) life$/);
  if (lifePayMatch) {
    const choice =
      ctx.unlessPaysLifeChoice ??
      ctx.selectorContext?.unlessPaysLifeChoice;
    if (choice === 'pay') return true;
    if (choice === 'decline') return false;
    return null;
  }

  if (/^(?:her|his|its|this spell's) additional cost was paid$/.test(inner)) {
    const paid =
      ctx.waterbendWasPaid ??
      ctx.optionalAdditionalCostWasPaid ??
      ctx.teamworkWasPaid ??
      ctx.selectorContext?.waterbendWasPaid ??
      ctx.selectorContext?.optionalAdditionalCostWasPaid;
    if (paid === true) return true;
    if (paid === false) return false;
    return false;
  }

  if (/^you waterbend \{2\}$/i.test(inner)) {
    const paid =
      ctx.waterbendWasPaid ??
      ctx.selectorContext?.waterbendWasPaid ??
      ctx.optionalAdditionalCostWasPaid;
    if (paid === true) return true;
    if (paid === false) return false;
    return null;
  }

  if (/^you exile a historic card from your graveyard$/i.test(inner)) {
    const unlessPaid =
      (ctx as any)?.unlessExiledHistoricFromGraveyard ??
      (ctx.selectorContext as any)?.unlessExiledHistoricFromGraveyard;
    if (unlessPaid === true) return true;
    if (unlessPaid === false) return false;
    if (nextState && controllerId) {
      const player = (nextState.players || []).find(
        (p: any) => String(p?.id || '').trim() === String(controllerId || '').trim(),
      ) as any;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      return graveyard.some((card: any) => {
        const tl = String(card?.type_line || '').toLowerCase();
        return tl.includes('artifact') || tl.includes('legendary') || tl.includes('saga');
      });
    }
    return null;
  }

  if (/^you return a land you control to its owner's hand$/i.test(inner)) {
    const unlessPaid =
      (ctx as any)?.unlessReturnedLandToHand ??
      (ctx.selectorContext as any)?.unlessReturnedLandToHand;
    if (unlessPaid === true) return true;
    if (unlessPaid === false) return false;
    if (nextState && controllerId) {
      return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
        if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
        return String(perm?.type_line || '').toLowerCase().includes('land');
      });
    }
    return null;
  }

  if (/^that land had a nonbasic land type$/i.test(inner)) {
    const moved = Array.isArray((ctx as any)?.lastMovedCards) ? (ctx as any).lastMovedCards : [];
    const land = moved[moved.length - 1];
    if (land) {
      const tl = String((land as any)?.type_line || '').toLowerCase();
      if (tl.includes('land')) return !/\bbasic\b/.test(tl);
    }
    const flag = (ctx as any)?.lastMovedLandWasNonbasic;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (/^that player has this permanent deal 4 damage to them$/i.test(inner)) {
    const choice =
      (ctx as any)?.unlessDealDamageChoice ??
      (ctx.selectorContext as any)?.unlessDealDamageChoice ??
      (ctx as any)?.unlessPaysDamageChoice;
    if (choice === 'pay' || choice === 'deal') return true;
    if (choice === 'decline') return false;
    return null;
  }

  if (/^they put a card from their hand on top of their library$/i.test(inner)) {
    const choice =
      (ctx as any)?.unlessPutCardOnTopOfLibraryChoice ??
      (ctx.selectorContext as any)?.unlessPutCardOnTopOfLibraryChoice;
    if (choice === 'put_on_top') return true;
    if (choice === 'decline') return false;
    if (nextState) {
      const targetId = String(
        ctx.selectorContext?.targetPlayerId ??
          ctx.selectorContext?.targetOpponentId ??
          'p2',
      ).trim();
      const player = (nextState.players || []).find(
        (p: any) => String(p?.id || '').trim() === targetId,
      ) as any;
      const hand = Array.isArray(player?.hand) ? player.hand : [];
      return hand.length > 0 ? false : null;
    }
    return null;
  }

  if (/^you pay \{e\}\{e\}(?: \(two energy counters\))?$/i.test(inner)) {
    const choice =
      (ctx as any)?.unlessPaysEnergyChoice ??
      (ctx.selectorContext as any)?.unlessPaysEnergyChoice;
    if (choice === 'pay') return true;
    if (choice === 'decline') return false;
    return null;
  }

  const opponentLifePayMatch = inner.match(
    /^(?:target opponent|that player|that opponent|an opponent|its controller) pays? (\d+) life$/
  );
  if (opponentLifePayMatch) {
    const choice =
      ctx.unlessPaysLifeChoice ??
      ctx.selectorContext?.unlessPaysLifeChoice;
    if (choice === 'pay') return true;
    if (choice === 'decline') return false;
    return null;
  }

  return undefined;
}

function normalizeContextualReferenceText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
}

function isContextualGraveyardMoveReference(step: OracleEffectStep): boolean {
  if (step.kind !== 'move_zone') return false;
  const text = normalizeContextualReferenceText((step.what as any)?.text || (step.what as any)?.raw || '');
  return /^(?:that card|that creature|that permanent)(?: from (?:(?:the |your |their |target player's |target opponent's |an opponent's |its owner's |its controller's |that player's |one of your opponents' )?graveyard))?$/.test(
    text
  );
}

function getYourGraveyardCards(nextState: GameState, controllerId: PlayerID): any[] {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === String(controllerId || '').trim()) as any;
  return Array.isArray(player?.graveyard) ? player.graveyard : [];
}

function getYourHandCount(nextState: GameState, controllerId: PlayerID): number {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === String(controllerId || '').trim()) as any;
  return Array.isArray(player?.hand) ? player.hand.length : 0;
}

function opponentHasMoreCardsInHandThanYou(nextState: GameState, controllerId: PlayerID): boolean {
  const yourHandCount = getYourHandCount(nextState, controllerId);
  const opponentIds = (nextState.players || [])
    .map((player: any) => String(player?.id || '').trim())
    .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
  return opponentIds.some((opponentId: string) => {
    const opponent = (nextState.players || []).find((player: any) => String(player?.id || '').trim() === opponentId) as any;
    const theirHandCount = Array.isArray(opponent?.hand) ? opponent.hand.length : 0;
    return theirHandCount > yourHandCount;
  });
}

function youHaveMoreCardsInHandThanEachOpponent(nextState: GameState, controllerId: PlayerID): boolean {
  const yourHandCount = getYourHandCount(nextState, controllerId);
  const opponentIds = (nextState.players || [])
    .map((player: any) => String(player?.id || '').trim())
    .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
  if (opponentIds.length === 0) return true;
  return opponentIds.every((opponentId: string) => {
    const opponent = (nextState.players || []).find((player: any) => String(player?.id || '').trim() === opponentId) as any;
    const theirHandCount = Array.isArray(opponent?.hand) ? opponent.hand.length : 0;
    return yourHandCount > theirHandCount;
  });
}

function getControllerExperienceCounters(nextState: GameState, controllerId: PlayerID): number {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === String(controllerId || '').trim()) as any;
  const fromPlayer = Number(player?.experienceCounters ?? player?.experience);
  if (Number.isFinite(fromPlayer)) return fromPlayer;
  const fromState = Number((nextState as any)?.experienceCounters?.[controllerId]);
  return Number.isFinite(fromState) ? fromState : 0;
}

function resolveReferencedCardManaValue(nextState: GameState, ctx: OracleIRExecutionContext): number | null {
  const candidateIds = [
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.targetPermanentId || '').trim(),
    getSingleChosenObjectId(ctx),
  ].filter(Boolean);

  const battlefield = getProcessedBattlefield(nextState);
  for (const id of candidateIds) {
    const onBattlefield = findObjectByIdInState(nextState, battlefield as any, id);
    if (onBattlefield) {
      const manaValue = getCardManaValue((onBattlefield as any)?.card || onBattlefield);
      if (manaValue !== null) return manaValue;
    }
    for (const player of nextState.players || []) {
      for (const zone of ['graveyard', 'hand', 'exile', 'library'] as const) {
        const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
        const card = cards.find((entry: any) => String(entry?.id || '').trim() === id);
        if (card) {
          const manaValue = getCardManaValue(card);
          if (manaValue !== null) return manaValue;
        }
      }
    }
  }

  return resolveTargetSpellManaValue(nextState, ctx);
}

function resolveConditionalCounterObject(
  nextState: GameState,
  ctx: OracleIRExecutionContext,
  selfReferenceRaw: string
): any | null {
  const normalizedSelf = String(selfReferenceRaw || '').trim().toLowerCase();
  if (
    normalizedSelf === 'this aura' ||
    normalizedSelf === 'this enchantment' ||
    normalizedSelf === 'this artifact' ||
    normalizedSelf === 'this creature' ||
    normalizedSelf === 'this permanent' ||
    normalizedSelf === 'this card'
  ) {
    const battlefield = getProcessedBattlefield(nextState);
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, battlefield as any, idRaw)
    );
    if (sourceRef) return sourceRef;
  }
  return getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
}

function playerRolledDoubles(nextState: GameState, controllerId: PlayerID): boolean | null {
  const playerRoll = (nextState as any)?.lastDieRollByPlayer?.[controllerId];
  const rollRecord =
    playerRoll && typeof playerRoll === 'object'
      ? playerRoll
      : String((nextState as any)?.lastDieRoll?.playerId || '').trim() === String(controllerId || '').trim()
        ? (nextState as any)?.lastDieRoll
        : null;
  if (!rollRecord || !Array.isArray(rollRecord.results) || rollRecord.results.length < 2) return null;
  const [first, second] = rollRecord.results;
  if (!Number.isFinite(Number(first)) || !Number.isFinite(Number(second))) return null;
  return checkRolledDoubles({ result: Number(first) } as any, { result: Number(second) } as any);
}

function countCreaturesAttackedThisTurn(nextState: GameState, controllerId: PlayerID): number {
  const declared = (nextState as any)?.attackersDeclaredThisCombatByPlayer?.[controllerId];
  if (Array.isArray(declared) && declared.length > 0) return declared.length;
  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.filter(
    (perm: any) =>
      String(perm?.controller || '').trim() === String(controllerId || '').trim() &&
      perm?.attackedThisTurn === true
  ).length;
}

function getHandCountAtBeginningOfTurn(nextState: GameState, controllerId: PlayerID): number | null {
  const map = (nextState as any)?.handAtBeginningOfTurn;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const entry = (map as Record<string, unknown>)[controllerId];
    if (typeof entry === 'number' && Number.isFinite(entry)) return Math.max(0, entry);
    if (Array.isArray(entry)) return entry.length;
  }
  return null;
}

function countCreaturesThatDiedThisTurn(nextState: GameState): number {
  const byController = (nextState as any)?.creaturesDiedThisTurnByController;
  if (byController && typeof byController === 'object' && !Array.isArray(byController)) {
    return Object.values(byController as Record<string, unknown>).reduce<number>((sum, value) => {
      const count = Number(value);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);
  }
  return Boolean((nextState as any)?.creatureDiedThisTurn) ? 1 : 0;
}

function controllerControlsCreatureWithPowerAtLeast(
  nextState: GameState,
  controllerId: PlayerID,
  threshold: number
): boolean {
  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.some(
    (perm: any) =>
      String(perm?.controller || '').trim() === String(controllerId || '').trim() &&
      battlefieldObjectHasType(perm, 'creature') &&
      getBattlefieldCreaturePower(perm) >= threshold
  );
}

function getLastDieRollTotal(nextState: GameState, controllerId: PlayerID): number | null {
  const playerRoll = (nextState as any)?.lastDieRollByPlayer?.[controllerId];
  if (playerRoll && typeof playerRoll === 'object' && Number.isFinite(Number(playerRoll.result))) {
    return Number(playerRoll.result);
  }
  const globalLast = (nextState as any)?.lastDieRoll;
  if (
    globalLast &&
    String(globalLast?.playerId || '').trim() === String(controllerId || '').trim() &&
    Number.isFinite(Number(globalLast?.result))
  ) {
    return Number(globalLast.result);
  }
  return null;
}

function cardWasToken(card: any): boolean {
  return Boolean(card?.isToken ?? card?.token ?? card?.card?.isToken ?? card?.card?.token);
}

function getSourceCounterCount(nextState: GameState, ctx: OracleIRExecutionContext, counterName: string): number | null {
  const battlefield = getProcessedBattlefield(nextState);
  const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, battlefield as any, idRaw)
  );
  if (!sourceRef) return null;
  const counters = ((sourceRef as any)?.counters || {}) as Record<string, unknown>;
  const count = Number(counters[counterName] ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function countYourGraveyardCards(params: {
  nextState: GameState;
  controllerId: PlayerID;
  typeName?: string;
  pendingSteps?: readonly OracleEffectStep[];
  ctx?: OracleIRExecutionContext;
  lastMovedCards?: readonly any[];
}): number {
  const { nextState, controllerId, typeName, pendingSteps, ctx, lastMovedCards } = params;
  const graveyard = getYourGraveyardCards(nextState, controllerId);
  const normalizedTypeName = String(typeName || '').trim().toLowerCase();
  const baseCount = normalizedTypeName
    ? graveyard.filter((card: any) => cardHasType(card, normalizedTypeName)).length
    : graveyard.length;

  const movedForAdjustment = ctx
    ? movedCardsFromCtx(ctx, lastMovedCards)
    : (Array.isArray(lastMovedCards) ? lastMovedCards : []);
  if (movedForAdjustment.length === 0) return baseCount;
  if (!Array.isArray(pendingSteps) || !pendingSteps.some(isContextualGraveyardMoveReference)) return baseCount;

  const graveyardIds = new Set(
    graveyard
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean)
  );

  const adjustment = movedForAdjustment.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || graveyardIds.has(cardId)) return false;
    return normalizedTypeName ? cardHasType(card, normalizedTypeName) : true;
  }).length;

  return baseCount + adjustment;
}

function parseSmallNumberWord(raw: string): number | null {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return parseInt(text, 10);

  const lookup: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
  };
  return Number.isFinite(lookup[text]) ? lookup[text] : null;
}

function matchesTypeLine(value: unknown, typeName: string): boolean {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return new RegExp(`\\b${typeName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function battlefieldObjectHasType(object: any, typeName: string): boolean {
  const normalizedTypeName = String(typeName || '').trim().toLowerCase();
  if (!normalizedTypeName) return false;

  if (hasExecutorClass(object, normalizedTypeName)) {
    return true;
  }

  return matchesTypeLine(getExecutorTypeLineLower(object), normalizedTypeName);
}

function battlefieldObjectMatchesDescriptor(object: any, descriptorRaw: string): boolean {
  const descriptor = String(descriptorRaw || '')
    .trim()
    .toLowerCase()
    .replace(/^an?\s+/i, '')
    .replace(/\s+cards?$/i, '')
    .trim();
  if (!descriptor) return true;

  const parts = descriptor.split(/\s+/g).filter(Boolean);
  return parts.every(part => battlefieldObjectHasType(object, part));
}

function countControlledBattlefieldObjectsMatching(params: {
  battlefield: readonly any[];
  controllerId: PlayerID;
  typeNames: readonly string[];
  tappedOnly?: boolean;
}): number {
  const { battlefield, controllerId, typeNames, tappedOnly } = params;
  return battlefield.filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    if (tappedOnly && perm?.tapped !== true) return false;
    return typeNames.some((typeName) => battlefieldObjectHasType(perm, typeName));
  }).length;
}

function cardHasType(card: any, typeName: string): boolean {
  if (typeName === 'permanent') {
    return (
      matchesTypeLine(card?.type_line, 'artifact') ||
      matchesTypeLine(card?.type_line, 'battle') ||
      matchesTypeLine(card?.type_line, 'creature') ||
      matchesTypeLine(card?.type_line, 'enchantment') ||
      matchesTypeLine(card?.type_line, 'land') ||
      matchesTypeLine(card?.type_line, 'planeswalker') ||
      matchesTypeLine(card?.cardType, 'artifact') ||
      matchesTypeLine(card?.cardType, 'battle') ||
      matchesTypeLine(card?.cardType, 'creature') ||
      matchesTypeLine(card?.cardType, 'enchantment') ||
      matchesTypeLine(card?.cardType, 'land') ||
      matchesTypeLine(card?.cardType, 'planeswalker')
    );
  }
  return matchesTypeLine(card?.type_line, typeName) || matchesTypeLine(card?.cardType, typeName);
}

function matchesCardTypeDescriptor(card: any, descriptorRaw: string): boolean {
  const descriptor = String(descriptorRaw || '')
    .trim()
    .toLowerCase()
    .replace(/^an?\s+/i, '')
    .replace(/\s+cards?$/i, '')
    .trim();
  // "If a card is put into exile this way" carries no type restriction. The strip above only removes
  // a trailing " card" that follows another word, so the bare descriptor arrives here intact.
  if (!descriptor || descriptor === 'card' || descriptor === 'cards') return true;

  const orParts = descriptor.split(/\s+or\s+/i).map(part => part.trim()).filter(Boolean);
  if (orParts.length > 1) {
    return orParts.some(part => matchesCardTypeDescriptor(card, part));
  }

  const commaParts = descriptor.split(/\s*,\s*/).map(part => part.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    return commaParts.every(part => matchesCardTypeDescriptor(card, part));
  }

  if (descriptor.startsWith('non') && descriptor.length > 3) {
    return !cardHasType(card, descriptor.slice(3).trim());
  }

  return cardHasType(card, descriptor);
}

function getSingleChosenObjectId(ctx: OracleIRExecutionContext): string {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const normalized = chosen.map(id => String(id || '').trim()).filter(Boolean);
  return normalized.length === 1 ? normalized[0] : '';
}

function splitCompositeCondition(raw: string, delimiter: 'and' | 'or'): string[] | null {
  const normalized = String(raw || '').trim();
  if (!normalized) return null;
  if (
    delimiter === 'or' &&
    (/\bor\s+(?:more|less|greater|fewer|equal(?:\s+to)?)\b/i.test(normalized) ||
      /^you gained or lost life this turn$/i.test(normalized) ||
      /^they entered or were cast from a graveyard$/i.test(normalized) ||
      /^this creature didn't attack or come under your control this turn$/i.test(normalized) ||
      /^this creature did not attack or come under your control this turn$/i.test(normalized) ||
      /^you control a white or blue permanent$/i.test(normalized) ||
      /^you control a green or white permanent$/i.test(normalized) ||
      (() => {
        const typeOr = normalized.match(/^it's an? ([a-z]+) or ([a-z]+)$/i);
        return Boolean(
          typeOr
          && isCreatureTypeWord(String(typeOr[1] || ''))
          && isCreatureTypeWord(String(typeOr[2] || '')),
        );
      })() ||
      /^you or a player you're attacking has the initiative$/i.test(normalized) ||
      /^that creature was green or white$/i.test(normalized) ||
      /^that creature was blue or black$/i.test(normalized) ||
      /^you control a red or green permanent$/i.test(normalized) ||
      (() => {
        const pair = normalized.match(/^you control three or more ([a-z]+)s? and\/or ([a-z]+)s?$/i);
        return Boolean(
          pair
          && normalizeCreatureTypeWord(String(pair[1] || ''))
          && normalizeCreatureTypeWord(String(pair[2] || '')),
        );
      })() ||
      /^that creature is black or red$/i.test(normalized) ||
      /^you control a god, a demigod, or a legendary enchantment$/i.test(normalized) ||
      /^you've played a land or cast a spell this turn from anywhere other than your hand$/i.test(normalized) ||
      /^you have played a land or cast a spell this turn from anywhere other than your hand$/i.test(normalized) ||
      /^you control the artifact with the greatest mana value or tied for the greatest mana value$/i.test(normalized) ||
      /^an artifact or creature was put into a graveyard from the battlefield this turn$/i.test(normalized))
  ) {
    return null;
  }
  if (
    delimiter === 'and' &&
    /^at least one other wall creature is blocking that creature and no non-wall creatures are blocking that creature$/i.test(
      normalized
    )
  ) {
    return null;
  }
  const pattern = delimiter === 'and' ? /\s+and\s+/i : /\s+or\s+/i;
  const parts = normalized.split(pattern).map(part => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

function getReferencedConditionalObject(
  nextState: GameState,
  _battlefield: readonly any[],
  ctx: OracleIRExecutionContext
): any | null {
  return resolveReferencedObject(nextState, ctx);
}

const CAST_ZONE_NAMES = new Set(['hand', 'graveyard', 'exile', 'library', 'battlefield', 'stack', 'command']);
const GRAVEYARD_CAST_ABILITIES = new Set([
  'flashback',
  'jump-start',
  'retrace',
  'escape',
  'disturb',
  'harmonize',
  'graveyard-cast',
  'aftermath',
]);

function normalizeCastZoneName(value: unknown): string | undefined {
  const zone = String(value || '').trim().toLowerCase();
  return CAST_ZONE_NAMES.has(zone) ? zone : undefined;
}

function objectWasCastFromGraveyard(object: any): boolean {
  if (object?.castFromGraveyard === true || object?.card?.castFromGraveyard === true) return true;
  const ability = String(object?.castWithAbility || object?.card?.castWithAbility || '').trim().toLowerCase();
  return GRAVEYARD_CAST_ABILITIES.has(ability);
}

function getConditionalObjectZoneProvenance(object: any): { castFromZone?: string; enteredFromZone?: string } {
  const castFromZone =
    normalizeCastZoneName(object?.castFromZone) ||
    normalizeCastZoneName(object?.castSourceZone) ||
    normalizeCastZoneName(object?.card?.castFromZone) ||
    normalizeCastZoneName(object?.card?.castSourceZone) ||
    normalizeCastZoneName(object?.source) ||
    normalizeCastZoneName(object?.card?.source) ||
    (objectWasCastFromGraveyard(object) ? 'graveyard' : undefined);
  const enteredFromZone =
    String(
      object?.enteredFromZone ||
        (object?.enteredFromGraveyard ? 'graveyard' : '') ||
        object?.card?.enteredFromZone ||
        (object?.card?.enteredFromGraveyard ? 'graveyard' : '') ||
        '',
    )
      .trim()
      .toLowerCase() || undefined;
  return { castFromZone, enteredFromZone };
}

function objectEnteredFromOrWasCastFromGraveyard(object: any): boolean {
  const provenance = getConditionalObjectZoneProvenance(object);
  return provenance.enteredFromZone === 'graveyard' || provenance.castFromZone === 'graveyard';
}

function getBattlefieldCreaturePower(perm: any): number {
  if (typeof perm?.effectivePower === 'number' && Number.isFinite(perm.effectivePower)) {
    return perm.effectivePower;
  }
  const basePower = perm?.power ?? perm?.card?.power ?? perm?.basePower;
  let power = Number.parseInt(String(basePower ?? '0'), 10);
  if (!Number.isFinite(power)) power = 0;
  const counters = ((perm as any)?.counters || {}) as Record<string, unknown>;
  power += Number(counters['+1/+1'] ?? 0);
  power -= Number(counters['-1/-1'] ?? 0);
  return power;
}

function controllerAttackedThisTurn(nextState: GameState, playerId: PlayerID): boolean {
  const normalizedPlayerId = String(playerId || '').trim();
  const attackersByPlayer = (nextState as any)?.attackersDeclaredThisCombatByPlayer;
  if (attackersByPlayer && typeof attackersByPlayer === 'object') {
    const attackers = (attackersByPlayer as Record<string, unknown>)[normalizedPlayerId];
    if (Array.isArray(attackers) && attackers.length > 0) return true;
  }

  const attackedPlayersThisTurn = (nextState as any)?.attackedPlayersThisTurnByPlayer;
  if (attackedPlayersThisTurn && typeof attackedPlayersThisTurn === 'object') {
    const attackedList = (attackedPlayersThisTurn as Record<string, unknown>)[normalizedPlayerId];
    if (Array.isArray(attackedList) && attackedList.length > 0) return true;
  }

  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.some(
    (perm: any) =>
      String(perm?.controller || '').trim() === normalizedPlayerId &&
      (perm?.attackedThisTurn === true || Boolean(perm?.attacking) || perm?.isAttacking === true)
  );
}

function controllerAttackedWithPowerAtLeast(
  nextState: GameState,
  playerId: PlayerID,
  threshold: number
): boolean {
  const normalizedPlayerId = String(playerId || '').trim();
  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.some((perm: any) => {
    if (String(perm?.controller || '').trim() !== normalizedPlayerId) return false;
    if (
      perm?.attackedThisTurn !== true &&
      !perm?.attacking &&
      perm?.isAttacking !== true
    ) {
      return false;
    }
    return !battlefieldObjectHasType(perm, 'creature')
      ? false
      : getBattlefieldCreaturePower(perm) >= threshold;
  });
}

function controllerControlsGreatestPowerCreature(nextState: GameState, playerId: PlayerID): boolean {
  const normalizedPlayerId = String(playerId || '').trim();
  const battlefield = getProcessedBattlefield(nextState) as any[];
  const creatures = battlefield.filter((perm: any) => battlefieldObjectHasType(perm, 'creature'));
  if (creatures.length === 0) return false;

  const maxPower = Math.max(...creatures.map((perm: any) => getBattlefieldCreaturePower(perm)));
  return creatures.some(
    (perm: any) =>
      String(perm?.controller || '').trim() === normalizedPlayerId &&
      getBattlefieldCreaturePower(perm) === maxPower
  );
}

function countControlledCreaturesWithSubtype(
  nextState: GameState,
  controllerId: PlayerID,
  subtype: string
): number {
  const normalizedSubtype = String(subtype || '').trim().toLowerCase();
  if (!normalizedSubtype) return 0;
  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    if (!battlefieldObjectHasType(perm, 'creature')) return false;
    const subtypes = getCreatureSubtypeKeys(perm, getExecutorTypeLineLower);
    return subtypes.some((entry: string) => entry.toLowerCase() === normalizedSubtype);
  }).length;
}

function controllerHasFullParty(nextState: GameState, controllerId: PlayerID): boolean {
  const roles = ['cleric', 'rogue', 'warrior', 'wizard'];
  return roles.every(role => countControlledCreaturesWithSubtype(nextState, controllerId, role) > 0);
}

function getPlayerPoisonCounters(nextState: GameState, playerId: string): number {
  const normalizedPlayerId = String(playerId || '').trim();
  const map = (nextState as any)?.poisonCounters;
  if (map && typeof map === 'object' && Number.isFinite(Number((map as Record<string, unknown>)[normalizedPlayerId]))) {
    return Number((map as Record<string, unknown>)[normalizedPlayerId]);
  }
  const player = (nextState.players || []).find(
    (entry: any) => String(entry?.id || '').trim() === normalizedPlayerId
  ) as any;
  const direct = Number(player?.poisonCounters);
  return Number.isFinite(direct) ? direct : 0;
}

function resolveKickedStatus(nextState: GameState, ctx: OracleIRExecutionContext, sourceRef: any): boolean | null {
  const candidates = [
    sourceRef,
    ((nextState as any)?.stack || []).find(
      (entry: any) => String(entry?.id || '').trim() === String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim()
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const explicit = (candidate as any)?.wasKicked ?? (candidate as any)?.card?.wasKicked;
    if (typeof explicit === 'boolean') return explicit;
    const count =
      (candidate as any)?.kickerPaidCount ??
      (candidate as any)?.timesKicked ??
      (candidate as any)?.kickedTimes ??
      (candidate as any)?.card?.kickerPaidCount ??
      (candidate as any)?.card?.timesKicked ??
      (candidate as any)?.card?.kickedTimes;
    if (typeof count === 'number') return count > 0;
  }

  return null;
}

function resolveKickedTwiceStatus(
  nextState: GameState,
  ctx: OracleIRExecutionContext,
  sourceRef: any
): boolean | null {
  const candidates = [
    sourceRef,
    ((nextState as any)?.stack || []).find(
      (entry: any) =>
        String(entry?.id || '').trim() ===
        String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim()
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const rawCount =
      (candidate as any)?.kickerPaidCount ??
      (candidate as any)?.timesKicked ??
      (candidate as any)?.kickedTimes ??
      (candidate as any)?.card?.kickerPaidCount ??
      (candidate as any)?.card?.timesKicked ??
      (candidate as any)?.card?.kickedTimes;
    if (typeof rawCount === 'number') return rawCount >= 2 ? true : null;

    const rawBool =
      (candidate as any)?.wasKickedTwice ??
      (candidate as any)?.kickedTwice ??
      (candidate as any)?.card?.wasKickedTwice ??
      (candidate as any)?.card?.kickedTwice;
    if (typeof rawBool === 'boolean') return rawBool;

    const rawWasKicked = (candidate as any)?.wasKicked ?? (candidate as any)?.card?.wasKicked;
    if (rawWasKicked === false) return false;
  }

  return null;
}

function resolveTargetSpellManaValue(nextState: GameState, ctx: OracleIRExecutionContext): number | null {
  if (typeof ctx.referenceSpellManaValue === 'number' && Number.isFinite(ctx.referenceSpellManaValue)) {
    return ctx.referenceSpellManaValue;
  }

  const selectorSpellManaValue = Number((ctx.selectorContext as any)?.spellManaValue);
  if (Number.isFinite(selectorSpellManaValue)) {
    return selectorSpellManaValue;
  }

  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (!targetSpellId) return null;

  const stackSpell = ((nextState as any)?.stack || []).find(
    (entry: any) => String(entry?.id || '').trim() === targetSpellId
  );
  if (!stackSpell) return null;
  return getCardManaValue(stackSpell.card || stackSpell);
}

export type { ConditionalCondition, LastActionOutcome };
export type EvaluateConditionalWrapperConditionParams = {
  condition: ConditionalCondition;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastStepOutcome?: LastActionOutcome;
  lastConditionalEvaluation?: boolean | null;
  pendingSteps?: readonly OracleEffectStep[];
  lastMovedCards?: readonly any[];
  lastDiscardedCards?: readonly any[];
  lastCreatedTokenIds?: readonly string[];
  lastExcessDamageDealtThisWay?: number;
  step?: OracleEffectStep;
  evaluateRecursive?: (params: EvaluateConditionalWrapperConditionParams) => boolean | null;
};
export {
  battlefieldObjectHasType,
  battlefieldObjectMatchesDescriptor,
  cardHasType,
  cardWasToken,
  controllerAttackedThisTurn,
  controllerAttackedWithPowerAtLeast,
  controllerControlsCreatureWithPowerAtLeast,
  controllerControlsGreatestPowerCreature,
  controllerHasFullParty,
  countControlledBattlefieldObjectsMatching,
  countCreaturesAttackedThisTurn,
  countCreaturesThatDiedThisTurn,
  countYourGraveyardCards,
  getBattlefieldCreaturePower,
  getConditionalObjectZoneProvenance,
  getControllerExperienceCounters,
  getHandCountAtBeginningOfTurn,
  getLastDieRollTotal,
  getPlayerPoisonCounters,
  getReferencedConditionalObject,
  getSingleChosenObjectId,
  getSourceCounterCount,
  getYourGraveyardCards,
  getYourHandCount,
  hasRecentExileOutcome,
  matchesCardTypeDescriptor,
  matchesTypeLine,
  movedCardsFromCtx,
  objectEnteredFromOrWasCastFromGraveyard,
  opponentHasMoreCardsInHandThanYou,
  parseSmallNumberWord,
  playerHandHasMatchingDescriptor,
  playerRolledDoubles,
  readCreaturePowerForUnless,
  resolveConditionalCounterObject,
  resolveKickedStatus,
  resolveKickedTwiceStatus,
  resolveReferencedCardManaValue,
  resolveTargetSpellManaValue,
  resolveUnlessPayInnerCondition,
  splitCompositeCondition,
  topCardSharesCreatureTypeWithSource,
  topCardSharesCreatureTypeWithControlledCreature,
  youHaveMoreCardsInHandThanEachOpponent,
};
