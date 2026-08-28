import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleIRExecutionResult } from '../../../../rules-engine/src/oracleIRExecutor.js';
import type { OracleIRReplayMutation } from '../../../../rules-engine/src/oracleIRReplayMutations.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';
import { applyGraveyardTypeEntryCounterGrants } from './graveyardTypeEntryCounterBonus.js';
import { queueTokenCreatedTriggers } from './triggers/tokens.js';

function collectCreateTokenMutations(
  result: OracleIRExecutionResult,
): Extract<OracleIRReplayMutation, { kind: 'createToken' }>[] {
  return (result.replayMutations || []).filter(
    (mutation): mutation is Extract<OracleIRReplayMutation, { kind: 'createToken' }> =>
      mutation.kind === 'createToken',
  );
}

/**
 * IR create_token applies tokens directly to game state without the legacy createToken()
 * path, so ETB triggers (Auriok Champion, Soul Warden, etc.) must be bridged here.
 */
export function bridgeCreatedTokenEtbTriggersAfterOracleIR(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
): void {
  if ((ctx as any).isReplaying) return;

  const tokenMutations = collectCreateTokenMutations(result);
  if (tokenMutations.length === 0) return;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const createdByController = new Map<string, { ids: string[]; name: string; typeLine: string }>();

  for (const mutation of tokenMutations) {
    const tokenId = String(mutation.tokenData?.id || '').trim();
    if (!tokenId) continue;

    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === tokenId);
    if (!permanent || permanent.isToken !== true) continue;

    const controller = String(permanent.controller || mutation.controllerId || '').trim() as PlayerID;
    if (!controller) continue;

    applyGraveyardTypeEntryCounterGrants(state, permanent, controller);

    try {
      triggerETBEffectsForPermanent(ctx, permanent, controller);
    } catch {
      // Defensive: token creation already succeeded.
    }

    const bucket = createdByController.get(controller) || {
      ids: [],
      name: String(permanent.card?.name || mutation.tokenData?.name || 'Token'),
      typeLine: String(permanent.card?.type_line || mutation.tokenData?.typeLine || 'Token'),
    };
    bucket.ids.push(tokenId);
    createdByController.set(controller, bucket);
  }

  if (createdByController.size === 0) return;

  for (const [controller, bucket] of createdByController.entries()) {
    try {
      const key = String(controller);
      state.tokensCreatedThisTurn = state.tokensCreatedThisTurn || {};
      state.tokenCreatedThisTurn = state.tokenCreatedThisTurn || {};
      state.createdTokenThisTurn = state.createdTokenThisTurn || {};
      state.tokensCreatedThisTurn[key] = (state.tokensCreatedThisTurn[key] || 0) + bucket.ids.length;
      state.tokenCreatedThisTurn[key] = (state.tokenCreatedThisTurn[key] || 0) + bucket.ids.length;
      state.createdTokenThisTurn[key] = (state.createdTokenThisTurn[key] || 0) + bucket.ids.length;

      queueTokenCreatedTriggers(ctx, key, bucket.ids, {
        name: bucket.name,
        typeLine: bucket.typeLine,
      });
    } catch {
      // best-effort only
    }
  }

  debug(
    2,
    `[oracleIR] Bridged ETB triggers for ${[...createdByController.values()].reduce((sum, bucket) => sum + bucket.ids.length, 0)} IR-created token(s)`,
  );
}
