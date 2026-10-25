// server/src/socket/combat-handlers/combatBatch31BlockRestrictions.ts
// Batch 31: "~ can't be blocked except by artifact creatures and/or COLOR creatures." (Amrou Seekers, Skirk Shaman)
// Origin parent: combatLegalityGates.ts canBlockAttacker.
// Public entry symbols: artifactOrColorBlockOnlyReason.

const COLOR_CODE: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const RE = /can't be blocked except by artifact creatures and\/or (white|blue|black|red|green) creatures/;

function blockerColors(blocker: any): string[] {
  const card = blocker?.card || {};
  const raw = Array.isArray(card.colors) ? card.colors : Array.isArray(blocker?.colors) ? blocker.colors : null;
  if (raw) return raw.map((c: any) => { const k = String(c).toLowerCase(); return k.length === 1 ? k.toUpperCase() : (COLOR_CODE[k] || ''); });
  const cost = String(card.mana_cost || '');
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.toUpperCase().includes('{' + c) || cost.toUpperCase().includes(c + '}'));
}

export function artifactOrColorBlockOnlyReason(blocker: any, attacker: any): string | null {
  const text = String(attacker?.card?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
  const m = text.match(RE);
  if (!m) return null;
  const typeLine = String(blocker?.card?.type_line || blocker?.type_line || '').toLowerCase();
  if (typeLine.includes('artifact')) return null;
  if (blockerColors(blocker).includes(COLOR_CODE[m[1]])) return null;
  return `${attacker?.card?.name || 'This creature'} can't be blocked except by artifact creatures and/or ${m[1]} creatures.`;
}
