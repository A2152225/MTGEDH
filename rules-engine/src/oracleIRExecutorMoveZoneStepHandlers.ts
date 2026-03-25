import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { evaluateConditionalWrapperCondition } from './oracleIRExecutorConditionalStepSupport';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import {
  bounceMatchingBattlefieldPermanentsToOwnersHands,
  moveBattlefieldPermanentsByIdToOwnersLibraries,
  moveBattlefieldPermanentsByIdToOwnersHands,
} from './oracleIRExecutorBattlefieldOps';
import {
  exileExactMatchingFromGraveyard,
  exileAllMatchingFromGraveyard,
  moveAllMatchingFromExile,
  moveAllMatchingFromHand,
  moveTargetedCardFromAnyGraveyard,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  findCardsExiledWithSource,
  parseMoveZoneRandomSingleFromYourGraveyard,
  parseMoveZoneAllFromEachOpponentsExile,
  parseMoveZoneAllFromEachOpponentsGraveyard,
  parseMoveZoneAllFromEachOpponentsHand,
  parseMoveZoneAllFromEachPlayersExile,
  parseMoveZoneAllFromEachPlayersGraveyard,
  parseMoveZoneAllFromEachPlayersHand,
  parseMoveZoneAllFromTargetPlayersExile,
  parseMoveZoneAllFromTargetPlayersGraveyard,
  parseMoveZoneAllFromTargetPlayersHand,
  parseMoveZoneCountFromTargetPlayersGraveyard,
  parseMoveZoneSingleTargetFromAGraveyard,
  parseMoveZoneSingleTargetFromTargetPlayersGraveyard,
  parseMoveZoneSingleTargetFromTargetPlayersHand,
  parseMoveZoneSingleTargetFromTargetPlayersExile,
  parseMoveZoneSingleTargetFromYourGraveyard,
  parseMoveZoneTargetAndSameNamedFromYourGraveyard,
  parseMoveZoneSingleTargetFromYourHand,
  parseMoveZoneSingleTargetFromYourExile,
  parseMoveZoneSingleTargetFromLinkedExile,
  parseMoveZoneAllFromLinkedExile,
  parseMoveZoneAllFromYourExile,
  parseMoveZoneAllFromYourGraveyard,
  parseMoveZoneAllFromYourHand,
  parseMoveZoneCountFromYourGraveyard,
  cardMatchesMoveZoneSingleTargetCriteria,
  selectRandomMatchingCardIdFromGraveyard,
  putExactMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromExileOntoBattlefield,
  putAllMatchingFromExileOntoBattlefieldWithController,
  putAllMatchingFromGraveyardOntoBattlefield,
  putAllMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromHandOntoBattlefield,
  putAllMatchingFromHandOntoBattlefieldWithController,
  returnExactMatchingFromGraveyardToHand,
  returnTargetAndSameNamedCardsFromYourGraveyardToHand,
  returnAllMatchingFromGraveyardToHand,
} from './oracleIRExecutorZoneOps';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastMovedCards?: readonly any[];
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'unsupported_destination'
    | 'unsupported_selector'
    | 'battlefield_requires_explicit_control_override'
    | 'player_choice_required'
    | 'impossible_action';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
    readonly persist?: boolean;
  };
};

export type MoveZoneStepHandlerResult = StepApplyResult | StepSkipResult;

type MoveZoneRuntime = {
  readonly lastMovedCards?: readonly any[];
};

type BoundCardZoneLocation = {
  readonly playerId: PlayerID;
  readonly zone: 'graveyard' | 'hand' | 'exile';
};

function buildAppliedResult(result: {
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards?: readonly any[];
  readonly movedPermanentIds?: readonly string[];
}): StepApplyResult {
  return {
    applied: true,
    state: result.state,
    log: result.log,
    ...(Array.isArray(result.movedCards) ? { lastMovedCards: [...result.movedCards] } : {}),
    ...(Array.isArray(result.movedPermanentIds)
      ? { lastMovedBattlefieldPermanentIds: [...result.movedPermanentIds] }
      : {}),
  };
}

function annotateExiledCardsWithSource(params: {
  state: GameState;
  movedCards?: readonly any[];
  ctx: OracleIRExecutionContext;
}): { state: GameState; movedCards?: readonly any[] } {
  const sourceId = String(params.ctx.sourceId || '').trim();
  const sourceRef = sourceId || String(params.ctx.sourceName || '').trim();
  const movedCards = Array.isArray(params.movedCards) ? params.movedCards : [];
  if (!sourceRef || movedCards.length === 0) {
    return { state: params.state, ...(params.movedCards ? { movedCards } : {}) };
  }

  const movedIds = new Set(
    movedCards
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean)
  );
  if (movedIds.size === 0) {
    return { state: params.state, movedCards };
  }

  let stateChanged = false;
  const updatedPlayers = (params.state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    let exileChanged = false;
    const nextExile = exile.map((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || !movedIds.has(cardId)) return card;
      exileChanged = true;
      return {
        ...card,
        exiledBy: sourceRef,
        ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
      };
    });
    if (!exileChanged) return player;
    stateChanged = true;
    return { ...player, exile: nextExile };
  });

  const nextMovedCards = movedCards.map((card: any) => ({
    ...card,
    exiledBy: sourceRef,
    ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
  }));

  return {
    state: stateChanged ? ({ ...params.state, players: updatedPlayers as any } as GameState) : params.state,
    movedCards: nextMovedCards,
  };
}

const CARD_TYPE_WORDS = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'] as const;
const LINKED_EXILE_SHARED_KEYWORDS = [
  'flying',
  'first strike',
  'double strike',
  'deathtouch',
  'haste',
  'hexproof',
  'indestructible',
  'lifelink',
  'menace',
  'reach',
  'trample',
  'vigilance',
] as const;

function getCardTypesFromTypeLine(card: any): readonly string[] {
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  if (!typeLine) return [];

  const found: string[] = [];
  for (const typeWord of CARD_TYPE_WORDS) {
    if (typeLine.includes(typeWord) && !found.includes(typeWord)) {
      found.push(typeWord);
    }
  }
  return found;
}

function cardHasLinkedKeyword(card: any, keyword: string): boolean {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase();
  if (!normalizedKeyword) return false;

  const oracleText = String(card?.oracle_text || card?.card?.oracle_text || '').toLowerCase();
  const printedKeywords = Array.isArray(card?.keywords) ? card.keywords : Array.isArray(card?.card?.keywords) ? card.card.keywords : [];
  const grantedAbilities = Array.isArray(card?.grantedAbilities) ? card.grantedAbilities : Array.isArray(card?.card?.grantedAbilities) ? card.card.grantedAbilities : [];

  return (
    oracleText.includes(normalizedKeyword) ||
    printedKeywords.some((entry: unknown) => String(entry || '').trim().toLowerCase() === normalizedKeyword) ||
    grantedAbilities.some((entry: unknown) => String(entry || '').trim().toLowerCase() === normalizedKeyword)
  );
}

function parseSharedLinkedExileKeywords(sourceText: string): readonly string[] {
  const normalized = String(sourceText || '').toLowerCase();
  if (!normalized.includes('this creature has flying as long as a card exiled with it has flying')) return [];

  const keywords = new Set<string>(['flying']);
  const sameIsTrueMatch = normalized.match(/the same is true for ([^.]+)/i);
  if (sameIsTrueMatch) {
    const parts = String(sameIsTrueMatch[1] || '')
      .split(/,\s*|\s+and\s+/i)
      .map(part => part.trim().toLowerCase())
      .filter(Boolean);
    for (const part of parts) {
      if ((LINKED_EXILE_SHARED_KEYWORDS as readonly string[]).includes(part)) {
        keywords.add(part);
      }
    }
  }

  return [...keywords];
}

function projectLinkedExileStaticText(params: {
  state: GameState;
  movedCards?: readonly any[];
  ctx: OracleIRExecutionContext;
}): GameState {
  const sourceId = String(params.ctx.sourceId || '').trim();
  let movedCards = Array.isArray(params.movedCards) ? params.movedCards : [];
  if (!sourceId) return params.state;
  const linkedMatches = findCardsExiledWithSource(params.state, sourceId, { cardType: 'any' });
  if (movedCards.length !== 1) {
    movedCards = linkedMatches.length === 1 ? [linkedMatches[0].card] : [];
  }

  const battlefield = Array.isArray((params.state as any).battlefield) ? ((params.state as any).battlefield as any[]) : [];
  const sourcePermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId);
  if (!sourcePermanent) return params.state;

  const sourceText = `${String((sourcePermanent as any)?.oracle_text || '').trim()}\n${String((sourcePermanent as any)?.card?.oracle_text || '').trim()}`
    .toLowerCase();
  const sharedKeywords = parseSharedLinkedExileKeywords(sourceText);
  if (sharedKeywords.length > 0) {
    const linkedCards = linkedMatches.map(match => match.card);
    const projectedKeywords = sharedKeywords.filter(keyword =>
      linkedCards.some(card => cardHasLinkedKeyword(card, keyword))
    );
    const previousProjected = Array.isArray((sourcePermanent as any)?.linkedExileGrantedAbilities)
      ? (sourcePermanent as any).linkedExileGrantedAbilities
          .map((entry: unknown) => String(entry || '').trim().toLowerCase())
          .filter(Boolean)
      : [];
    const existingGranted = Array.isArray((sourcePermanent as any)?.grantedAbilities)
      ? (sourcePermanent as any).grantedAbilities
          .map((entry: unknown) => String(entry || '').trim().toLowerCase())
          .filter(Boolean)
      : [];
    const retainedGranted = existingGranted.filter((entry: string) => !previousProjected.includes(entry));
    const nextGranted = Array.from(new Set([...retainedGranted, ...projectedKeywords]));
    const nextBattlefield = battlefield.map((perm: any) =>
      String((perm as any)?.id || '').trim() === sourceId
        ? ({
            ...perm,
            linkedExileGrantedAbilities: projectedKeywords,
            grantedAbilities: nextGranted,
          } as any)
        : perm
    );

    return {
      ...(params.state as any),
      battlefield: nextBattlefield as any,
    } as GameState;
  }

  if (movedCards.length !== 1) return params.state;
  if (!sourceText.includes("has protection from each of the exiled card's card types")) {
    return params.state;
  }

  const projectedTypes = getCardTypesFromTypeLine(movedCards[0]);
  if (projectedTypes.length === 0) return params.state;

  const existingGranted = Array.isArray((sourcePermanent as any)?.grantedAbilities)
    ? (sourcePermanent as any).grantedAbilities
        .map((entry: unknown) => String(entry || '').trim())
        .filter(Boolean)
    : [];
  const nextGranted = [...existingGranted];
  for (const typeWord of projectedTypes) {
    const grantedText = `protection from ${typeWord}`;
    if (!nextGranted.some((entry: string) => entry.toLowerCase() === grantedText)) {
      nextGranted.push(grantedText);
    }
  }

  const nextBattlefield = battlefield.map((perm: any) =>
    String((perm as any)?.id || '').trim() === sourceId
      ? ({
          ...perm,
          grantedAbilities: nextGranted,
        } as any)
      : perm
  );

  return {
    ...(params.state as any),
    battlefield: nextBattlefield as any,
  } as GameState;
}

function getControllerId(ctx: OracleIRExecutionContext): PlayerID {
  return (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
}

function getOpponents(state: GameState, controllerId: PlayerID): any[] {
  const players = (state.players || []) as any[];
  const hasValidController = players.some(p => p?.id === controllerId);
  return hasValidController ? players.filter(p => p?.id && p.id !== controllerId) : [];
}

function getTargetPlayerId(ctx: OracleIRExecutionContext): PlayerID | '' {
  return (String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || '').trim() || '') as PlayerID | '';
}

function getChosenObjectIds(ctx: OracleIRExecutionContext): readonly string[] {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of chosen) {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

function normalizeReferenceText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNameReferenceAliases(value: unknown): readonly string[] {
  const normalized = normalizeReferenceText(value);
  if (!normalized) return [];

  const aliases = new Set<string>();
  aliases.add(normalized);
  for (const face of normalized.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    aliases.add(face);
    const commaHead = String(face.split(',')[0] || '').trim();
    if (commaHead.length >= 4) aliases.add(commaHead);
  }

  return [...aliases];
}

function getTargetObjectId(ctx: OracleIRExecutionContext): string {
  return String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
}

function isAnotherTargetReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:up to one\s+)?another\s+target\b/.test(text);
}

function getBoundTargetObjectId(
  ctx: OracleIRExecutionContext,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  runtime?: MoveZoneRuntime
): string {
  const directId = getTargetObjectId(ctx);
  if (!isAnotherTargetReference(step.what)) {
    if (directId) return directId;
    const chosen = getChosenObjectIds(ctx);
    return chosen.length === 1 ? chosen[0] : '';
  }

  const excluded = new Set<string>();
  if (directId) excluded.add(directId);
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId) excluded.add(movedId);
  }

  const remaining = getChosenObjectIds(ctx).filter(id => !excluded.has(id));
  return remaining.length === 1 ? remaining[0] : '';
}

function isUpToOneTargetReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^up to one\s+(?:another\s+)?target\b/.test(text);
}

function buildNoOpOptionalSingleTargetResult(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>
): StepApplyResult {
  return {
    applied: true,
    state,
    log: [`Skipped optional targetless move zone slot: ${step.raw}`],
    lastMovedCards: [],
  };
}

function resolveUniqueChosenGraveyardTargetId(
  state: GameState,
  playerId: PlayerID,
  criteria: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  referenceCardName?: string
): string {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return '';

  const chosen = new Set(getChosenObjectIds(ctx));
  if (chosen.size === 0) return '';

  const excluded = new Set<string>();
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId) excluded.add(movedId);
  }

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const matches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || !chosen.has(cardId) || excluded.has(cardId)) return false;
    return cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn);
  });

  return matches.length === 1 ? String((matches[0] as any)?.id || '').trim() : '';
}

function resolveUniqueChosenAnyGraveyardTargetId(
  state: GameState,
  criteria: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  referenceCardName?: string
): string {
  const chosen = new Set(getChosenObjectIds(ctx));
  if (chosen.size === 0) return '';

  const excluded = new Set<string>();
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId) excluded.add(movedId);
  }

  const matches: any[] = [];
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  for (const player of state.players || []) {
    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    for (const card of graveyard) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId || !chosen.has(cardId) || excluded.has(cardId)) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn)) continue;
      matches.push(card);
    }
  }

  return matches.length === 1 ? String((matches[0] as any)?.id || '').trim() : '';
}

function isContextualBoundCardReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return (
    text === 'it' ||
    /^that (?:(?:[a-z0-9+'/-]+\s+)*(?:card|creature|permanent))(?: from (?:(?:the |your |their |target player's |target opponent's |an opponent's |its owner's |its controller's |that player's |one of your opponents' )?(?:graveyard|hand|exile)))?$/.test(
      text
    )
  );
}

function isContextualBoundCardsReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:those cards|those creatures|those permanents)(?: from (?:(?:the |your |their |target player's |target opponent's |an opponent's |its owner's |its controller's |that player's |one of your opponents' )?(?:graveyard|hand|exile)))?$/.test(
    text
  );
}

function findBoundCardZoneLocation(state: GameState, targetCardId: string): BoundCardZoneLocation | null {
  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return null;

  const matches: BoundCardZoneLocation[] = [];
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    for (const zone of ['graveyard', 'hand', 'exile'] as const) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      if (cards.some((card: any) => String(card?.id || '').trim() === wantedId)) {
        matches.push({ playerId, zone });
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

function resolveSourceCardZoneLocation(
  state: GameState,
  what: unknown,
  ctx: OracleIRExecutionContext
): BoundCardZoneLocation & { readonly cardId: string } | null {
  const rawText = normalizeReferenceText((what as any)?.text || (what as any)?.raw || '');
  if (!rawText) return null;

  const selfReference = /^(?:this card|this permanent|this aura|this equipment|this enchantment|this artifact|this creature|this land)$/i.test(
    rawText
  );
  const sourceNameAliases = new Set(buildNameReferenceAliases(ctx.sourceName));
  const matchesSourceName = sourceNameAliases.has(rawText);
  if (!selfReference && !matchesSourceName) return null;

  const sourceId = String(ctx.sourceId || '').trim();
  if (sourceId) {
    const exactLocation = findBoundCardZoneLocation(state, sourceId);
    if (exactLocation) {
      return { ...exactLocation, cardId: sourceId };
    }
  }

  const matches: Array<BoundCardZoneLocation & { readonly cardId: string }> = [];
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    for (const zone of ['graveyard', 'hand', 'exile'] as const) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      for (const card of cards) {
        const cardId = String((card as any)?.id || '').trim();
        const cardNameAliases = new Set(buildNameReferenceAliases((card as any)?.name));
        if (!cardId || cardNameAliases.size === 0) continue;
        if ([...sourceNameAliases].some(alias => cardNameAliases.has(alias))) {
          matches.push({ playerId, zone, cardId });
        }
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

type BattlefieldAttachmentResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'resolved'; readonly permanentId: string }
  | { readonly kind: 'player_choice_required'; readonly selector: string }
  | { readonly kind: 'impossible'; readonly selector: string }
  | { readonly kind: 'unsupported'; readonly selector: string };

function resolveBattlefieldAttachment(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext
): BattlefieldAttachmentResolution {
  if (step.to !== 'battlefield' || !step.battlefieldAttachedTo) return { kind: 'none' };
  if ((step.battlefieldAttachedTo as any)?.kind !== 'raw') {
    return { kind: 'unsupported', selector: String((step.battlefieldAttachedTo as any)?.raw || '') };
  }

  const selectorText = String((step.battlefieldAttachedTo as any)?.text || '').trim();
  const normalized = selectorText.replace(/\u2019/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  const battlefield = (state.battlefield || []) as any[];
  const chosenObjectIds = getChosenObjectIds(ctx);
  const contextualPermanentIds = Array.from(
    new Set(
      [String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim(), ...chosenObjectIds].filter(Boolean)
    )
  );

  if (normalized === 'this creature') {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find(perm => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    if (!sourcePermanent || !hasExecutorClass(sourcePermanent as any, 'creature')) {
      return { kind: 'impossible', selector: selectorText || normalized };
    }
    return { kind: 'resolved', permanentId: sourceId };
  }

  if (normalized === 'a creature you control') {
    const controllerId = getControllerId(ctx);
    const controlledCreatures = battlefield.filter(
      perm => perm?.controller === controllerId && hasExecutorClass(perm as any, 'creature')
    );
    if (controlledCreatures.length === 0) return { kind: 'impossible', selector: selectorText || normalized };
    if (controlledCreatures.length > 1) {
      return { kind: 'player_choice_required', selector: selectorText || normalized };
    }
    return { kind: 'resolved', permanentId: String((controlledCreatures[0] as any)?.id || '').trim() };
  }

  if (normalized === 'that creature' || normalized === 'that land' || normalized === 'that permanent') {
    const expectedType = normalized === 'that land' ? 'land' : normalized === 'that creature' ? 'creature' : undefined;
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!contextualPermanentIds.includes(permanentId)) return false;
      if (expectedType && !hasExecutorClass(perm as any, expectedType)) return false;
      return true;
    });
    if (matches.length === 0) return { kind: 'impossible', selector: selectorText || normalized };
    if (matches.length > 1) return { kind: 'player_choice_required', selector: selectorText || normalized };
    return { kind: 'resolved', permanentId: String((matches[0] as any)?.id || '').trim() };
  }

  return { kind: 'unsupported', selector: selectorText || normalized };
}

function getLibraryPlacement(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): 'top' | 'bottom' | '' {
  if (step.to !== 'library') return '';
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  const hasTop = /^(?:on\s+)?top of\b/i.test(toRaw);
  const hasBottom = /^(?:on\s+)?(?:the\s+)?bottom of\b/i.test(toRaw);
  if (hasTop && hasBottom) return '';
  if (hasTop) return 'top';
  if (hasBottom) return 'bottom';
  return '';
}

function requiresExplicitControllerOverride(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): boolean {
  return (
    step.to === 'battlefield' &&
    step.battlefieldController?.kind !== 'you' &&
    step.battlefieldController?.kind !== 'owner_of_moved_cards'
  );
}

function applyBattlefieldEntryCharacteristicsToState(
  state: GameState,
  permanentIds: readonly string[] | undefined,
  addTypes: readonly string[] | undefined,
  addColors: readonly string[] | undefined
): GameState {
  const ids = new Set((permanentIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (ids.size === 0) return state;

  const normalizedTypes = (addTypes || []).map(type => String(type || '').trim()).filter(Boolean);
  const normalizedColors = (addColors || []).map(color => String(color || '').trim().toUpperCase()).filter(Boolean);
  if (normalizedTypes.length === 0 && normalizedColors.length === 0) return state;

  const battlefield = (state.battlefield || []) as any[];
  let changed = false;
  const nextBattlefield = battlefield.map((permanent: any) => {
    const permanentId = String(permanent?.id || '').trim();
    if (!ids.has(permanentId)) return permanent;

    const nextPermanent: any = { ...permanent };

    if (normalizedTypes.length > 0) {
      const grantedTypes = Array.isArray(nextPermanent.grantedTypes) ? [...nextPermanent.grantedTypes] : [];
      for (const typeName of normalizedTypes) {
        if (!grantedTypes.includes(typeName)) grantedTypes.push(typeName);
      }
      nextPermanent.grantedTypes = grantedTypes;
      changed = true;
    }

    if (normalizedColors.length > 0) {
      const colors = Array.isArray(nextPermanent.colors)
        ? [...nextPermanent.colors]
        : (Array.isArray(nextPermanent.card?.colors) ? [...nextPermanent.card.colors] : []);
      for (const color of normalizedColors) {
        if (!colors.includes(color)) colors.push(color);
      }
      nextPermanent.colors = colors;
      changed = true;
    }

    return nextPermanent;
  });

  return changed ? ({ ...state, battlefield: nextBattlefield as any } as any) : state;
}

export function applyMoveZoneStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): MoveZoneStepHandlerResult {
  if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield' && step.to !== 'library') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const controllerId = getControllerId(ctx);
  let effectiveWithCounters = step.withCounters;
  let effectiveBattlefieldAddTypes = step.battlefieldAddTypes;
  let effectiveBattlefieldAddColors = step.battlefieldAddColors;
  const battlefieldEntryOverrides =
    step.to === 'battlefield' &&
    (step.battlefieldSetTypeLine || step.battlefieldSetOracleText || step.battlefieldLoseAllAbilities)
      ? {
          ...(step.battlefieldSetTypeLine ? { setTypeLine: step.battlefieldSetTypeLine } : {}),
          ...(typeof step.battlefieldSetOracleText === 'string'
            ? { setOracleText: step.battlefieldSetOracleText }
            : {}),
          ...(step.battlefieldLoseAllAbilities ? { loseAllAbilities: true } : {}),
        }
      : undefined;

  if (step.withCounters && step.withCountersCondition) {
    const conditionEvaluation = evaluateConditionalWrapperCondition({
      condition: step.withCountersCondition,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome: null,
    });

    if (conditionEvaluation === null) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported condition): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (conditionEvaluation === false) {
      effectiveWithCounters = undefined;
    }
  }

  if ((step.battlefieldAddTypes || step.battlefieldAddColors) && step.battlefieldCharacteristicsCondition) {
    const conditionEvaluation = evaluateConditionalWrapperCondition({
      condition: step.battlefieldCharacteristicsCondition,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome: null,
    });

    if (conditionEvaluation === null) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported battlefield-entry characteristic condition): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (conditionEvaluation === false) {
      effectiveBattlefieldAddTypes = undefined;
      effectiveBattlefieldAddColors = undefined;
    }
  }

  const finalizeAppliedResult = (result: {
    readonly state: GameState;
    readonly log: readonly string[];
    readonly movedCards?: readonly any[];
    readonly movedPermanentIds?: readonly string[];
  }): StepApplyResult => {
    let nextState =
      step.to === 'battlefield'
        ? applyBattlefieldEntryCharacteristicsToState(
            result.state,
            result.movedPermanentIds,
            effectiveBattlefieldAddTypes,
            effectiveBattlefieldAddColors
          )
        : result.state;
    let nextMovedCards = result.movedCards;

    if (step.to === 'exile') {
      const annotated = annotateExiledCardsWithSource({
        state: nextState,
        movedCards: result.movedCards,
        ctx,
      });
      nextState = annotated.state;
      nextMovedCards = annotated.movedCards;
      nextState = projectLinkedExileStaticText({
        state: nextState,
        movedCards: nextMovedCards,
        ctx,
      });
    }

    return buildAppliedResult({ ...result, state: nextState, movedCards: nextMovedCards });
  };

  const attachmentResolution = resolveBattlefieldAttachment(nextState, step, ctx);

  if (attachmentResolution.kind === 'unsupported') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported attachment target): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  if (attachmentResolution.kind === 'player_choice_required') {
    return {
      applied: false,
      message: `Skipped move zone (needs player attachment choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          destination: step.to,
          attachmentSelector: attachmentResolution.selector,
        },
      },
    };
  }

  if (attachmentResolution.kind === 'impossible') {
    return {
      applied: false,
      message: `Skipped move zone (attachment target unavailable): ${step.raw}`,
      reason: 'impossible_action',
      options: {
        persist: false,
        metadata: {
          destination: step.to,
          attachmentSelector: attachmentResolution.selector,
        },
      },
    };
  }

  if (((step.to === 'hand') || (step.to === 'library' && getLibraryPlacement(step))) && (step.what as any)?.kind === 'raw') {
    const whatText = String((step.what as any).text || '').trim();
    const directLibraryPlacement = step.to === 'library' ? getLibraryPlacement(step) : '';
    const directBattlefieldTargetId = getTargetObjectId(ctx);
    const battlefieldTargetLikeReference =
      /^(?:up to one\s+)?(?:another\s+)?target\b/i.test(whatText) ||
      /^(?:it|him|her|that card|that creature|that permanent)$/i.test(whatText);
    if (directBattlefieldTargetId && battlefieldTargetLikeReference) {
      const hasDirectBattlefieldTarget = ((nextState.battlefield || []) as any[]).some(
        perm => String((perm as any)?.id || '').trim() === directBattlefieldTargetId
      );
      if (hasDirectBattlefieldTarget) {
        const result =
          step.to === 'hand'
            ? moveBattlefieldPermanentsByIdToOwnersHands(nextState, [directBattlefieldTargetId])
            : moveBattlefieldPermanentsByIdToOwnersLibraries(
                nextState,
                [directBattlefieldTargetId],
                directLibraryPlacement === 'top' ? 'top' : 'bottom'
              );
        return finalizeAppliedResult(result);
      }
    }

    if (step.to === 'hand' && whatText && !/\b(from|card|cards)\b/i.test(whatText)) {
      const selector = parseSimpleBattlefieldSelector(step.what as any);
      if (selector) {
        const result = bounceMatchingBattlefieldPermanentsToOwnersHands(nextState, selector, ctx);
        return finalizeAppliedResult(result);
      }
    }
  }

  const parsedFromGraveyard = parseMoveZoneAllFromYourGraveyard(step.what as any);
  const parsedCountFromGraveyard = parseMoveZoneCountFromYourGraveyard(step.what as any);
  const parsedTargetCountFromGraveyard = parseMoveZoneCountFromTargetPlayersGraveyard(step.what as any);
  const parsedSingleTargetFromAnyGraveyard = parseMoveZoneSingleTargetFromAGraveyard(step.what as any);
  const parsedSingleTargetFromTargetPlayerGraveyard = parseMoveZoneSingleTargetFromTargetPlayersGraveyard(step.what as any);
  const parsedSingleTargetFromTargetPlayerHand = parseMoveZoneSingleTargetFromTargetPlayersHand(step.what as any);
  const parsedSingleTargetFromTargetPlayerExile = parseMoveZoneSingleTargetFromTargetPlayersExile(step.what as any);
  const parsedSingleTargetFromYourGraveyard = parseMoveZoneSingleTargetFromYourGraveyard(step.what as any);
  const parsedRandomSingleFromYourGraveyard = parseMoveZoneRandomSingleFromYourGraveyard(step.what as any);
  const parsedSameNamedFromYourGraveyard = parseMoveZoneTargetAndSameNamedFromYourGraveyard(step.what as any);
  const parsedSingleTargetFromYourHand = parseMoveZoneSingleTargetFromYourHand(step.what as any);
  const parsedSingleTargetFromYourExile = parseMoveZoneSingleTargetFromYourExile(step.what as any);
  const parsedSingleTargetFromLinkedExile = parseMoveZoneSingleTargetFromLinkedExile(step.what as any);
  const parsedFromHand = parseMoveZoneAllFromYourHand(step.what as any);
  const parsedFromExile = parseMoveZoneAllFromYourExile(step.what as any);
  const parsedAllFromLinkedExile = parseMoveZoneAllFromLinkedExile(step.what as any);
  const parsedEachPlayersGy = parseMoveZoneAllFromEachPlayersGraveyard(step.what as any);
  const parsedEachPlayersHand = parseMoveZoneAllFromEachPlayersHand(step.what as any);
  const parsedEachPlayersExile = parseMoveZoneAllFromEachPlayersExile(step.what as any);
  const parsedEachOpponentsGy = parseMoveZoneAllFromEachOpponentsGraveyard(step.what as any);
  const parsedEachOpponentsHand = parseMoveZoneAllFromEachOpponentsHand(step.what as any);
  const parsedEachOpponentsExile = parseMoveZoneAllFromEachOpponentsExile(step.what as any);
  const parsedTargetPlayerHand = parseMoveZoneAllFromTargetPlayersHand(step.what as any);
  const parsedTargetPlayerExile = parseMoveZoneAllFromTargetPlayersExile(step.what as any);
  const parsedTargetPlayerGy = parseMoveZoneAllFromTargetPlayersGraveyard(step.what as any);
  const boundTargetObjectId = getBoundTargetObjectId(ctx, step, runtime);
  const contextualBoundCardIds =
    isContextualBoundCardsReference(step.what as any)
      ? Array.from(
          new Set([String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim(), ...getChosenObjectIds(ctx)].filter(Boolean))
        )
      : [];
  const contextualBoundCardZone =
    isContextualBoundCardReference(step.what as any) && boundTargetObjectId
      ? findBoundCardZoneLocation(nextState, boundTargetObjectId)
      : null;
  const sourceCardZone = resolveSourceCardZoneLocation(nextState, step.what as any, ctx);

  if (
    !parsedFromGraveyard &&
    !parsedCountFromGraveyard &&
    !parsedTargetCountFromGraveyard &&
    !parsedSingleTargetFromAnyGraveyard &&
    !parsedSingleTargetFromTargetPlayerGraveyard &&
    !parsedSingleTargetFromTargetPlayerHand &&
    !parsedSingleTargetFromTargetPlayerExile &&
    !parsedSingleTargetFromYourGraveyard &&
    !parsedRandomSingleFromYourGraveyard &&
    !parsedSameNamedFromYourGraveyard &&
    !parsedSingleTargetFromYourHand &&
    !parsedSingleTargetFromYourExile &&
    !parsedSingleTargetFromLinkedExile &&
    !parsedFromHand &&
    !parsedFromExile &&
    !parsedAllFromLinkedExile &&
    !parsedEachPlayersGy &&
    !parsedEachPlayersHand &&
    !parsedEachPlayersExile &&
    !parsedEachOpponentsGy &&
    !parsedEachOpponentsHand &&
    !parsedEachOpponentsExile &&
    !parsedTargetPlayerHand &&
    !parsedTargetPlayerExile &&
    !parsedTargetPlayerGy &&
    contextualBoundCardIds.length === 0 &&
    !contextualBoundCardZone &&
    !sourceCardZone
  ) {
    return {
      applied: false,
      message: `Skipped move zone (unsupported selector): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  if (contextualBoundCardIds.length > 0) {
    const libraryPlacement = getLibraryPlacement(step);
    if (!['hand', 'exile'].includes(step.to) && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const targetObjectId of contextualBoundCardIds) {
      const exactZone = findBoundCardZoneLocation(workingState, targetObjectId);
      if (!exactZone) {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }

      const destination =
        step.to === 'library'
          ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
          : step.to;
      const result =
        exactZone.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, exactZone.playerId, targetObjectId, { cardType: 'any' }, destination as any)
          : exactZone.zone === 'hand'
            ? moveTargetedCardFromHand(workingState, exactZone.playerId, targetObjectId, 'any', destination as any)
            : moveTargetedCardFromExile(workingState, exactZone.playerId, targetObjectId, 'any', destination as any);

      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }

      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved ${contextualBoundCardIds.length} contextual card(s)`],
    });
  }

  const linkedSourceId = String(ctx.sourceId || '').trim();

  if (parsedSingleTargetFromLinkedExile || parsedAllFromLinkedExile) {
    if (!linkedSourceId) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile source unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const criteria = parsedSingleTargetFromLinkedExile || parsedAllFromLinkedExile!;
    const matches = findCardsExiledWithSource(nextState, linkedSourceId, criteria);
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No linked exiled cards matched: ${step.raw}`],
      });
    }

    const chosenObjectIds = getChosenObjectIds(ctx);
    const selectedMatches =
      parsedSingleTargetFromLinkedExile
        ? (() => {
            if (chosenObjectIds.length > 0) {
              const explicit = matches.filter(match => chosenObjectIds.includes(match.cardId));
              return explicit.length === 1 ? explicit : explicit;
            }
            return matches.length === 1 ? matches : matches;
          })()
        : matches;

    if (parsedSingleTargetFromLinkedExile && selectedMatches.length !== 1) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            availableLinkedExileTargets: matches.map(match => match.cardId),
          },
        },
      };
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of selectedMatches) {
      const result = moveTargetedCardFromExile(
        workingState,
        match.playerId,
        match.cardId,
        criteria.cardType,
        step.to === 'battlefield' ? 'battlefield' : step.to,
        step.to === 'battlefield' && step.battlefieldController?.kind === 'you' ? controllerId : undefined,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (linked exiled card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds = movedPermanentIds.concat(result.movedPermanentIds || []);
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog,
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if (contextualBoundCardZone) {
    const targetObjectId = boundTargetObjectId;
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const contextualBattlefieldControllerId =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? controllerId
          : contextualBoundCardZone.playerId
        : undefined;

    const destination =
      step.to === 'library'
        ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
        : step.to;

    const result =
      contextualBoundCardZone.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            contextualBoundCardZone.playerId,
            targetObjectId,
            { cardType: 'any' },
            destination as any,
            contextualBattlefieldControllerId,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : contextualBoundCardZone.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              contextualBoundCardZone.playerId,
              targetObjectId,
              'any',
              destination as any,
              contextualBattlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : moveTargetedCardFromExile(
              nextState,
              contextualBoundCardZone.playerId,
              targetObjectId,
              'any',
              destination as any,
              contextualBattlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (sourceCardZone) {
    const libraryPlacement = getLibraryPlacement(step);
    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const destination =
      step.to === 'library'
        ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
        : step.to;
    const battlefieldControllerId =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? controllerId
          : sourceCardZone.playerId
        : undefined;
    const result =
      sourceCardZone.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            sourceCardZone.playerId,
            sourceCardZone.cardId,
            { cardType: 'any' },
            destination as any,
            battlefieldControllerId,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : sourceCardZone.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              sourceCardZone.playerId,
              sourceCardZone.cardId,
              'any',
              destination as any,
              battlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : moveTargetedCardFromExile(
              nextState,
              sourceCardZone.playerId,
              sourceCardZone.cardId,
              'any',
              destination as any,
              battlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (source card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerGy) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? returnAllMatchingFromGraveyardToHand(nextState, targetPlayerId, parsedTargetPlayerGy.cardType)
        : step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'owner_of_moved_cards'
            ? putAllMatchingFromGraveyardOntoBattlefield(
                nextState,
                targetPlayerId,
                parsedTargetPlayerGy.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                nextState,
                targetPlayerId,
                controllerId,
                parsedTargetPlayerGy.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
          : exileAllMatchingFromGraveyard(nextState, targetPlayerId, parsedTargetPlayerGy.cardType);
    return finalizeAppliedResult(result);
  }

  if (parsedSameNamedFromYourGraveyard) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = returnTargetAndSameNamedCardsFromYourGraveyardToHand(
      nextState,
      controllerId,
      targetObjectId,
      parsedSameNamedFromYourGraveyard
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedRandomSingleFromYourGraveyard) {
    const selection = selectRandomMatchingCardIdFromGraveyard(
      nextState,
      controllerId,
      parsedRandomSingleFromYourGraveyard,
      ctx.sourceName
    );
    if (selection.kind === 'missing_player') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    if (selection.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    const libraryPlacement = getLibraryPlacement(step);
    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      selection.cardId,
      parsedRandomSingleFromYourGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromAnyGraveyard) {
    const targetObjectId =
      resolveUniqueChosenAnyGraveyardTargetId(
        nextState,
        parsedSingleTargetFromAnyGraveyard,
        ctx,
        runtime,
        ctx.sourceName
      ) || boundTargetObjectId;
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromAnyGraveyard(
      nextState,
      targetObjectId,
      parsedSingleTargetFromAnyGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? undefined
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'graveyard',
            scope: 'any_graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerGraveyard) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId =
      (targetPlayerId
        ? resolveUniqueChosenGraveyardTargetId(
            nextState,
            targetPlayerId,
            parsedSingleTargetFromTargetPlayerGraveyard,
            ctx,
            runtime,
            ctx.sourceName
          )
        : '') ||
      boundTargetObjectId;
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = boundTargetObjectId;
    if (!targetPlayerId || !targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromHand(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerHand.cardType,
      step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'hand',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerExile) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = boundTargetObjectId;
    if (!targetPlayerId || !targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromExile(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerExile.cardType,
      step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'exile',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourGraveyard) {
    const targetObjectId =
      boundTargetObjectId ||
      resolveUniqueChosenGraveyardTargetId(
        nextState,
        controllerId,
        parsedSingleTargetFromYourGraveyard,
        ctx,
        runtime,
        ctx.sourceName
      );
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourHand) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourHand.cardType,
      step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'hand',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourExile) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromExile(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourExile.cardType,
      step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'exile',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetCountFromGraveyard) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? returnExactMatchingFromGraveyardToHand(
            nextState,
            targetPlayerId,
            parsedTargetCountFromGraveyard.count,
            parsedTargetCountFromGraveyard.cardType
          )
        : step.to === 'battlefield'
          ? putExactMatchingFromGraveyardOntoBattlefieldWithController(
              nextState,
              targetPlayerId,
              step.battlefieldController?.kind === 'owner_of_moved_cards' ? targetPlayerId : controllerId,
              parsedTargetCountFromGraveyard.count,
              parsedTargetCountFromGraveyard.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            )
          : exileExactMatchingFromGraveyard(
              nextState,
              targetPlayerId,
              parsedTargetCountFromGraveyard.count,
              parsedTargetCountFromGraveyard.cardType
            );

    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            requiredCount: parsedTargetCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
            targetPlayerId,
          },
        },
      };
    }

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough matching cards): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            requiredCount: parsedTargetCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
            targetPlayerId,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerExile) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? moveAllMatchingFromExile(nextState, targetPlayerId, parsedTargetPlayerExile.cardType, 'hand')
        : step.to === 'graveyard'
          ? moveAllMatchingFromExile(nextState, targetPlayerId, parsedTargetPlayerExile.cardType, 'graveyard')
          : step.battlefieldController?.kind === 'owner_of_moved_cards'
            ? putAllMatchingFromExileOntoBattlefield(
                nextState,
                targetPlayerId,
                parsedTargetPlayerExile.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromExileOntoBattlefieldWithController(
                nextState,
                targetPlayerId,
                controllerId,
                parsedTargetPlayerExile.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              );
    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
              nextState,
              targetPlayerId,
              controllerId,
              parsedTargetPlayerHand.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            )
          : putAllMatchingFromHandOntoBattlefield(
              nextState,
              targetPlayerId,
              parsedTargetPlayerHand.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            )
        : moveAllMatchingFromHand(nextState, targetPlayerId, parsedTargetPlayerHand.cardType, step.to);
    return finalizeAppliedResult(result);
  }

  if (parsedCountFromGraveyard) {
    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result =
      step.to === 'hand'
        ? returnExactMatchingFromGraveyardToHand(
            nextState,
            controllerId,
            parsedCountFromGraveyard.count,
            parsedCountFromGraveyard.cardType
          )
        : step.to === 'battlefield'
          ? putExactMatchingFromGraveyardOntoBattlefieldWithController(
              nextState,
              controllerId,
              controllerId,
              parsedCountFromGraveyard.count,
              parsedCountFromGraveyard.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            )
          : exileExactMatchingFromGraveyard(
              nextState,
              controllerId,
              parsedCountFromGraveyard.count,
              parsedCountFromGraveyard.cardType
            );

    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            requiredCount: parsedCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough matching cards): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            requiredCount: parsedCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedEachOpponentsExile) {
    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'hand'
          ? moveAllMatchingFromExile(nextState, player.id, parsedEachOpponentsExile.cardType, 'hand')
          : step.to === 'graveyard'
            ? moveAllMatchingFromExile(nextState, player.id, parsedEachOpponentsExile.cardType, 'graveyard')
            : step.battlefieldController?.kind === 'owner_of_moved_cards'
              ? putAllMatchingFromExileOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachOpponentsExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromExileOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachOpponentsExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                );
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachOpponentsGy) {
    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'hand'
          ? returnAllMatchingFromGraveyardToHand(nextState, player.id, parsedEachOpponentsGy.cardType)
          : step.to === 'battlefield'
            ? step.battlefieldController?.kind === 'owner_of_moved_cards'
              ? putAllMatchingFromGraveyardOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachOpponentsGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachOpponentsGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
            : exileAllMatchingFromGraveyard(nextState, player.id, parsedEachOpponentsGy.cardType);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachOpponentsHand) {
    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
                nextState,
                player.id,
                controllerId,
                parsedEachOpponentsHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromHandOntoBattlefield(
                nextState,
                player.id,
                parsedEachOpponentsHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
          : moveAllMatchingFromHand(nextState, player.id, parsedEachOpponentsHand.cardType, step.to);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachPlayersGy) {
    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'hand'
          ? returnAllMatchingFromGraveyardToHand(nextState, player.id, parsedEachPlayersGy.cardType)
          : step.to === 'battlefield'
            ? step.battlefieldController?.kind === 'you'
              ? putAllMatchingFromGraveyardOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachPlayersGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromGraveyardOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachPlayersGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
            : exileAllMatchingFromGraveyard(nextState, player.id, parsedEachPlayersGy.cardType);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachPlayersExile) {
    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'hand'
          ? moveAllMatchingFromExile(nextState, player.id, parsedEachPlayersExile.cardType, 'hand')
          : step.to === 'graveyard'
            ? moveAllMatchingFromExile(nextState, player.id, parsedEachPlayersExile.cardType, 'graveyard')
            : step.battlefieldController?.kind === 'you'
              ? putAllMatchingFromExileOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachPlayersExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromExileOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachPlayersExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                );
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachPlayersHand) {
    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
                nextState,
                player.id,
                controllerId,
                parsedEachPlayersHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromHandOntoBattlefield(
                nextState,
                player.id,
                parsedEachPlayersHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
          : moveAllMatchingFromHand(nextState, player.id, parsedEachPlayersHand.cardType, step.to);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedFromGraveyard) {
    if (step.to === 'hand') {
      const result = returnAllMatchingFromGraveyardToHand(nextState, controllerId, parsedFromGraveyard.cardType);
      return finalizeAppliedResult(result);
    }

    if (step.to === 'exile') {
      const result = exileAllMatchingFromGraveyard(nextState, controllerId, parsedFromGraveyard.cardType);
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result = putAllMatchingFromGraveyardOntoBattlefield(
        nextState,
        controllerId,
        parsedFromGraveyard.cardType,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters
      );
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (parsedFromExile) {
    if (step.to === 'hand') {
      const result = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'hand');
      return finalizeAppliedResult(result);
    }

    if (step.to === 'graveyard') {
      const result = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'graveyard');
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result =
        step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromExileOntoBattlefieldWithController(
              nextState,
              controllerId,
              controllerId,
              parsedFromExile.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            )
          : putAllMatchingFromExileOntoBattlefield(
              nextState,
              controllerId,
              parsedFromExile.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            );
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  const result =
    step.to === 'battlefield'
      ? putAllMatchingFromHandOntoBattlefield(
          nextState,
          controllerId,
          parsedFromHand!.cardType,
          step.entersTapped,
          step.entersFaceDown,
          effectiveWithCounters
        )
      : moveAllMatchingFromHand(nextState, controllerId, parsedFromHand!.cardType, step.to);

  return finalizeAppliedResult(result);
}
