// rules-engine/src/attackRequirementTextExtras.ts
// Extra "attacks each combat if able" sources for permanentHasMustAttackRequirement:
// Berzerker / Iron Golem "~ attacks or blocks each combat if able", and Aura /
// Equipment hosts ("Enchanted creature [gets +N/+N and] attacks [or blocks]
// each combat if able" - Lust for War, Furor of the Bitten).
// B58: Reckless Cohort "~ attacks each combat if able unless you control another Ally".
// Public entry symbols: permanentHasMustAttackFromTextExtras.

const SELF_RE = /(?:\bthis creature|~) attacks or blocks each combat if able\b/;
const ATTACHED_RE = /\b(?:enchanted|equipped) creature (?:[^.()]*?\band )?attacks (?:or blocks )?each combat if able\b/;
const UNLESS_ALLY_RE = /(?:\bthis creature|~) attacks each combat if able unless you control another ally\b/;

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
  // B58: Reckless Cohort - must attack only when you do NOT control another Ally.
  if (UNLESS_ALLY_RE.test(own)) {
    const controller = String(permanent?.controller || '').trim();
    const selfId = String(permanent?.id || '');
    const hasOtherAlly = Array.isArray(battlefield) && battlefield.some((p) => {
      if (!p || String(p.id || '') === selfId) return false;
      if (String(p.controller || '') !== controller) return false;
      const tl = String(p?.card?.type_line || p?.type_line || '').toLowerCase();
      return /\bally\b/.test(tl);
    });
    return !hasOtherAlly;
  }
  const id = String(permanent?.id || '');
  if (!id || !Array.isArray(battlefield)) return false;
  for (const source of battlefield) {
    if (!source || String(source.attachedTo || '') !== id) continue;
    if (ATTACHED_RE.test(lower(source?.card?.oracle_text || source?.oracle_text))) return true;
  }
  return false;
}
