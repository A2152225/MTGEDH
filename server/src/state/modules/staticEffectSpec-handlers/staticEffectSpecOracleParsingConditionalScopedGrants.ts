// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingConditionalScopedGrants.ts
// Conditional group grants: "As long as <condition>, [artifacts and] creatures you control have <keywords>"
// (Storied / enduring story and any condition parseStaticSelfCondition understands). Unrecognized
// conditions yield no spec.
// B52: trailing-condition form "[Metalcraft -] Artifacts you control have shroud as long as you control three or
// more artifacts" (Indomitable Archangel) and "Creatures attacking enchanted player have <keywords>" (Curses).
// Public entry symbols: pushConditionalScopedGrantSpecs.

import type { StaticEffectSpec } from '../staticEffectSpec.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseStaticSelfCondition } from './staticEffectSpecOracleParsingConditionalSelfGrants.js';

const SCOPED = /^\s*as long as ([^,]+),\s*(artifacts and creatures|creatures and artifacts|creatures|artifacts|permanents) you control have\s+([^.]+)/;

const TRAILING = /^\s*(?:[a-z]+\s*[\u2014-]\s*)?(artifacts and creatures|creatures and artifacts|creatures|artifacts|permanents) you control have\s+([^.]+?)\s+as long as ([^.]+)/;
const ATTACKING_ENCHANTED = /^\s*creatures attacking enchanted player have\s+([^."]+?)(?:\s+and\s+"|\.|$)/;

export function pushConditionalScopedGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  let index = 0;
  for (const line of String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/)) {
    const curse = line.match(ATTACKING_ENCHANTED);
    if (curse) {
      const abilities = parseAbilitiesFromTail(curse[1]);
      if (abilities.length > 0) {
        specs.push(buildSpec(source, `attacking-enchanted-player-grant-${index++}`, { kind: 'all_creatures' }, { abilities }, { kind: 'target_is_attacking_enchanted_player' }));
      }
      continue;
    }
    const trailing = line.match(TRAILING);
    const match = line.match(SCOPED) || (trailing ? [trailing[0], trailing[3], trailing[1], trailing[2]] as unknown as RegExpMatchArray : null);
    if (!match) continue;
    const condition = parseStaticSelfCondition(match[1]);
    const abilities = parseAbilitiesFromTail(match[3]);
    if (!condition || abilities.length === 0) continue;
    const scope = match[2];
    if (scope === 'permanents') {
      specs.push(buildSpec(source, `conditional-scoped-grant-${index++}`, { kind: 'permanents_you_control' }, { abilities }, condition));
      continue;
    }
    if (scope.includes('creatures')) {
      specs.push(buildSpec(source, `conditional-scoped-grant-${index++}`, { kind: 'creatures_you_control' }, { abilities }, condition));
    }
    if (scope.includes('artifacts')) {
      const spec = buildSpec(source, `conditional-scoped-grant-${index++}`, { kind: 'permanents_you_control' }, { abilities }, condition);
      specs.push({ ...spec, conditions: [{ kind: 'target_has_type', cardType: 'artifact' }] });
    }
  }
}
