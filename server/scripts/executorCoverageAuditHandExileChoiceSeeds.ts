/**
 * Dry-run choice binding for "<player> exiles N cards from their hand" (discard steps with destination
 * 'exile', e.g. Witness the End). The executor rightly waits on the affected player's choice when their hand
 * holds more than N cards (rules-engine oracleIRExecutorExileFromHandChoice.ts); the audit plays that player
 * and binds the first N cards of each affected hand, as it pre-binds other player choices.
 * Origin parent: executorCoverageAuditFixtureSeeds.ts enrichExecutorCoverageGapFixtureSeeds.
 * Public: bindAuditHandExileChoices.
 */
import type { GameState, PlayerID } from '../../shared/src/index.js';
import type { OracleEffectStep } from '../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutionTypes.js';
import { resolvePlayers } from '../../rules-engine/src/oracleIRExecutorPlayerResolvePlayers.js';
import { resolveStepAmountForPlayer } from '../../rules-engine/src/oracleIRExecutorPlayerStepShared.js';
import { readPlayerZoneCards } from '../../rules-engine/src/oracleIRExecutorPlayerZoneAccess.js';

type DiscardStep = Extract<OracleEffectStep, { kind: 'discard' }>;

function collectHandExileSteps(steps: readonly OracleEffectStep[], out: DiscardStep[]): DiscardStep[] {
  for (const step of steps) {
    if (step.kind === 'discard' && (step as { destination?: unknown }).destination === 'exile') out.push(step);
    for (const key of ['steps', 'elseSteps'] as const) {
      const nested = (step as { [k in typeof key]?: unknown })[key];
      if (Array.isArray(nested)) collectHandExileSteps(nested as readonly OracleEffectStep[], out);
    }
  }
  return out;
}

export function bindAuditHandExileChoices(
  steps: readonly OracleEffectStep[],
  state: GameState,
  ctx: OracleIRExecutionContext,
): OracleIRExecutionContext {
  const handExileSteps = collectHandExileSteps(steps, []);
  if (handExileSteps.length === 0) return ctx;

  const controllerId = String(ctx.controllerId || '').trim() as PlayerID;
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? [...ctx.selectorContext.chosenObjectIds] : [];
  for (const step of handExileSteps) {
    for (const playerId of resolvePlayers(state, step.who, ctx)) {
      const player = (state.players || []).find((entry) => entry?.id === playerId);
      const amount = resolveStepAmountForPlayer(state, controllerId, step.amount, ctx, playerId);
      if (amount === null || !Number.isFinite(amount)) continue;
      const handIds = readPlayerZoneCards(state, playerId, player, 'hand')
        .map((card: { id?: unknown }) => String(card?.id ?? '').trim())
        .filter(Boolean);
      chosen.push(...handIds.slice(0, Math.max(0, Math.floor(amount))));
    }
  }
  return {
    ...ctx,
    selectorContext: { ...(ctx.selectorContext || {}), chosenObjectIds: Array.from(new Set(chosen)) },
  };
}
