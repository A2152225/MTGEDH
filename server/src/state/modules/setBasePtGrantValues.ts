// server/src/state/modules/setBasePtGrantValues.ts
// Resolve layer-7b setPower/setToughness grant fields, including B62 life-total setters
// (Aettir and Priwen: equipped creature has base P/T X/X where X is your life total).
// Public: resolveSetBasePtGrantValues.

export type SetBasePtGrantLike = {
  setPower?: number;
  setToughness?: number;
  setPowerFromControllerLife?: boolean;
  setToughnessFromControllerLife?: boolean;
  /** B70: Animate Artifact — both sides from the recipient's mana value. */
  setPowerToughnessFromManaValue?: boolean;
};

function permanentManaValue(permanent: any): number | undefined {
  const card = permanent?.card || permanent || {};
  const raw = card.cmc ?? card.mana_value ?? card.manaValue ?? permanent?.cmc ?? permanent?.mana_value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function controllerLife(state: any, controllerId: string): number | undefined {
  const pid = String(controllerId || '');
  if (!pid || !state) return undefined;
  const fromMap = state.life?.[pid];
  if (typeof fromMap === 'number' && Number.isFinite(fromMap)) return fromMap;
  const player = (state.players || []).find((p: any) => String(p?.id || '') === pid);
  if (typeof player?.life === 'number' && Number.isFinite(player.life)) return player.life;
  return undefined;
}

/** Effective numeric setPower/setToughness for a grant, or null when the grant sets neither. */
export function resolveSetBasePtGrantValues(
  grant: SetBasePtGrantLike | null | undefined,
  state: any,
  controllerId: string,
  recipient?: any,
): { power?: number; toughness?: number } | null {
  if (!grant) return null;
  if (grant.setPowerToughnessFromManaValue) {
    const mv = permanentManaValue(recipient);
    if (typeof mv !== 'number' || !Number.isFinite(mv)) return null;
    return { power: mv, toughness: mv };
  }
  const life = controllerLife(state, controllerId);
  const power = grant.setPowerFromControllerLife
    ? (typeof life === 'number' ? life : undefined)
    : (grant.setPower !== undefined ? Number(grant.setPower) : undefined);
  const toughness = grant.setToughnessFromControllerLife
    ? (typeof life === 'number' ? life : undefined)
    : (grant.setToughness !== undefined ? Number(grant.setToughness) : undefined);
  const hasPower = power !== undefined && Number.isFinite(power);
  const hasToughness = toughness !== undefined && Number.isFinite(toughness);
  if (!hasPower && !hasToughness) return null;
  return {
    ...(hasPower ? { power: Number(power) } : {}),
    ...(hasToughness ? { toughness: Number(toughness) } : {}),
  };
}

export function grantSetsBasePt(grant: SetBasePtGrantLike | null | undefined): boolean {
  if (!grant) return false;
  return grant.setPower !== undefined
    || grant.setToughness !== undefined
    || grant.setPowerFromControllerLife === true
    || grant.setToughnessFromControllerLife === true
    || grant.setPowerToughnessFromManaValue === true;
}
