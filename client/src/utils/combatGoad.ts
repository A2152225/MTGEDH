/**
 * Client-side goad / must-attack helpers for declare-attackers UI.
 * Server remains authoritative (Rule 701.15 / 701.38).
 */

type GoadedPermanentLike = {
  goadedBy?: unknown;
  goaded?: unknown;
  isStaticallyGoaded?: unknown;
  staticGoadedBy?: unknown;
  grantedAbilities?: unknown; // view projection: continuous "goaded" (Sound of Drums, Baeloth)
  mustAttackEachCombat?: unknown;
  mustAttack?: unknown;
};

export function getPermanentGoaders(perm: GoadedPermanentLike | null | undefined): string[] {
  const goaders: string[] = [];
  const add = (id: unknown) => {
    const normalized = String(id || '').trim();
    if (normalized && !goaders.includes(normalized)) {
      goaders.push(normalized);
    }
  };

  if (Array.isArray(perm?.goadedBy)) {
    for (const goaderId of perm.goadedBy) add(goaderId);
  }

  if (perm?.goaded && typeof perm.goaded === 'object' && !Array.isArray(perm.goaded)) {
    for (const [goaderId, active] of Object.entries(perm.goaded as Record<string, unknown>)) {
      if (active) add(goaderId);
    }
  }

  if (perm?.isStaticallyGoaded) {
    if (Array.isArray(perm.staticGoadedBy)) {
      for (const goaderId of perm.staticGoadedBy) add(goaderId);
    }
  }

  return goaders;
}

export function isPermanentGoaded(perm: GoadedPermanentLike | null | undefined): boolean {
  if (perm?.isStaticallyGoaded) return true;
  if (Array.isArray(perm?.grantedAbilities) && perm.grantedAbilities.some((a) => String(a || '').trim().toLowerCase() === 'goaded')) return true;
  return getPermanentGoaders(perm).length > 0;
}

export function permanentMustAttackIfAble(perm: GoadedPermanentLike | null | undefined): boolean {
  return isPermanentGoaded(perm) || Boolean(perm?.mustAttackEachCombat) || Boolean(perm?.mustAttack);
}

export function preferredForcedAttackTarget(
  perm: Parameters<typeof getPermanentGoaders>[0],
  defenderIds: readonly string[],
): string | undefined {
  const goaders = new Set(getPermanentGoaders(perm));
  return defenderIds.find((id) => id && !goaders.has(id)) || defenderIds.find(Boolean);
}
