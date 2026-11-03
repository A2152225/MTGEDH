// server/src/state/modules/enchantedPermanentDestroyReplacement.ts
// B49: "If enchanted land would be destroyed, instead sacrifice this Aura and that land gains indestructible
// until end of turn." (Harmonious Emergence, Crackling Emergence). Generic over the enchanted type word.
// Origin parent: destroyPermanent (counters_tokens.ts), next to the static regenerate replacement.
// Public entry symbols: findEnchantedDestroyReplacementAura, tryEnchantedPermanentDestroyReplacement.

const SAC_AURA_RE = /\bif enchanted (land|creature|artifact|permanent|enchantment|planeswalker) would be destroyed, instead sacrifice (?:~|this aura) and that \1 gains indestructible until end of turn\b/;

function auraText(aura: any): string {
  const text = String(aura?.card?.oracle_text || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const name = String(aura?.card?.name || '').toLowerCase();
  return name ? text.split(name).join('~') : text;
}

function typeMatches(perm: any, word: string): boolean {
  if (word === 'permanent') return true;
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase().split(/[^a-z]+/).includes(word);
}

/** The Aura attached to perm whose replacement applies, if any. */
export function findEnchantedDestroyReplacementAura(battlefield: readonly any[] | undefined, perm: any): any | null {
  const id = String(perm?.id || '');
  if (!id) return null;
  for (const aura of Array.isArray(battlefield) ? battlefield : []) {
    if (!aura || aura.phasedOut || String(aura.attachedTo || '') !== id) continue;
    const m = auraText(aura).match(SAC_AURA_RE);
    if (m && typeMatches(perm, m[1])) return aura;
  }
  return null;
}

function grantIndestructibleUntilEndOfTurn(perm: any): void {
  perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
  if (!perm.grantedAbilities.includes('Indestructible')) {
    perm.grantedAbilities.push('Indestructible');
    perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === 'object' ? perm.untilEndOfTurn : {};
    const list = Array.isArray(perm.untilEndOfTurn.grantedAbilitiesToRemove) ? perm.untilEndOfTurn.grantedAbilitiesToRemove : [];
    if (!list.includes('Indestructible')) list.push('Indestructible');
    perm.untilEndOfTurn.grantedAbilitiesToRemove = list;
  }
}

/**
 * Applies the replacement when it exists: sacrifices the Aura (via sacrificeAura, normally
 * movePermanentToGraveyard) and gives the enchanted permanent indestructible until end of turn.
 * Returns true when the destruction was replaced.
 */
export function tryEnchantedPermanentDestroyReplacement(state: any, permanentId: string, sacrificeAura: (auraId: string) => unknown): boolean {
  const bf = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const perm = bf.find((p: any) => p && String(p.id || '') === String(permanentId || ''));
  if (!perm) return false;
  const aura = findEnchantedDestroyReplacementAura(bf, perm);
  if (!aura) return false;
  sacrificeAura(String(aura.id));
  grantIndestructibleUntilEndOfTurn(perm);
  state.replacementLog = Array.isArray(state.replacementLog) ? state.replacementLog : [];
  state.replacementLog.push({ kind: 'enchanted-destroy-sacrifice-aura', permanentId: String(perm.id), auraId: String(aura.id), auraName: String(aura.card?.name || '') });
  return true;
}
