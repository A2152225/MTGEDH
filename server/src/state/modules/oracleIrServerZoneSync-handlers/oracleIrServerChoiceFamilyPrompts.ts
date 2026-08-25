// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerChoiceFamilyPrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster: queue existing Divine Reckoning / Prisoner's Dilemma / mill-from-among
//   may-cast / may-reveal four-zone named-copy-win resolution steps from
//   Oracle IR player-choice gaps.
// Public: queueChoiceFamilyPromptsFromOracleIRResult
// Called from applyOracleIRStepsOnServer; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';
import {
  applyInstantSorcerySpecialCaseSpellEffects,
} from '../stackResolveSpellSpecialCaseUtils.js';
import {
  queueMayCastFromAmongMilledCards,
} from '../oracleIrSpellLegacySummonsUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
} from '../oracleIrServerPromptResumeUtils.js';

function resolveMaxManaValue(amount: OracleQuantity | undefined, irCtx?: OracleIRExecutionContext): number {
  if (!amount) return Number.NaN;
  if (amount.kind === 'number') return Number(amount.value);
  if (amount.kind === 'x') {
    const xValue = Number(irCtx?.xValue);
    return Number.isFinite(xValue) ? xValue : Number.NaN;
  }
  return Number.NaN;
}

export function queueChoiceFamilyPromptsFromOracleIRResult(
  ctx: GameContext,
  _state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx?: OracleIRExecutionContext;
    card?: any;
    effectiveCard?: any;
    item?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'spell').trim() || 'spell';
  const sourceId = String(params.sourceId || '').trim();
  const queuedKinds = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    const stepKind = String(gap.stepKind || '');
    if (
      stepKind !== 'each_player_choose_then_destroy_rest'
      && stepKind !== 'secret_opponent_choice_damage'
      && stepKind !== 'may_cast_from_among'
      && stepKind !== 'may_reveal_hand_then_win_if_own_named_in_zones'
    ) {
      continue;
    }
    if (queuedKinds.has(stepKind)) continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step) continue;
    queuedKinds.add(stepKind);

    if (step.kind === 'each_player_choose_then_destroy_rest' || step.kind === 'secret_opponent_choice_damage') {
      applyInstantSorcerySpecialCaseSpellEffects(ctx, {
        controller: params.controller,
        card: params.card || { id: sourceId, name: sourceName },
        effectiveCard: params.effectiveCard || { name: sourceName },
        item: params.item || { id: sourceId, source: sourceId },
        gameId,
        spellXValue: params.irCtx?.xValue,
        isRiteOfHarmonyStyleWindow: false,
        isDivineReckoningStyleChoice: step.kind === 'each_player_choose_then_destroy_rest',
        isPrisonersDilemmaStyleChoice: step.kind === 'secret_opponent_choice_damage',
        isSummonsOfSarumanStyle: false,
        fromOracleIrPromptQueue: true,
      });
      continue;
    }

    if (step.kind === 'may_cast_from_among') {
      const milledCards = Array.isArray((result as any).lastMilledCards)
        ? (result as any).lastMilledCards
        : Array.isArray(params.irCtx?.lastMilledCards)
          ? params.irCtx.lastMilledCards
          : [];
      const maxManaValue = resolveMaxManaValue((step as any).maxManaValue, params.irCtx);
      queueMayCastFromAmongMilledCards(ctx, {
        controller: params.controller,
        sourceName,
        sourceId,
        sourceImage: params.effectiveCard?.image_uris?.small || params.effectiveCard?.image_uris?.normal,
        milledCards,
        cardTypes: Array.isArray((step as any).cardTypes) ? (step as any).cardTypes : ['instant', 'sorcery'],
        maxManaValue: Number.isFinite(maxManaValue) ? maxManaValue : 0,
      });
      continue;
    }

    if (step.kind === 'may_reveal_hand_then_win_if_own_named_in_zones') {
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: params.controller,
        description: `${sourceName}: You may reveal your hand. If you do, you win the game if you own a card named ${sourceName} in exile, in your hand, in your graveyard, and on the battlefield.`,
        mandatory: true,
        sourceId: sourceId || undefined,
        sourceName,
        options: [
          { id: 'reveal', label: 'Reveal hand', description: 'Reveal your hand' },
          { id: 'decline', label: 'Decline', description: 'Decline to reveal your hand' },
        ],
        minSelections: 1,
        maxSelections: 1,
        mayRevealHandWinIfOwnNamedChoice: true,
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId || undefined,
        oracleIrSourceName: sourceName,
      } as any, result, params) as any);
    }
  }
}
