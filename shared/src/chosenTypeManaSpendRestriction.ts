/**
 * Chosen-type mana spend restrictions (Cavern of Souls, Unclaimed Territory,
 * Secluded Courtyard, Echoing Cavern).
 *
 * Overlay only the any-color ability: `{T}: Add {C}` on the same land is unrestricted.
 */

import type { ManaRestrictionType } from './types-handlers/manaPoolTypes.js';

export function parseChosenTypeManaSpendRestriction(oracleText: string): {
  creatureSpellsOnly: boolean;
  allowsCreatureSourceAbilities?: boolean;
} | null {
  const oracle = String(oracleText || '').toLowerCase();
  if (!oracle.includes('of the chosen type')) return null;
  const allowsCreatureSourceAbilities =
    oracle.includes('activate an ability of a creature source of the chosen type') ||
    oracle.includes('activate abilities of creature sources of the chosen type');
  if (
    oracle.includes('spend this mana only to cast a creature spell of the chosen type') ||
    oracle.includes('spend this mana only to cast creature spells of the chosen type') ||
    (allowsCreatureSourceAbilities && oracle.includes('cast a creature spell of the chosen type'))
  ) {
    return { creatureSpellsOnly: true, ...(allowsCreatureSourceAbilities ? { allowsCreatureSourceAbilities: true } : {}) };
  }
  if (oracle.includes('spend this mana only to cast spells of the chosen type')) {
    return { creatureSpellsOnly: false };
  }
  return null;
}

export function getChosenTypeManaSpendRestriction(
  permanent: { chosenCreatureType?: string; card?: { oracle_text?: string } } | null | undefined,
  oracleText?: string,
): { restriction: ManaRestrictionType; restrictedTo: string } | null {
  const chosenType = String(permanent?.chosenCreatureType || '').trim().toLowerCase();
  if (!chosenType) return null;

  const parsed = parseChosenTypeManaSpendRestriction(String(oracleText || permanent?.card?.oracle_text || ''));
  if (!parsed) return null;

  const restriction: ManaRestrictionType = parsed.allowsCreatureSourceAbilities
    ? 'chosen_type_creature_source'
    : parsed.creatureSpellsOnly
      ? 'chosen_type_creature_spell'
      : 'chosen_type_spell';

  return {
    restriction,
    restrictedTo: chosenType,
  };
}

/** True for Command Tower / Cavern any-color / native_any — not `{T}: Add {C}`. */
export function isAnyColorManaAbility(ability: {
  id?: string;
  effect?: string;
  produces?: readonly string[];
} | null | undefined): boolean {
  const id = String(ability?.id || '').trim();
  if (id === 'native_any' || id === 'native_commander_any' || id === 'native_pay_life_any') {
    return true;
  }
  if (Array.isArray(ability?.produces) && ability.produces.length >= 5) {
    return true;
  }
  const effect = String(ability?.effect || '');
  return /add\s+one\s+mana\s+of\s+any\s+color|add\s+one\s+mana\s+of\s+any\s+type/i.test(effect);
}

/**
 * Cavern of Souls any-color: chosen-type creature spell restriction plus
 * "that spell can't be countered". Unclaimed Territory matches the restriction
 * but not uncounterable.
 */
export function chosenTypeManaAbilityGrantsUncounterableCast(oracleText: string): boolean {
  const parsed = parseChosenTypeManaSpendRestriction(oracleText);
  if (!parsed?.creatureSpellsOnly) return false;
  const oracle = String(oracleText || '').toLowerCase().replace(/[\u2019\u2018]/g, "'");
  return oracle.includes("can't be countered");
}
