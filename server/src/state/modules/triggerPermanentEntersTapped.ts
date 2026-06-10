import { detectETBTappedPattern } from '../../socket/land-helpers.js';
import { debug } from '../../utils/debug.js';

/**
 * Check if a permanent should enter the battlefield tapped.
 * Handles the permanent's own ETB-tapped text plus opponent-control effects
 * (Authority of the Consuls, Blind Obedience, Kismet, etc.).
 */
export function checkPermanentEntersTapped(
  battlefield: any[],
  permanentController: string,
  permanentCard: any,
): boolean {
  const permanentName = permanentCard?.name || 'Permanent';
  const permanentTypeLine = (permanentCard?.type_line || '').toLowerCase();
  const permanentOracleText = String(permanentCard?.oracle_text || '');
  const isCreature = permanentTypeLine.includes('creature');
  const isArtifact = permanentTypeLine.includes('artifact');
  const isLand = permanentTypeLine.includes('land');
  const isBasicLand = isLand && permanentTypeLine.includes('basic');

  if (detectETBTappedPattern(permanentOracleText) === 'always') {
    debug(2, `[checkPermanentEntersTapped] ${permanentName} enters tapped due to its own oracle text`);
    return true;
  }

  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;

    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    const permController = perm.controller;

    if (permController === permanentController) continue;

    if (isCreature && (cardName.includes('authority of the consuls') ||
      (oracleText.includes('creatures your opponents control enter') && oracleText.includes('tapped')))) {
      debug(2, `[checkPermanentEntersTapped] ${permanentName} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }

    if ((isArtifact || isCreature) && (cardName.includes('blind obedience') ||
        (oracleText.includes('artifacts and creatures your opponents control enter') && oracleText.includes('tapped')))) {
      debug(2, `[checkPermanentEntersTapped] ${permanentName} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }

    if (isCreature && (cardName.includes('urabrask the hidden') ||
      cardName.includes('urabrask,'))) {
      if (oracleText.includes('creatures your opponents control enter') && oracleText.includes('tapped')) {
        debug(2, `[checkPermanentEntersTapped] ${permanentName} enters tapped due to ${perm.card.name || 'effect'}`);
        return true;
      }
    }

    if (isCreature && cardName.includes('imposing sovereign')) {
      debug(2, `[checkPermanentEntersTapped] ${permanentName} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }

    if (cardName.includes('thalia, heretic cathar') || oracleText.includes('your opponents control enter')) {
      if ((isCreature && oracleText.includes('creatures') && oracleText.includes('tapped')) ||
          (isLand && !isBasicLand && oracleText.includes('nonbasic lands') && oracleText.includes('tapped'))) {
        debug(2, `[checkPermanentEntersTapped] ${permanentName} enters tapped due to ${perm.card.name || 'effect'}`);
        return true;
      }
    }

    if (cardName.includes('frozen aether') ||
        (oracleText.includes('permanents your opponents control enter') && oracleText.includes('tapped'))) {
      debug(2, `[checkPermanentEntersTapped] ${permanentName} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }

    if ((isArtifact || isCreature || isLand) && (cardName.includes('kismet') ||
        (oracleText.includes('your opponents') && oracleText.includes('play') && oracleText.includes('tapped') &&
          ((isArtifact && oracleText.includes('artifacts')) ||
           (isCreature && oracleText.includes('creatures')) ||
           (isLand && oracleText.includes('lands')))))) {
      debug(2, `[checkPermanentEntersTapped] ${permanentName} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }

    if (isCreature && oracleText.includes('creatures') &&
        oracleText.includes('opponents') &&
        oracleText.includes('control') &&
        oracleText.includes('enter') &&
        oracleText.includes('battlefield') &&
        oracleText.includes('tapped')) {
      debug(2, `[checkPermanentEntersTapped] ${permanentName} enters tapped due to ${perm.card.name || 'effect'} (generic pattern)`);
      return true;
    }
  }

  return false;
}

export function checkCreatureEntersTapped(
  battlefield: any[],
  creatureController: string,
  creatureCard: any,
): boolean {
  return checkPermanentEntersTapped(battlefield, creatureController, creatureCard);
}
