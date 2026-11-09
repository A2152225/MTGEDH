/**
 * Jasmine Boreal of the Seven:
 * "Creatures you control with no abilities can't be blocked by creatures with abilities."
 */
type Perm = {
  controller?: string;
  card?: { oracle_text?: string; keywords?: unknown };
  oracle_text?: string;
  grantedAbilities?: unknown;
  temporaryAbilities?: unknown;
  tempAbilities?: unknown;
};

const LORD_RE =
  /(?:^|[.\n]\s*)creatures you control with no abilities can(?:'t|not) be blocked by creatures with abilities\.?/i;

/** True when a permanent has any printed or granted ability text. */
export function permanentHasAbilities(permanent: Perm | undefined, extraAbilities: readonly string[] = []): boolean {
  if (!permanent) return false;
  if (extraAbilities.some((a) => String(a || '').trim())) return true;
  const granted = [
    ...(Array.isArray(permanent.grantedAbilities) ? permanent.grantedAbilities : []),
    ...(Array.isArray(permanent.temporaryAbilities) ? permanent.temporaryAbilities : []),
    ...(Array.isArray(permanent.tempAbilities) ? permanent.tempAbilities : []),
  ];
  if (granted.some((entry) => {
    if (typeof entry === 'string') return entry.trim().length > 0;
    if (entry && typeof entry === 'object' && typeof (entry as { ability?: unknown }).ability === 'string') {
      return String((entry as { ability?: unknown }).ability).trim().length > 0;
    }
    return false;
  })) return true;
  const keywords = Array.isArray(permanent.card?.keywords) ? permanent.card!.keywords! : [];
  if (keywords.some((k) => String(k || '').trim())) return true;
  const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '')
    .replace(/\u2019/g, "'")
    .replace(/\([^)]*\)/g, ' ')
    .trim();
  return oracle.length > 0;
}

export function controllerHasNoAbilitiesBlockLord(
  battlefield: ReadonlyArray<Perm>,
  controllerId: string | undefined,
): boolean {
  const ctrl = String(controllerId || '');
  if (!ctrl) return false;
  for (const src of battlefield) {
    if (!src || String(src.controller || '') !== ctrl) continue;
    if (LORD_RE.test(String(src.card?.oracle_text || src.oracle_text || ''))) return true;
  }
  return false;
}

export function getNoAbilitiesBlockRestrictionReason(
  attacker: Perm | undefined,
  blocker: Perm | undefined,
  battlefield: ReadonlyArray<Perm>,
  blockerExtraAbilities: readonly string[] = [],
): string | undefined {
  if (!attacker || !blocker) return undefined;
  if (!controllerHasNoAbilitiesBlockLord(battlefield, String(attacker.controller || ''))) return undefined;
  if (permanentHasAbilities(attacker)) return undefined;
  if (!permanentHasAbilities(blocker, blockerExtraAbilities)) return undefined;
  return "Attacker can't be blocked by creatures with abilities (no-abilities lord)";
}
