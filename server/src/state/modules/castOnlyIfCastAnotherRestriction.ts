// server/src/state/modules/castOnlyIfCastAnotherRestriction.ts
// Spell's own casting restriction (CR 601.3):
//   "Cast this spell only if you've cast another spell this turn." (Illusory Angel, Skyshroud Condor)
//   "Cast this spell only if you've cast another <color> spell this turn." (Talara's Battalion)
// Counts spells already recorded in state.spellsCastThisTurn for the caster (the spell being cast is
// not recorded yet when casting legality is checked).
// Public entry symbols: castOnlyIfCastAnotherViolation.

const COLOR_CODES: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const RE = /\bcast this spell only if you've cast another (?:(white|blue|black|red|green) )?spell this turn\b/;

function spellOracle(spell: any): string {
  const card = spell?.card || spell || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  return [card.oracle_text || spell?.oracle_text || '', ...faces].join('\n').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function entryColors(entry: any): string[] {
  const raw = entry?.card?.colors ?? entry?.colors ?? entry?.card?.color_identity;
  return Array.isArray(raw) ? raw.map((c: any) => String(c).toUpperCase()) : [];
}

export function castOnlyIfCastAnotherViolation(state: any, playerId: string, spell: any): string | null {
  const m = spellOracle(spell).match(RE);
  if (!m) return null;
  const list = Array.isArray(state?.spellsCastThisTurn) ? state.spellsCastThisTurn : [];
  const spellId = String(spell?.id || spell?.card?.id || '');
  const prior = list.filter((entry: any) => {
    const caster = String(entry?.casterId ?? entry?.playerId ?? entry?.controllerId ?? '');
    if (caster !== playerId) return false;
    const id = String(entry?.card?.id || entry?.cardId || entry?.id || '');
    return !(spellId && id === spellId);
  });
  const color = m[1];
  const ok = color ? prior.some((entry: any) => entryColors(entry).includes(COLOR_CODES[color])) : prior.length > 0;
  if (ok) return null;
  return color
    ? `Cast this spell only if you've cast another ${color} spell this turn.`
    : "Cast this spell only if you've cast another spell this turn.";
}
