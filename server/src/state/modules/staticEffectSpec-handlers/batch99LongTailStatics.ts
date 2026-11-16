// server/src/state/modules/staticEffectSpec-handlers/batch99LongTailStatics.ts
// B99 long-tail statics: Starfield of Nyx (5+ enchantments animate), Jandor
// type+Mount layer-4 grant, Thran Portal additional life on mana abilities,
// as-enters choose-N-at-random (Haktos). Public: parseBatch99LongTailStaticKind,
// pushBatch99LongTailStaticSpecs, parseAdditionalLifeToActivateManaAbilities,
// BATCH99_LAYER4_SPECS.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseAsEntersChooseNumberAtRandom } from '../batch99AsEntersRandom.js';
import { parseAdditionalTypesAndSaddle } from '../batch98CombatAndKeywords.js';
import { parseAdditionalLifeToActivateManaAbilities } from '../batch99ManaAbilityAdditionalLife.js';

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function manaValueOf(perm: any): number {
  const card = perm?.card || {};
  const n = Number(card.cmc ?? card.mana_value ?? card.manaValue ?? perm?.cmc ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

const STARFIELD_RE = /as long as you control (?:five|5) or more enchantments, each other non-?aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value/i;
const JANDOR_SADDLE_RE = /is an? [a-z]+ in addition to its other types and has saddle \d+/i;
const CONTROL_ENCHANTED_RE = /you control enchanted (?:creature|permanent|artifact|land|planeswalker|enchantment|equipment)/i;
const NOVICE_DEFENDER_RE = /as long as (?:this creature|~|it) is enchanted or equipped, (?:this creature|it|~) can attack as though it didn.t have defender/i;

export { parseAdditionalLifeToActivateManaAbilities };

export function parseStarfieldAnimation(oracle: string): boolean {
  return STARFIELD_RE.test(normalize(oracle));
}

function countEnchantmentsControlled(state: any, controllerId: string): number {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.filter((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') !== String(controllerId)) return false;
    return /\benchantment\b/.test(typeLineOf(perm));
  }).length;
}

export const BATCH99_LAYER4_SPECS = [
  {
    re: STARFIELD_RE,
    build: (source: any) => ({
      addTypes: ['Creature'],
      basePT: (perm: any) => ({ power: manaValueOf(perm), toughness: manaValueOf(perm) }),
      sourceActive: (state: any) => countEnchantmentsControlled(state, String(source?.controller || '')) >= 5,
      appliesTo: (perm: any) => {
        if (!perm || String(perm.id || '') === String(source?.id || '')) return false;
        if (String(perm.controller || '') !== String(source?.controller || '')) return false;
        const typeLine = typeLineOf(perm);
        return /\benchantment\b/.test(typeLine) && !/\baura\b/.test(typeLine);
      },
    }),
  },
  {
    re: JANDOR_SADDLE_RE,
    build: (source: any) => {
      const parsed = parseAdditionalTypesAndSaddle(source?.card?.oracle_text || source?.oracle_text || '');
      const types = parsed?.types || [];
      return {
        addTypes: ['Mount'],
        appliesTo: (perm: any) => {
          if (!perm || String(perm.controller || '') !== String(source?.controller || '')) return false;
          const typeLine = typeLineOf(perm);
          if (!/\bcreature\b/.test(typeLine)) return false;
          return types.some((type) => new RegExp(`\\b${type.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`)}\\b`, 'i').test(typeLine));
        },
      };
    },
  },
];

export function parseBatch99LongTailStaticKind(oracle: string): string[] {
  const text = normalize(oracle);
  const kinds: string[] = [];
  if (parseStarfieldAnimation(text)) kinds.push('starfield-non-aura-enchantments-are-creatures');
  if (parseAdditionalLifeToActivateManaAbilities(text) != null) kinds.push('mana-abilities-additional-life');
  if (parseAsEntersChooseNumberAtRandom(text)) kinds.push('as-enters-choose-number-at-random');
  if (parseAdditionalTypesAndSaddle(text)) kinds.push('additional-types-and-saddle');
  if (CONTROL_ENCHANTED_RE.test(text)) kinds.push('you-control-enchanted-permanent');
  if (NOVICE_DEFENDER_RE.test(text)) kinds.push('can-attack-as-though-no-defender-if-enchanted-or-equipped');
  return kinds;
}

export function pushBatch99LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  if (parseStarfieldAnimation(oracle)) {
    specs.push(buildSpec(
      source,
      'starfield-non-aura-enchantments-are-creatures',
      { kind: 'other_permanents_you_control' } as any,
      { typeAdditions: ['Creature'] },
    ));
  }
  const extraLife = parseAdditionalLifeToActivateManaAbilities(oracle);
  if (extraLife != null) {
    specs.push(buildSpec(
      source,
      'mana-abilities-additional-life',
      { kind: 'self' },
      { abilities: [`mana_abilities_additional_${extraLife}_life`] },
    ));
  }
  if (parseAsEntersChooseNumberAtRandom(oracle)) {
    specs.push(buildSpec(
      source,
      'as-enters-choose-number-at-random',
      { kind: 'self' },
      { abilities: ['as_enters_choose_number_at_random'] },
    ));
  }
  if (CONTROL_ENCHANTED_RE.test(normalize(oracle))) {
    specs.push(buildSpec(
      source,
      'you-control-enchanted-permanent',
      { kind: 'self' },
      { abilities: ['you_control_enchanted_permanent'] },
    ));
  }
  if (NOVICE_DEFENDER_RE.test(normalize(oracle))) {
    specs.push(buildSpec(
      source,
      'can-attack-as-though-no-defender-if-enchanted-or-equipped',
      { kind: 'self' },
      { abilities: ['can_attack_as_though_no_defender_if_enchanted_or_equipped'] },
    ));
  }
}
