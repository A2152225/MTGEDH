// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingEnchantedCreatureLord.ts
// Magemark cycle: "Creatures you control that are enchanted get +1/+1 [and have <keyword>]."
// Emits a creatures_you_control spec gated on target_is_enchanted (any Aura attached, any controller).
// Cheap prefilter on the raw Oracle text keeps the per-permanent parse cost flat on big boards.
// Public entry symbols: pushEnchantedCreatureLordSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectGrant, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const PREFILTER_RE = /that are enchanted get/i;
const LINE_RE = /^creatures you control that are enchanted get ([+-]\d+)\/([+-]\d+)(?: and have ([a-z ,]+?))?\.?$/;
const KEYWORDS = new Set(['flying', 'first strike', 'double strike', 'trample', 'vigilance', 'lifelink', 'deathtouch', 'haste', 'reach', 'hexproof', 'indestructible', 'menace']);

export function pushEnchantedCreatureLordSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  if (!PREFILTER_RE.test(String(oracle || ''))) return;
  String(oracle).toLowerCase().replace(/\u2212/g, '-').split(/\n+/).forEach((raw, index) => {
    const m = raw.trim().match(LINE_RE);
    if (!m) return;
    const grant: StaticEffectGrant = { power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) };
    if (m[3]) {
      const kws = m[3].split(/,\s*|\s+and\s+/).map((k) => k.trim()).filter(Boolean);
      if (!kws.every((k) => KEYWORDS.has(k))) return;
      (grant as any).abilities = kws;
    }
    specs.push(buildSpec(source, 'enchanted-creature-lord:' + index, { kind: 'creatures_you_control' }, grant, { kind: 'target_is_enchanted' }));
  });
}
