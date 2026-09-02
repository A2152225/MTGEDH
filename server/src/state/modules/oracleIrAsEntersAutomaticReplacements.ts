/**
 * Origin sibling: oracleIrBattlefieldEntryPrompts.ts / stackResolvePermanentSpellPostEntryUtils.ts
 * Cluster: apply as-enters automatic IR replacements (turn_face_down) when a permanent
 *   enters, without re-entering applyOracleIRStepsOnServer.
 * Public: applyAsEntersAutomaticReplacementsForPermanent,
 *   applyAsEntersAutomaticReplacementsAfterOracleIR
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import { collectAsEntersAutomaticReplacementSteps } from '../../../../rules-engine/src/oracleIRAsEntersAutomaticReplacementSteps.js';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
} from '../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../context.js';
import { debugWarn } from '../../utils/debug.js';

export function applyAsEntersAutomaticReplacementsForPermanent(
  ctx: GameContext,
  permanent: any,
): void {
  if ((ctx as any).isReplaying) return;
  const state = (ctx as any).state;
  if (!state || !permanent) return;

  const card = permanent.card || {};
  const oracleText = String(card.oracle_text || card.oracleText || '');
  if (!oracleText) return;

  const steps = collectAsEntersAutomaticReplacementSteps(oracleText, String(card.name || ''));
  if (steps.length === 0) return;

  const controller = String(permanent.controller || permanent.controllerId || '').trim();
  const sourceId = String(permanent.id || '').trim();
  if (!controller || !sourceId) return;

  try {
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: controller as PlayerID,
        sourceId,
      }),
    );
    if (Array.isArray(result.state?.battlefield)) {
      state.battlefield = result.state.battlefield;
    }
  } catch (err) {
    debugWarn(1, `[oracleIR] as-enters automatic replacement failed for ${card.name || sourceId}:`, err);
  }
}

export function applyAsEntersAutomaticReplacementsAfterOracleIR(
  ctx: GameContext,
  state: any,
  battlefieldIdsBefore: ReadonlySet<string>,
): void {
  if ((ctx as any).isReplaying) return;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    const id = String(permanent?.id || '').trim();
    if (!id || battlefieldIdsBefore.has(id)) continue;
    applyAsEntersAutomaticReplacementsForPermanent(ctx, permanent);
  }
}
