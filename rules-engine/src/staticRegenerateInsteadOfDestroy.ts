// Batch 17: "If ~ would be destroyed, regenerate it" (Knight/Clergy of the Holy Nimbus, Mossbridge Troll)
// for destroys that resolve inside the rules-engine (oracleIRExecutorBattlefieldDestroyStep).
// Mirrors server/src/state/modules/replacementBatch16LongTail.ts (hasStaticRegenerateInsteadOfDestroy).
// Public entry symbols: hasStaticRegenerateInsteadOfDestroy, staticRegeneratedCopy.

const REGEN_INSTEAD_RE = /if (?:~|this creature|this permanent|it) would be destroyed, regenerate it\b/;

function selfOracle(perm: any): string {
  const name = String(perm?.card?.name || '').toLowerCase();
  let o = String(perm?.card?.oracle_text || perm?.oracle_text || '').toLowerCase().replace(/\u2019/g, "'");
  if (name) o = o.split(name).join('~');
  const short = name.split(',')[0].trim();
  if (short && short !== name && short.length >= 3) o = o.split(short).join('~');
  return o;
}

function cantBeRegenerated(perm: any): boolean {
  if (perm?.cantBeRegenerated === true || perm?.cantRegenerate === true || perm?.cantBeRegeneratedThisTurn === true) return true;
  const temps = Array.isArray(perm?.temporaryEffects) ? perm.temporaryEffects : [];
  return temps.some((e: any) => /can(?:'|\u2019|no)t be regenerated/i.test(String(e?.description || '')));
}

export function hasStaticRegenerateInsteadOfDestroy(perm: unknown): boolean {
  return !!perm && REGEN_INSTEAD_RE.test(selfOracle(perm)) && !cantBeRegenerated(perm);
}

/** CR 701.19: tapped, all damage removed, removed from combat. */
export function staticRegeneratedCopy<T>(perm: T): T {
  const p: any = perm;
  return {
    ...p,
    tapped: true,
    markedDamage: 0,
    damageMarked: 0,
    damage: 0,
    counters: { ...((p?.counters || {}) as Record<string, number>), damage: 0 },
    attacking: undefined,
    attackingPlayerId: undefined,
    defendingPlayerId: undefined,
    blocking: undefined,
    blockedBy: undefined,
    regeneratedThisTurn: true,
  } as T;
}