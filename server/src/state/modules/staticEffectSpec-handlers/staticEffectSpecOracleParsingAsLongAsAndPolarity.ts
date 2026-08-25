// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingAsLongAsAndPolarity.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: player hexproof/shroud, you+planeswalkers+other-creatures grants,
//   you-and-type grants, other-creature / opponent P/T polarity.
// Public entry symbols: pushPlayerHexproofAndConditionalGrantSpecs,
//   pushOtherCreatureAndOpponentPolaritySpecs.

import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
import type { StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  parseAbilitiesFromTail,
  parseBuffSegment,
  parseLordCreatureType,
  pushPlayerAbilityGrantsFromList,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

/** "You have hexproof." / "You and Humans you control have hexproof." */
export function pushPlayerHexproofAndConditionalGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  if (/\byou have hexproof\b/i.test(oracle)) {
    pushPlayerAbilityGrantsFromList(specs, source, 'you-have', ['hexproof']);
  }
  if (/\byou have shroud\b/i.test(oracle)) {
    pushPlayerAbilityGrantsFromList(specs, source, 'you-have', ['shroud']);
  }

  // "You, planeswalkers you control, and other creatures you control have hexproof."
  // Require the planeswalker conjunct; do not treat "you and other creatures you
  // control have" as if it also covered planeswalkers.
  const youPlaneswalkersAndOtherMatch = oracle.match(
    /you,?\s+planeswalkers you control,?\s+and\s+other\s+creatures you control have\s+([^.]+)/i,
  );
  if (youPlaneswalkersAndOtherMatch) {
    const abilities = parseAbilitiesFromTail(youPlaneswalkersAndOtherMatch[1] || '');
    if (abilities.length > 0) {
      specs.push(buildSpec(
        source,
        'you-planeswalkers-other-creatures-ability-grant',
        { kind: 'other_creatures_you_control' },
        { abilities },
      ));
      specs.push(buildSpec(
        source,
        'you-planeswalkers-ability-grant',
        { kind: 'planeswalkers_you_control' },
        { abilities },
      ));
      pushPlayerAbilityGrantsFromList(specs, source, 'you-planeswalkers-other', abilities);
      return;
    }
  }

  // Sigarda, Heron's Grace: "You and Humans you control have hexproof."
  // Do not steal "you and other creatures you control have".
  const youAndTypeMatch = oracle.match(
    /you and (?!other )([a-z]+)s? you control have ([^.]+)/i,
  );
  if (!youAndTypeMatch) return;

  const creatureType = parseLordCreatureType(String(youAndTypeMatch[1] || ''));
  const abilities = parseAbilitiesFromTail(youAndTypeMatch[2] || '');
  if (!creatureType || !isCreatureTypeWord(creatureType) || abilities.length === 0) return;

  specs.push(buildSpec(
    source,
    `you-and-${creatureType}-ability-grant`,
    { kind: 'creatures_you_control', creatureType },
    { abilities },
  ));
  pushPlayerAbilityGrantsFromList(specs, source, `you-and-${creatureType}`, abilities);
}

/**
 * Elesh Norn polarity:
 * "Other creatures you control get +2/+2."
 * "Creatures your opponents control get -2/-2."
 */
export function pushOtherCreatureAndOpponentPolaritySpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const otherCreaturesMatch = oracle.match(
    /other creatures you control get\s+([+-]?\d+\s*\/\s*[+-]?\d+)([^.]*)/i,
  );
  if (otherCreaturesMatch) {
    const buff = parseBuffSegment(otherCreaturesMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'other-creatures-polarity',
        { kind: 'other_creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(otherCreaturesMatch[2] || ''),
        },
      ));
    }
  }

  const opponentCreaturesMatch = oracle.match(
    /creatures your opponents control get\s+([+-]?\d+\s*\/\s*[+-]?\d+)([^.]*)/i,
  );
  if (opponentCreaturesMatch) {
    const buff = parseBuffSegment(opponentCreaturesMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'opponent-creatures-polarity',
        { kind: 'opponent_creatures' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(opponentCreaturesMatch[2] || ''),
        },
      ));
    }
  }
}
