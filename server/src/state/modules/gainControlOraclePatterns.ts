// server/src/state/modules/gainControlOraclePatterns.ts
// Generic Oracle wording for "gain control" spells resolved by stackResolveSpellControlChangeUtils.ts:
//   targeted:  Act of Treason "Gain control of target creature until end of turn. Untap that creature. ..."
//              Threaten "Untap target creature and gain control of it until end of turn. ..."
//              Traitorous Instinct "Until end of turn, you gain control of target creature, untap it, ..."
//              Besmirch "Until end of turn, gain control of target creature and it gains haste. ..."
//   mass:      Mob Rule "Gain control of all creatures with power 4 or greater until end of turn. ..."
//              Insurrection "Untap all creatures and gain control of them until end of turn. ..."
// Public entry symbols: parseTargetedGainControl, parseMassGainControl, TargetedGainControl, MassGainControl.

export interface TargetedGainControl { temporary: boolean; noun: string; }
export interface MassGainControl { temporary: boolean; minPower?: number; maxPower?: number; }

const EXCLUDED = /\beach gain control\b|\bexchange control\b|gains control of target|\bgain control of target (?:player|opponent|spell)\b|for as long as/;
const TARGETED = /\bgain control of (target (?:[a-z-]+ ){0,3}?(creature|permanent|artifact|planeswalker|land|enchantment)|it|that (creature|permanent|artifact))\b/;

export function parseTargetedGainControl(text: string): TargetedGainControl | null {
  const t = String(text || '').toLowerCase().replace(/\([^)]*\)/g, ' ');
  if (EXCLUDED.test(t)) return null;
  const m = TARGETED.exec(t);
  if (!m) return null;
  let noun = m[2] || m[3] || '';
  if (!m[1].startsWith('target')) {
    // "gain control of it": the antecedent is an earlier "target <type>" in the same text (Threaten).
    const antecedent = /\btarget (?:[a-z-]+ ){0,3}?(creature|permanent|artifact|planeswalker|land|enchantment)\b/.exec(t.slice(0, m.index));
    if (!antecedent) return null;
    noun = antecedent[1];
  }
  return { temporary: /until end of turn/.test(t), noun };
}

const MASS = /\bgain control of (?:all creatures(?: with power (\d+) or (greater|less))?|them)(?= until end of turn|[.,]|$)/;

export function parseMassGainControl(text: string): MassGainControl | null {
  const t = String(text || '').toLowerCase().replace(/\([^)]*\)/g, ' ');
  if (EXCLUDED.test(t)) return null;
  const m = MASS.exec(t);
  if (!m) return null;
  // "gain control of them" only for "untap all creatures and gain control of them" (Insurrection).
  if (!m[1] && /gain control of them/.test(m[0]) && !/\ball creatures and gain control of them/.test(t)) return null;
  const n = m[1] !== undefined ? parseInt(m[1], 10) : undefined;
  return {
    temporary: /until end of turn/.test(t),
    ...(n !== undefined && m[2] === 'greater' ? { minPower: n } : {}),
    ...(n !== undefined && m[2] === 'less' ? { maxPower: n } : {}),
  };
}
