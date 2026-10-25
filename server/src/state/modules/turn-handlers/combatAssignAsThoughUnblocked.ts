// Origin parent: server/src/state/modules/turn-handlers/turnCombatDamageAttackerLoop.ts
// "You may have ~ assign its combat damage as though it weren't blocked" (Thorn Elemental family),
// aura/equipment grants (Indomitable Might) and "for each non-TYPE creature you control" (Zilortha
// variants). The optional choice defaults to yes; set attacker.assignAsThoughUnblocked = false to decline.
// Public entry symbols: assignsCombatDamageAsThoughUnblocked.

const SELF = /you may have ~ assign (?:its|his|her|their) combat damage as though (?:it|he|she|they) weren't blocked/;
const ATTACHED = /(?:enchanted|equipped) creature's controller may have it assign its combat damage as though it weren't blocked/;
const EACH = /for each (?:non-?([a-z]+) )?creature you control, you may have that creature assign its combat damage as though it weren't blocked/;

function normalize(text: unknown, name: unknown): string {
  let out = String(text || '').replace(/[\u2018\u2019]/g, "'").toLowerCase().replace(/\s+/g, ' ');
  const full = String(name || '').toLowerCase().trim();
  for (const n of [full, full.split(',')[0].trim()]) if (n) out = out.split(n).join('~');
  return out.replace(/\bthis creature\b/g, '~');
}

export function assignsCombatDamageAsThoughUnblocked(attacker: any, battlefield: readonly any[]): boolean {
  if (!attacker || attacker.assignAsThoughUnblocked === false) return false;
  if (SELF.test(normalize(attacker.card?.oracle_text, attacker.card?.name))) return true;
  const granted = Array.isArray(attacker.grantedAbilities) ? attacker.grantedAbilities : [];
  if (granted.some((g: unknown) => /as though it weren't blocked/i.test(String(g || '').replace(/[\u2018\u2019]/g, "'")))) return true;
  const attackerId = String(attacker.id || '');
  for (const perm of battlefield || []) {
    if (!perm?.card || perm.phasedOut === true) continue;
    const oracle = normalize(perm.card.oracle_text, perm.card.name);
    if (!oracle.includes("as though it weren't blocked")) continue;
    if (attackerId && String(perm.attachedTo || '') === attackerId && ATTACHED.test(oracle)) return true;
    const m = oracle.match(EACH);
    if (m && String(perm.controller || '') === String(attacker.controller || '')) {
      const typeLine = String(attacker.card?.type_line || '').toLowerCase();
      if (!m[1] || !new RegExp(`\\b${m[1]}\\b`).test(typeLine)) return true;
    }
  }
  return false;
}
