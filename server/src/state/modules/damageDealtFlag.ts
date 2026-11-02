// server/src/state/modules/damageDealtFlag.ts
// R23: persistent per-object "has dealt damage" flag (Karakyk Guardian, Palladia-Mors: "if it hasn't dealt
// damage yet"). Set from every damage path that knows its source permanent: creature/fight/combat damage
// (applyCreatureDamageFromSource), combat damage to players and planeswalkers, and noncombat ability damage.
// A new object after a zone change starts without the flag (CR 400.7).
// Public entry symbols: markPermanentDealtDamage.

export function markPermanentDealtDamage(ctx: any, permanentOrId: any): void {
  try {
    let perm = permanentOrId && typeof permanentOrId === 'object' ? permanentOrId : null;
    if (!perm) {
      const id = String(permanentOrId || '').trim();
      if (!id) return;
      perm = ((ctx?.state?.battlefield || []) as any[]).find((p: any) => String(p?.id || '') === id) || null;
    }
    if (perm) perm.hasDealtDamage = true;
  } catch {
    // best-effort only
  }
}
