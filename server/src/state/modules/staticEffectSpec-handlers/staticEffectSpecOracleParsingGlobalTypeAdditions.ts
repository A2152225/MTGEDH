// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingGlobalTypeAdditions.ts
// Phase 5 step 3: global layer-4 type-changing statics as declarative specs
//   ("All permanents are artifacts in addition to their other types." Mycosynth Lattice,
//    "All permanents are enchantments ..." Enchanted Evening, "All creatures are Zombies ...").
// Land subtypes ("All lands are Islands") stay with the land-type modifier pipeline.
// Public entry symbols: pushGlobalTypeAdditionSpecs.

import type { StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  parseLordAbilitiesFromTail,
  parseLordCreatureType,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';
import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';

const GLOBAL_TYPE_RE =
  /(?:^|[.\n])\s*all (permanents|creatures|artifacts|enchantments|lands) are (?:an? )?([a-z]+) in addition to their other (?:creature )?types/g;

// B59: Senator Peacock - "Artifacts you control are Clues in addition to their other types and have \"...\"".
const YOU_CONTROL_TYPE_HAVE_RE =
  /(?:^|[.\n])\s*(artifacts?|enchantments?|creatures?|lands?|permanents?) you control are (?:an? )?([a-z]+)s? in addition to their other types(?: and have ("[^"]*"|[^.]+))?/gi;

// B62: Encroaching Mycosynth ? "Nonland permanents you control are artifacts in addition to their other types."
const NONLAND_YOU_CONTROL_TYPE_RE =
  /(?:^|[.\n])\s*nonland permanents you control are (?:an? )?([a-z]+)s? in addition to their other types/gi;

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
  for (const match of String(oracle || '').toLowerCase().matchAll(NONLAND_YOU_CONTROL_TYPE_RE)) {
    const addedRaw = String(match[1] || '').trim().replace(/s$/, '');
    const added = addedRaw ? addedRaw.charAt(0).toUpperCase() + addedRaw.slice(1) : '';
    if (!added) continue;
    const id = `nonland-you-control-type-addition:${added.toLowerCase()}`;
    if (specs.some((spec) => spec.id.endsWith(id))) continue;
    specs.push({
      ...buildSpec(
        source,
        id,
        { kind: 'permanents_you_control' },
        { typeAdditions: [added] },
        { kind: 'target_lacks_type', cardType: 'land' },
      ),
      layer: 4,
    });
  }
  for (const match of String(oracle || '').toLowerCase().matchAll(YOU_CONTROL_TYPE_HAVE_RE)) {
    const subject = match[1].replace(/s$/, '');
    const addedRaw = String(match[2] || '').trim().replace(/s$/, '');
    const tail = String(match[3] || '').trim();
    const added = addedRaw ? addedRaw.charAt(0).toUpperCase() + addedRaw.slice(1) : '';
    if (!added) continue;
    const abilities = tail ? parseLordAbilitiesFromTail(tail) : [];
    // Keep quoted text when parseAbilitiesFromTail returns the quote body.
    const quoted = [...tail.matchAll(/"([^"]+)"/g)].map((q) => q[1].trim()).filter(Boolean);
    const grantAbilities = abilities.length ? abilities : quoted;
    const id = `you-control-type-addition:${subject}:${added.toLowerCase()}`;
    if (specs.some((spec) => spec.id.endsWith(id))) continue;
    const scopeKind = subject === 'creature' ? 'creatures_you_control' : 'permanents_you_control';
    const grant: any = { typeAdditions: [added] };
    if (grantAbilities.length) grant.abilities = grantAbilities;
    specs.push({
      ...buildSpec(
        source,
        id,
        { kind: scopeKind },
        grant,
        subject === 'creature' || subject === 'permanent' ? undefined : { kind: 'target_has_type', cardType: subject },
      ),
      layer: 4,
    });
  }
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
