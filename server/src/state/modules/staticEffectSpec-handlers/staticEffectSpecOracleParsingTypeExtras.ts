// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingTypeExtras.ts
// Layer 4 type-adding lords the census lists as unhandled (round 17):
//   "Creatures you control are the chosen type in addition to their other types." (Arcane Adaptation)
//   "Other creatures you control are <Type>s in addition to their other types."
// Public entry symbols: pushTypeExtraSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectScope, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function pushTypeExtraSpecs(specs: StaticEffectSpec[], source: StaticEffectSpecSource, perm: BattlefieldPermanent, oracle: string): void {
  const chosen = String((perm as any)?.chosenCreatureType || (perm as any)?.card?.chosenCreatureType || '').trim();
  const lines = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/).map((l) => l.replace(/\([^)]*\)/g, '').trim());
  lines.forEach((line, index) => {
    const m = line.match(/^(other )?creatures you control are (the chosen type|[a-z]+?s?) in addition to their other (?:creature )?types(?:\.|$)/);
    if (!m) return;
    const type = m[2] === 'the chosen type' ? chosen : m[2].replace(/s$/, '');
    if (!type) return;
    const scope: StaticEffectScope = { kind: m[1] ? 'other_creatures_you_control' : 'creatures_you_control' };
    specs.push(buildSpec(source, `type-extra-lord:${index}`, scope, { typeAdditions: [cap(type)] }));
  });
}
