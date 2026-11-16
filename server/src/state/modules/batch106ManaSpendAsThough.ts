// server/src/state/modules/batch106ManaSpendAsThough.ts
// Agatha's Soul Cauldron family: spend mana as though it were mana of any color
// only when activating abilities of creatures you control.
// Imports the UI worker's manaSpendAsThough.ts and does not edit it.
// Public: getBatch106ManaSpendAsThoughRules, canSpendManaAsForCreatureActivation.

import {
  canSpendManaAs,
  getManaSpendAsThoughRules,
  type ManaSpendAsThoughRules,
  type SpendManaColor,
} from './manaSpendAsThough.js';
import { parseSpendManaAsAnyToActivateCreatureAbilities } from './batch106Parsers.js';

export type ManaSpendAsThoughContext = {
  /** True when the payment is for an activated ability of a creature the player controls. */
  activatingCreatureAbility?: boolean;
};

function controllerHasSpendAnyForCreatureActivations(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true) continue;
    if (String(permanent.controller || '') !== pid) continue;
    const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '');
    if (parseSpendManaAsAnyToActivateCreatureAbilities(oracle)) return true;
  }
  return false;
}

/** Merge battlefield spend-as-though rules with the creature-activation-only any-color grant. */
export function getBatch106ManaSpendAsThoughRules(
  state: any,
  playerId: string,
  context: ManaSpendAsThoughContext = {},
): ManaSpendAsThoughRules {
  const rules = getManaSpendAsThoughRules(state, playerId);
  if (context.activatingCreatureAbility && controllerHasSpendAnyForCreatureActivations(state, playerId)) {
    return { ...rules, anyColor: true, colorAsAny: null, otherOnlyColorless: false };
  }
  return rules;
}

export function canSpendManaAsForCreatureActivation(
  from: SpendManaColor,
  need: SpendManaColor | 'generic',
  state: any,
  playerId: string,
  activatingCreatureAbility: boolean,
): boolean {
  return canSpendManaAs(from, need, getBatch106ManaSpendAsThoughRules(state, playerId, { activatingCreatureAbility }));
}
