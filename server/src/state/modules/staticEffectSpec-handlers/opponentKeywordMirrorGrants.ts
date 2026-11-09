// server/src/state/modules/staticEffectSpec-handlers/opponentKeywordMirrorGrants.ts
// B61: Escaped Shapeshifter ? "As long as an opponent controls a creature with flying not named ~,
// this creature has flying. The same is true for first strike, trample, and protection from any color."
// Public entry symbols: pushOpponentKeywordMirrorGrantSpecs.

import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const LEAD_RE =
  /as long as an opponent controls a creature with ([a-z][a-z ]*?) not named ([^,\.]+),\s*(?:this creature|~) has ([^.]+)\.?/i;
const SAME_RE = /the same is true for (.+?)\.?$/i;

function splitAbilityList(raw: string): string[] {
  const text = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return [];
  return text
    .replace(/\band\b/g, ',')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function normalizeAbility(raw: string): string | null {
  const a = String(raw || '').toLowerCase().trim();
  if (!a) return null;
  if (a === 'protection from any color' || a === 'protection from any colour') {
    return 'protection from any color';
  }
  return a;
}

function opponentKeywordFor(ability: string): string {
  if (ability.startsWith('protection')) return 'protection';
  return ability;
}

export function pushOpponentKeywordMirrorGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  const lower = text.toLowerCase();
  const lead = lower.match(LEAD_RE);
  if (!lead) return;

  const excludedName = String(lead[2] || '')
    .trim()
    .toLowerCase()
    .replace(/^~$/, String(source.sourceName || '').toLowerCase());
  const abilities = new Set<string>();
  const leadAbility = normalizeAbility(lead[3] || lead[1] || '');
  if (leadAbility) abilities.add(leadAbility);

  for (const line of lower.split(/\n+/)) {
    const same = line.trim().match(SAME_RE);
    if (!same) continue;
    for (const part of splitAbilityList(same[1])) {
      const ability = normalizeAbility(part);
      if (ability) abilities.add(ability);
    }
  }

  let index = 0;
  for (const ability of abilities) {
    const condition = {
      kind: 'opponent_controls_creature_with_keyword_excluding_name',
      keyword: opponentKeywordFor(ability),
      excludedName: excludedName || String(source.sourceName || '').toLowerCase(),
      ...(ability.startsWith('protection') ? { option: ability } : {}),
    } as StaticEffectCondition;
    specs.push(buildSpec(
      source,
      `opponent-keyword-mirror:${index++}`,
      { kind: 'self' },
      { abilities: [ability] },
      condition,
    ));
  }
}
