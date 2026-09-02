// Origin parent: client/src/utils/manaUtils.ts
// Cluster moved: restricted-mana purpose flags and client eligibility
//   (canUseRestrictedManaClient, buildRestrictedManaPurposeForSpell,
//   typeLineIndicatesArtifactSpell). Chosen-type Courtyard/Cavern matching
//   lives here so manaUtils stays under the 40KB ceiling.
// Public entry symbols: RestrictedManaPoolEntry, RestrictedManaSpendPurpose,
//   typeLineIndicatesArtifactSpell, canUseRestrictedManaClient,
//   buildRestrictedManaPurposeForSpell, sourcePrefersUncounterableChosenTypeCast.

import { cardHasCreatureType } from '../../../shared/src/creatureTypes';

export interface RestrictedManaPoolEntry {
  type?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
  amount?: number;
  restriction?: string;
  restrictedTo?: string;
}

/** Purpose flags used to filter restricted floating mana (Vibranium/Powerstone, Courtyard, etc.). */
export interface RestrictedManaSpendPurpose {
  isCreature?: boolean;
  isAbility?: boolean;
  isArtifact?: boolean;
  isActivatedAbility?: boolean;
  isInstantOrSorcery?: boolean;
  isLegendary?: boolean;
  isMulticolored?: boolean;
  isColorless?: boolean;
  isCommander?: boolean;
  creatureType?: string;
  spellType?: string;
  abilitySourceIsCreature?: boolean;
  abilitySourceCreatureType?: string;
  spellCard?: {
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    cmc?: number;
    name?: string;
  } | null;
}

/** True when type_line is an artifact spell (Vehicle, Equipment, Artifact Creature, etc.). */
export function typeLineIndicatesArtifactSpell(typeLine: string | null | undefined): boolean {
  return /\bartifact\b/i.test(String(typeLine || ''));
}

function chosenTypeRestrictedManaAllowsPurpose(
  entry: RestrictedManaPoolEntry,
  purpose: RestrictedManaSpendPurpose,
): boolean {
  const restriction = String(entry.restriction || '');
  const wanted = String(entry.restrictedTo || '').trim();
  if (restriction === 'chosen_type_spell') {
    if (!wanted) return true;
    if (purpose.creatureType === wanted || purpose.spellType === wanted) return true;
    return Boolean(purpose.spellCard && cardHasCreatureType(
      purpose.spellCard.type_line,
      purpose.spellCard.oracle_text,
      wanted,
    ));
  }

  if (purpose.isCreature !== true) {
    if (restriction === 'chosen_type_creature_source' && purpose.isActivatedAbility === true) {
      if (purpose.abilitySourceIsCreature !== true) return false;
      return !wanted
        || purpose.creatureType === wanted
        || purpose.abilitySourceCreatureType === wanted;
    }
    return false;
  }
  if (!wanted) return true;
  if (purpose.creatureType === wanted) return true;
  return Boolean(purpose.spellCard && cardHasCreatureType(
    purpose.spellCard.type_line,
    purpose.spellCard.oracle_text,
    wanted,
  ));
}

function creatureSpellsMvOrXAllowsPurpose(
  entry: RestrictedManaPoolEntry,
  purpose: RestrictedManaSpendPurpose,
): boolean {
  if (purpose.isCreature !== true) return false;
  const spellCard = purpose.spellCard;
  if (!spellCard) return false;
  const manaCost = String(spellCard.mana_cost || '');
  if (/\{x\}/i.test(manaCost)) return true;
  const minMv = Number.parseInt(String(entry.restrictedTo || '4'), 10);
  const threshold = Number.isFinite(minMv) && minMv > 0 ? minMv : 4;
  let manaValue = Number(spellCard.cmc);
  if (!Number.isFinite(manaValue)) {
    manaValue = 0;
    const tokens = manaCost.match(/\{([^}]+)\}/g) || [];
    for (const token of tokens) {
      const inner = token.replace(/[{}]/g, '');
      if (/^\d+$/.test(inner)) manaValue += Number.parseInt(inner, 10);
      else if (/^[wubrgcs]$/i.test(inner)) manaValue += 1;
      else if (inner.includes('/')) manaValue += 1;
    }
  }
  return manaValue >= threshold;
}

/** Client-side mirror of server canUseRestrictedMana for auto-pay filtering. */
export function canUseRestrictedManaClient(
  entry: RestrictedManaPoolEntry,
  purpose?: RestrictedManaSpendPurpose | null,
): boolean {
  const restriction = String(entry?.restriction || '').trim();
  if (!restriction) return true;
  const p = purpose || {};
  switch (restriction) {
    case 'creatures':
      return p.isCreature === true;
    case 'abilities':
      return p.isAbility === true;
    case 'artifacts':
      return p.isArtifact === true;
    case 'activated_abilities':
      return p.isActivatedAbility === true;
    case 'instant_sorcery':
      return p.isInstantOrSorcery === true;
    case 'legendary':
      return p.isLegendary === true;
    case 'multicolored':
      return p.isMulticolored === true;
    case 'commander':
      return p.isCommander === true;
    case 'colorless_spells':
      return p.isColorless === true;
    case 'chosen_type_creature_spell':
    case 'chosen_type_creature_source':
    case 'chosen_type_spell':
      return chosenTypeRestrictedManaAllowsPurpose(entry, p);
    case 'creature_spells_mv_or_x':
      return creatureSpellsMvOrXAllowsPurpose(entry, p);
    case 'no_nonartifact_spells': {
      // Powerstone / Vibranium: cannot cast nonartifact spells; OK for abilities / artifact spells.
      // Artifact includes Vehicle, Equipment, Fortification, etc. — not only Artifact Creature.
      if (p.isActivatedAbility === true || p.isAbility === true) return true;
      if (p.isArtifact === true) return true;
      const spellCard = p.spellCard;
      const spellTypeLine = String(spellCard?.type_line || '').trim();
      if (spellTypeLine) {
        return typeLineIndicatesArtifactSpell(spellTypeLine);
      }
      if (
        p.isCreature === true
        || p.isInstantOrSorcery === true
        || p.isLegendary === true
        || p.isMulticolored === true
        || p.isColorless === true
        || p.isCommander === true
      ) {
        return false;
      }
      // Unknown / non-cast context, or empty type_line without cast flags: allow.
      return true;
    }
    default:
      // Unknown restriction: exclude from auto-pay (safer than treating as free C).
      return false;
  }
}

export function buildRestrictedManaPurposeForSpell(
  spellCard?: {
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    cmc?: number;
    name?: string;
  } | null,
  extras?: { isCommander?: boolean },
): RestrictedManaSpendPurpose {
  const rawTypeLine = String(spellCard?.type_line || '').trim();
  const typeLine = rawTypeLine.toLowerCase();
  const isArtifact = typeLineIndicatesArtifactSpell(rawTypeLine);
  return {
    // Only attach spellCard when type_line is present — empty type_line used to
    // hard-fail no_nonartifact_spells and mark Vibranium restricted for Vehicles.
    ...(rawTypeLine ? { spellCard: { ...spellCard, type_line: rawTypeLine } } : {}),
    ...(typeLine.includes('creature') ? { isCreature: true } : {}),
    ...(isArtifact ? { isArtifact: true } : {}),
    ...((typeLine.includes('instant') || typeLine.includes('sorcery')) ? { isInstantOrSorcery: true } : {}),
    ...(typeLine.includes('legendary') ? { isLegendary: true } : {}),
    ...(extras?.isCommander === true ? { isCommander: true } : {}),
  };
}

/**
 * Prefer Cavern of Souls any-color only when the spell can spend that restricted
 * mana (matching creature type). `{C}` on the same land never sets this flag.
 */
export function sourcePrefersUncounterableChosenTypeCast(
  source: {
    grantsUncounterableOnSpend?: boolean;
    spendRestriction?: { restriction: string; restrictedTo?: string };
  },
  purpose?: RestrictedManaSpendPurpose | null,
): boolean {
  if (source?.grantsUncounterableOnSpend !== true) return false;
  const restriction = source.spendRestriction;
  if (!restriction?.restriction) return false;
  return canUseRestrictedManaClient(
    {
      restriction: restriction.restriction,
      restrictedTo: restriction.restrictedTo,
      amount: 1,
      type: 'colorless',
    },
    purpose,
  );
}
