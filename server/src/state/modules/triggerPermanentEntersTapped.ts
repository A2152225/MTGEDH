import { resolvePermanentEntersTapped } from '../../../../rules-engine/src/oracleIRBattlefieldEntryProposal.js';
import { debug } from '../../utils/debug.js';
import { enterUntappedOverrideSourceName } from './landsEnterUntappedOverride.js';

/**
 * Check if a permanent should enter the battlefield tapped.
 * Delegates to generic oracle-text pattern detection in rules-engine.
 */
export function checkPermanentEntersTapped(
  battlefield: any[],
  permanentController: string,
  permanentCard: any,
): boolean {
  const entersTapped = resolvePermanentEntersTapped({
    battlefield,
    controllerId: permanentController,
    card: permanentCard,
  });
  if (entersTapped) {
    const overrideSource = enterUntappedOverrideSourceName(battlefield, permanentController, permanentCard);
    if (overrideSource) {
      debug(2, `[checkPermanentEntersTapped] ${permanentCard?.name || 'Permanent'} enters untapped (${overrideSource})`);
      return false;
    }
    debug(2, `[checkPermanentEntersTapped] ${permanentCard?.name || 'Permanent'} enters tapped (generic ETB rule)`);
  }
  return entersTapped;
}

export function checkCreatureEntersTapped(
  battlefield: any[],
  creatureController: string,
  creatureCard: any,
): boolean {
  return checkPermanentEntersTapped(battlefield, creatureController, creatureCard);
}
