/**
 * Origin parent: server/src/socket/interaction-handlers/interactionActivateGrantFightCounterTap.ts
 *
 * Cluster: parse "target [CreatureType] / target creature you control gains/gets …"
 * so grant-keyword activations (Otepec Huntmaster) queue targeting.
 *
 * Public entry symbols: parseGrantAbilityCreatureTarget.
 */

import { isCreatureTypeWord } from '../../../../shared/src/creatureTypes.js';

export type GrantAbilityControllerRestriction = 'any' | 'you' | 'opponent';

export interface ParsedGrantAbilityCreatureTarget {
  creatureType?: string;
  controllerRestriction: GrantAbilityControllerRestriction;
  abilityGranted: string;
}

function stripQuotedAbilityText(raw: string): string {
  let abilityGranted = String(raw || '').trim();
  abilityGranted = abilityGranted.replace(/\s+until end of turn\.?$/i, '').trim();
  abilityGranted = abilityGranted.replace(/\.$/, '').trim();
  if (abilityGranted.startsWith('"') && abilityGranted.endsWith('"')) {
    abilityGranted = abilityGranted.slice(1, -1).trim();
  }
  return abilityGranted;
}

/**
 * Parse grant-keyword ability text after the cost colon.
 * Returns null for non-creature subjects (player / opponent / artifact / …)
 * so later activate handlers can still match those families.
 */
export function parseGrantAbilityCreatureTarget(
  resolvedAbilityText: string,
): ParsedGrantAbilityCreatureTarget | null {
  const text = String(resolvedAbilityText || '').trim();
  const match = text.match(
    /^(?:until end of turn,\s*)?target\s+(.+?)\s+(gains?|gets?)\s+(.+)$/i,
  );
  if (!match) return null;

  let targetPhrase = String(match[1] || '').trim();
  targetPhrase = targetPhrase.replace(/\s+with\s+power\s+.+$/i, '').trim();
  if (!targetPhrase) return null;

  let controllerRestriction: GrantAbilityControllerRestriction = 'any';
  if (/\byou control$/i.test(targetPhrase)) {
    controllerRestriction = 'you';
    targetPhrase = targetPhrase.replace(/\s+you control$/i, '').trim();
  } else if (/\ban opponent controls$/i.test(targetPhrase)) {
    controllerRestriction = 'opponent';
    targetPhrase = targetPhrase.replace(/\s+an opponent controls$/i, '').trim();
  }

  const abilityGranted = stripQuotedAbilityText(String(match[3] || ''));
  if (!abilityGranted) return null;

  if (/^creatures?$/i.test(targetPhrase)) {
    return { controllerRestriction, abilityGranted };
  }

  const typePhrase = targetPhrase.replace(/\s+creatures?$/i, '').trim();
  if (!typePhrase || !isCreatureTypeWord(typePhrase)) return null;

  return {
    creatureType: typePhrase.toLowerCase(),
    controllerRestriction,
    abilityGranted,
  };
}
