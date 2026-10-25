// server/src/state/modules/untapStepLimits.ts
// Untap-step caps (CR 502.3 restrictions):
//   "Players can't untap more than one artifact during their untap steps." (Imi Statue, Damping Field)
//   "As long as ~ is untapped, players can't untap more than one land during their untap steps." (Winter Orb)
//   "Your opponents can't untap more than two permanents during their untap steps." (emblems)
// The untapping player would choose which ones untap; the server keeps battlefield order
// (no choice prompt yet).
// Public entry symbols: getUntapStepLimits, UntapStepLimit, untapLimitAllows.

export type UntapStepLimit = { kind: 'artifact' | 'land' | 'creature' | 'permanent'; max: number; sourceId: string };

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const LIMIT_RE = /(?:^|[\n.]\s*)(as long as (?:~|this [a-z]+) is untapped, )?(players|your opponents|each player) can(?:'t|not) untap more than (one|two|three|four|five|\d+) (artifact|land|creature|permanent)s? during their untap steps?\b/gi;

export function getUntapStepLimits(state: any, untappingPlayerId: string): UntapStepLimit[] {
  const out: UntapStepLimit[] = [];
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut) continue;
    const name = String(perm?.card?.name || '').toLowerCase();
    let text = String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
    if (!text.includes('untap more than')) continue;
    if (name) text = text.split(name).join('~');
    for (const m of text.matchAll(LIMIT_RE)) {
      if (m[1] && perm.tapped) continue;
      if (m[2] === 'your opponents' && String(perm.controller || '') === String(untappingPlayerId)) continue;
      const max = WORDS[m[3]] ?? Number(m[3]);
      if (!Number.isFinite(max)) continue;
      out.push({ kind: m[4] as UntapStepLimit['kind'], max, sourceId: String(perm.id || '') });
    }
  }
  return out;
}

function matchesKind(perm: any, kind: UntapStepLimit['kind']): boolean {
  if (kind === 'permanent') return true;
  return new RegExp('\\b' + kind + '\\b').test(String(perm?.card?.type_line || perm?.type_line || '').toLowerCase());
}

/** True when perm may still untap; records the untap against every matching limit when allowed. */
export function untapLimitAllows(perm: any, limits: readonly UntapStepLimit[], used: Map<UntapStepLimit, number>): boolean {
  const relevant = limits.filter((l) => matchesKind(perm, l.kind));
  if (relevant.some((l) => (used.get(l) || 0) >= l.max)) return false;
  for (const l of relevant) used.set(l, (used.get(l) || 0) + 1);
  return true;
}
