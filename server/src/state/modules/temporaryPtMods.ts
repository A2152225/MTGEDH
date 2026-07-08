export type TemporaryPtMod = {
  power?: number;
  toughness?: number;
  until?: string;
  expiresAt?: string;
  source?: string;
  turnApplied?: number;
};

export function sumActiveTemporaryPTMods(permanent: any): { power: number; toughness: number } {
  const mods = Array.isArray(permanent?.temporaryPTMods) ? permanent.temporaryPTMods : [];
  let power = 0;
  let toughness = 0;
  for (const mod of mods) {
    if (!mod || typeof mod !== 'object') continue;
    const until = String((mod as TemporaryPtMod).until || (mod as TemporaryPtMod).expiresAt || '').trim().toLowerCase();
    if (until && until !== 'end_of_turn' && until !== 'eot') continue;
    power += Number((mod as TemporaryPtMod).power ?? 0) || 0;
    toughness += Number((mod as TemporaryPtMod).toughness ?? 0) || 0;
  }
  return { power, toughness };
}
