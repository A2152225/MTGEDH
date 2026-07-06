import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getAmountOfManaSpent, getAmountOfSpecificManaSymbolSpent } from './oracleIRExecutorManaUtils';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { resolveReferencedObject } from './oracleIRExecutorReferenceUtils';
import { getProcessedBattlefield, getSourceBattlefieldPermanent } from './oracleIRExecutorCreatureStepUtils';
import { getCounterCountOnObject, findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { checkRolledDoubles } from './dieRoll';
import { deriveWinningVoteChoice, getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { cardMatchesType, parseSimpleCardTypeFromText } from './oracleIRExecutorZoneOps';
import { splitCardMatchesName } from './splitCards';
import { evaluateExtendedConditionalClause } from './oracleIRExecutorConditionalStepSupportExtended';
import { collectContextualCardsLedgerFirst, collectRevealedThisWayCardsLedgerFirst, isSearchedLibraryThisWayLedgerFirst, resolveAntecedentDiscardedCards, resolveAntecedentMilledCards } from './oracleIRLedgerCardAccess';

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

type ConditionalCondition = Extract<OracleEffectStep, { kind: 'conditional' }>['condition'];

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
  if (descriptor === 'pirate card' || descriptor === 'a pirate card') {
    return hand.some((card: any) => matchesCardTypeDescriptor(card, 'pirate'));
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
      ctx.selectorContext?.unlessExiledHistoricFromGraveyard;
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
      ctx.selectorContext?.unlessReturnedLandToHand;
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
      ctx.selectorContext?.unlessDealDamageChoice ??
      (ctx as any)?.unlessPaysDamageChoice;
    if (choice === 'pay' || choice === 'deal') return true;
    if (choice === 'decline') return false;
    return null;
  }

  if (/^they put a card from their hand on top of their library$/i.test(inner)) {
    const choice =
      (ctx as any)?.unlessPutCardOnTopOfLibraryChoice ??
      ctx.selectorContext?.unlessPutCardOnTopOfLibraryChoice;
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
      ctx.selectorContext?.unlessPaysEnergyChoice;
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
    return Object.values(byController as Record<string, unknown>).reduce((sum: number, value) => {
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
  if (!descriptor) return true;

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
      /^it's a goblin or orc$/i.test(normalized) ||
      /^you or a player you're attacking has the initiative$/i.test(normalized) ||
      /^that creature was green or white$/i.test(normalized) ||
      /^that creature was blue or black$/i.test(normalized) ||
      /^you control a red or green permanent$/i.test(normalized) ||
      /^you control three or more wolves and\/or werewolves$/i.test(normalized) ||
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

function getConditionalObjectZoneProvenance(object: any): { castFromZone?: string; enteredFromZone?: string } {
  const castFromZone =
    String(
      object?.castFromZone ||
        object?.castSourceZone ||
        object?.card?.castFromZone ||
        object?.card?.castSourceZone ||
        object?.source ||
        object?.card?.source ||
        '',
    )
      .trim()
      .toLowerCase() || undefined;
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

function getTopLibraryCard(nextState: GameState, ownerId: string): any | null {
  const normalizedOwnerId = String(ownerId || '').trim();
  if (!normalizedOwnerId) return null;
  const player = (nextState.players || []).find((entry: any) => String(entry?.id || '').trim() === normalizedOwnerId) as any;
  return Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
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

  const selectorSpellManaValue = Number(ctx.selectorContext?.spellManaValue);
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

function topCardSharesCreatureTypeWithSource(nextState: GameState, ownerId: string, sourceRef: any): boolean {
  const topCard = getTopLibraryCard(nextState, ownerId);
  if (!topCard || !sourceRef) return false;

  const topCardSubtypes = new Set(getCreatureSubtypeKeys(topCard, getExecutorTypeLineLower));
  const sourceSubtypes = new Set(getCreatureSubtypeKeys(sourceRef, getExecutorTypeLineLower));
  if (topCardSubtypes.size === 0 || sourceSubtypes.size === 0) return false;

  for (const subtype of topCardSubtypes) {
    if (sourceSubtypes.has(subtype)) return true;
  }
  return false;
}

export function evaluateOracleStepUnlessCondition(
  unlessCondition: ConditionalCondition,
  state: GameState,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID = ctx.controllerId,
): boolean | null {
  return evaluateConditionalWrapperCondition({
    condition: unlessCondition,
    nextState: state,
    controllerId,
    ctx,
    lastActionOutcome: undefined,
    lastStepOutcome: undefined,
    lastConditionalEvaluation: undefined,
    pendingSteps: [],
    lastMovedCards: [],
    lastDiscardedCards: [],
    lastCreatedTokenIds: [],
    lastExcessDamageDealtThisWay: undefined,
  });
}

export function evaluateConditionalWrapperCondition(params: {
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
}): boolean | null {
  const {
    condition,
    nextState,
    controllerId,
    ctx,
    lastActionOutcome,
    lastStepOutcome = null,
    lastConditionalEvaluation,
    pendingSteps,
    lastMovedCards,
    lastDiscardedCards,
    lastCreatedTokenIds,
    lastExcessDamageDealtThisWay,
  } = params;

  const getAffirmativeAntecedentOutcome = (): LastActionOutcome =>
    lastActionOutcome ?? lastStepOutcome;

  if (condition.kind === 'unless') {
    const inner = String(condition.raw || '')
      .replace(/\u2019/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const unlessResolved = resolveUnlessPayInnerCondition(inner, ctx, nextState, controllerId);
    if (unlessResolved !== undefined) return unlessResolved;
    {
      const extended = evaluateExtendedConditionalClause({
        normalizedRaw: inner,
        raw: condition.raw,
        nextState,
        controllerId,
        ctx,
        lastActionOutcome,
        lastMovedCards,
        lastDiscardedCards,
        lastExcessDamageDealtThisWay,
        step: params.step,
      });
      if (extended !== null) return extended;
    }
    return null;
  }

  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

  const raw = String(condition.raw || '').trim().toLowerCase();
  let normalizedRaw = raw.replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
  if (normalizedRaw.startsWith('then ')) {
    normalizedRaw = normalizedRaw.replace(/^then\s+(?:if\s+)?/i, '').trim();
  }
  if (normalizedRaw.startsWith('if ')) {
    normalizedRaw = normalizedRaw.replace(/^if\s+/i, '').trim();
  }

  {
    const unlessResolved = resolveUnlessPayInnerCondition(normalizedRaw, ctx, nextState, controllerId);
    if (unlessResolved !== undefined) return unlessResolved;
  }

  if (normalizedRaw.startsWith('you do, ')) {
    return evaluateConditionalWrapperCondition({
      ...params,
      condition: { ...condition, raw: 'you do' },
    });
  }

  if (normalizedRaw === 'otherwise') {
    return typeof lastConditionalEvaluation === 'boolean' ? !lastConditionalEvaluation : null;
  }

  {
    const movedCardTypeMatch = normalizedRaw.match(/^it was (?:a|an)\s+(.+?)(?:\s+card)?$/i);
    if (movedCardTypeMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      const descriptor = String(movedCardTypeMatch[1] || '').trim().toLowerCase();
      const movedFromOutcome =
        lastActionOutcome?.stepKind === 'discard'
          ? (Array.isArray(lastDiscardedCards) ? lastDiscardedCards : [])
          : Array.isArray(lastMovedCards)
            ? lastMovedCards
            : [];
      const movedCards = collectContextualCardsLedgerFirst(ctx, {
        lastMovedCards: movedFromOutcome,
        lastDiscardedCards,
      });
      if (movedCards.length > 0) {
        return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
      }
      if (
        lastActionOutcome?.stepKind !== 'move_zone' &&
        lastActionOutcome?.stepKind !== 'discard' &&
        lastActionOutcome?.stepKind !== 'look_top' &&
        lastActionOutcome?.stepKind !== 'look_choose_from_top' &&
        lastActionOutcome?.stepKind !== 'search_library'
      ) {
        if (!lastActionOutcome && descriptor === 'creature') return true;
        return null;
      }
      return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  if (normalizedRaw === 'a creature enters this way') {
    const moveStep = params.step;
    if (!moveStep || moveStep.kind !== 'move_zone' || moveStep.to !== 'battlefield') return null;
    const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const player = nextState.players.find((entry) => entry.id === controllerId) as any;
    if (!player) return null;
    for (const zone of ['graveyard', 'hand', 'exile'] as const) {
      const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
      const selected =
        chosenIds.length > 0
          ? cards.filter((card: any) => chosenIds.includes(String(card?.id || '').trim()))
          : cards;
      if (selected.length > 0) {
        return selected.some((card: any) => matchesCardTypeDescriptor(card, 'creature'));
      }
    }
    return null;
  }

  {
    const movedCardTypeNegatedMatch = normalizedRaw.match(/^it was not (?:a|an)\s+(.+?)(?:\s+card)?$/i);
    if (movedCardTypeNegatedMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'move_zone' && lastActionOutcome?.stepKind !== 'discard') return null;

      const descriptor = String(movedCardTypeNegatedMatch[1] || '').trim().toLowerCase();
      const movedCards = lastActionOutcome?.stepKind === 'discard'
        ? resolveAntecedentDiscardedCards(ctx, { lastDiscardedCards }) as any[]
        : collectContextualCardsLedgerFirst(ctx, { lastMovedCards }) as any[];
      return movedCards.length > 0 && movedCards.every((card: any) => !matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const discardedThisWayMatch = normalizedRaw.match(/^a[n]?\s+(.+?)\s+card\s+was\s+discarded\s+this\s+way$/i);
    if (discardedThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      const descriptor = String(discardedThisWayMatch[1] || '').trim().toLowerCase();
      const discardedCards = resolveAntecedentDiscardedCards(ctx, { lastDiscardedCards }) as any[];
      if (discardedCards.length > 0) {
        return discardedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
      }
      if (lastActionOutcome?.stepKind !== 'discard') return false;
      return false;
    }
  }

  {
    const youDiscardThisWayMatch = normalizedRaw.match(/^you discard (?:a|an) (.+?) card this way$/i);
    if (youDiscardThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'discard') return null;

      const descriptor = String(youDiscardThisWayMatch[1] || '').trim().toLowerCase();
      const discardedCards = resolveAntecedentDiscardedCards(ctx, { lastDiscardedCards }) as any[];
      return discardedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const putIntoExileThisWayMatch = normalizedRaw.match(/^(?:a|an)\s+(.+?)\s+is put into exile this way$/i);
    if (putIntoExileThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
      const hasRecentExile = hasRecentExileOutcome(lastActionOutcome, movedCards);
      if (!hasRecentExile) return null;

      const descriptor = String(putIntoExileThisWayMatch[1] || '').trim().toLowerCase();
      return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const exiledThisWayMatch = normalizedRaw.match(/^(.*?)\s+card\s+(?:was exiled|is exiled|is put into exile)\s+this way$/i);
    if (exiledThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
      const hasRecentExile = hasRecentExileOutcome(lastActionOutcome, movedCards);
      if (!hasRecentExile) return null;

      const rawDescriptor = String(exiledThisWayMatch[1] || '').trim().toLowerCase();
      const descriptor = rawDescriptor.replace(/^an?\s+/i, '').trim();
      if (!descriptor || rawDescriptor === 'a' || rawDescriptor === 'an') return movedCards.length > 0;
      return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const milledThisWayMatch = normalizedRaw.match(/^(?:a|an)\s+(.+?)\s+card\s+was\s+milled\s+this\s+way$/i);
    if (milledThisWayMatch) {
      const descriptor = String(milledThisWayMatch[1] || '').trim().toLowerCase();
      const milledCards = resolveAntecedentMilledCards(ctx) as any[];
      return milledCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const unlessNotMatch = normalizedRaw.match(/^not \((.+)\)$/i);
    if (unlessNotMatch) {
      const inner = String(unlessNotMatch[1] || '').trim().toLowerCase();
      const unlessPayResolved = resolveUnlessPayInnerCondition(inner, ctx, nextState, controllerId);
      if (unlessPayResolved !== undefined) {
        if (unlessPayResolved === null) return null;
        return !unlessPayResolved;
      }

      const manaSpentUnlessMatch = inner.match(/^\{([wubrgcs])\} was spent to cast it$/);
      const satisfied = manaSpentUnlessMatch
        ? (() => {
            const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
              findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
            );
            const spent = getAmountOfSpecificManaSymbolSpent(sourceRef, manaSpentUnlessMatch[1]);
            return spent === null ? null : spent > 0;
          })()
        : /^you discard (?:a|an) /.test(inner) ||
            /^you exile (?:a|an) card from your graveyard/.test(inner) ||
            /^you exile the top creature card of your graveyard/.test(inner) ||
            /^you return (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) /.test(inner) ||
            /^you return another creature you control to its owner's hand/.test(inner) ||
            /^you sacrifice (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) /.test(inner) ||
            /^you remove a \+1\/\+1 counter from it$/.test(inner) ||
            /^you gained life this turn$/.test(inner) ||
            /^an opponent was dealt damage this turn$/.test(inner) ||
            /^you discard two cards$/.test(inner)
          ? true
          : null;
      if (satisfied === null) {
        const extendedNegated = evaluateExtendedConditionalClause({
          normalizedRaw,
          raw,
          nextState,
          controllerId,
          ctx,
          lastActionOutcome,
          lastMovedCards,
          lastDiscardedCards,
          lastExcessDamageDealtThisWay,
          step: params.step,
        });
        if (extendedNegated !== null) return extendedNegated;
        return null;
      }
      return !satisfied;
    }
  }

  if (/^(?:her|his|its|this spell's) additional cost was paid$/.test(normalizedRaw)) {
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

  if (
    normalizedRaw ===
    'a permanent entered the battlefield face down under your control this turn or you turned a permanent face up this turn'
  ) {
    return Boolean(
      ctx.faceDownPermanentEnteredThisTurnUnderYourControl ||
        ctx.turnedPermanentFaceUpThisTurn ||
        ctx.selectorContext?.faceDownPermanentEnteredThisTurnUnderYourControl ||
        ctx.selectorContext?.turnedPermanentFaceUpThisTurn
    );
  }

  if (normalizedRaw === "that player can't" || normalizedRaw === "that player can't sacrifice") {
    const targetPlayerId =
      String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.activePlayerId || '').trim() ||
      controllerId;
    const battlefield = getProcessedBattlefield(nextState);
    const hasLegalSacrifice = battlefield.some((perm: any) => {
      if (String(perm?.controller || '').trim() !== targetPlayerId) return false;
      const typeLine = getExecutorTypeLineLower(perm);
      if (typeLine.includes('land')) return false;
      if (Boolean((perm as any)?.isToken) || /\btoken\b/i.test(typeLine)) return false;
      return true;
    });
    return !hasLegalSacrifice;
  }

  {
    const isPermanentCardClause =
      normalizedRaw === "it's a permanent card" || normalizedRaw === 'it is a permanent card';
    if (isPermanentCardClause) {
      const revealed = collectRevealedThisWayCardsLedgerFirst(ctx, params.step);
      const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
      const revealedCtx = Array.isArray((ctx as any)?.lastRevealedCards) ? (ctx as any).lastRevealedCards : [];
      const subject =
        (revealed.length > 0 ? revealed[revealed.length - 1] : null) ??
        (revealedCtx.length > 0 ? revealedCtx[revealedCtx.length - 1] : null) ??
        (movedCards.length > 0 ? movedCards[movedCards.length - 1] : null);
      if (!subject) {
        const ownerId = String(
          ctx.lastTopLibraryOwnerId || ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || controllerId || '',
        ).trim();
        const player = (nextState.players || []).find(
          (entry: any) => String(entry?.id || '').trim() === ownerId,
        ) as any;
        const library = Array.isArray(player?.library) ? player.library : [];
        const topCard = library.length > 0 ? library[0] : null;
        return topCard ? matchesCardTypeDescriptor(topCard, 'permanent') : false;
      }
      return matchesCardTypeDescriptor(subject, 'permanent');
    }
  }

  {
    const extended = evaluateExtendedConditionalClause({
      normalizedRaw,
      raw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      lastDiscardedCards,
      lastExcessDamageDealtThisWay,
      step: params.step,
    });
    if (extended !== null) return extended;
  }

  if (normalizedRaw === 'a graveyard has twenty or more cards in it') {
    const graveyardCount = ((nextState as any).players || []).reduce((sum: number, player: any) => {
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      return sum + graveyard.length;
    }, 0);
    return graveyardCount >= 20;
  }

  if (normalizedRaw === 'this creature entered this turn') {
    const source = getSourceBattlefieldPermanent(nextState, ctx);
    if (!source) return false;
    return Boolean((source as any)?.enteredThisTurn);
  }

  if (normalizedRaw === 'this permanent entered this turn') {
    const source = getSourceBattlefieldPermanent(nextState, ctx);
    if (!source) return false;
    return Boolean((source as any)?.enteredThisTurn);
  }

  if (normalizedRaw === 'it entered from your library or was cast from your library') {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.stepKind === 'draw' && antecedent.kind === 'applied') return true;
    const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
    if (movedCards.length > 0) return true;
    return false;
  }

  if (normalizedRaw === 'you control another creature with power 2 or less') {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = getProcessedBattlefield(nextState);
    return battlefield.some((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId || (sourceId && permanentId === sourceId)) return false;
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      if (!getExecutorTypeLineLower(perm).includes('creature')) return false;
      return readCreaturePowerForUnless(perm) <= 2;
    });
  }

  {
    const discardUnlessMatch = normalizedRaw.match(
      /^(?:they|you) discard (?:a|an) (.+)$/
    );
    if (discardUnlessMatch) {
      const descriptor = String(discardUnlessMatch[1] || '').trim().toLowerCase();
      if (normalizedRaw.startsWith('they discard')) {
        const opponentIds = ((nextState as any).players || [])
          .map((player: any) => String(player?.id || '').trim())
          .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
        return opponentIds.some((opponentId) =>
          playerHandHasMatchingDescriptor(nextState, opponentId, descriptor),
        );
      }
      return playerHandHasMatchingDescriptor(nextState, String(controllerId || '').trim(), descriptor);
    }
  }

  if (normalizedRaw === 'an opponent controls more lands than you') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const countLands = (playerId: string): number =>
      battlefield.filter(
        (perm: any) =>
          String(perm?.controller || '').trim() === playerId && battlefieldObjectHasType(perm, 'land')
      ).length;
    const youLands = countLands(String(controllerId || '').trim());
    const opponentIds = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
    return opponentIds.some((opponentId: string) => countLands(opponentId) > youLands);
  }

  {
    const thatPlayerMoreMatch = normalizedRaw.match(/^that player controls more (creatures|lands) than you$/i);
    if (thatPlayerMoreMatch) {
      const subject = String(thatPlayerMoreMatch[1] || '').trim().toLowerCase();
      const thatPlayerId = String(
        ctx.selectorContext?.targetOpponentId ||
          ctx.selectorContext?.targetPlayerId ||
          ctx.targetPlayerId ||
          ctx.targetOpponentId ||
          ''
      ).trim();
      if (!thatPlayerId) return null;
      const battlefield = getProcessedBattlefield(nextState) as any[];
      const typeName = subject === 'creatures' ? 'creature' : 'land';
      const countMatching = (playerId: string): number =>
        battlefield.filter(
          (perm: any) =>
            String(perm?.controller || '').trim() === playerId && battlefieldObjectHasType(perm, typeName)
        ).length;
      const yourCount = countMatching(String(controllerId || '').trim());
      const theirCount = countMatching(thatPlayerId);
      return theirCount > yourCount;
    }
  }

  if (normalizedRaw === 'that player controls more lands than each other player') {
    const activeIndex = Number.isInteger((nextState as any).activePlayerIndex)
      ? Number((nextState as any).activePlayerIndex)
      : 0;
    const thatPlayerId = String(
      ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.activePlayerId ||
        ctx.targetPlayerId ||
        ctx.selectorContext?.thatPlayerId ||
        (nextState as any)?.turnPlayer ||
        (nextState.players || [])[activeIndex]?.id ||
        ''
    ).trim();
    if (!thatPlayerId) return null;
    const playerIds = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId: string) => playerId);
    if (!playerIds.length) return null;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const countLands = (playerId: string): number =>
      battlefield.filter(
        (perm: any) =>
          String(perm?.controller || '').trim() === playerId && battlefieldObjectHasType(perm, 'land')
      ).length;
    const thatCount = countLands(thatPlayerId);
    return playerIds.every((playerId) => {
      if (playerId === thatPlayerId) return true;
      return thatCount > countLands(playerId);
    });
  }

  if (
    normalizedRaw === 'this is the second time this ability has resolved this turn' ||
    normalizedRaw === "it's the second time"
  ) {
    const count = Number(ctx.abilityResolveCountThisTurn);
    return Number.isFinite(count) ? count >= 2 : false;
  }

  if (normalizedRaw === "it's the third time") {
    const count = Number(ctx.abilityResolveCountThisTurn);
    return Number.isFinite(count) ? count >= 3 : false;
  }

  if (normalizedRaw === 'this is the third time this ability has resolved this turn') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    const count = Number(
      ctx.abilityResolveCountThisTurn ??
        (nextState as any)?.abilityResolveCountThisTurn?.[sourceId] ??
        0
    );
    return Number.isFinite(count) ? count >= 3 : true;
  }

  if (normalizedRaw === 'a permanent left the battlefield under your control this turn' ||
    normalizedRaw === 'a permanent you controlled left the battlefield this turn'
  ) {
    const map = (nextState as any)?.permanentLeftBattlefieldThisTurn;
    return typeof map?.[controllerId] === 'boolean' ? map[controllerId] : null;
  }

  if (normalizedRaw === 'you attacked this turn') {
    return controllerAttackedThisTurn(nextState, controllerId);
  }

  if (
    normalizedRaw === "you didn't attack with a creature this turn" ||
    normalizedRaw === 'you did not attack with a creature this turn'
  ) {
    return !controllerAttackedThisTurn(nextState, controllerId);
  }

  if (normalizedRaw === "it's the first combat phase of your turn" || normalizedRaw === 'it is the first combat phase of your turn') {
    const combatPhases = Number((nextState as any)?.combatPhasesThisTurn?.[controllerId]);
    if (Number.isFinite(combatPhases)) return combatPhases <= 1;
    const phase = String((nextState as any)?.phase || '').trim().toLowerCase();
    return phase === 'combat' || phase === 'combat1' || phase === 'first_combat';
  }

  if (normalizedRaw === 'it attacked during its controller\'s last turn' || normalizedRaw === 'this creature attacked during its controller\'s last turn') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return Boolean(
      (referencedObject as any)?.attackedLastTurn ??
        (referencedObject as any)?.attackedPreviousTurn ??
        (referencedObject as any)?.attackedLastTurn === true
    );
  }

  if (normalizedRaw === 'you had no cards in hand at the beginning of this turn') {
    const count = getHandCountAtBeginningOfTurn(nextState, controllerId);
    return count === null ? null : count === 0;
  }

  if (normalizedRaw === 'you had a card in hand' || normalizedRaw === 'you had at least one card in hand') {
    const count = getHandCountAtBeginningOfTurn(nextState, controllerId);
    return count === null ? null : count > 0;
  }

  {
    const creaturesDiedMatch = normalizedRaw.match(/^(three|[a-z0-9]+) or more creatures died this turn$/i);
    if (creaturesDiedMatch) {
      const threshold = parseSmallNumberWord(String(creaturesDiedMatch[1] || '').trim());
      if (threshold !== null) {
        return countCreaturesThatDiedThisTurn(nextState) >= threshold;
      }
    }
  }

  {
    const attackedWithPowerMatch = normalizedRaw.match(
      /^you attacked this turn with a creature with power (\d+) or greater$/
    );
    if (attackedWithPowerMatch) {
      const threshold = Number.parseInt(String(attackedWithPowerMatch[1] || ''), 10);
      return Number.isFinite(threshold)
        ? controllerAttackedWithPowerAtLeast(nextState, controllerId, threshold)
        : null;
    }
  }

  if (normalizedRaw === 'you control the creature with the greatest power or tied for the greatest power') {
    return controllerControlsGreatestPowerCreature(nextState, controllerId);
  }

  if (
    normalizedRaw === "you didn't put a card into your hand this way" ||
    normalizedRaw === 'you did not put a card into your hand this way'
  ) {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (
      lastActionOutcome?.stepKind === 'look_choose_from_top' ||
      lastActionOutcome?.stepKind === 'move_zone' ||
      lastActionOutcome?.stepKind === 'search_library'
    ) {
      if (lastActionOutcome.kind === 'applied') {
        const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
        return movedCards.length === 0;
      }
      if (lastActionOutcome.kind === 'impossible') return true;
      return lastActionOutcome.kind !== 'applied';
    }
    return null;
  }

  if (
    normalizedRaw === 'this creature would die' ||
    normalizedRaw === 'this permanent would die' ||
    normalizedRaw === 'it would die'
  ) {
    return true;
  }

  if (
    normalizedRaw === "it isn't a creature" ||
    normalizedRaw === 'it is not a creature' ||
    normalizedRaw === "this permanent isn't a creature" ||
    normalizedRaw === 'this permanent is not a creature'
  ) {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return !battlefieldObjectHasType(referencedObject, 'creature');
  }

  if (normalizedRaw === "it's suspected" || normalizedRaw === 'it is suspected' || normalizedRaw === 'this creature is suspected') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return Boolean(
      (referencedObject as any)?.suspected ??
        (referencedObject as any)?.isSuspected ??
        (referencedObject as any)?.card?.suspected ??
        (referencedObject as any)?.card?.isSuspected
    );
  }

  if (normalizedRaw === "it's not suspected" || normalizedRaw === 'it is not suspected' || normalizedRaw === "it isn't suspected") {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    const suspected = Boolean(
      (referencedObject as any)?.suspected ??
        (referencedObject as any)?.isSuspected ??
        (referencedObject as any)?.card?.suspected ??
        (referencedObject as any)?.card?.isSuspected
    );
    return !suspected;
  }

  if (
    normalizedRaw === "this creature didn't enter the battlefield this turn" ||
    normalizedRaw === 'this creature did not enter the battlefield this turn'
  ) {
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState), idRaw)
    );
    if (!sourceRef) return null;
    if ((sourceRef as any)?.enteredThisTurn === true) return false;
    if ((sourceRef as any)?.enteredThisTurn === false) return true;
    return null;
  }

  if (
    normalizedRaw === "it doesn't have an indestructible counter on it" ||
    normalizedRaw === 'it does not have an indestructible counter on it'
  ) {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    const count = Number(((referencedObject as any)?.counters || {}).indestructible ?? 0);
    return (Number.isFinite(count) ? count : 0) === 0;
  }

  if (normalizedRaw === 'it was attacking' || normalizedRaw === 'this creature was attacking') {
    let referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) {
      const moved = movedCardsFromCtx(ctx, lastMovedCards);
      referencedObject = moved.length > 0 ? moved[0] : null;
    }
    if (!referencedObject) return null;
    return (
      (referencedObject as any)?.attackedThisTurn === true ||
      Boolean((referencedObject as any)?.attacking) ||
      (referencedObject as any)?.isAttacking === true
    );
  }

  if (
    normalizedRaw === "this creature didn't attack this turn" ||
    normalizedRaw === 'this creature did not attack this turn'
  ) {
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState), idRaw)
    );
    if (!sourceRef) return null;
    return !(
      (sourceRef as any)?.attackedThisTurn === true ||
      Boolean((sourceRef as any)?.attacking) ||
      (sourceRef as any)?.isAttacking === true
    );
  }

  if (
    normalizedRaw === "this creature didn't attack or come under your control this turn" ||
    normalizedRaw === 'this creature did not attack or come under your control this turn'
  ) {
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState), idRaw)
    );
    if (!sourceRef) return null;
    const attacked =
      (sourceRef as any)?.attackedThisTurn === true ||
      Boolean((sourceRef as any)?.attacking) ||
      (sourceRef as any)?.isAttacking === true ||
      Boolean((sourceRef as any)?.defendingPlayerId);
    const cameUnderControl =
      (sourceRef as any)?.cameUnderYourControlThisTurn === true ||
      (sourceRef as any)?.gainedControlThisTurn === true ||
      (sourceRef as any)?.enteredThisTurn === true;
    if (attacked || cameUnderControl) return false;
    if (
      (sourceRef as any)?.attackedThisTurn === false &&
      (sourceRef as any)?.cameUnderYourControlThisTurn === false &&
      (sourceRef as any)?.gainedControlThisTurn === false &&
      (sourceRef as any)?.enteredThisTurn === false
    ) {
      return true;
    }
    return null;
  }

  {
    const spellMvMatch = normalizedRaw.match(/^that spell(?:'s)? (?:has )?mana value (?:is )?(\d+) or greater$/);
    if (spellMvMatch) {
      const threshold = Number.parseInt(String(spellMvMatch[1] || ''), 10);
      const manaValue = resolveTargetSpellManaValue(nextState, ctx);
      if (!Number.isFinite(threshold) || manaValue === null) return null;
      return manaValue >= threshold;
    }
  }

  {
    const cardMvExperienceMatch = normalizedRaw.match(
      /^that card(?:'s)? mana value is less than or equal to the number of experience counters you have$/i
    );
    if (cardMvExperienceMatch) {
      const manaValue = resolveReferencedCardManaValue(nextState, ctx);
      if (manaValue === null) return null;
      return manaValue <= getControllerExperienceCounters(nextState, controllerId);
    }
  }

  {
    const cardHasMvLteMatch = normalizedRaw.match(/^that card has mana value (\d+) or less$/i);
    if (cardHasMvLteMatch) {
      const threshold = Number.parseInt(String(cardHasMvLteMatch[1] || ''), 10);
      const manaValue = resolveReferencedCardManaValue(nextState, ctx);
      if (!Number.isFinite(threshold) || manaValue === null) return null;
      return manaValue <= threshold;
    }
  }

  {
    const cardMvThresholdMatch = normalizedRaw.match(
      /^that card(?:'s)? mana value is (less than or equal to|greater than or equal to|equal to|less than|greater than) (\d+)$/i
    );
    if (cardMvThresholdMatch) {
      const operator = String(cardMvThresholdMatch[1] || '').trim().toLowerCase();
      const threshold = Number.parseInt(String(cardMvThresholdMatch[2] || ''), 10);
      const manaValue = resolveReferencedCardManaValue(nextState, ctx);
      if (!Number.isFinite(threshold) || manaValue === null) return null;
      if (operator === 'less than or equal to') return manaValue <= threshold;
      if (operator === 'greater than or equal to') return manaValue >= threshold;
      if (operator === 'equal to') return manaValue === threshold;
      if (operator === 'less than') return manaValue < threshold;
      if (operator === 'greater than') return manaValue > threshold;
    }
  }

  {
    const powerThresholdMatch = normalizedRaw.match(
      /^(?:that creature(?:'s)?|that permanent(?:'s)?|its) power is (\d+) or (?:greater|more)$/i
    );
    if (powerThresholdMatch) {
      const threshold = Number.parseInt(String(powerThresholdMatch[1] || ''), 10);
      if (!Number.isFinite(threshold)) return null;
      const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
      if (!referencedObject) return null;
      return getBattlefieldCreaturePower(referencedObject) >= threshold;
    }
  }

  {
    const hasPowerThresholdMatch = normalizedRaw.match(
      /^(?:that creature|that permanent|it) has power (\d+) or (?:greater|more)$/i
    );
    if (hasPowerThresholdMatch) {
      const threshold = Number.parseInt(String(hasPowerThresholdMatch[1] || ''), 10);
      if (!Number.isFinite(threshold)) return null;
      const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
      if (!referencedObject) return null;
      return getBattlefieldCreaturePower(referencedObject) >= threshold;
    }
  }

  {
    const powerAtMostMatch = normalizedRaw.match(
      /^(?:that creature(?:'s)?|its) power is (\d+) or less$/i
    );
    if (powerAtMostMatch) {
      const threshold = Number.parseInt(String(powerAtMostMatch[1] || ''), 10);
      if (!Number.isFinite(threshold)) return null;
      const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
      if (!referencedObject) return null;
      return getBattlefieldCreaturePower(referencedObject) <= threshold;
    }
  }

  if (normalizedRaw === 'that player has more cards in hand than you') {
    const thatPlayerId = String(
      ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || ''
    ).trim();
    if (!thatPlayerId) return null;
    const youPlayer = (nextState.players || []).find(
      (player: any) => String(player?.id || '').trim() === String(controllerId || '').trim()
    ) as any;
    const thatPlayer = (nextState.players || []).find(
      (player: any) => String(player?.id || '').trim() === thatPlayerId
    ) as any;
    const yourHandCount = Array.isArray(youPlayer?.hand) ? youPlayer.hand.length : 0;
    const theirHandCount = Array.isArray(thatPlayer?.hand) ? thatPlayer.hand.length : 0;
    return theirHandCount > yourHandCount;
  }

  if (normalizedRaw === 'that player has no cards in hand') {
    const thatPlayerId = String(
      ctx.selectorContext?.targetOpponentId ||
        ctx.selectorContext?.targetPlayerId ||
        ctx.targetOpponentId ||
        ''
    ).trim();
    if (!thatPlayerId) return null;
    const thatPlayer = (nextState.players || []).find(
      (player: any) => String(player?.id || '').trim() === thatPlayerId
    ) as any;
    return Array.isArray(thatPlayer?.hand) ? thatPlayer.hand.length === 0 : true;
  }

  if (normalizedRaw === 'an opponent has more cards in hand than you') {
    return opponentHasMoreCardsInHandThanYou(nextState, controllerId);
  }

  if (normalizedRaw === 'an opponent discarded a card this turn') {
    const map = (nextState as any)?.discardedCardThisTurn;
    if (!map || typeof map !== 'object') return null;
    const opponentIds = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
    if (opponentIds.length === 0) return false;
    for (const opponentId of opponentIds) {
      if (!Object.prototype.hasOwnProperty.call(map, opponentId)) return null;
      const value = (map as Record<string, unknown>)[opponentId];
      if (typeof value === 'boolean') {
        if (value) return true;
        continue;
      }
      if (typeof value === 'number') {
        if (value > 0) return true;
        continue;
      }
      return null;
    }
    return false;
  }

  if (normalizedRaw === 'you have more cards in hand than each opponent') {
    return youHaveMoreCardsInHandThanEachOpponent(nextState, controllerId);
  }

  if (normalizedRaw === 'you have no cards in hand' || normalizedRaw === 'you have no cards in your hand') {
    return getYourHandCount(nextState, controllerId) === 0;
  }

  {
    const graveyardTypeMatch = normalizedRaw.match(/^there is an? ([a-z0-9' -]+) card in your graveyard$/i);
    if (graveyardTypeMatch) {
      const descriptor = String(graveyardTypeMatch[1] || '').trim().toLowerCase();
      const graveyard = getYourGraveyardCards(nextState, controllerId);
      return graveyard.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  if (normalizedRaw === 'that creature is legendary' || normalizedRaw === 'that permanent is legendary') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return (
      battlefieldObjectHasType(referencedObject, 'legendary') ||
      matchesTypeLine(getExecutorTypeLineLower(referencedObject), 'legendary')
    );
  }

  if (normalizedRaw === "it's legendary" || normalizedRaw === 'it is legendary') {
    const battlefield = getProcessedBattlefield(nextState);
    const referencedId =
      String(ctx.targetPermanentId || '').trim() ||
      getSingleChosenObjectId(ctx) ||
      String(ctx.sourceId || '').trim();
    if (!referencedId) return null;
    const referencedObject = findObjectByIdInState(nextState, battlefield as any, referencedId);
    if (!referencedObject) return false;
    return (
      battlefieldObjectHasType(referencedObject, 'legendary') ||
      matchesTypeLine(getExecutorTypeLineLower(referencedObject), 'legendary') ||
      cardHasType(referencedObject, 'legendary')
    );
  }

  if (normalizedRaw === 'you controlled it') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return true;
    return String((referencedObject as any)?.controller || '').trim() === String(controllerId || '').trim();
  }

  if (normalizedRaw === 'a creature an opponent controls would die') {
    return true;
  }

  if (normalizedRaw === "each opponent who didn't discard a nonland card this way") {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'discard' && lastActionOutcome.kind === 'applied') return true;
    return true;
  }

  if (
    normalizedRaw === 'a card or token would be put into your graveyard from anywhere' ||
    normalizedRaw === 'a card or token would be put into a graveyard from anywhere' ||
    normalizedRaw === 'a spell cast this way would be put into a graveyard'
  ) {
    return true;
  }

  if (normalizedRaw === 'this is the first time this ability has resolved this turn') {
    const count = Number(ctx.abilityResolveCountThisTurn);
    return Number.isFinite(count) ? count >= 1 : true;
  }

  if (normalizedRaw === 'they guessed wrong') {
    const guessCorrect = (ctx as { readonly lastGuessCorrect?: boolean }).lastGuessCorrect;
    return typeof guessCorrect === 'boolean' ? !guessCorrect : false;
  }

  if (normalizedRaw === 'you do and your opponent guessed wrong') {
    const youDo =
      (ctx as any)?.youDoChoice ??
      ctx.selectorContext?.youDoChoice ??
      (ctx as any)?.youDo;
    if (youDo !== true) return false;
    const guessCorrect = (ctx as { readonly lastGuessCorrect?: boolean }).lastGuessCorrect;
    return typeof guessCorrect === 'boolean' ? !guessCorrect : false;
  }

  if (normalizedRaw === 'you control that creature' || normalizedRaw === 'you control that permanent') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return String((referencedObject as any)?.controller || '').trim() === String(controllerId || '').trim();
  }

  if (
    normalizedRaw === 'that creature would die this turn' ||
    normalizedRaw === 'that permanent would die this turn'
  ) {
    return true;
  }

  if (normalizedRaw === 'that spell is countered this way') {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'counter_spell' && lastActionOutcome.kind === 'applied') return true;
    if (lastActionOutcome?.stepKind === 'counter_spell') return false;
    return null;
  }

  if (
    normalizedRaw === "a permanent's ability is countered this way" ||
    normalizedRaw === 'an ability is countered this way'
  ) {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'counter_spell' && lastActionOutcome.kind === 'applied') return true;
    if (lastActionOutcome?.stepKind === 'counter_spell') return false;
    return null;
  }

  if (normalizedRaw === 'an opponent created a token this way') {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'create_token' && lastActionOutcome.kind === 'applied') return true;
    const createdIds = Array.isArray(lastCreatedTokenIds) ? lastCreatedTokenIds : [];
    return createdIds.length > 0 ? true : lastActionOutcome?.stepKind === 'create_token' ? false : null;
  }

  if (normalizedRaw === 'that creature was a token' || normalizedRaw === 'that permanent was a token') {
    const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
    if (movedCards.length > 0) return movedCards.some(cardWasToken);
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (
      lastActionOutcome?.kind === 'applied' &&
      (lastActionOutcome.stepKind === 'exile' ||
        lastActionOutcome.stepKind === 'move_zone' ||
        lastActionOutcome.stepKind === 'destroy')
    ) {
      return false;
    }
    if (lastActionOutcome?.stepKind === 'exile' || lastActionOutcome?.stepKind === 'move_zone') return false;
    return null;
  }

  if (normalizedRaw === "it's not a token" || normalizedRaw === 'it is not a token' || normalizedRaw === "it isn't a token") {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return !cardWasToken(referencedObject);
  }

  if (normalizedRaw === 'those auras would leave the battlefield' || normalizedRaw === 'that aura would leave the battlefield') {
    return true;
  }

  if (normalizedRaw === 'a player would gain life') {
    return true;
  }

  if (normalizedRaw === 'damage is prevented this way') {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'prevent_damage' && lastActionOutcome.kind === 'applied') return true;
    if (lastActionOutcome?.stepKind === 'prevent_damage') return false;
    return null;
  }

  if (
    normalizedRaw === "you didn't put a card onto the battlefield this way" ||
    normalizedRaw === 'you did not put a card onto the battlefield this way'
  ) {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.stepKind === 'move_zone' && lastActionOutcome.kind === 'applied') {
      const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
      return movedCards.length === 0;
    }
    if (lastActionOutcome?.stepKind === 'move_zone') return true;
    return null;
  }

  if (
    normalizedRaw === "this creature's sneak cost was paid" ||
    normalizedRaw === "this permanent's sneak cost was paid" ||
    normalizedRaw === 'its sneak cost was paid' ||
    normalizedRaw === 'his sneak cost was paid'
  ) {
    const battlefield = getProcessedBattlefield(nextState);
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, battlefield as any, idRaw)
    );
    if (!sourceRef) return null;
    return Boolean(
      (sourceRef as any)?.sneakCostPaid ??
        (sourceRef as any)?.paidSneakCost ??
        (sourceRef as any)?.alternateCostKind === 'sneak'
    );
  }

  {
    const hadCountersMatch = normalizedRaw.match(/^it had (three|[a-z0-9]+) or more ([a-z0-9/+ -]+) counters on it$/i);
    if (hadCountersMatch) {
      const threshold = parseSmallNumberWord(String(hadCountersMatch[1] || '').trim());
      const counterName = String(hadCountersMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && counterName) {
        const count = getSourceCounterCount(nextState, ctx, counterName);
        return count === null ? null : count >= threshold;
      }
    }
  }

  {
    const resultAtMostMatch = normalizedRaw.match(/^the result is (three|[a-z0-9]+) or less$/i);
    if (resultAtMostMatch) {
      const threshold = parseSmallNumberWord(String(resultAtMostMatch[1] || '').trim());
      if (threshold !== null) {
        const rolled = getLastDieRollTotal(nextState, controllerId);
        return rolled === null ? null : rolled <= threshold;
      }
    }
  }

  {
    const youControlPowerMatch = normalizedRaw.match(/^you control a creature with power (\d+) or greater$/i);
    if (youControlPowerMatch) {
      const threshold = Number.parseInt(String(youControlPowerMatch[1] || ''), 10);
      return Number.isFinite(threshold) ? controllerControlsCreatureWithPowerAtLeast(nextState, controllerId, threshold) : null;
    }
  }

  if (normalizedRaw === 'you have a full party') {
    return controllerHasFullParty(nextState, controllerId);
  }

  {
    const poisonMatch = normalizedRaw.match(/^an opponent has (three|[a-z0-9]+) or more poison counters$/);
    if (poisonMatch) {
      const threshold = parseSmallNumberWord(String(poisonMatch[1] || '').trim());
      if (threshold === null) return null;
      const opponentIds = (nextState.players || [])
        .map((player: any) => String(player?.id || '').trim())
        .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
      return opponentIds.some((opponentId: string) => getPlayerPoisonCounters(nextState, opponentId) >= threshold);
    }
  }

  if (
    normalizedRaw === 'a nonland permanent left the battlefield this turn or a spell was warped this turn'
  ) {
    const leftMap = (nextState as any)?.permanentLeftBattlefieldThisTurn;
    const leftBattlefield =
      typeof leftMap?.[controllerId] === 'boolean' ? leftMap[controllerId] : false;
    const warpedMap = (nextState as any)?.spellWarpedThisTurn;
    const warped =
      typeof warpedMap?.[controllerId] === 'boolean'
        ? warpedMap[controllerId]
        : Boolean((nextState as any)?.spellWarpedThisTurn);
    return leftBattlefield || warped;
  }

  {
    const genericCounterThresholdMatch = normalizedRaw.match(
      /^it has (three|[a-z0-9]+) or more ([a-z0-9/+ -]+) counters on it$/i
    );
    if (genericCounterThresholdMatch) {
      const threshold = parseSmallNumberWord(String(genericCounterThresholdMatch[1] || '').trim());
      const counterName = String(genericCounterThresholdMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && counterName) {
        const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
        if (!referencedObject) return null;
        const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
        const count = Number(counters[counterName] ?? 0);
        return (Number.isFinite(count) ? count : 0) >= threshold;
      }
    }

    const thatCreatureCounterThresholdMatch = normalizedRaw.match(
      /^that creature has (three|[a-z0-9]+) or more ([a-z0-9/+ -]+) counters on it$/i
    );
    if (thatCreatureCounterThresholdMatch) {
      const threshold = parseSmallNumberWord(String(thatCreatureCounterThresholdMatch[1] || '').trim());
      const counterName = String(thatCreatureCounterThresholdMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && counterName) {
        const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
        if (!referencedObject) return null;
        const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
        const count = Number(counters[counterName] ?? 0);
        return (Number.isFinite(count) ? count : 0) >= threshold;
      }
    }
  }

  const sourceRefForEarlyChecks = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );

  if (normalizedRaw === 'it was kicked' || normalizedRaw === 'this spell was kicked') {
    const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
    return kicked === null ? null : kicked;
  }

  if (normalizedRaw === 'that spell was kicked') {
    const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
    return kicked === null ? null : kicked;
  }

  if (normalizedRaw === 'this creature was kicked') {
    const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
    return kicked === null ? false : kicked;
  }

  if (normalizedRaw === 'it was kicked twice') {
    return resolveKickedTwiceStatus(nextState, ctx, sourceRefForEarlyChecks);
  }

  if (normalizedRaw === 'life was paid to activate it') {
    const explicit =
      (ctx as any)?.lifeWasPaidToActivateIt ??
      (ctx as any)?.lifePaidToActivateIt ??
      ctx.selectorContext?.lifeWasPaidToActivateIt;
    if (typeof explicit === 'boolean') return explicit;
    const stackItem =
      (ctx as any)?.stackItem ??
      ((nextState as any)?.stack || []).find(
        (entry: any) =>
          String(entry?.id || '').trim() ===
          String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim()
      );
    if (!stackItem) return null;
    const abilityTextRaw = String(
      (stackItem as any)?.abilityText ??
        (stackItem as any)?.activatedAbilityText ??
        (stackItem as any)?.description ??
        ''
    ).trim();
    if (!abilityTextRaw) return null;
    const colonIdx = abilityTextRaw.indexOf(':');
    if (colonIdx <= 0) return null;
    const costPart = abilityTextRaw.slice(0, colonIdx).toLowerCase();
    if (/\bor\b/i.test(costPart)) return null;
    if (/\bmay\s+pay\b/i.test(costPart)) return null;
    if (/\bpay\s+([0-9]+|x)\s+life\b/i.test(costPart)) return true;
    return null;
  }

  {
    const specificKickerMatch = normalizedRaw.match(
      /^(?:it|this spell|this creature|this permanent) was kicked with its .+ kicker$/i
    );
    if (specificKickerMatch) {
      const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
      return kicked === null ? null : kicked;
    }
  }

  if (
    normalizedRaw === "it wasn't kicked" ||
    normalizedRaw === 'it was not kicked' ||
    normalizedRaw === "this spell wasn't kicked" ||
    normalizedRaw === 'this spell was not kicked' ||
    normalizedRaw === "this creature wasn't kicked" ||
    normalizedRaw === 'this creature was not kicked'
  ) {
    const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
    return kicked === null ? null : !kicked;
  }

  if (normalizedRaw === 'you rolled doubles') {
    return playerRolledDoubles(nextState, controllerId);
  }

  {
    const manaSpentThisSpellMatch = normalizedRaw.match(/^\{([wubrgcs])\} was spent to cast this spell$/i);
    if (manaSpentThisSpellMatch) {
      const spent = getAmountOfSpecificManaSymbolSpent(sourceRefForEarlyChecks, manaSpentThisSpellMatch[1]);
      return spent === null ? false : spent > 0;
    }
  }

  {
    const attackedCountMatch = normalizedRaw.match(
      /^you attacked with (two|[a-z0-9]+) or more creatures this turn$/i
    );
    if (attackedCountMatch) {
      const threshold = parseSmallNumberWord(String(attackedCountMatch[1] || '').trim());
      if (threshold !== null) {
        return countCreaturesAttackedThisTurn(nextState, controllerId) >= threshold;
      }
    }
  }

  {
    const graveyardCountMatch = normalizedRaw.match(/^([a-z0-9]+) or more cards are in your graveyard$/i);
    if (graveyardCountMatch) {
      const threshold = parseSmallNumberWord(String(graveyardCountMatch[1] || '').trim());
      if (threshold !== null) {
        return getYourGraveyardCards(nextState, controllerId).length >= threshold;
      }
    }
  }

  {
    const andParts = splitCompositeCondition(normalizedRaw, 'and');
    if (andParts) {
      const results = andParts.map(part =>
        evaluateConditionalWrapperCondition({
          ...params,
          condition: { ...condition, raw: part },
        })
      );
      return results.every(result => result === true)
        ? true
        : results.some(result => result === false)
          ? false
          : null;
    }
  }

  const orParts = splitCompositeCondition(normalizedRaw, 'or');
  if (orParts) {
    const results = orParts.map(part =>
      evaluateConditionalWrapperCondition({
        ...params,
        condition: { ...condition, raw: part },
      })
    );
    return results.some(result => result === true)
      ? true
      : results.every(result => result === false)
        ? false
        : null;
  }

  {
    const youDoNotControlMatch = normalizedRaw.match(/^you (?:don't|do not) control (?:a|an|one or more)\s+(.+)$/i);
    if (youDoNotControlMatch) {
      const descriptor = String(youDoNotControlMatch[1] || '').trim();
      const battlefield = getProcessedBattlefield(nextState) as any[];
      return !battlefield.some(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId &&
          battlefieldObjectMatchesDescriptor(perm, descriptor)
      );
    }
  }

  if (
    /^you (?:don't|do not)\b/i.test(normalizedRaw) ||
    /^they (?:don't|do not)\b/i.test(normalizedRaw) ||
    /^the player (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^that player (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^a player (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^each opponent who (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^the player can't\b/i.test(normalizedRaw) ||
    normalizedRaw === "it doesn't" ||
    normalizedRaw === 'it does not'
  ) {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.kind === 'applied') return false;
    if (lastActionOutcome) return true;
    if (normalizedRaw === "you don't" || normalizedRaw === 'you do not') return true;
    return null;
  }

  if (
    normalizedRaw === "you can't" ||
    normalizedRaw === 'you can not' ||
    normalizedRaw.startsWith("you can't,") ||
    normalizedRaw.startsWith('you can not,')
  ) {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.kind === 'applied') return false;
    if (antecedent) return true;
    return null;
  }

  if (normalizedRaw === 'no player does') {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.kind === 'applied') return false;
    if (antecedent?.kind === 'impossible') return true;
    if ((ctx as any)?.optionalOfferAccepted === true) return false;
    if ((ctx as any)?.optionalOfferAccepted === false) return true;
    return null;
  }

  if (
    normalizedRaw === 'you do' ||
    normalizedRaw === 'the player does' ||
    normalizedRaw === 'a player does' ||
    normalizedRaw === 'they do' ||
    normalizedRaw === 'that player does'
  ) {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.kind === 'applied' && antecedent.stepKind === 'tap_matching_permanents') {
      const count = Number(antecedent.count ?? 0);
      return Number.isFinite(count) ? count > 0 : true;
    }
    if (antecedent?.kind === 'applied') return true;
    if (antecedent) return false;
    return false;
  }

  if (
    normalizedRaw === 'you search your library this way' ||
    normalizedRaw === 'they search their library this way' ||
    normalizedRaw === 'that player searches their library this way' ||
    normalizedRaw === 'an opponent searches their library this way' ||
    normalizedRaw === 'you searched your library this way'
  ) {
    if (isSearchedLibraryThisWayLedgerFirst(ctx, params.step)) return true;
    if (ctx.searchedLibraryThisWay === true) return true;
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.stepKind === 'search_library' && antecedent.kind === 'applied') return true;
    if (antecedent?.stepKind === 'search_library' || ctx.searchedLibraryThisWay === false) return false;
    return false;
  }

  if (
    normalizedRaw === 'that spell would be put into a graveyard' ||
    normalizedRaw === 'that spell would be put into a graveyard from anywhere' ||
    normalizedRaw === 'it would be put into a graveyard' ||
    normalizedRaw === 'this spell would be put into a graveyard'
  ) {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (
      antecedent?.kind === 'applied' &&
      (antecedent.stepKind === 'grant_graveyard_permission' ||
        antecedent.stepKind === 'cast_spell' ||
        antecedent.stepKind === 'copy_spell')
    ) {
      return true;
    }
    if (antecedent) return false;
    return null;
  }

  if (
    normalizedRaw === 'this permanent would be put into a graveyard from anywhere' ||
    normalizedRaw === 'this creature would be put into a graveyard from anywhere'
  ) {
    return true;
  }

  if (normalizedRaw === "you can't" || normalizedRaw === 'you cannot') {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.kind === 'applied' || lastActionOutcome?.kind === 'choice_required') return false;
    return null;
  }

  if (normalizedRaw === "they can't" || normalizedRaw === 'they cannot') {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.stepKind === 'discard' && lastActionOutcome?.kind === 'applied') return false;
    if (lastActionOutcome?.stepKind === 'discard' && lastActionOutcome?.kind === 'impossible') return true;
    return null;
  }

  if (normalizedRaw === 'a creature died this turn') {
    return Boolean((nextState as any)?.creatureDiedThisTurn);
  }

  if (normalizedRaw === 'you gained life this turn') {
    return Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0) > 0;
  }

  if (normalizedRaw === 'you gained or lost life this turn') {
    const gained = Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0);
    const lost = Number(((nextState as any)?.lifeLostThisTurn || {})?.[controllerId] || 0);
    return gained > 0 || lost > 0;
  }

  if (
    normalizedRaw === "you've committed a crime this turn" ||
    normalizedRaw === 'you have committed a crime this turn'
  ) {
    const stateAny = nextState as any;
    const crimeMap =
      stateAny?.committedCrimeThisTurn ||
      stateAny?.crimeCommittedThisTurn ||
      stateAny?.hasCommittedCrimeThisTurn;
    if (crimeMap && typeof crimeMap[controllerId] === 'boolean') return crimeMap[controllerId];
    return null;
  }

  if (normalizedRaw === 'evidence was collected') {
    return typeof ctx.lastCollectedEvidence === 'boolean' ? ctx.lastCollectedEvidence : null;
  }

  if (
    normalizedRaw === 'defending player has the most life or is tied for the most life' ||
    normalizedRaw === 'the defending player has the most life or is tied for the most life'
  ) {
    const defendingPlayerId = String(
      ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2'
    ).trim();
    if (!defendingPlayerId) return null;

    const lifeTotals = ((nextState as any)?.players || [])
      .map((player: any) => Number(player?.life))
      .filter((life: number) => Number.isFinite(life));
    if (lifeTotals.length === 0) return null;

    const defendingPlayer = ((nextState as any)?.players || []).find(
      (player: any) => String(player?.id || '').trim() === defendingPlayerId
    );
    const defendingLife = Number((defendingPlayer as any)?.life);
    if (!Number.isFinite(defendingLife)) return null;

    return defendingLife === Math.max(...lifeTotals);
  }

  if (
    normalizedRaw === "this creature isn't renowned" ||
    normalizedRaw === "this permanent isn't renowned" ||
    normalizedRaw === "it isn't renowned" ||
    normalizedRaw === "this creature is not renowned" ||
    normalizedRaw === "this permanent is not renowned" ||
    normalizedRaw === "it is not renowned"
  ) {
    const battlefield = getProcessedBattlefield(nextState);
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    if (!referencedObject) return null;
    const isRenowned =
      typeof (referencedObject as any)?.isRenowned === 'boolean'
        ? Boolean((referencedObject as any).isRenowned)
        : typeof (referencedObject as any)?.renowned === 'boolean'
          ? Boolean((referencedObject as any).renowned)
          : false;
    return !isRenowned;
  }

  {
    const youControlMatch = normalizedRaw.match(/^you control (?:a|an|one or more)\s+(.+)$/i);
    if (youControlMatch) {
      const descriptor = String(youControlMatch[1] || '').trim();
      const battlefield = getProcessedBattlefield(nextState) as any[];
      return battlefield.some(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId &&
          battlefieldObjectMatchesDescriptor(perm, descriptor)
      );
    }
  }

  {
    const returnedToHandMatch = normalizedRaw.match(
      /^returned (?:a|an) ([a-z][a-z'-]*) card to your hand this way$/i
    );
    if (returnedToHandMatch) {
      const subtype = String(returnedToHandMatch[1] || '').trim().toLowerCase();
      const movedCards = [
        ...(Array.isArray(lastMovedCards) ? lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ];
      return movedCards.some((card: any) => {
        const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
        return typeLine.includes(subtype);
      });
    }
  }

  {
    const gainedLifeThresholdMatch = normalizedRaw.match(/^you gained ([a-z0-9]+) or more life this turn$/i);
    if (gainedLifeThresholdMatch) {
      const threshold = parseSmallNumberWord(String(gainedLifeThresholdMatch[1] || ''));
      if (threshold !== null) {
        return Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0) >= threshold;
      }
    }
  }

  if (normalizedRaw === "you're the monarch" || normalizedRaw === 'you are the monarch') {
    return String((nextState as any)?.monarch || '').trim() === String(controllerId || '').trim();
  }

  if (normalizedRaw === 'there is no monarch') {
    return !String((nextState as any)?.monarch || '').trim();
  }

  if (
    normalizedRaw === 'you have the initiative' ||
    normalizedRaw === "you've got the initiative"
  ) {
    return String((nextState as any)?.initiative || '').trim() === String(controllerId || '').trim();
  }

  if (normalizedRaw === "you or a player you're attacking has the initiative") {
    const initiative = String((nextState as any)?.initiative || '').trim();
    if (!initiative) return false;
    if (initiative === String(controllerId || '').trim()) return true;
    const source = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    const defendingPlayerId = String(
      (ctx as any)?.defendingPlayerId ??
        ctx.selectorContext?.targetOpponentId ??
        (source as any)?.defendingPlayerId ??
        (source as any)?.attacking ??
        ''
    ).trim();
    return Boolean(defendingPlayerId && initiative === defendingPlayerId);
  }

  if (
    normalizedRaw === 'you completed a dungeon this turn' ||
    normalizedRaw === "you've completed a dungeon this turn" ||
    normalizedRaw === 'you have completed a dungeon this turn'
  ) {
    return Boolean(((nextState as any)?.dungeonCompletedThisTurn || {})?.[controllerId]);
  }

  if (
    normalizedRaw === 'you completed a dungeon' ||
    normalizedRaw === "you've completed a dungeon" ||
    normalizedRaw === 'you have completed a dungeon'
  ) {
    return Boolean(((nextState as any)?.dungeonCompleted || {})?.[controllerId]);
  }

  if (normalizedRaw === 'the gift was promised') {
    return typeof ctx.giftPromised === 'boolean' ? ctx.giftPromised : null;
  }

  if (normalizedRaw === "it's your turn" || normalizedRaw === 'it is your turn' || normalizedRaw === 'your turn') {
    return String((nextState as any)?.turnPlayer || '').trim() === String(controllerId || '').trim();
  }

  const battlefield = getProcessedBattlefield(nextState);

  {
    const noCountersMatch = normalizedRaw.match(
      /^(?:there are no|it has no|this creature has no|this permanent has no|this aura has no|this enchantment has no)\s+(.+?)\s+counters?\s+on\s+(?:it|this aura|this permanent|this creature|this enchantment)$/i
    );
    if (noCountersMatch) {
      const selfReference = String(
        normalizedRaw.match(/\s+on\s+(this aura|this permanent|this creature|this enchantment|it)$/i)?.[1] || 'it'
      ).trim();
      const referencedObject = resolveConditionalCounterObject(nextState, ctx, selfReference);
      if (!referencedObject) return null;
      const counterName = String(noCountersMatch[1] || '').trim().toLowerCase();
      if (!counterName) return null;
      const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
      const count = Number(counters[counterName] ?? 0);
      return (Number.isFinite(count) ? count : 0) === 0;
    }
  }

  {
    const oddCounterMatch = normalizedRaw.match(/^it has an odd number of counters on it$/i);
    if (oddCounterMatch) {
      const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
      if (!referencedObject) return null;
      const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
      const total = Object.values(counters).reduce((sum: number, value) => {
        const count = Number(value);
        return sum + (Number.isFinite(count) ? count : 0);
      }, 0);
      return total % 2 === 1;
    }
  }

  {
    const thatLandIsTypeMatch = normalizedRaw.match(/^that land is (?:a|an) ([a-z0-9' -]+)$/i);
    if (thatLandIsTypeMatch) {
      const typeName = String(thatLandIsTypeMatch[1] || '').trim().toLowerCase();
      if (!typeName) return null;

      const movedLand = movedCardsFromCtx(ctx, lastMovedCards).find((card: any) => cardHasType(card, 'land')) ?? null;
      if (movedLand) return matchesCardTypeDescriptor(movedLand, typeName);

      const referencedId =
        getSingleChosenObjectId(ctx) ||
        String(ctx.targetPermanentId || '').trim() ||
        String(ctx.sourceId || '').trim();
      if (referencedId) {
        const referencedLand = battlefield.find((perm: any) => String(perm?.id || '').trim() === referencedId);
        if (referencedLand) return battlefieldObjectHasType(referencedLand, typeName);
      }
      return false;
    }
  }

  {
    const contextualCardTypeMatch = normalizedRaw.match(
      /^(?:it(?:'s| is)?|that card|that creature|that permanent|this card|this permanent) (?:is )?(?:a|an) ([a-z0-9' -]+?)(?: card)?$/i
    );
    if (contextualCardTypeMatch) {
      const typeName = String(contextualCardTypeMatch[1] || '').trim().toLowerCase();
      const referencedId =
        String(ctx.targetPermanentId || '').trim() ||
        getSingleChosenObjectId(ctx) ||
        String(ctx.sourceId || '').trim();
      if (typeName && referencedId) {
        const referencedObject = findObjectByIdInState(nextState, battlefield as any, referencedId);
        if (!referencedObject) return false;

        const battlefieldObject = battlefield.find(
          (perm: any) => String(perm?.id || '').trim() === referencedId
        );
        return battlefieldObject
          ? battlefieldObjectHasType(battlefieldObject, typeName)
          : cardHasType(referencedObject, typeName);
      }
    }
  }

  {
    const youControlCountMatch = raw.match(/^you control ([a-z0-9]+) or more ([a-z0-9' -]+?)(?:s)?$/i);
    if (youControlCountMatch) {
      const threshold = parseSmallNumberWord(String(youControlCountMatch[1] || ''));
      const typeName = String(youControlCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && typeName) {
        const count = battlefield.filter((perm: any) =>
          String(perm?.controller || '').trim() === String(controllerId || '').trim() &&
          battlefieldObjectHasType(perm, typeName)
        ).length;
        return count >= threshold;
      }
    }
  }

  {
    const youControlSingleMatch = raw.match(/^you control (?:a|an) ([a-z0-9' -]+)$/i);
    if (youControlSingleMatch) {
      const typeName = String(youControlSingleMatch[1] || '').trim().toLowerCase();
      if (typeName) {
        return countControlledBattlefieldObjectsMatching({
          battlefield,
          controllerId,
          typeNames: [typeName],
        }) >= 1;
      }
    }
  }

  {
    const tappedMixedTypeMatch = raw.match(
      /^you control ([a-z0-9]+) or more tapped ([a-z0-9' -]+?)s? and\/or ([a-z0-9' -]+?)s?$/i
    );
    if (tappedMixedTypeMatch) {
      const threshold = parseSmallNumberWord(String(tappedMixedTypeMatch[1] || ''));
      const firstType = String(tappedMixedTypeMatch[2] || '').trim().toLowerCase();
      const secondType = String(tappedMixedTypeMatch[3] || '').trim().toLowerCase();
      if (threshold !== null && firstType && secondType) {
        return countControlledBattlefieldObjectsMatching({
          battlefield,
          controllerId,
          typeNames: [firstType, secondType],
          tappedOnly: true,
        }) >= threshold;
      }
    }
  }

  {
    const graveyardCountMatch = raw.match(/^([a-z0-9]+) or more ([a-z0-9' -]+?) cards are in your graveyard$/i);
    if (graveyardCountMatch) {
      const threshold = parseSmallNumberWord(String(graveyardCountMatch[1] || ''));
      const typeName = String(graveyardCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && typeName) {
        const count = countYourGraveyardCards({
          nextState,
          controllerId,
          typeName,
          pendingSteps,
          ctx,
          lastMovedCards,
        });
        return count >= threshold;
      }
    }
  }

  {
    const thereAreGraveyardCountMatch = raw.match(/^there are ([a-z0-9]+) or more(?: ([a-z0-9' -]+?))? cards in your graveyard$/i);
    if (thereAreGraveyardCountMatch) {
      const threshold = parseSmallNumberWord(String(thereAreGraveyardCountMatch[1] || ''));
      const typeName = String(thereAreGraveyardCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null) {
        const count = countYourGraveyardCards({
          nextState,
          controllerId,
          typeName,
          pendingSteps,
          ctx,
          lastMovedCards,
        });
        return count >= threshold;
      }
    }
  }

  {
    const youHaveGyCardCountMatch = normalizedRaw.match(/^you have ([a-z0-9]+) or more cards in your graveyard$/i);
    if (youHaveGyCardCountMatch) {
      const threshold = parseSmallNumberWord(String(youHaveGyCardCountMatch[1] || ''));
      if (threshold !== null) {
        return getYourGraveyardCards(nextState, controllerId).length >= threshold;
      }
    }
  }

  {
    const youHaveGraveyardCountMatch = raw.match(/^you have ([a-z0-9]+) or more ([a-z0-9' -]+?) cards in your graveyard$/i);
    if (youHaveGraveyardCountMatch) {
      const threshold = parseSmallNumberWord(String(youHaveGraveyardCountMatch[1] || ''));
      const typeName = String(youHaveGraveyardCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && typeName) {
        const count = countYourGraveyardCards({
          nextState,
          controllerId,
          typeName,
          pendingSteps,
          ctx,
          lastMovedCards,
        });
        return count >= threshold;
      }
    }
  }

  {
    const namedInYourGraveyardMatch = normalizedRaw.match(/^([a-z0-9][a-z0-9,' -]*) is in your graveyard$/i);
    if (namedInYourGraveyardMatch) {
      const expectedName = String(namedInYourGraveyardMatch[1] || '').trim().toLowerCase();
      if (expectedName === 'this card' || expectedName === 'this permanent' || expectedName === 'it') {
        // Let the dedicated self-reference branch below handle these.
      } else {
      const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === String(controllerId || '').trim()) as any;
      if (expectedName && player) {
        return (Array.isArray(player?.graveyard) ? player.graveyard : []).some((card: any) =>
          String(card?.name || '').trim().toLowerCase() === expectedName
        );
      }
      }
    }
  }

  if (normalizedRaw === 'this card is in your graveyard' || normalizedRaw === 'this permanent is in your graveyard' || normalizedRaw === 'it is in your graveyard') {
    const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === String(controllerId || '').trim()) as any;
    const sourceId = String(ctx.sourceId || '').trim();
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    if (!player) return null;
    return (Array.isArray(player?.graveyard) ? player.graveyard : []).some((card: any) =>
      (sourceId && String(card?.id || '').trim() === sourceId) ||
      (sourceName && String(card?.name || '').trim().toLowerCase() === sourceName)
    );
  }

  if (
    normalizedRaw === 'it was cast from your graveyard' ||
    normalizedRaw === 'it was cast from a graveyard' ||
    normalizedRaw === 'you cast it from your graveyard' ||
    normalizedRaw === 'this spell was cast from your graveyard' ||
    normalizedRaw === 'this spell was cast from a graveyard' ||
    normalizedRaw === 'it entered from your graveyard'
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const referencedObject = sourceId
      ? findObjectByIdInState(nextState, battlefield as any, sourceId)
      : getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : {
          castFromZone: String(ctx.castFromZone || ctx.selectorContext?.castFromZone || '')
            .trim()
            .toLowerCase() || undefined,
          enteredFromZone: String(ctx.enteredFromZone || ctx.selectorContext?.enteredFromZone || '')
            .trim()
            .toLowerCase() || undefined,
        };
    if (normalizedRaw === 'it entered from your graveyard') {
      return provenance.enteredFromZone === 'graveyard';
    }
    return provenance.castFromZone === 'graveyard';
  }

  if (normalizedRaw === 'this spell was cast from your hand') {
    return String(ctx.castFromZone || '').trim().toLowerCase() === 'hand';
  }

  if (
    normalizedRaw === 'this spell was cast from anywhere other than your hand' ||
    normalizedRaw === 'this spell was cast from somewhere other than your hand'
  ) {
    const castFromZone = String(ctx.castFromZone || ctx.selectorContext?.castFromZone || '')
      .trim()
      .toLowerCase();
    if (!castFromZone || castFromZone === 'hand') return false;
    return true;
  }

  if (normalizedRaw === 'this spell was cast from exile') {
    const castFromZone = String(ctx.castFromZone || ctx.selectorContext?.castFromZone || '')
      .trim()
      .toLowerCase();
    if (castFromZone === 'exile') return true;
    if (castFromZone) return false;
    if (ctx.castFromExile === true || ctx.selectorContext?.castFromExile === true) return true;
    return null;
  }

  if (normalizedRaw === 'it was cast' || normalizedRaw === 'he was cast' || normalizedRaw === 'she was cast') {
    if (ctx.wasCast === true || ctx.selectorContext?.wasCast === true) return true;
    if (ctx.wasCast === false || ctx.selectorContext?.wasCast === false) return false;
    const castFromZone = String(ctx.castFromZone || ctx.selectorContext?.castFromZone || '').trim().toLowerCase();
    if (castFromZone) return true;
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    if (referencedObject) {
      const provenance = getConditionalObjectZoneProvenance(referencedObject);
      if (provenance.castFromZone) return true;
    }
    return null;
  }

  if (normalizedRaw === "it wasn't cast" || normalizedRaw === 'it was not cast') {
    if (ctx.wasCast === false || ctx.selectorContext?.wasCast === false) return true;
    if (ctx.wasCast === true || ctx.selectorContext?.wasCast === true) return false;
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : {
          castFromZone: String(ctx.castFromZone || ctx.selectorContext?.castFromZone || '')
            .trim()
            .toLowerCase() || undefined,
        };
    if (provenance.castFromZone) return false;
    return referencedObject ? true : null;
  }

  if (
    normalizedRaw === "you didn't cast it from your hand" ||
    normalizedRaw === 'you did not cast it from your hand'
  ) {
    const interveningSubjectId = String(
      ctx.selectorContext?.chosenObjectIds?.[0]
        || ctx.targetPermanentId
        || '',
    ).trim();
    const referencedObject = interveningSubjectId
      ? findObjectByIdInState(nextState, battlefield as any, interveningSubjectId)
      : getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : null;
    if (provenance?.castFromZone) return provenance.castFromZone !== 'hand';
    const castFromZone = String(
      ctx.castFromZone || ctx.selectorContext?.castFromZone || ''
    )
      .trim()
      .toLowerCase();
    if (castFromZone) return castFromZone !== 'hand';
    return null;
  }

  if (
    normalizedRaw === 'this spell was cast from anywhere other than your hand' ||
    normalizedRaw === 'this spell was cast from somewhere other than your hand'
  ) {
    const castFromZone = String(
      ctx.castFromZone || ctx.selectorContext?.castFromZone || ''
    )
      .trim()
      .toLowerCase();
    if (castFromZone) return castFromZone !== 'hand';
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject ? getConditionalObjectZoneProvenance(referencedObject) : null;
    if (provenance?.castFromZone) return provenance.castFromZone !== 'hand';
    return null;
  }

  if (normalizedRaw === 'no mana was spent to cast it') {
    if (ctx.noManaSpentToCast === true || ctx.selectorContext?.noManaSpentToCast === true) return true;
    if (ctx.noManaSpentToCast === false || ctx.selectorContext?.noManaSpentToCast === false) return false;
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, battlefield, idRaw)
    );
    const spent = getAmountOfManaSpent(sourceRef);
    if (spent !== null) return spent === 0;
    return null;
  }

  if (
    normalizedRaw === 'one or more of them entered from a graveyard or was cast from a graveyard' ||
    normalizedRaw === 'one or more of them entered from a graveyard or were cast from a graveyard'
  ) {
    const moved = movedCardsFromCtx(ctx, lastMovedCards);
    if (moved.some((card) => objectEnteredFromOrWasCastFromGraveyard(card))) return true;
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
        ? ctx.lastAntecedentBattlefieldPermanentIds
        : []),
      ...(Array.isArray(ctx.selectorContext?.lastAntecedentBattlefieldPermanentIds)
        ? ctx.selectorContext.lastAntecedentBattlefieldPermanentIds
        : []),
    ].map((id) => String(id || '').trim()).filter(Boolean);
    if (antecedentIds.length > 0) {
      const battlefield = getProcessedBattlefield(nextState) as any[];
      return antecedentIds.some((id) => {
        const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
        return perm ? objectEnteredFromOrWasCastFromGraveyard(perm) : false;
      });
    }
    return moved.length > 0 ? false : null;
  }

  if (normalizedRaw === 'they entered or were cast from a graveyard') {
    const explicit = (ctx as any)?.theyEnteredOrWereCastFromGraveyard;
    if (typeof explicit === 'boolean') return explicit;
    const ids: string[] = Array.isArray((ctx as any)?.thoseCreatureIds)
      ? (ctx as any).thoseCreatureIds
      : Array.isArray((ctx as any)?.referencedCreatureIds)
        ? (ctx as any).referencedCreatureIds
        : [];
    if (ids.length === 0) return null;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    let sawAny = false;
    let sawUnknown = false;
    for (const id of ids) {
      const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === String(id).trim());
      if (!perm) {
        sawUnknown = true;
        continue;
      }
      sawAny = true;
      if (!objectEnteredFromOrWasCastFromGraveyard(perm)) return false;
    }
    if (!sawAny) return null;
    return sawUnknown ? null : true;
  }

  if (normalizedRaw === 'you would lose the game') {
    if (ctx.wouldLoseTheGame === true || ctx.selectorContext?.wouldLoseTheGame === true) return true;
    if (ctx.wouldLoseTheGame === false || ctx.selectorContext?.wouldLoseTheGame === false) return false;
    return true;
  }

  {
    const sacrificedTypeMatch = normalizedRaw.match(/^the sacrificed creature was a ([a-z]+)$/i);
    if (sacrificedTypeMatch) {
      const descriptor = String(sacrificedTypeMatch[1] || '').trim().toLowerCase();
      const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
        ? ((ctx as any).lastSacrificedPermanents as any[])
        : [];
      if (snapshots.length > 0) {
        return snapshots.some((entry: any) =>
          matchesCardTypeDescriptor(entry, descriptor) ||
          new RegExp(`\\b${descriptor.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(
            String(entry?.type_line || entry?.card?.type_line || entry?.subtype || entry?.cardType || '')
          )
        );
      }
      if (lastActionOutcome?.stepKind !== 'sacrifice') return null;
      return false;
    }
  }

  {
    const sacrificedColorMatch = normalizedRaw.match(
      /^the sacrificed creature was (white|blue|black|red|green)$/i
    );
    if (sacrificedColorMatch) {
      const color = String(sacrificedColorMatch[1] || '').trim().toLowerCase();
      const colorLetter: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
      const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
        ? ((ctx as any).lastSacrificedPermanents as any[])
        : [];
      if (snapshots.length > 0) {
        return snapshots.some((entry: any) => {
          const colors = Array.isArray(entry?.colors) ? entry.colors : Array.isArray(entry?.card?.colors) ? entry.card.colors : [];
          return colors.some((c: unknown) => String(c || '').toUpperCase() === colorLetter[color]);
        });
      }
      if (lastActionOutcome?.stepKind !== 'sacrifice') return null;
      return false;
    }
  }

  {
    const wasntSubtypeMatch = normalizedRaw.match(/^(?:it|this creature|this permanent) (?:wasn't|was not) (?:a|an) ([a-z0-9-]+)$/i);
    if (wasntSubtypeMatch) {
      const subtype = String(wasntSubtypeMatch[1] || '').trim().toLowerCase();
      const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
        ? ((ctx as any).lastSacrificedPermanents as any[])
        : [];
      const subject =
        snapshots[0] ??
        getReferencedConditionalObject(nextState, battlefield, ctx);
      if (!subject) return null;
      const typeLine = String(subject?.type_line || subject?.card?.type_line || '').toLowerCase();
      return !new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(typeLine);
    }
  }

  if (normalizedRaw === 'you chose a creature this way') {
    const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds
      : [];
    if (chosenIds.length === 0) return false;
    return chosenIds.some((id) => {
      const perm = battlefield.find(
        (entry: any) => String(entry?.id || '').trim() === String(id || '').trim()
      );
      return Boolean(perm) && /\bcreature\b/i.test(String((perm as any)?.type_line || (perm as any)?.card?.type_line || ''));
    });
  }

  if (normalizedRaw === 'it escaped' || normalizedRaw === 'this permanent escaped') {
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : {
          castFromZone: String(ctx.castFromZone || '').trim().toLowerCase() || undefined,
          enteredFromZone: String(ctx.enteredFromZone || '').trim().toLowerCase() || undefined,
        };
    return provenance.castFromZone === 'graveyard';
  }

  if (
    normalizedRaw === "it didn't escape" ||
    normalizedRaw === 'it did not escape' ||
    normalizedRaw === "this permanent didn't escape" ||
    normalizedRaw === 'this permanent did not escape'
  ) {
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : {
          castFromZone: String(ctx.castFromZone || '').trim().toLowerCase() || undefined,
          enteredFromZone: String(ctx.enteredFromZone || '').trim().toLowerCase() || undefined,
        };
    return provenance.castFromZone !== 'graveyard';
  }

  {
    const hadNoCountersMatch = normalizedRaw.match(/^it had no ([a-z0-9/+ -]+) counters on it$/i);
    if (hadNoCountersMatch) {
      const counterName = String(hadNoCountersMatch[1] || '').trim().toLowerCase();
      const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
      if (!referencedObject) return false;
      const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
      const count = Number(counters[counterName] ?? 0);
      return (Number.isFinite(count) ? count : 0) === 0;
    }
  }

  if (normalizedRaw === 'it had one or more counters on it') {
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    if (!referencedObject) return false;
    const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
    const total = Object.values(counters).reduce((sum, value) => {
      const count = Number(value ?? 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);
    return total > 0;
  }

  {
    const hasCountersThresholdMatch = normalizedRaw.match(
      /^it has (three|[a-z0-9]+) or more ([+-]1\/[+-]1) counters on it$/i
    );
    if (hasCountersThresholdMatch) {
      const threshold = parseSmallNumberWord(String(hasCountersThresholdMatch[1] || '').trim());
      const counterName = String(hasCountersThresholdMatch[2] || '').trim();
      if (threshold !== null && counterName) {
        const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
        if (!referencedObject) return null;
        const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
        const count = Number(counters[counterName] ?? 0);
        return (Number.isFinite(count) ? count : 0) >= threshold;
      }
    }
  }

  const generic = evaluateModifyPtCondition(nextState, controllerId, condition.raw);
  if (generic !== null) return generic;

  const sourceRef = getContextSourceObject(ctx, (idRaw: string) => findObjectByIdInState(nextState, battlefield, idRaw));

  {
    const manaSpentMatch = raw.match(/^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i);
    if (manaSpentMatch) {
      const threshold = parseSmallNumberWord(String(manaSpentMatch[1] || ''));
      if (threshold === null) return null;
      const spent = getAmountOfManaSpent(sourceRef);
      if (spent === null) return null;
      return spent >= threshold;
    }
  }

  if (normalizedRaw === 'you win the flip') {
    return typeof ctx.wonCoinFlip === 'boolean' ? ctx.wonCoinFlip : null;
  }

  if (normalizedRaw === 'you lose the flip') {
    return typeof ctx.wonCoinFlip === 'boolean' ? !ctx.wonCoinFlip : false;
  }

  if (
    normalizedRaw === 'you win' ||
    normalizedRaw === 'you won' ||
    normalizedRaw === 'you win the clash' ||
    normalizedRaw === 'you won the clash'
  ) {
    return typeof ctx.lastClashWon === 'boolean' ? ctx.lastClashWon : null;
  }

  if (
    normalizedRaw === "it's on the battlefield" ||
    normalizedRaw === 'it is on the battlefield' ||
    normalizedRaw === 'this permanent is on the battlefield'
  ) {
    if (sourceRef) return true;
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    if (!sourceName) return null;
    return battlefield.some((perm: any) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === sourceName);
  }

  {
    const namedOnBattlefieldMatch = normalizedRaw.match(/^([a-z0-9][a-z0-9,' -]*) is on the battlefield$/i);
    if (namedOnBattlefieldMatch) {
      const expectedName = String(namedOnBattlefieldMatch[1] || '').trim().toLowerCase();
      if (expectedName) {
        return battlefield.some((perm: any) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === expectedName);
      }
    }
  }

  if (
    normalizedRaw === "it's tapped" ||
    normalizedRaw === 'it is tapped' ||
    normalizedRaw === 'this permanent is tapped' ||
    normalizedRaw === 'this creature is tapped'
  ) {
    return sourceRef ? Boolean((sourceRef as any)?.tapped) : null;
  }

  {
    const namedTappedMatch = normalizedRaw.match(/^([a-z0-9][a-z0-9,' -]*) is tapped$/i);
    if (namedTappedMatch) {
      const expectedName = String(namedTappedMatch[1] || '').trim().toLowerCase();
      const match = battlefield.find((perm: any) =>
        String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === expectedName
      ) as any;
      return match ? Boolean(match.tapped) : false;
    }
  }

  {
    const voteWinnerMatch = normalizedRaw.match(/^([a-z0-9][a-z0-9' -]*) gets more votes$/i);
    if (voteWinnerMatch) {
      const expected = String(voteWinnerMatch[1] || '').trim().toLowerCase();
      const winningVoteChoice = deriveWinningVoteChoice(ctx);
      const actual = winningVoteChoice === null ? '' : String(winningVoteChoice || '').trim().toLowerCase();
      if (!expected || !actual) return null;
      return actual === expected;
    }
  }

  if (normalizedRaw === 'the vote is tied' || normalizedRaw === 'vote is tied') {
    const winningVoteChoice = deriveWinningVoteChoice(ctx);
    return winningVoteChoice === null ? true : typeof winningVoteChoice === 'undefined' ? null : false;
  }

  {
    const topCardTypePrefixMatch = normalizedRaw.match(/^(it(?:'s| is)|that card is)\s+(.+)$/i);
    if (topCardTypePrefixMatch) {
      const normalizedTypeText = String(topCardTypePrefixMatch[2] || '')
        .trim()
        .replace(/^an?\s+/i, '')
        .replace(/\s+card$/i, '')
        .trim();
      if (normalizedTypeText === 'snow') {
        const card =
          (Array.isArray(lastMovedCards) && lastMovedCards.length > 0 ? lastMovedCards[lastMovedCards.length - 1] : null) ??
          getReferencedConditionalObject(nextState, battlefield, ctx);
        if (!card) {
          const libraryOwnerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
          const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === libraryOwnerId) as any;
          const topCard = Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
          if (!topCard) return null;
          return cardMatchesType(topCard, 'snow');
        }
        return cardMatchesType(card, 'snow');
      }
      const parsedType = parseSimpleCardTypeFromText(normalizedTypeText);
      if (parsedType) {
        const libraryOwnerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
        const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === libraryOwnerId) as any;
        const topCard = Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
        if (!topCard) return null;
        return cardMatchesType(topCard, parsedType);
      }
    }
  }

  if (
    normalizedRaw === 'it shares a creature type with this creature' ||
    normalizedRaw === 'that card shares a creature type with this creature' ||
    normalizedRaw === 'it shares a creature type with this permanent' ||
    normalizedRaw === 'that card shares a creature type with this permanent'
  ) {
    const libraryOwnerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
    if (!libraryOwnerId) return null;
    return topCardSharesCreatureTypeWithSource(nextState, libraryOwnerId, sourceRef);
  }

  if (!sourceRef) return null;

  if (normalizedRaw === 'that card has the chosen name') {
    const chosenName = String(
      ctx.selectorContext?.chosenCardName || (sourceRef as any)?.chosenCardName || (sourceRef as any)?.card?.chosenCardName || ''
    ).trim();
    if (!chosenName) return null;

    const libraryOwnerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
    const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === libraryOwnerId) as any;
    const topCard = Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
    if (!topCard) return null;

    const normalizedChosenName = chosenName.toLowerCase();
    const topCardNames = new Set<string>();
    const pushName = (value: unknown) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized) topCardNames.add(normalized);
    };
    pushName((topCard as any)?.name);
    for (const face of Array.isArray((topCard as any)?.card_faces) ? (topCard as any).card_faces : []) {
      pushName((face as any)?.name);
    }
    if (topCardNames.has(normalizedChosenName)) return true;

    const leftName = String((topCard as any)?.leftHalf?.name || '').trim();
    const rightName = String((topCard as any)?.rightHalf?.name || '').trim();
    if (leftName && rightName) {
      try {
        return splitCardMatchesName(
          {
            type: 'split-card',
            leftHalf: {
              name: leftName,
              manaCost: '',
              types: [],
              subtypes: [],
              supertypes: [],
              text: '',
              power: null,
              toughness: null,
              loyalty: null,
              colors: [],
            },
            rightHalf: {
              name: rightName,
              manaCost: '',
              types: [],
              subtypes: [],
              supertypes: [],
              text: '',
              power: null,
              toughness: null,
              loyalty: null,
              colors: [],
            },
            hasSharedTypeLine: false,
          },
          chosenName
        );
      } catch {
        return null;
      }
    }
    return false;
  }

  if (raw === 'all five types on this permanent have counters over them') {
    const counters = ((sourceRef as any)?.counters || (sourceRef as any)?.card?.counters || {}) as Record<string, unknown>;
    const requiredKeys = ['artifact', 'creature', 'enchantment', 'instant', 'sorcery'];
    return requiredKeys.every(key => Number((counters as any)[key]) > 0);
  }

  if (
    raw === "the result is equal to this vehicle's mana value" ||
    raw === "the result is equal to this permanent's mana value"
  ) {
    const rolled = Number((nextState as any)?.lastDieRollByPlayer?.[controllerId]);
    if (!Number.isFinite(rolled)) return null;
    const manaValue = getCardManaValue((sourceRef as any)?.card || sourceRef);
    if (manaValue === null) return null;
    return rolled === manaValue;
  }

  return null;
}

export function resolveConditionalReferenceAmount(params: {
  condition: ConditionalCondition;
  nextState: GameState;
  ctx: OracleIRExecutionContext;
}): number | null {
  const { condition, nextState, ctx } = params;
  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

  const battlefield = getProcessedBattlefield(nextState);
  const sourceRef = getContextSourceObject(ctx, (idRaw: string) => findObjectByIdInState(nextState, battlefield, idRaw));
  if (!sourceRef) return null;

  const raw = String(condition.raw || '').trim().toLowerCase();
  if (
    raw === "the result is equal to this vehicle's mana value" ||
    raw === "the result is equal to this permanent's mana value"
  ) {
    const controllerId = String(ctx.controllerId || '').trim();
    const rolled = Number((nextState as any)?.lastDieRollByPlayer?.[controllerId]);
    return Number.isFinite(rolled) ? rolled : null;
  }

  const manaSpentMatch = raw.match(/^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i);
  if (!manaSpentMatch) return null;

  return getAmountOfManaSpent(sourceRef);
}

export function applyConditionalReferenceAmount(step: OracleEffectStep, resolvedAmount: number | null): OracleEffectStep {
  if (resolvedAmount === null || !('amount' in (step as any))) return step;

  const amount = (step as any).amount;
  const raw = String(amount?.raw || '').trim().toLowerCase();
  if (amount?.kind !== 'unknown' || raw !== 'that much') return step;

  return {
    ...(step as any),
    amount: { kind: 'number', value: Math.max(0, resolvedAmount) },
  } as OracleEffectStep;
}
