// rules-engine/src/batch105MonarchControl.ts
// "The monarch controls enchanted creature." The Aura's controller is not automatically the monarch.

const MONARCH_RE = /the monarch controls enchanted (?:creature|permanent|artifact|land|planeswalker|enchantment)/i;

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

export function batch105MonarchControllerForEnchanted(aura: any, state: any): string | null {
  if (!aura || !MONARCH_RE.test(oracleOf(aura))) return null;
  const id = String(state?.monarch || state?.monarchId || '').trim();
  return id || null;
}
