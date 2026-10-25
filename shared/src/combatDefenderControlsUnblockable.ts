/**
 * "~ can't be blocked as long as defending player controls an artifact" (Bouncing Beebles,
 * Scrapdiver Serpent, Shrouded Serpent-style). Matches the listed words against the
 * defending player's permanents' type lines (all words must appear, e.g. "snow land").
 */
type Perm = { controller?: string; card?: { type_line?: string; oracle_text?: string }; type_line?: string; oracle_text?: string };

const RE = /can't be blocked as long as defending player controls (?:an?|one or more) ([a-z][a-z -]*?)(?:\s*[.(]|$)/i;

export function parseDefenderControlsUnblockable(oracle: string): string[] | undefined {
  const m = String(oracle || '').toLowerCase().match(RE);
  if (!m) return undefined;
  const words = m[1].trim().replace(/s$/, '').split(/\s+/).filter(Boolean);
  return words.length ? words : undefined;
}

export function getDefenderControlsUnblockableReason(
  attacker: Perm | undefined,
  defendingPlayerId: string | undefined,
  battlefield: ReadonlyArray<Perm>,
): string | undefined {
  if (!attacker || !defendingPlayerId) return undefined;
  const words = parseDefenderControlsUnblockable(String(attacker.card?.oracle_text || attacker.oracle_text || ''));
  if (!words) return undefined;
  const hit = battlefield.some((perm) => {
    if (!perm || String(perm.controller) !== String(defendingPlayerId)) return false;
    const tl = String(perm.card?.type_line || perm.type_line || '').toLowerCase();
    return words.every((w) => new RegExp('\\b' + w + 's?\\b').test(tl));
  });
  const noun = words.join(' ');
  return hit ? 'Attacker can\'t be blocked while defending player controls ' + (/^[aeiou]/.test(noun) ? 'an ' : 'a ') + noun : undefined;
}
