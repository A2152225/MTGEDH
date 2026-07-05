import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import type { GameContext } from '../context.js';
import type { OracleIRExecutionResult } from '../../../../rules-engine/src/oracleIRExecutor.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';

const EACH_PLAYER_COUNTER_PLACEMENT_PATTERN =
  /each player may put (?:two|\d+) \+1\/\+1 counters? on a creature (?:they|that player) controls?/i;

export function isEachPlayerMayPutCountersOnCreatureTheyControlStep(
  step: OracleEffectStep,
): boolean {
  if (step.kind !== 'add_counter') return false;
  const raw = String(step.raw || '').replace(/\u2019/g, "'").trim();
  return EACH_PLAYER_COUNTER_PLACEMENT_PATTERN.test(raw);
}

function resolveCounterPlacementConditionalText(
  triggerDescription: string,
  triggerItem: any,
  battlefield: readonly any[],
): string {
  const parts = [
    String(triggerDescription || ''),
    String(triggerItem?.effect || ''),
    String(triggerItem?.description || ''),
    String(triggerItem?.card?.oracle_text || ''),
  ];
  const sourceId = String(triggerItem?.permanentId || triggerItem?.source || triggerItem?.sourceId || '').trim();
  if (sourceId) {
    const sourcePerm = battlefield.find((perm: any) => String(perm?.id || '') === sourceId);
    if (sourcePerm?.card?.oracle_text) {
      parts.push(String(sourcePerm.card.oracle_text));
    }
  }
  return parts.join(' ').replace(/['']/g, "'").toLowerCase();
}

function resolveCounterPlacementEffectMetadata(
  triggerDescription: string,
  triggerItem: any,
  battlefield: readonly any[],
): {
  effectType: 'goad' | 'cant_attack' | 'none';
  conditionalEffect: { trigger: string; onAccept: string | null };
} {
  const conditionalText = resolveCounterPlacementConditionalText(
    triggerDescription,
    triggerItem,
    battlefield,
  );
  const effectType = conditionalText.includes('goad')
    ? 'goad'
    : (conditionalText.includes("can't attack") || conditionalText.includes('cannot attack'))
      ? 'cant_attack'
      : 'none';
  const counterOnAccept = effectType === 'goad'
    ? 'goad'
    : effectType === 'cant_attack'
      ? 'cant_attack_controller'
      : null;

  return {
    effectType,
    conditionalEffect: {
      trigger: 'counter_placement',
      onAccept: counterOnAccept,
    },
  };
}

function counterAmountLabel(amount: number): string {
  const words: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
  return words[amount] || String(amount);
}

export function queueEachPlayerCounterPlacementPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    triggerItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || params.triggerItem?.sourceId || params.triggerItem?.source || '').trim() || undefined;
  const players = Array.isArray(state?.players) ? state.players : [];
  if (players.length === 0) return;

  const candidateSteps: OracleEffectStep[] = [];
  for (const step of result.pendingOptionalSteps || []) {
    if (isEachPlayerMayPutCountersOnCreatureTheyControlStep(step)) {
      candidateSteps.push(step);
    }
  }
  const matchingGapReasons = new Set([
    'optional_step_requires_player_choice',
    'no_deterministic_target',
    'player_choice_required',
  ]);
  for (const gap of result.automationGaps || []) {
    if (!matchingGapReasons.has(String(gap.reasonCode || ''))) continue;
    if (String(gap.stepKind || '') !== 'add_counter') continue;
    const step = (result.skippedSteps || []).find(
      (candidate) =>
        candidate.kind === 'add_counter'
        && String((candidate as any).raw || '') === String(gap.raw || ''),
    );
    if (step && isEachPlayerMayPutCountersOnCreatureTheyControlStep(step)) {
      candidateSteps.push(step);
    }
  }

  const step = candidateSteps[0];
  if (!step || step.kind !== 'add_counter') return;

  const counterAmount = (step as any).amount?.kind === 'number'
    ? Math.max(1, Math.floor(Number((step as any).amount.value) || 2))
    : 2;
  const counterLabel = counterAmountLabel(counterAmount);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const { effectType, conditionalEffect } = resolveCounterPlacementEffectMetadata(
    String(step.raw || ''),
    params.triggerItem,
    battlefield,
  );
  const turnOrder = players.map((player: any) => player.id as PlayerID);
  const activePlayerId = String(state?.activePlayer || params.controller).trim() as PlayerID;

  const stepConfigs = players.map((player: any) => {
    const playerId = player.id as PlayerID;
    const playerCreatures = battlefield.filter((perm: any) => {
      if (perm.controller !== playerId) return false;
      return String(perm.card?.type_line || '').toLowerCase().includes('creature');
    });

    return {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: `${sourceName}: You may put ${counterLabel} +1/+1 counters on a creature you control`,
      mandatory: false,
      sourceId,
      sourceName,
      sourceImage: params.triggerItem?.card?.image_uris?.small,
      counterPlacementTrigger: true,
      sourceController: params.controller,
      effectType,
      conditionalEffect,
      triggerDescription: String(step.raw || ''),
      availableCreatures: playerCreatures.map((perm: any) => ({
        permanentId: perm.id,
        cardName: perm.card?.name || 'Creature',
        imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
      })),
      options: [
        { id: 'decline', label: 'Decline' },
        ...playerCreatures.map((perm: any) => ({
          id: perm.id,
          label: perm.card?.name || 'Creature',
        })),
      ],
      minSelections: 0,
      maxSelections: 1,
    };
  });

  ResolutionQueueManager.addStepsWithAPNAP(
    gameId,
    stepConfigs as any,
    turnOrder,
    activePlayerId,
  );
}
