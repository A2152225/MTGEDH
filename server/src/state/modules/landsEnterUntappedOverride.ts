/**
 * "Lands you control enter untapped" style overrides (Spelunking, The Wandering Minstrel).
 * Returns the name of the controlled permanent whose static ability makes the entering
 * card enter untapped, or null when none applies.
 */
const ENTER_UNTAPPED_RE = /(?:^|[\n.]\s*)((?:basic )?lands|permanents|creatures|artifacts) you control enter untapped\b/g;

function readString(obj: unknown, key: string): string {
  if (!obj || typeof obj !== 'object') return '';
  const value: unknown = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function subjectMatches(subject: string, typeLine: string): boolean {
  switch (subject) {
    case 'basic lands': return typeLine.includes('basic') && typeLine.includes('land');
    case 'lands': return typeLine.includes('land');
    case 'creatures': return typeLine.includes('creature');
    case 'artifacts': return typeLine.includes('artifact');
    default: return true;
  }
}

export function enterUntappedOverrideSourceName(battlefield: unknown, controllerId: string, card: unknown): string | null {
  if (!Array.isArray(battlefield) || !controllerId) return null;
  const typeLine = readString(card, 'type_line').toLowerCase();
  for (const perm of battlefield as unknown[]) {
    if (!perm || typeof perm !== 'object') continue;
    if (readString(perm, 'controller') !== controllerId) continue;
    const permCard: unknown = (perm as Record<string, unknown>).card;
    const oracle = readString(permCard, 'oracle_text').toLowerCase().replace(/\u2019/g, "'");
    if (!oracle.includes('enter untapped')) continue;
    ENTER_UNTAPPED_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ENTER_UNTAPPED_RE.exec(oracle)) !== null) {
      if (subjectMatches(m[1], typeLine)) return readString(permCard, 'name') || 'permanent';
    }
  }
  return null;
}
