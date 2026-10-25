// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingGlobalTypeAdditions.ts
// Phase 5 step 3: global layer-4 type-changing statics as declarative specs
//   ("All permanents are artifacts in addition to their other types." Mycosynth Lattice,
//    "All permanents are enchantments ..." Enchanted Evening, "All creatures are Zombies ...").
// Land subtypes ("All lands are Islands") stay with the land-type modifier pipeline.
// Public entry symbols: pushGlobalTypeAdditionSpecs.

import type { StaticEffectSpec } from '../staticEffectSpec.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
import { parseLordCreatureType } from './staticEffectSpecOracleParseHelpers.js';

const GLOBAL_TYPE_RE =
  /(?:^|[.\n])\s*all (permanents|creatures|artifacts|enchantments|lands) are (?:an? )?([a-z]+) in addition to their other (?:creature )?types/g;

const CARD_TYPE_WORDS: Record<string, string> = {
  artifact: 'Artifact', artifacts: 'Artifact',
  enchantment: 'Enchantment', enchantments: 'Enchantment',
  creature: 'Creature', creatures: 'Creature',
  land: 'Land', lands: 'Land',
};

export function pushGlobalTypeAdditionSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  for (const match of String(oracle || '').toLowerCase().matchAll(GLOBAL_TYPE_RE)) {
    const subject = match[1];
    const word = match[2];
    let added = CARD_TYPE_WORDS[word];
    if (!added) {
      if (subject !== 'creatures') continue; // land/other subtypes belong to other pipelines
      const creatureType = parseLordCreatureType(word);
      if (!creatureType || !isCreatureTypeWord(creatureType)) continue;
      added = creatureType.charAt(0).toUpperCase() + creatureType.slice(1);
    }
    if (subject === 'lands' && added !== 'Artifact' && added !== 'Enchantment' && added !== 'Creature') continue;
    const id = `global-type-addition:${subject}:${added.toLowerCase()}`;
    if (specs.some((spec) => spec.id.endsWith(id))) continue;
    const cardType = subject.replace(/s$/, '');
    specs.push({
      ...buildSpec(
        source,
        id,
        { kind: subject === 'creatures' ? 'all_creatures' : 'all_permanents' },
        { typeAdditions: [added] },
        subject === 'permanents' || subject === 'creatures' ? undefined : { kind: 'target_has_type', cardType },
      ),
      layer: 4,
    });
  }
}
