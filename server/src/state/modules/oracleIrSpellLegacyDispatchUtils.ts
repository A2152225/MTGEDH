import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { countArtifacts, hasMetalcraft } from './game-state-effects.js';
import { movePermanentToExile } from './counters_tokens.js';
import { debug } from '../../utils/debug.js';
import { skipRetiredSpellLegacyHandler } from './oracleIrSpellLegacyRouting.js';

/**
 * Handle Dispatch and similar metalcraft-conditional spells.
 * Dispatch: "Tap target creature. Metalcraft — If you control three or more artifacts, exile that creature instead."
 */
export function handleDispatch(
  ctx: GameContext,
  card: any,
  controller: PlayerID,
  targets: any[],
  state: any,
): boolean {
  const oracleText = (card.oracle_text || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();

  if (skipRetiredSpellLegacyHandler(oracleText, card.name || '')) {
    return false;
  }

  const isDispatchPattern =
    cardName.includes('dispatch') ||
    (oracleText.includes('tap target creature') &&
      oracleText.includes('metalcraft') &&
      oracleText.includes('exile'));

  if (!isDispatchPattern || targets.length === 0) {
    return false;
  }

  const battlefield = state.battlefield || [];
  const targetPerm = battlefield.find((p: any) => p?.id === targets[0] || p?.id === targets[0]?.id);

  if (!targetPerm) {
    debug(2, `[handleDispatch] Target not found on battlefield`);
    return false;
  }

  const metalcraftActive = hasMetalcraft(ctx, controller);

  if (metalcraftActive) {
    movePermanentToExile(ctx, targetPerm.id);

    if (targetPerm.isToken || targetPerm.card?.isToken) {
      debug(2, `[handleDispatch] Metalcraft active - ${targetPerm.card?.name || targetPerm.id} token left the battlefield via exile helper`);
    } else {
      debug(2, `[handleDispatch] Metalcraft active (${countArtifacts(ctx, controller)} artifacts) - exiled ${targetPerm.card?.name || targetPerm.id}`);
    }
  } else {
    targetPerm.tapped = true;
    debug(1, `[handleDispatch] Metalcraft inactive (${countArtifacts(ctx, controller)} artifacts) - tapped ${targetPerm.card?.name || targetPerm.id}`);
  }

  return true;
}
