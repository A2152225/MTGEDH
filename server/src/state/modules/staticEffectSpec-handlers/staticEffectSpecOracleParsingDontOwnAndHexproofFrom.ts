// B58: Don Andres don't-own creature lords, and Tam "hexproof from each of its colors".
// Public entry symbols: pushDontOwnAndHexproofFromSpecs.

import type { StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const DONT_OWN_RE =
  /(?:^|[.\n;])\s*(?:each )?(other\s+)?creatures? you control but don'?t own get(?:s)?\s+([+-]\d+\s*\/\s*[+-]\d+)(?:,?\s+has\s+([^.,]+))?(?:,?\s+and\s+is\s+an?\s+([a-z]+)\s+in addition to (?:its|their) other types)?/gi;

const HEXPROOF_FROM_OWN_COLORS_RE =
  /(?:^|[.\n;])\s*(?:each )?(other\s+)?creatures? you control has hexproof from each of its colors/gi;

export function pushDontOwnAndHexproofFromSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '');
  for (const match of text.toLowerCase().matchAll(DONT_OWN_RE)) {
    const isOther = Boolean(match[1]);
    const buff = parseBuffSegment(match[2] || '');
    const abilities = parseLordAbilitiesFromTail(match[3] || '');
    const typeWord = String(match[4] || '').trim();
    const typeAdditions = typeWord
      ? [typeWord.charAt(0).toUpperCase() + typeWord.slice(1)]
      : [];
    if (!buff && abilities.length === 0 && typeAdditions.length === 0) continue;
    const grant: any = {};
    if (buff) { grant.power = buff.power; grant.toughness = buff.toughness; }
    if (abilities.length) grant.abilities = abilities;
    if (typeAdditions.length) grant.typeAdditions = typeAdditions;
    const spec = buildSpec(
      source,
      `dont-own-lord:${typeWord || 'any'}`,
      { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control' },
      grant,
      { kind: 'target_not_owned_by_source_controller' } as any,
    );
    if (typeAdditions.length) (spec as any).layer = 4;
    specs.push(spec);
  }
  for (const match of text.toLowerCase().matchAll(HEXPROOF_FROM_OWN_COLORS_RE)) {
    const isOther = Boolean(match[1]);
    specs.push(buildSpec(
      source,
      'hexproof-from-own-colors',
      { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control' },
      { hexproofFromOwnColors: true } as any,
    ));
  }
}
