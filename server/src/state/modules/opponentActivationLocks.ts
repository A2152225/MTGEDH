// server/src/state/modules/opponentActivationLocks.ts
// Batch 32: generic opponent activation lock read from battlefield oracle text.
//   "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments."
//   (Grand Abolisher, Myrel, Shield of Argive) and the unconditional "Your opponents can't activate abilities of <types>".
// Mana abilities ARE covered (CR: Abolisher stops all activated abilities of those types) unless the line says
// "unless they're mana abilities". Activation of the lock holder's own permanents is never restricted.
// Origin parent: socket/interaction.ts activateBattlefieldAbility gate + canRespondActivatableAbilities.
// Public entry symbols: parseOpponentActivationLock, opponentActivationProhibitionReason.

export interface OpponentActivationLock { duringYourTurnOnly: boolean; types: string[]; allowsMana: boolean }

const LOCK_RE = /^(during your turn, )?(?:your opponents|each opponent) can't (?:cast spells(?:,| or) )?(?:and )?activate (?:activated )?abilities of ([a-z ,]+?)(?: unless they're mana abilities)?\.?$/;
const TYPE_WORDS = ['artifact', 'creature', 'enchantment', 'planeswalker', 'land', 'battle'];

/** Parse one lowercased oracle line; null when it is not an opponent activation lock. */
export function parseOpponentActivationLock(rawLine: string): OpponentActivationLock | null {
  const line = String(rawLine || '').replace(/\u2019/g, "'").toLowerCase().trim();
  const m = line.match(LOCK_RE);
  if (!m) return null;
  const words = m[2].split(/,|\bor\b|\band\b/).map((w) => w.trim().replace(/s$/, '')).filter(Boolean);
  if (!words.length || !words.every((w) => TYPE_WORDS.includes(w))) return null;
  return { duringYourTurnOnly: !!m[1], types: words, allowsMana: /unless they're mana abilities/.test(line) };
}

/** Reason string when playerId can't activate abilities of `permanent` because of an opponent's lock, else null. */
export function opponentActivationProhibitionReason(state: any, playerId: string, permanent: any, isManaAbility = false): string | null {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  if (!typeLine) return null;
  const turnPlayer = String(state?.turnPlayer ?? state?.activePlayer ?? '');
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    const controller = String(perm?.controller || '');
    if (!controller || controller === String(playerId)) continue;
    const text = String(perm?.card?.oracle_text || perm?.oracle_text || '');
    for (const line of text.split(/\n+/)) {
      const lock = parseOpponentActivationLock(line);
      if (!lock) continue;
      if (lock.duringYourTurnOnly && turnPlayer !== controller) continue;
      if (isManaAbility && lock.allowsMana) continue;
      if (!lock.types.some((t) => typeLine.includes(t))) continue;
      return `${String(perm?.card?.name || 'An opponent\'s permanent')} prevents activating abilities of ${lock.types.join('s, ')}s${lock.duringYourTurnOnly ? " during its controller's turn" : ''}.`;
    }
  }
  return null;
}
