// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingR35CombatGrants.ts
// R35 combat static grants (CR 509.1b, 701.15):
//   "This creature can't be blocked by non-Wall creatures / creature tokens" (self) and
//   "Enchanted/Equipped creature can't be blocked by creatures with power 3 or greater" (host): the ability text
//   "can't be blocked by <filter>" is read by combatQualifierBlockRestriction via continuous granted abilities.
//   "Enchanted creature is goaded." -> host ability "goaded" (server forced-attack checks honor it).
//   "Goaded creatures your opponents control can't block." -> opponents' creatures get "can't block while goaded".
//   "Creatures your opponents control with power less than ~'s power are goaded." -> conditional "goaded".
// Public entry symbols: pushR35CombatGrantSpecs, STATIC_GOADED_ABILITY, CANT_BLOCK_WHILE_GOADED.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

export const STATIC_GOADED_ABILITY = 'goaded';
export const CANT_BLOCK_WHILE_GOADED = "can't block while goaded";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&');
}

export function pushR35CombatGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const name = String(source.sourceName || '').toLowerCase().trim();
  const short = name.split(',')[0].trim();
  const self = '(?:this creature|~' + (name ? '|' + escapeRe(name) : '') + (short && short !== name ? '|' + escapeRe(short) : '') + ')';
  const blockByRe = new RegExp('^(' + self + '|enchanted creature|equipped creature) can\'t be blocked by (.+)$');
  const baelothRe = new RegExp('^creatures your opponents control with power less than ' + self + '\'s power are goaded$');
  const hostId = String((perm as any)?.attachedTo || '').trim();
  const lines = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/);
  const hostSpec = (suffix: string, abilities: string[]): StaticEffectSpec | null => hostId
    ? { ...buildSpec(source, suffix, { kind: 'self' }, { abilities }), sourcePermanentId: hostId, scope: { kind: 'self' } }
    : null;
  lines.forEach((raw, index) => {
    const line = raw.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '');
    const block = line.match(blockByRe);
    if (block) {
      const filter = block[2].trim();
      if (/\b(?:more than|this turn|as long as|unless|except|if)\b/.test(filter)) return;
      const ability = "can't be blocked by " + filter;
      if (/^(?:enchanted|equipped) creature$/.test(block[1])) {
        const spec = hostSpec('attached-block-filter:' + index, [ability]);
        if (spec) specs.push(spec);
      } else {
        specs.push(buildSpec(source, 'self-block-filter:' + index, { kind: 'self' }, { abilities: [ability] }));
      }
      return;
    }
    if (/^(?:enchanted|equipped) creature is goaded$/.test(line)) {
      const spec = hostSpec('attached-static-goad:' + index, [STATIC_GOADED_ABILITY]);
      if (spec) specs.push(spec);
      return;
    }
    if (/^goaded creatures your opponents control can't block$/.test(line)) {
      specs.push(buildSpec(source, 'goaded-cant-block:' + index, { kind: 'opponent_creatures' }, { abilities: [CANT_BLOCK_WHILE_GOADED] }));
      return;
    }
    if (baelothRe.test(line)) {
      specs.push(buildSpec(source, 'power-less-goad:' + index, { kind: 'opponent_creatures' }, { abilities: [STATIC_GOADED_ABILITY] },
        { kind: 'target_power_less_than_source', sourcePermanentId: source.sourcePermanentId } as any));
    }
  });
}
