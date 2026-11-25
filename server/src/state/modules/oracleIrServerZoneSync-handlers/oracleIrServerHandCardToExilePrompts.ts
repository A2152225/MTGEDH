// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerHandCardToExilePrompts.ts
// Bridges the Oracle IR "exile a card from your hand" step (Azor's Gateway: "Draw a card, then
// exile a card from your hand.") to an OPTION_CHOICE prompt. The executor skips that step as
// player_choice_required when the hand has multiple cards and none were pre-chosen; without a
// queued prompt the step was silently dropped (hand-unavailable) and all-or-nothing failed.
// Public entry symbols: isHandCardToExileChoiceStep,
//   queueHandCardToExileChoicePromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer. Pattern copied from oracleIrServerHandCardToLibraryPrompts.

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

/** True when this move_zone step is a mandatory "exile a card from your hand". */
export function isHandCardToExileChoiceStep(step: unknown): boolean {
  const moveStep = step as Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;
  if (!moveStep || moveStep.kind !== 'move_zone' || moveStep.to !== 'exile') return false;
  const raw = String((moveStep as any).raw || '').trim();
  if ((moveStep as any).optional === true || /^(?:then\s+)?you may\b/i.test(raw)) return false;
  const whatText = String((moveStep.what as any)?.text || (moveStep.what as any)?.raw || '').trim();
  return SINGLE_CARD_FROM_YOUR_HAND.test(whatText);
}

function readControllerHand(state: any, controller: string): any[] {
  const zoneHand = state?.zones?.[controller]?.hand;
  if (Array.isArray(zoneHand) && zoneHand.length > 0) return zoneHand;
  const player = (Array.isArray(state?.players) ? state.players : [])
    .find((entry: any) => String(entry?.id || '') === controller);
  return Array.isArray(player?.hand) ? player.hand : [];
}

export function queueHandCardToExileChoicePromptsFromOracleIRResult(
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
    if (!isHandCardToExileChoiceStep(step)) continue;
    const raw = String((step as any).raw || '');
    const isChoiceGap = (result.automationGaps || []).some((gap) =>
      String(gap.stepKind || '') === 'move_zone'
      && String(gap.raw || '') === raw
      && isOracleIrPlayerChoiceGap(gap));
    if (!isChoiceGap) continue;
    if (queuedKeys.has(raw)) continue;
    queuedKeys.add(raw);

    const hand = readControllerHand(state, controller);
    if (hand.length === 0) continue;
    const cardOptions = hand.map((card: any) => ({
      id: String(card?.id || ''),
      label: String(card?.name || 'Card'),
      description: String(card?.type_line || ''),
    })).filter((option) => Boolean(option.id));
    if (cardOptions.length === 0) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: controller as PlayerID,
      description: `${sourceName}: Choose a card from your hand to exile.`,
      mandatory: true,
      sourceId,
      sourceName,
      options: cardOptions,
      minSelections: 1,
      maxSelections: 1,
      moveChosenHandCardToExileChoice: true,
      moveChosenHandCardToExileController: controller,
      moveChosenHandCardToExileSourceName: sourceName,
      moveChosenHandCardToExileSourceId: sourceId,
    } as Record<string, unknown>, result, { ...params, sourceName, sourceId }) as any);
  }
}
