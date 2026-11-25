// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerHandCardToLibraryPrompts.ts
// Bridges the Oracle IR "put a card from your hand on the top/bottom of your library" step
// (Jace, Multiverse Architect +1: "Draw two cards, then put a card from your hand on the bottom of
// your library.") to the existing moveChosenHandCardToLibraryChoice OPTION_CHOICE prompt.
// The executor skips that step as player_choice_required when no card was chosen; without a queued
// prompt the step was silently dropped and the all-or-nothing fallback re-ran the draw.
// Public entry symbols: readHandCardToLibraryPlacement, isHandCardToLibraryChoiceStep,
//   queueHandCardToLibraryChoicePromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { attachOracleIrResumeMetadata, isOracleIrPlayerChoiceGap } from '../oracleIrServerPromptResumeUtils.js';

const SINGLE_CARD_FROM_YOUR_HAND = /^(?:a|an|one) card from your hand$/i;
const N_CARDS_FROM_YOUR_HAND =
  /^(two|three|four|five|six|seven|eight|nine|ten|\d+) cards? from your hand$/i;
const ANY_NUMBER_FROM_YOUR_HAND = /^any number of cards from your hand$/i;

const COUNT_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Option id for "put none of them" on an any-number hand-to-library choice. */
export const PUT_NO_HAND_CARDS_OPTION_ID = '__put_no_cards__';

function parseHandCardCountWord(raw: string): number | null {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(COUNT_WORDS, key)) return COUNT_WORDS[key];
  const n = Number(key);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Fixed card count for "put N cards from your hand…" (1 for a/an/one); null if not that shape. */
export function readHandCardToLibraryCount(step: unknown): number | null {
  const moveStep = step as Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;
  if (!moveStep || moveStep.kind !== 'move_zone' || moveStep.to !== 'library') return null;
  const whatText = String((moveStep.what as any)?.text || (moveStep.what as any)?.raw || '').trim();
  if (SINGLE_CARD_FROM_YOUR_HAND.test(whatText)) return 1;
  const nMatch = whatText.match(N_CARDS_FROM_YOUR_HAND);
  if (nMatch) return parseHandCardCountWord(String(nMatch[1] || ''));
  return null;
}

/** "top" / "bottom" for a mandatory hand-to-library move step, otherwise null. */
export function readHandCardToLibraryPlacement(step: unknown): 'top' | 'bottom' | null {
  const moveStep = step as Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;
  if (!moveStep || moveStep.kind !== 'move_zone' || moveStep.to !== 'library') return null;
  const raw = String((moveStep as any).raw || '').trim();
  if ((moveStep as any).optional === true || /^(?:then\s+)?you may\b/i.test(raw)) return null;
  const whatText = String((moveStep.what as any)?.text || (moveStep.what as any)?.raw || '').trim();
  const anyNumber = ANY_NUMBER_FROM_YOUR_HAND.test(whatText);
  const fixedCount = readHandCardToLibraryCount(step);
  if (!anyNumber && (fixedCount === null || fixedCount < 1)) return null;
  // "Shuffle any number of cards from your hand into your library" is not an ordered bottom/top put.
  if (anyNumber && /\bshuffles?\b/i.test(raw)) return null;
  const toRaw = String((moveStep as any).toRaw || '').toLowerCase();
  if (/\bbottom\b/.test(toRaw)) return 'bottom';
  if (/\btop\b/.test(toRaw)) return 'top';
  return null;
}

export function isHandCardToLibraryChoiceStep(step: unknown): boolean {
  return readHandCardToLibraryPlacement(step) !== null;
}

export function isAnyNumberHandCardToLibraryStep(step: unknown): boolean {
  if (readHandCardToLibraryPlacement(step) === null) return false;
  const moveStep = step as Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;
  const whatText = String((moveStep?.what as any)?.text || (moveStep?.what as any)?.raw || '').trim();
  return ANY_NUMBER_FROM_YOUR_HAND.test(whatText);
}

function readControllerHand(state: any, controller: string): any[] {
  const zoneHand = state?.zones?.[controller]?.hand;
  if (Array.isArray(zoneHand)) return zoneHand;
  const player = (Array.isArray(state?.players) ? state.players : [])
    .find((entry: any) => String(entry?.id || '') === controller);
  return Array.isArray(player?.hand) ? player.hand : [];
}

export function queueHandCardToLibraryChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const controller = String(params.controller || '').trim();
  if (!controller) return;
  const queuedKeys = new Set<string>();

  for (const step of result.skippedSteps || []) {
    const placement = readHandCardToLibraryPlacement(step);
    if (!placement) continue;
    const raw = String((step as any).raw || '');
    const isChoiceGap = (result.automationGaps || []).some((gap) =>
      String(gap.stepKind || '') === 'move_zone'
      && String(gap.raw || '') === raw
      && isOracleIrPlayerChoiceGap(gap));
    if (!isChoiceGap) continue;
    const queueKey = `${placement}:${raw}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const hand = readControllerHand(state, controller);
    if (hand.length === 0) continue;
    const anyNumber = isAnyNumberHandCardToLibraryStep(step);
    const fixedCount = readHandCardToLibraryCount(step) ?? 1;
    const requiredCount = anyNumber ? null : Math.max(1, fixedCount);
    if (requiredCount !== null && hand.length < requiredCount) continue;
    const cardOptions = hand.map((card: any) => ({
      id: String(card?.id || ''),
      label: String(card?.name || 'Card'),
      description: String(card?.type_line || ''),
    }));
    const multiSelect = anyNumber || (requiredCount !== null && requiredCount > 1);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: controller as PlayerID,
      description: anyNumber
        ? `${sourceName}: Choose any number of cards from your hand to put on the ${placement} of your library, in order. The last card you choose is the ${placement} card. Choose "Put no cards" to leave your hand as it is.`
        : requiredCount === 1
          ? `${sourceName}: Choose a card from your hand to put on the ${placement} of your library.`
          : `${sourceName}: Choose ${requiredCount} cards from your hand to put on the ${placement} of your library, in any order.`,
      mandatory: true,
      sourceId,
      sourceName,
      options: anyNumber
        ? [...cardOptions, { id: PUT_NO_HAND_CARDS_OPTION_ID, label: 'Put no cards', description: 'Leave your hand unchanged.' }]
        : cardOptions,
      minSelections: anyNumber ? 1 : (requiredCount as number),
      maxSelections: anyNumber ? Math.max(1, cardOptions.length) : (requiredCount as number),
      moveChosenHandCardToLibraryChoice: true,
      moveChosenHandCardToLibraryAnyNumber: anyNumber,
      moveChosenHandCardToLibraryMultiSelect: multiSelect,
      moveChosenHandCardToLibraryRequiredCount: requiredCount ?? undefined,
      moveChosenHandCardToLibraryController: controller,
      moveChosenHandCardToLibrarySourceName: sourceName,
      moveChosenHandCardToLibrarySourceId: sourceId,
      moveChosenHandCardToLibraryPosition: placement,
    } as Record<string, unknown>, result, { ...params, sourceName, sourceId }) as any);
  }
}