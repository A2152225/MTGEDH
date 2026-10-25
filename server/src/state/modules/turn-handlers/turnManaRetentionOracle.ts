// Origin parent: server/src/state/modules/turn-handlers/turnClearManaPool.ts
// Generic oracle reader for Rule 106.4 mana retention:
//  - "You don't lose unspent COLOR mana as steps and phases end." (Leyline Tyrant, Fangorn, Electro)
//  - "If you would lose unspent mana, that mana becomes COLOR|colorless instead." (Omnath, Ozai, Kruphix)
// Public entry symbols: readOracleManaRetentionEffects.

export type OracleManaRetentionEffect = {
  permanentId: string;
  cardName: string;
  type: string;
  colors?: string[];
  color?: string;
};

const COLOR = '(white|blue|black|red|green)';
const KEEP = new RegExp(`you don't lose unspent ${COLOR} mana as steps and phases end`, 'g');
const BECOMES = new RegExp(`if you would lose unspent mana, that mana becomes ${COLOR.slice(0, -1)}|colorless) instead`);

export function readOracleManaRetentionEffects(battlefield: readonly any[], playerId: string): OracleManaRetentionEffect[] {
  const effects: OracleManaRetentionEffect[] = [];
  for (const perm of battlefield || []) {
    if (!perm?.card || perm.phasedOut === true || String(perm.controller || '') !== String(playerId)) continue;
    const oracle = String(perm.card.oracle_text || '').replace(/[\u2018\u2019]/g, "'").toLowerCase().replace(/\s+/g, ' ');
    if (!oracle.includes('unspent')) continue;
    const base = { permanentId: String(perm.id), cardName: String(perm.card.name || 'Unknown') };
    const colors = Array.from(oracle.matchAll(KEEP), (m) => m[1]);
    if (colors.length) effects.push({ ...base, type: 'doesnt_empty', colors });
    const b = oracle.match(BECOMES);
    if (b) effects.push(b[1] === 'colorless' ? { ...base, type: 'becomes_colorless' } : { ...base, type: 'becomes_color', color: b[1] });
  }
  return effects;
}
