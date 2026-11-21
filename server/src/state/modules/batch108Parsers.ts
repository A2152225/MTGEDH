// server/src/state/modules/batch108Parsers.ts
// B108 oracle parsers: Fumiko bushido X is already in batch107Parsers.
// Engine tails — Rampaging Cyclops, Tetsuko, Ironscale Hydra, Scheming Fence,
// Sorin lifelink, die-to-library, Life and Limb, Balrog, Goblin Assault,
// Balan, Master of Cruelties, Dregscape, and cheap onward tails.

import { memoOracleNormalize } from './oracleNormalizeMemo.js';

export function normalizeB108Oracle(text: string): string {
  return memoOracleNormalize('b108', text, undefined, () => String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim());
}

function n(text: string): string {
  return normalizeB108Oracle(text);
}

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseNum(raw: string): number {
  const key = String(raw || '').toLowerCase();
  if (key in WORDS) return WORDS[key];
  const value = parseInt(key, 10);
  return Number.isFinite(value) ? value : 0;
}

/** Rampaging Cyclops: gets PT as long as N or more creatures are blocking it. */
export function parseGetsPTAsLongAsNCreaturesAreBlockingIt(oracle: string): { min: number; power: number; toughness: number } | null {
  const m = n(oracle).match(/(?:this creature|this permanent|~|it) gets ([+-]\d+)\s*\/\s*([+-]\d+) as long as (\w+|\d+) or more creatures are blocking it/i);
  if (!m) return null;
  const min = parseNum(m[3]);
  return min > 0 ? { min, power: Number(m[1]), toughness: Number(m[2]) } : null;
}

/** Tetsuko: creatures you control with power or toughness N or less can't be blocked. */
export function parseCreaturesYouControlWithPowerOrToughnessNOrLessCantBeBlocked(oracle: string): number | null {
  const m = n(oracle).match(/creatures you control with power or toughness (\d+|one|two|three|four|five) or less can't be blocked/i);
  return m ? parseNum(m[1]) : null;
}

/** Ironscale Hydra: if a creature would deal combat damage to this creature, prevent and +1/+1. */
export function parseCreatureCombatDamageToThisPreventAndPlusCounter(oracle: string): { counter: string; count: number } | null {
  const m = n(oracle).match(/if a creature would deal combat damage to (?:this creature|this permanent|~), prevent that damage and put (?:a|an|one) (\+1\/\+1) counters? on (?:this creature|this permanent|~|it)/i);
  return m ? { counter: '+1/+1', count: 1 } : null;
}

/** Scheming Fence census line. */
export function parseActivatedAbilitiesOfTheChosenPermanentCantBeActivated(oracle: string): boolean {
  return /activated abilities of the chosen permanent can't be activated/i.test(n(oracle));
}

/** Sorin, Vengeful Bloodlord. */
export function parseDuringYourTurnCreaturesAndPlaneswalkersYouControlHaveLifelink(oracle: string): boolean {
  return /during your turn, creatures and planeswalkers you control have lifelink/i.test(n(oracle));
}

export function parseIfThisWouldDiePutOnLibrary(oracle: string): 'top' | 'bottom' | null {
  const text = n(oracle);
  if (/if (?:this creature|this permanent|~) would die, put it on top of its owner's library instead/i.test(text)) return 'top';
  if (/if (?:this creature|this permanent|~) would die, put it on the bottom of its owner's library instead/i.test(text)) return 'bottom';
  return null;
}

/** Life and Limb. */
export function parseForestsAndSaprolingsAreNNColorSaprolingCreaturesAndForestLands(oracle: string): { power: number; toughness: number; color: string } | null {
  const m = n(oracle).match(/all forests and all saprolings are (\d+)\s*\/\s*(\d+) (white|blue|black|red|green) saproling creatures and forest lands in addition/i);
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]), color: String(m[3]).toLowerCase() };
}

export function parseCantBeBlockedExceptByLegendaryCreatures(oracle: string): boolean {
  return /(?:this creature|this permanent|the balrog|~) can't be blocked except by legendary creatures/i.test(n(oracle));
}

export function parseTypalCreaturesAttackEachCombatIfAble(oracle: string): string | null {
  const m = n(oracle).match(/^([A-Z][A-Za-z]+) creatures attack each combat if able/i)
    || n(oracle).match(/(?:^|\. )([A-Z][A-Za-z]+) creatures attack each combat if able/i);
  return m ? String(m[1]) : null;
}

export function parseHasDoubleStrikeAsLongAsNEquipmentAttached(oracle: string): number | null {
  const m = n(oracle).match(/(?:this creature|this permanent|~|balan) has double strike as long as (\w+|\d+) or more equipment are attached to (?:it|him|her|them)/i);
  return m ? parseNum(m[1]) : null;
}

export function parseCanOnlyAttackAlone(oracle: string): boolean {
  return /(?:this creature|this permanent|~) can only attack alone\b/i.test(n(oracle));
}

export function parseEachTypalCreatureCardInYourGraveyardHasUnearth(oracle: string): { typal: string; cost: string } | null {
  const m = n(oracle).match(/each ([A-Z][A-Za-z]+) creature cards? in your graveyard ha(?:s|ve) unearth (\{[^}]+\})/i);
  return m ? { typal: String(m[1]), cost: String(m[2]) } : null;
}

export function parseEnchantedCantBeBlockedAsLongAsAttackingAlone(oracle: string): boolean {
  return /enchanted creature can't be blocked as long as it's attacking alone/i.test(n(oracle));
}

export function parseAllBasicLandTypeAreNNColorCreaturesStillLands(oracle: string): { land: string; power: number; toughness: number; color: string } | null {
  const m = n(oracle).match(/all (plains|islands|swamps|mountains|forests) are (\d+)\s*\/\s*(\d+) (white|blue|black|red|green) creatures that are still lands/i);
  if (!m) return null;
  return { land: String(m[1]).toLowerCase(), power: Number(m[2]), toughness: Number(m[3]), color: String(m[4]).toLowerCase() };
}

export function parseAllCreaturesWithFlyingAbleToBlockThisDoSo(oracle: string): boolean {
  return /all creatures with flying able to block (?:this creature|this permanent|~) do so/i.test(n(oracle));
}

export function parseGetsPTAsLongAsTopLibraryCardIsCreature(oracle: string): { power: number; toughness: number } | null {
  const text = n(oracle);
  const m = text.match(/(?:this creature|this permanent|~) gets ([+-]\d+)\s*\/\s*([+-]\d+) as long as the top card of your library is a creature card/i)
    || text.match(/as long as the top card of your library is a creature card, (?:this creature|this permanent|~) gets ([+-]\d+)\s*\/\s*([+-]\d+)/i);
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]) };
}

export function parseCantAttackOrBlockUnlessNPlusCounters(oracle: string): { min: number; counter: string } | null {
  const m = n(oracle).match(/(?:this creature|this permanent|~) can't attack or block unless it has (\w+|\d+) or more (\+1\/\+1) counters? on it/i);
  if (!m) return null;
  const min = parseNum(m[1]);
  return min > 0 ? { min, counter: '+1/+1' } : null;
}

export function parseAsLongAsThisIsACreatureItHasProwess(oracle: string): boolean {
  return /as long as (?:this creature|this permanent|this vehicle|~) is a creature, it has prowess/i.test(n(oracle));
}
