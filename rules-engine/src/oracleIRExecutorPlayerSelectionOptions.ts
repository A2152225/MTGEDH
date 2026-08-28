// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: buildSearchLibrarySelectionOptions, move-zone selection helpers,
// buildMoveZoneSelectionOptions, buildPlayerChoiceAmongThemSelectionOptions,
// getChosenObjectIds.
// Public entries: buildSearchLibrarySelectionOptions, buildMoveZoneSelectionOptions,
// buildPlayerChoiceAmongThemSelectionOptions, getChosenObjectIds.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolvePlayerLibraryCardsForSearch } from './oracleIRExecutorLibrarySearchCardUtils';
import {
  collectRevealedThisWayCardsLedgerFirst,
  resolveAntecedentContextualCards,
  resolveAntecedentMilledCards,
} from './oracleIRLedgerCardAccess';
import {
  buildLookChooseLibrarySearchFilter,
  parseLookChooseSelectionLimits,
} from './oracleIRExecutorPlayerLookChooseLimits';
import { cardMatchesLookChooseSelector } from './oracleIRExecutorPlayerLookChooseSelector';
import {
  getSearchLibraryMatches,
  isOptionalSearchLibraryStep,
  resolveSearchLibraryMaxResults,
} from './oracleIRExecutorPlayerSearchLibraryMatches';
import { normalizeOracleText, resolvePlayers } from './oracleIRExecutorPlayerUtils';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  cardMatchesType,
  parseMoveZoneAnyNumberCardsFromYourHand,
  parseMoveZoneAnyNumberTypedFromYourHand,
  parseMoveZoneSingleTargetCriteria,
  parseMoveZoneTypedCardFromYourHand,
  parseMoveZoneUpToTargetCountFromYourHand,
} from './oracleIRExecutorZoneOps';

export function buildSearchLibrarySelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'search_library' }>,
  ctx: OracleIRExecutionContext,
): {
  playerId: PlayerID;
  matches: any[];
  maxResults: number;
  minSelections: number;
  maxSelections: number;
  destination: string;
} | null {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) return null;

  const playerId = players[0];
  const player = state.players.find((entry) => entry.id === playerId) as any;
  if (!player) return null;

  const library = resolvePlayerLibraryCardsForSearch(state, playerId, player);
  const matches = getSearchLibraryMatches(library, step, state, ctx);
  if (!matches || matches.length === 0) return null;

  const isAnyNumber = step.maxResults === 'any_number';
  const maxResults = isAnyNumber
    ? matches.length
    : resolveSearchLibraryMaxResults(state, step, ctx);
  const isOptional = isOptionalSearchLibraryStep(step);
  // Always surface a LIBRARY_SEARCH choice for mandatory tutors — even when only one
  // card matches — so server queue bridges (Celestial X-search, etc.) stay on the IR path
  // instead of auto-applying and skipping the resolution UI.

  return {
    playerId,
    matches,
    maxResults,
    minSelections: isOptional || isAnyNumber ? 0 : 1,
    maxSelections: isAnyNumber ? matches.length : (isOptional ? Math.min(maxResults, matches.length) : maxResults),
    destination: String(step.destination || 'hand'),
  };
}

function resolveMoveZoneSelectionPool(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
  playerId: PlayerID,
): any[] {
  const whatText = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
  const raw = String(step.raw || '').trim();
  const combined = `${whatText} ${raw}`.toLowerCase();
  const player = state.players.find((entry) => entry.id === playerId) as any;

  if (/milled this way|among the cards milled/i.test(combined)) {
    return [...(resolveAntecedentMilledCards(ctx) as any[])];
  }
  if (/this card/i.test(whatText) && /graveyard/i.test(combined)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    return graveyard.filter((card: any) => String(card?.id || '').trim() === sourceId);
  }
  if (/from your graveyard|from the graveyard/i.test(combined)) {
    return Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
  }
  if (/from your hand/i.test(combined) && !/from among them/i.test(combined)) {
    return Array.isArray(player?.hand) ? [...player.hand] : [];
  }
  if (/\bgraveyard\b/i.test(combined) && !/to your hand|into your hand|onto the battlefield/i.test(combined)) {
    return Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
  }
  if (
    /from among|among them|those cards|those creature cards|one of those cards|the rest/i.test(combined)
  ) {
    const contextual = resolveAntecedentContextualCards(ctx) as any[];
    if (contextual.length > 0) return [...contextual];
    return [...(collectRevealedThisWayCardsLedgerFirst(ctx, step) as any[])];
  }
  if (/from your hand/i.test(combined)) {
    return Array.isArray(player?.hand) ? [...player.hand] : [];
  }
  return [];
}

function normalizeMoveZoneWhatCriteriaText(whatText: string): string {
  return normalizeOracleText(
    String(whatText || '')
      .replace(/\s+from your graveyard$/i, '')
      .replace(/\s+from among the cards milled this way$/i, '')
      .replace(/^those creature cards$/i, 'creature cards')
      .replace(/^those cards$/i, 'cards')
      .replace(/^one of those cards$/i, 'a card')
      .replace(/^a permanent card from among the cards milled this way$/i, 'a permanent card')
      .replace(/^a permanent card from your hand$/i, 'a permanent card'),
  );
}

function filterMoveZoneSelectionCandidates(
  pool: readonly any[],
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx?: OracleIRExecutionContext,
): any[] {
  const whatText = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
  const raw = String(step.raw || '').trim();
  const combined = `${whatText} ${raw}`.toLowerCase();

  if (/^the rest/i.test(whatText)) {
    return [];
  }

  const anyNumberTypedFromHand = parseMoveZoneAnyNumberTypedFromYourHand({ kind: 'raw', text: whatText });
  if (anyNumberTypedFromHand) {
    return pool.filter((card) => cardMatchesType(card, anyNumberTypedFromHand.cardType));
  }
  const anyNumberCardsFromHand = parseMoveZoneAnyNumberCardsFromYourHand({ kind: 'raw', text: whatText });
  if (anyNumberCardsFromHand) {
    return pool.filter((card) => cardMatchesType(card, anyNumberCardsFromHand.cardType));
  }
  const upToFromHand = parseMoveZoneUpToTargetCountFromYourHand({ kind: 'raw', text: whatText });
  if (upToFromHand) {
    return pool.filter((card) => cardMatchesMoveZoneSingleTargetCriteria(card, upToFromHand.criteria));
  }

  const typedFromHand = parseMoveZoneTypedCardFromYourHand({ kind: 'raw', text: whatText });
  if (typedFromHand) {
    let resolvedCriteria = typedFromHand;
    if (resolvedCriteria.usesChosenCreatureType) {
      const chosenType = String(ctx?.selectorContext?.chosenCreatureType || '').trim();
      if (chosenType) {
        resolvedCriteria = { ...resolvedCriteria, creatureTypesAnyOf: [chosenType] };
      }
    }
    return pool.filter((card) => cardMatchesMoveZoneSingleTargetCriteria(card, resolvedCriteria));
  }

  const normalizedCriteria = normalizeMoveZoneWhatCriteriaText(whatText);
  const structured = parseMoveZoneSingleTargetCriteria(
    normalizedCriteria.replace(/^(?:a|an)\s+/i, ''),
  );
  if (structured) {
    let resolvedCriteria = structured;
    if (resolvedCriteria.usesChosenCreatureType) {
      const chosenType = String(ctx?.selectorContext?.chosenCreatureType || '').trim();
      if (chosenType) {
        resolvedCriteria = { ...resolvedCriteria, creatureTypesAnyOf: [chosenType] };
      }
    }
    return pool.filter((card) => cardMatchesMoveZoneSingleTargetCriteria(card, resolvedCriteria));
  }
  const articleCriteria = normalizedCriteria.match(/^(?:a|an)\s+(.+)$/i);
  if (articleCriteria) {
    const articleLabel = String(articleCriteria[1] || '')
      .replace(/\s+from your graveyard$/i, '')
      .replace(/\s+from among the cards milled this way$/i, '')
      .trim();
    const articleFiltered = pool.filter((card) => cardMatchesLookChooseSelector(card, articleLabel));
    if (articleFiltered.length > 0) return articleFiltered;
  }
  if (/creature card and\/or a land card|creature cards|permanent card|one of those cards/i.test(combined)) {
    const selectorText = whatText
      .replace(/^those creature cards$/i, 'creature cards')
      .replace(/^one of those cards$/i, 'a card')
      .replace(/^a permanent card/i, 'permanent card');
    return pool.filter((card) => cardMatchesLookChooseSelector(card, selectorText));
  }
  return [...pool];
}

function resolveMoveZoneSelectionLimits(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  candidateCount: number,
): { readonly minSelections: number; readonly maxSelections: number } {
  const rawWhat = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
  const whatText = normalizeMoveZoneWhatCriteriaText(rawWhat);
  const optional = step.optional === true || /^you may\b/i.test(String(step.raw || ''));
  if (/^the rest/i.test(whatText)) {
    return { minSelections: 0, maxSelections: 0 };
  }
  if (/^any number of /i.test(rawWhat) || /^any number of /i.test(whatText)) {
    return { minSelections: 0, maxSelections: candidateCount };
  }
  const upToFromHand = parseMoveZoneUpToTargetCountFromYourHand({ kind: 'raw', text: rawWhat });
  if (upToFromHand && !upToFromHand.useXValue && !upToFromHand.useReferenceAmount) {
    return { minSelections: 0, maxSelections: Math.min(upToFromHand.maxCount, candidateCount) };
  }
  if (/^those cards$|^those creature cards$/i.test(whatText)) {
    return {
      minSelections: optional ? 0 : Math.min(1, candidateCount),
      maxSelections: Math.max(optional ? 0 : 1, candidateCount),
    };
  }
  if (/^one of those cards$/i.test(whatText) || /^a .+ card$/i.test(whatText) || /^up to one/i.test(whatText)) {
    return { minSelections: optional ? 0 : Math.min(1, candidateCount), maxSelections: Math.min(1, candidateCount) };
  }
  return {
    minSelections: optional ? 0 : Math.min(1, candidateCount),
    maxSelections: Math.max(optional ? 0 : 1, candidateCount),
  };
}

export function buildMoveZoneSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
): {
  readonly playerId: PlayerID;
  readonly availableCards: readonly any[];
  readonly selectableCardIds: readonly string[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly destination: string;
  readonly shuffleAfter: boolean;
  readonly remainderDestination: 'bottom' | 'graveyard' | 'shuffle' | 'top' | 'none';
  readonly remainderRandomOrder: boolean;
  readonly remainderPlayerChoosesOrder: boolean;
  readonly filter: ReturnType<typeof buildLookChooseLibrarySearchFilter>;
  readonly optional: boolean;
  readonly searchZone: 'hand' | 'graveyard' | 'library';
} | null {
  const players = resolvePlayers(state, (step as any).who || { kind: 'you' }, ctx);
  const playerId = (players[0] || ctx.controllerId) as PlayerID;
  const pool = resolveMoveZoneSelectionPool(state, step, ctx, playerId);
  if (pool.length === 0) return null;

  const candidates = filterMoveZoneSelectionCandidates(pool, step, ctx);
  const optional = step.optional === true || /^you may\b/i.test(String(step.raw || ''));
  if (candidates.length === 0 && !optional) return null;

  const limits = resolveMoveZoneSelectionLimits(step, candidates.length);
  if (limits.maxSelections <= 0 && !optional) return null;

  const whatText = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
  const toRaw = String(step.toRaw || step.raw || '').toLowerCase();
  const fromHand = /from your hand/i.test(`${whatText} ${String(step.raw || '')}`);
  const fromGraveyard = /from your graveyard|from a graveyard|from graveyards/i.test(`${whatText} ${String(step.raw || '')}`);
  const destination =
    step.to === 'battlefield'
      ? 'battlefield'
      : step.to === 'graveyard'
        ? 'graveyard'
        : step.to === 'exile'
          ? 'exile'
          : step.to === 'library' && /shuffle/i.test(toRaw)
            ? 'shuffle'
            : 'hand';
  const remainderDestination: 'bottom' | 'graveyard' | 'shuffle' | 'top' | 'none' =
    /shuffle.*(rest|revealed)/i.test(toRaw)
      ? 'shuffle'
      : /bottom/i.test(toRaw)
        ? 'bottom'
        : fromHand
          ? 'none'
          : 'bottom';

  return {
    playerId,
    availableCards: (fromHand || fromGraveyard) && candidates.length > 0 ? candidates : pool,
    selectableCardIds: candidates
      .map((card) => String(card?.id || '').trim())
      .filter(Boolean),
    minSelections: limits.minSelections,
    maxSelections: limits.maxSelections,
    destination,
    shuffleAfter: destination === 'shuffle',
    remainderDestination,
    remainderRandomOrder: /random order/i.test(toRaw),
    remainderPlayerChoosesOrder: /any order/i.test(toRaw),
    filter: buildLookChooseLibrarySearchFilter(whatText),
    optional,
    searchZone: fromHand ? 'hand' : fromGraveyard ? 'graveyard' : 'library',
  };
}

export function buildPlayerChoiceAmongThemSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'player_choice' }>,
  ctx: OracleIRExecutionContext,
): {
  readonly playerId: PlayerID;
  readonly availableCards: readonly any[];
  readonly selectableCardIds: readonly string[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly filter: ReturnType<typeof buildLookChooseLibrarySearchFilter>;
} | null {
  const raw = String(step.raw || '').trim();
  if (!/\bfrom among them\b/i.test(raw)) return null;

  const pool = resolveAntecedentContextualCards(ctx) as any[];
  if (pool.length === 0) return null;

  const selectorMatch = raw.match(/^choose\s+(.+?)\s+from among them\.?$/i);
  const selectorText = String(selectorMatch?.[1] || 'a card').trim();
  const selectable = pool.filter((card) => cardMatchesLookChooseSelector(card, selectorText));
  if (selectable.length === 0) return null;

  const limits = parseLookChooseSelectionLimits(selectorText, step.optional === true);
  return {
    playerId: ctx.controllerId as PlayerID,
    availableCards: pool,
    selectableCardIds: selectable.map((card) => String(card?.id || '').trim()).filter(Boolean),
    minSelections: limits.minSelections,
    maxSelections: Math.min(limits.maxSelections, selectable.length),
    filter: buildLookChooseLibrarySearchFilter(selectorText),
  };
}

export function getChosenObjectIds(ctx: OracleIRExecutionContext): readonly string[] {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const direct = [ctx.targetCreatureId, ctx.targetPermanentId];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...chosen, ...direct]) {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

