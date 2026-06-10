/**
 * Shared helpers for cards that say "choose a creature type" / "chosen type".
 */

import type { ManaRestrictionType } from '../../../../shared/src/index.js';
import { cardHasCreatureType, permanentHasCreatureTypeNow } from '../creatureTypeNow.js';

export function isEtbCreatureTypeChoiceOracle(oracleText: string): boolean {
  return /as .+? enters(?: the battlefield)?,?\s+choose a creature type/i.test(String(oracleText || ''));
}

export function parseChosenTypeCreatureEtbTrigger(oracleText: string): {
  effect: string;
  anotherOnly: boolean;
  nontokenOnly: boolean;
  mandatory: boolean;
} | null {
  const oracle = String(oracleText || '');
  // Kindred Discovery-style "enters or attacks" is handled by chosen_type_creature_etb_or_attack.
  if (/\benters or attacks\b/i.test(oracle)) return null;

  const match = oracle.match(
    /whenever\s+(another\s+|a\s+)?(nontoken\s+)?creatures?\s+you\s+control\s+of\s+the\s+chosen\s+type\s+enters?(?:\s+the\s+battlefield)?,?\s*([^.]+)/i,
  );
  if (!match) return null;

  const effect = String(match[3] || '').trim();
  if (!effect) return null;

  return {
    effect,
    anotherOnly: Boolean(match[1] && /another/i.test(match[1])),
    nontokenOnly: Boolean(match[2]),
    mandatory: !/\byou may\b/i.test(effect),
  };
}

export function parseBeholdChosenTypeAdditionalCost(oracleText: string): {
  beholdCount: number;
  optional: boolean;
} | null {
  const match = String(oracleText || '').match(
    /as an additional cost to cast this spell,?\s*(you may\s+)?choose a creature type and behold\s+(\w+)\s+creatures? of that type/i,
  );
  if (!match) return null;

  const countWord = String(match[2] || '').trim().toLowerCase();
  const count = countWord === 'two'
    ? 2
    : countWord === 'one'
      ? 1
      : countWord === 'three'
        ? 3
        : parseInt(countWord, 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  return {
    beholdCount: count,
    optional: Boolean(match[1]),
  };
}

export function isCelestialReunionOracle(oracleText: string): boolean {
  const lower = String(oracleText || '').toLowerCase();
  return lower.includes('search your library for a creature card with mana value x or less')
    && lower.includes("if this spell's additional cost was paid");
}

export function isCastCreatureTypeChoiceOracle(oracleText: string): boolean {
  const oracle = String(oracleText || '');
  if (!/choose a creature type/i.test(oracle)) return false;
  if (isEtbCreatureTypeChoiceOracle(oracle)) return false;
  if (parseBeholdChosenTypeAdditionalCost(oracle)) return false;
  return true;
}

const LOOK_COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseLookCountWord(word: string | undefined, defaultValue = 1): number {
  if (!word) return defaultValue;
  const lower = String(word).trim().toLowerCase();
  if (LOOK_COUNT_WORDS[lower] !== undefined) return LOOK_COUNT_WORDS[lower];
  const parsed = parseInt(lower, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

/** Bloodline Shaman: {T}: Choose a creature type. Reveal the top card... */
export function parseActivationChosenTypeRevealTop(text: string): boolean {
  const lower = String(text || '').toLowerCase();
  return lower.includes('choose a creature type')
    && lower.includes('reveal the top card of your library')
    && lower.includes('creature card of the chosen type');
}

/** Herald's Horn upkeep / Gathering Stone ETB+upkeep */
export function parseChosenTypeTopCardRevealToHand(text: string): {
  creatureCardsOnly: boolean;
  allowGraveyardIfDeclined: boolean;
} | null {
  const lower = String(text || '').toLowerCase();
  if (!lower.includes('look at the top card of your library')) return null;
  if (!lower.includes('chosen type')) return null;

  const creatureCardsOnly =
    lower.includes('creature card of the chosen type')
    || lower.includes('creature cards of the chosen type');
  const allowGraveyardIfDeclined =
    lower.includes('put it into your graveyard')
    && lower.includes("if you don't put");

  if (!creatureCardsOnly && !lower.includes('card of the chosen type')) return null;

  return { creatureCardsOnly, allowGraveyardIfDeclined };
}

export function cardMatchesChosenTypeFilter(
  card: any,
  chosenType: string,
  creatureCardsOnly: boolean,
): boolean {
  if (!card || !String(chosenType || '').trim()) return false;
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (creatureCardsOnly && !typeLine.includes('creature')) return false;
  return cardHasCreatureType(card, chosenType);
}

/** Pol Jamaar / The Convincing General: choose type, draw per matching creature */
export function parseChosenTypeDrawPerCreatureEffect(text: string): boolean {
  const lower = String(text || '').toLowerCase();
  return /choose a creature type/i.test(lower)
    && /draw a card for each creature you control of (?:that|the chosen) type/i.test(lower);
}

/** Icon of Ancestry: {3}, {T}: look at top N, reveal creature of chosen type */
export function parseActivationChosenTypeTopLibraryReveal(text: string): {
  lookCount: number;
  creatureCardsOnly: boolean;
} | null {
  const lower = String(text || '').toLowerCase();
  const lookMatch = lower.match(
    /look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library/,
  );
  if (!lookMatch || !lower.includes('chosen type') || !lower.includes('put it into your hand')) {
    return null;
  }
  return {
    lookCount: parseLookCountWord(lookMatch[1], 1),
    creatureCardsOnly: lower.includes('creature card of the chosen type')
      || lower.includes('creature cards of the chosen type'),
  };
}

export function isMetallicMimicOracle(oracleText: string): boolean {
  const lower = String(oracleText || '').toLowerCase();
  return lower.includes('each other creature you control of the chosen type enters with an additional +1/+1 counter');
}

/** Doom Cannon: Sacrifice a creature of the chosen type */
export function isSacrificeCreatureOfChosenTypeCost(costStr: string): boolean {
  return /sacrifice\s+(?:a|an)\s+creature\s+of\s+the\s+chosen\s+type/i.test(String(costStr || ''));
}

/** Progenitor's Icon: next spell of the chosen type has flash */
export function parseNextChosenTypeSpellFlashGrant(text: string): boolean {
  return /the next spell of the chosen type you cast this turn can be cast as though it had flash/i.test(String(text || ''));
}

/** Littjara chaos: choose type, +1/+1 counter on each matching creature */
export function parseChosenTypeCounterEachCreatureEffect(text: string): boolean {
  const lower = String(text || '').toLowerCase();
  return /choose a creature type/i.test(lower)
    && /put a \+1\/\+1 counter on each creature you control of (?:that|the chosen) type/i.test(lower);
}

export function hasUnrestrictedChosenTypeManaAbility(oracleText: string): boolean {
  const lower = String(oracleText || '').toLowerCase();
  return /\{t\}: add one mana of any color/i.test(lower)
    && !/spend this mana only/i.test(lower);
}

/** For the Ancestors: look at top N, reveal any number of cards of the chosen type */
export function parseChosenTypeLookRevealTopLibrary(oracleText: string): { lookCount: number } | null {
  const match = String(oracleText || '').match(
    /look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may reveal any number of cards? of the chosen type from among them/i,
  );
  if (!match) return null;
  return { lookCount: parseLookCountWord(match[1], 1) };
}

export function parseChosenTypeCostReduction(oracleText: string): {
  amount: number;
  creatureSpellsOnly: boolean;
} | null {
  const oracle = String(oracleText || '').toLowerCase();
  const creatureMatch = oracle.match(/creature spells of the chosen type cost \{(\d+)\} less/);
  if (creatureMatch) {
    const amount = parseInt(creatureMatch[1], 10);
    return Number.isFinite(amount) && amount > 0 ? { amount, creatureSpellsOnly: true } : null;
  }
  const spellMatch = oracle.match(/spells of the chosen type cost \{(\d+)\} less/);
  if (spellMatch) {
    const amount = parseInt(spellMatch[1], 10);
    return Number.isFinite(amount) && amount > 0 ? { amount, creatureSpellsOnly: false } : null;
  }
  return null;
}

export function parseChosenTypeUntilEndOfTurnBuff(oracleText: string): {
  power: number;
  toughness: number;
  abilities?: string[];
} | null {
  const match = String(oracleText || '').match(
    /creatures you control of the chosen type get ([+-]?\d+)\/([+-]?\d+)(?: and gain ([^.]+?))? until end of turn/i,
  );
  if (!match) return null;
  const power = parseInt(match[1], 10);
  const toughness = parseInt(match[2], 10);
  if (!Number.isFinite(power) || !Number.isFinite(toughness)) return null;
  const abilityText = String(match[3] || '').trim();
  const abilities = abilityText
    ? abilityText.split(/\s+and\s+|,\s*/i).map((part) => part.trim().toLowerCase()).filter(Boolean)
    : undefined;
  return { power, toughness, abilities };
}

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
  permanent: any,
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

export function filterHandCreatureCardsOfChosenType(hand: any[], chosenType: string): any[] {
  const normalized = String(chosenType || '').trim();
  if (!normalized) return [];
  return (hand || []).filter((card) => {
    const typeLine = String(card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) return false;
    return cardHasCreatureType(card, normalized);
  });
}

export function countControlledPermanentsOfChosenType(
  gameState: any,
  playerId: string,
  chosenType: string,
): number {
  const battlefield = gameState?.battlefield || [];
  let count = 0;
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    if (permanentHasCreatureTypeNow(perm, chosenType)) {
      count += 1;
      continue;
    }
    if (cardHasCreatureType(perm?.card, chosenType)) {
      count += 1;
    }
  }
  return count;
}

export function applyArcaneAdaptationToControllerCreatures(
  battlefield: any[],
  controllerId: string,
  chosenType: string,
): void {
  const normalized = String(chosenType || '').trim();
  if (!normalized) return;
  const wanted = normalized.toLowerCase();
  for (const creature of battlefield) {
    if (!creature || String(creature.controller || '') !== String(controllerId || '')) continue;
    const typeLine = String(creature.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    creature.grantedCreatureTypes = Array.isArray(creature.grantedCreatureTypes)
      ? creature.grantedCreatureTypes
      : [];
    if (!creature.grantedCreatureTypes.some((entry: string) => String(entry).toLowerCase() === wanted)) {
      creature.grantedCreatureTypes.push(normalized);
    }
  }
}

export function syncArcaneAdaptationForNewCreature(gameState: any, newPermanent: any): void {
  const controller = String(newPermanent?.controller || '').trim();
  if (!controller) return;
  for (const source of gameState?.battlefield || []) {
    if (!source || String(source.controller || '') !== controller) continue;
    const oracle = String(source.card?.oracle_text || '').toLowerCase();
    if (!oracle.includes('creatures you control are the chosen type in addition')) continue;
    const chosenType = String(source.chosenCreatureType || '').trim();
    if (!chosenType) continue;
    newPermanent.grantedCreatureTypes = Array.isArray(newPermanent.grantedCreatureTypes)
      ? newPermanent.grantedCreatureTypes
      : [];
    if (!newPermanent.grantedCreatureTypes.some((entry: string) => String(entry).toLowerCase() === chosenType.toLowerCase())) {
      newPermanent.grantedCreatureTypes.push(chosenType);
    }
    return;
  }
}

export function deriveCavernUncounterableForCreatureCast(
  gameState: any,
  playerId: string,
  spellCard: any,
  payment?: Array<{ permanentId?: string }> | null,
): boolean {
  const typeLine = String(spellCard?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return false;
  const paidSourceIds = new Set(
    (payment || [])
      .map((entry) => String(entry?.permanentId || '').trim())
      .filter(Boolean),
  );
  if (paidSourceIds.size === 0) return false;

  for (const perm of gameState?.battlefield || []) {
    if (!perm || perm.controller !== playerId) continue;
    const oracle = String(perm.card?.oracle_text || '').toLowerCase();
    if (!oracle.includes("can't be countered") && !oracle.includes('that spell can\'t be countered')) continue;
    if (!paidSourceIds.has(String(perm.id || ''))) continue;
    const chosenType = String(perm.chosenCreatureType || '').trim();
    if (!chosenType || !cardHasCreatureType(spellCard, chosenType)) continue;
    return true;
  }
  return false;
}

export function buildBeholdSelectionOptions(
  gameState: any,
  playerId: string,
  chosenType: string,
  hand: any[],
  excludeCardId?: string,
): { handCards: any[]; battlefieldCreatures: any[] } {
  const filteredHand = filterHandCreatureCardsOfChosenType(
    (hand || []).filter((card) => !excludeCardId || String(card?.id || '') !== String(excludeCardId)),
    chosenType,
  );
  const battlefieldCreatures = (gameState?.battlefield || []).filter((perm: any) => {
    if (!perm || String(perm.controller || '') !== String(playerId)) return false;
    const typeLine = String(perm?.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) return false;
    return permanentHasCreatureTypeNow(perm, chosenType) || cardHasCreatureType(perm?.card, chosenType);
  });
  return { handCards: filteredHand, battlefieldCreatures };
}

export function countControlledCreaturesOfChosenType(
  gameState: any,
  playerId: string,
  chosenType: string,
): number {
  const battlefield = gameState?.battlefield || [];
  let count = 0;
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    const typeLine = String(perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    if (permanentHasCreatureTypeNow(perm, chosenType)) {
      count += 1;
    }
  }
  return count;
}
