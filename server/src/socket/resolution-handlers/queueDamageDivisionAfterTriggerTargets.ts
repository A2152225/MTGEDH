/**
 * socket/resolution-handlers/queueDamageDivisionAfterTriggerTargets.ts
 *
 * After a triggered ability's targets are chosen, queue DAMAGE_DIVISION when the
 * effect deals damage divided as you choose among two or more targets and the
 * total is known (including "equal to its power" once the source is on the
 * battlefield). Auto-stamps even or already-valid splits onto the stack item.
 */

import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import {
  describeDamageDivisionTargets,
  normalizeDamageDivisionTargetIds,
  shouldPromptDamageDivision,
  stampDamageDivisionOnHost,
} from "../../state/modules/dividedDamageDivision.js";

export function maybeQueueDamageDivisionAfterTriggerTargets(args: {
  readonly game: any;
  readonly gameId: string;
  readonly playerId: string;
  readonly triggerItem: any;
  readonly triggerStackItemId?: string;
  readonly sourceName?: string;
  readonly description?: string;
  readonly controller?: string;
  readonly sourceImage?: unknown;
  readonly skipInteractivePrompts?: boolean;
}): boolean {
  const { game, gameId, playerId: pid, triggerItem } = args;
  if (!triggerItem || typeof triggerItem !== 'object') return false;

  const stackItemId = String(args.triggerStackItemId || triggerItem.id || '').trim();
  const stackItem = stackItemId && Array.isArray(game.state?.stack)
    ? game.state.stack.find((item: any) => item && String(item.id || '') === stackItemId)
    : undefined;
  const host = stackItem || triggerItem;
  const targetIds = normalizeDamageDivisionTargetIds(triggerItem.targets || host?.targets);
  const oracleText = String(
    triggerItem.effect
    || triggerItem.description
    || args.description
    || host?.effect
    || host?.description
    || triggerItem.card?.oracle_text
    || '',
  );
  const sourceId = String(
    triggerItem.permanentId
    || triggerItem.source
    || host?.permanentId
    || host?.source
    || '',
  ).trim();
  const decision = shouldPromptDamageDivision({
    oracleText,
    targetIds,
    xValue: triggerItem.xValue ?? host?.xValue,
    existingDivision: host?.damageDivisionByTargetId || triggerItem.damageDivisionByTargetId,
    skipInteractivePrompts: args.skipInteractivePrompts === true,
    gameOrState: game,
    sourceId,
    sourcePermanent: Array.isArray(game.state?.battlefield)
      ? game.state.battlefield.find((entry: any) => String(entry?.id || '').trim() === sourceId)
      : undefined,
  });

  if (decision.autoDivision) {
    stampDamageDivisionOnHost(host, decision.autoDivision);
    if (host !== triggerItem) stampDamageDivisionOnHost(triggerItem, decision.autoDivision);
  }

  if (!decision.prompt || decision.total === null) {
    return false;
  }

  const existingStep = ResolutionQueueManager
    .getStepsForPlayer(gameId, pid as any)
    .find((step: any) =>
      step?.type === ResolutionStepType.DAMAGE_DIVISION
      && String((step as any)?.triggerStackItemId || '') === stackItemId,
    );
  if (existingStep) return true;

  const sourceName = String(args.sourceName || triggerItem.sourceName || host?.sourceName || 'Triggered ability');
  const total = decision.total;
  const validTargets = describeDamageDivisionTargets(game, targetIds);

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.DAMAGE_DIVISION,
    playerId: pid as any,
    sourceId: stackItemId || sourceId,
    sourceName,
    sourceImage: args.sourceImage,
    description: `Divide ${total} damage among the chosen targets for ${sourceName}.`,
    mandatory: true,
    totalAmount: total,
    minPerTarget: 1,
    validTargets,
    message: `Divide ${total} damage among the chosen targets. Each target must receive at least 1 damage.`,
    title: `Divide damage — ${sourceName}`,
    triggerStackItemId: stackItemId,
    targetedTriggeredAbility: true,
    triggerItem: {
      ...triggerItem,
      targets: targetIds,
    },
    targetedTriggeredAbilitySourceName: sourceName,
    targetedTriggeredAbilityDescription: String(args.description || triggerItem.description || ''),
    targetedTriggeredAbilityController: String(args.controller || triggerItem.controller || pid),
  } as any);

  debug(2, `[Resolution] Queued DAMAGE_DIVISION for trigger ${sourceName} (${total} among ${targetIds.length} targets)`);
  return true;
}
