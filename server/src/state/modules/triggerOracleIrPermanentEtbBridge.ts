/**
 * Origin sibling: triggerOracleIrTokenEtbBridge.ts.
 * Cluster: ETB emission for non-token permanents IR places onto the battlefield
 *   (search_library / move_zone tutors) without the spell-entry wrapper.
 * Public: bridgeEnteredPermanentEtbTriggersAfterOracleIR.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';

/**
 * IR search_library / move_zone (Ghalta via Savage Order, put-from-hand, etc.)
 * stamps permanents with createBattlefieldPermanentsFromCards and never calls
 * putCardOntoBattlefield / queuePermanentEntersBattlefieldTriggerStackItems.
 * Tokens already go through bridgeCreatedTokenEtbTriggersAfterOracleIR.
 */
export function bridgeEnteredPermanentEtbTriggersAfterOracleIR(
  ctx: GameContext,
  state: any,
  battlefieldIdsBefore: ReadonlySet<string>,
): void {
  if ((ctx as any).isReplaying) return;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let bridged = 0;

  for (const permanent of battlefield) {
    const id = String(permanent?.id || '').trim();
    if (!id || battlefieldIdsBefore.has(id)) continue;
    if (permanent?.isToken === true) continue;

    const controller = String(permanent?.controller || '').trim() as PlayerID;
    if (!controller) continue;

    try {
      triggerETBEffectsForPermanent(ctx, permanent, controller);
      bridged += 1;
    } catch {
      // Defensive: the permanent already entered.
    }
  }

  if (bridged > 0) {
    debug(2, `[oracleIR] Bridged ETB triggers for ${bridged} IR-entered permanent(s)`);
  }
}
