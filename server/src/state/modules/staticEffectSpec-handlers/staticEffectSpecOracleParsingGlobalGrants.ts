// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingGlobalGrants.ts
// Unconditional global / group grants written as whole static lines:
//   "All creatures have haste." (Concordant Crossroads, Mass Hysteria) -> all_creatures abilities.
//   "All permanents have <kw>." -> all_permanents abilities.
//   "<~ | this creature | NAME> is all colors." (Transguild Courier) -> self color additions (WUBRG).
//   "(All creatures | Creatures you control | All permanents | Permanents you control) are all colors."
// Lines with "until end of turn" or a trigger/activation prefix are not statics and are ignored.
// Public entry symbols: pushGlobalGrantSpecs.

import type { StaticEffectSpec, StaticEffectScopeKind } from '../staticEffectSpecTypes.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const ALL_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const GROUP_SCOPES: Record<string, StaticEffectScopeKind> = {
  'all creatures': 'all_creatures',
  'creatures you control': 'creatures_you_control',
  'all permanents': 'all_permanents',
  'permanents you control': 'permanents_you_control',
  'other creatures you control': 'other_creatures_you_control',
};
const GROUP = '(all creatures|other creatures you control|creatures you control|all permanents|permanents you control)';
const HAVE = new RegExp('^' + GROUP.replace('|other creatures you control|creatures you control', '') + ' have ([^."]+)\\.?$');
const ALL_COLORS_GROUP = new RegExp('^' + GROUP + ' are all colors\\.?$');

export function pushGlobalGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const name = String(source.sourceName || '').toLowerCase();
  const short = name.split(',')[0].trim();
  const selfSubjects = ['~', 'this creature', 'this permanent', 'this artifact', name, short].filter(Boolean);
  for (const raw of String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/)) {
    const line = raw.replace(/\([^)]*\)/g, '').trim();
    if (!line || /until end of turn|^(?:when|whenever|at)\b|:/.test(line)) continue;
    let m = line.match(HAVE);
    if (m) {
      const abilities = parseAbilitiesFromTail(m[2]);
      const id = `global-grant:${m[1].replace(/ /g, '-')}`;
      if (abilities.length > 0 && !specs.some((s) => String(s.id).endsWith(id))) {
        specs.push(buildSpec(source, id, { kind: GROUP_SCOPES[m[1]] }, { abilities }));
      }
      continue;
    }
    m = line.match(ALL_COLORS_GROUP);
    if (m) {
      specs.push(buildSpec(source, `all-colors:${m[1].replace(/ /g, '-')}`, { kind: GROUP_SCOPES[m[1]] }, { colorAdditions: [...ALL_COLORS] }));
      continue;
    }
    const selfMatch = line.match(/^(.+?) is all colors\.?$/);
    if (selfMatch && selfSubjects.includes(selfMatch[1].trim())) {
      specs.push(buildSpec(source, 'all-colors:self', { kind: 'self' }, { colorAdditions: [...ALL_COLORS] }));
    }
  }
}
