/**
 * Early classification of an activation request as a mana ability (CR 605.1a) before the
 * special handlers (equip, crew, level up, fetch lands, ...) run. Used so a lock saying
 * "its activated abilities can't be activated unless they're mana abilities" also stops
 * those special activations, which are never mana abilities.
 */
const SPECIAL_NON_MANA_ID = /-(?:equip|fortify|reconfigure|crew|station|level-up|outlast|boast|monstrosity|adapt|cycling|fetch|loyalty|pw|upgrade|unlock|saddle|dominus)\b/i;

export function isLikelyManaActivation(abilityId: string, abilityText: string): boolean {
  const id = String(abilityId || '');
  if (SPECIAL_NON_MANA_ID.test(id)) return false;
  const text = String(abilityText || '');
  if (/\btarget\b/i.test(text)) return false;
  if (/^\s*[+\u2212\u2013-]?\d+\s*:/.test(text)) return false; // loyalty
  return /\badd\b/i.test(text) || /-mana(?:-|$)/i.test(id);
}