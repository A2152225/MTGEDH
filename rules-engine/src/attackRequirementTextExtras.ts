// rules-engine/src/attackRequirementTextExtras.ts
// Extra "attacks each combat if able" sources for permanentHasMustAttackRequirement:
// Berzerker / Iron Golem "~ attacks or blocks each combat if able", and Aura /
// Equipment hosts ("Enchanted creature [gets +N/+N and] attacks [or blocks]
// each combat if able" - Lust for War, Furor of the Bitten).
// Public entry symbols: permanentHasMustAttackFromTextExtras.

const SELF_RE = /(?:\bthis creature|~) attacks or blocks each combat if able\b/;
const ATTACHED_RE = /\b(?:enchanted|equipped) creature (?:[^.()]*?\band )?attacks (?:or blocks )?each combat if able\b/;

function lower(text: unknown): string {
  return String(text || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

export function permanentHasMustAttackFromTextExtras(permanent: any, battlefield?: readonly any[]): boolean {
  if (!permanent) return false;
  const name = lower(permanent?.card?.name).trim();
  let own = lower(permanent?.card?.oracle_text || permanent?.oracle_text);
  if (name) {
    own = own.split(name).join('~');
    const short = name.split(' // ')[0].split(',')[0].trim();
    if (short && short !== name) own = own.split(short).join('~');
  }
  if (SELF_RE.test(own)) return true;
  const id = String(permanent?.id || '');
  if (!id || !Array.isArray(battlefield)) return false;
  for (const source of battlefield) {
    if (!source || String(source.attachedTo || '') !== id) continue;
    if (ATTACHED_RE.test(lower(source?.card?.oracle_text || source?.oracle_text))) return true;
  }
  return false;
}
