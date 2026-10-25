/**
 * Level up (CR 711): a leveler's abilities under a LEVEL N1-N2 / LEVEL N3+ header
 * apply only while it has that many level counters. Returns the oracle text with
 * inactive level bands removed (base text before the first band is kept).
 */
export function getPermanentLevel(permanent: any): number {
  const n = Number(permanent?.counters?.level ?? permanent?.counters?.Level ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function activeLevelUpText(oracleText: string, level: number): string {
  const text = String(oracleText || '');
  if (!/\blevel up\b/i.test(text)) return text;
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let active = true;
  for (const line of lines) {
    const header = line.trim().match(/^level\s+(\d+)\s*(?:[-\u2013\u2014]\s*(\d+)|(\+))\s*$/i);
    if (header) {
      const lo = Number(header[1]);
      const hi = header[3] ? Infinity : Number(header[2]);
      active = level >= lo && level <= hi;
      continue;
    }
    if (active) out.push(line);
  }
  return out.join('\n');
}

export function activeLevelUpTextForPermanent(permanent: any, oracleText: string): string {
  return activeLevelUpText(oracleText, getPermanentLevel(permanent));
}