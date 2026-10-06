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

/** "top" / "bottom" for a mandatory single-card hand-to-library move step, otherwise null. */
export function readHandCardToLibraryPlacement(step: unknown): 'top' | 'bottom' | null {
  const moveStep = step as Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;
  if (!moveStep || moveStep.kind !== 'move_zone' || moveStep.to !== 'library') return null;
  const raw = String((moveStep as any).raw || '').trim();
  if ((moveStep as any).optional === true || /^(?:then\s+)?you may\b/i.test(raw)) return null;
  const whatText = String((moveStep.what as any)?.text || (moveStep.what as any)?.raw || '').trim();
  if (!SINGLE_CARD_FROM_YOUR_HAND.test(whatText)) return null;
  const toRaw = String((moveStep as any).toRaw || '').toLowerCase();
  if (/\bbottom\b/.test(toRaw)) return 'bottom';
  if (/\btop\b/.test(toRaw)) return 'top';
  return null;
}

export function isHandCardToLibraryChoiceStep(step: unknown): boolean {
  return readHandCardToLibraryPlacement(step) !== null;
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

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: controller as PlayerID,
      description: `${sourceName}: Choose a card from your hand to put on the ${placement} of your library.`,
      mandatory: true,
      sourceId,
      sourceName,
      options: hand.map((card: any) => ({
        id: String(card?.id || ''),
        label: String(card?.name || 'Card'),
        description: String(card?.type_line || ''),
      })),
      minSelections: 1,
      maxSelections: 1,
      moveChosenHandCardToLibraryChoice: true,
      moveChosenHandCardToLibraryController: controller,
      moveChosenHandCardToLibrarySourceName: sourceName,
      moveChosenHandCardToLibrarySourceId: sourceId,
      moveChosenHandCardToLibraryPosition: placement,
    } as Record<string, unknown>, result, { ...params, sourceName, sourceId }) as any);
  }
}