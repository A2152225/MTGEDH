// server/src/state/modules/mana-abilities-handlers/manaAbilityLandTypeSettingOracle.ts
// Oracle-pattern layer-4 land type SETTING (CR 305.7): "Nonbasic lands are Mountains" (Blood Moon, Magus of
// the Moon), "Lands you control are Plains" (Celestial Dawn), "All lands are Islands" without "in addition".
// The land loses its other land types and the abilities they granted; it gains the new type's mana ability.
// Name-independent so renamed / reprinted / copied sources work. Additive "in addition" forms stay in
// parseOracleLandTypeGrant.
// Also: "All Mountains are Plains" (Conversion / Glaciers), "Basic lands of the first chosen type are the second
// chosen type" (Illusionary Terrain; reads chosenLandTypes / chosenBasicLandTypes [from, to]) and "Each land with an
// <name> counter on it is every land type in addition" (Omo, Queen of Vesuva).
// Public entry symbols: parseOracleLandTypeSetting.

import type { ManaModifier } from './manaAbilityLandTypeModifiers.js';

const WORDS: Record<string, string> = {
  plains: 'plains', island: 'island', islands: 'island', swamp: 'swamp', swamps: 'swamp',
  mountain: 'mountain', mountains: 'mountain', forest: 'forest', forests: 'forest',
};
const MANA: Record<string, string> = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
const TYPE = '(plains|islands?|swamps?|mountains?|forests?)';
const SCOPES: Array<[RegExp, ManaModifier['affects']]> = [
  [new RegExp('(?:^|[.\\n]\\s*)nonbasic lands are (?:basic )?' + TYPE + '\\s*(?:[.\\n]|$)'), 'nonbasic_lands'],
  [new RegExp('(?:^|[.\\n]\\s*)(?:all|each) lands? (?:are|is an?) (?:basic )?' + TYPE + '\\s*(?:[.\\n]|$)'), 'all_lands'],
  [new RegExp('(?:^|[.\\n]\\s*)lands you control are (?:basic )?' + TYPE + '\\s*(?:[.\\n]|$)'), 'lands'],
];

type Mod = Omit<ManaModifier, 'permanentId' | 'cardName'>;
const ALL = ['plains', 'island', 'swamp', 'mountain', 'forest'];
const setMod = (landType: string, extra: Partial<Mod>, id: string): Mod => ({
  type: 'land_type', affects: 'all_lands', landTypes: [landType], overridesExisting: true, affectsAllPlayers: true,
  grantedAbility: { id, cost: '{T}', produces: [MANA[landType]] }, ...extra,
});

function parseConditionalLandTypeSetting(oracle: string, permanent?: any): Mod | null {
  const conv = oracle.match(new RegExp('(?:^|[.\\n]\\s*)all ' + TYPE + ' are (?:basic )?' + TYPE + '\\s*(?:[.\\n]|$)'));
  if (conv && WORDS[conv[1]] && WORDS[conv[2]] && WORDS[conv[1]] !== WORDS[conv[2]]) {
    return setMod(WORDS[conv[2]], { fromLandType: WORDS[conv[1]] }, 'oracle_convert_' + WORDS[conv[1]] + '_' + WORDS[conv[2]]);
  }
  if (/(?:^|[.\n]\s*)basic lands of the first chosen type are the second chosen type/.test(oracle)) {
    const raw = permanent?.chosenLandTypes || permanent?.chosenBasicLandTypes || permanent?.chosenOptions;
    const [from, to] = (Array.isArray(raw) ? raw : []).map((v: unknown) => WORDS[String(v || '').trim().toLowerCase()]);
    if (from && to && from !== to) return setMod(to, { fromLandType: from, fromBasicOnly: true }, 'oracle_chosen_' + from + '_' + to);
  }
  const omo = oracle.match(/(?:^|[.\n]\s*)each land with an? ([a-z0-9+/-]+) counter on it is every (?:basic )?land type in addition/);
  if (omo) {
    return {
      type: 'land_type', affects: 'all_lands', landTypes: [...ALL], affectsAllPlayers: true, counterName: omo[1],
      grantedAbility: { id: 'oracle_counter_every_basic', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
    };
  }
  return null;
}

export function parseOracleLandTypeSetting(oracleLower: string, permanent?: any): Omit<ManaModifier, 'permanentId' | 'cardName'> | null {
  const oracle = String(oracleLower || '').toLowerCase();
  if (!oracle) return null;
  const conditional = parseConditionalLandTypeSetting(oracle, permanent);
  if (conditional) return conditional;
  for (const [re, affects] of SCOPES) {
    const m = re.exec(oracle);
    const landType = m ? WORDS[m[1]] : undefined;
    if (!landType) continue;
    return {
      type: 'land_type',
      affects,
      landTypes: [landType],
      overridesExisting: true,
      grantedAbility: { id: 'oracle_set_' + affects + '_' + landType, cost: '{T}', produces: [MANA[landType]] },
    };
  }
  return null;
}
