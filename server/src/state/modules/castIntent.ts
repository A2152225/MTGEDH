/**
 * Cast-intent adapter.
 *
 * Durable cast identity already flows as `graveyardPermissionId` (same string as
 * `DurablePermission.id`). `castPermissionId` is an explicit alias of that id so
 * request/replay code can prefer an authoritative permission without inventing a
 * second candidate pipeline.
 *
 * Free casts are payment intent (`alternateCostId: 'free'` +
 * `castWithoutPayingManaCost`), orthogonal to permission identity. Hand
 * alternate costs (e.g. Web-slinging) keep using `alternateCostId` plus any
 * cost-specific fields such as `webSlingingReturnedCreatureId`.
 */

export type CastIntentSource = {
  castPermissionId?: unknown;
  graveyardPermissionId?: unknown;
  permissionId?: unknown;
  alternateCostId?: unknown;
  castWithoutPayingManaCost?: unknown;
  webSlingingReturnedCreatureId?: unknown;
  webSlingingCostWasPaid?: unknown;
  fromZone?: unknown;
  castMethod?: unknown;
  graveyardPermissionCostMode?: unknown;
  libraryPermissionCostMode?: unknown;
  card?: CastIntentSource | null;
};

export type FreeCastIntentFields = {
  alternateCostId: 'free';
  castWithoutPayingManaCost: true;
};

export function resolveCastPermissionId(source: CastIntentSource | null | undefined): string {
  const direct = String(
    source?.castPermissionId
    || source?.graveyardPermissionId
    || source?.permissionId
    || '',
  ).trim();
  if (direct) return direct;

  const nested = source?.card;
  if (nested && typeof nested === 'object') {
    return String(
      nested.castPermissionId
      || nested.graveyardPermissionId
      || nested.permissionId
      || '',
    ).trim();
  }
  return '';
}

export function stampCastPermissionId(target: Record<string, any> | null | undefined, permissionId: string | undefined): void {
  if (!target || typeof target !== 'object') return;
  const id = String(permissionId || '').trim();
  if (!id) {
    delete target.castPermissionId;
    delete target.graveyardPermissionId;
    return;
  }
  target.castPermissionId = id;
  target.graveyardPermissionId = id;
}

export function buildPersistedCastPermissionFields(
  source: CastIntentSource | null | undefined,
): { castPermissionId: string; graveyardPermissionId: string } | Record<string, never> {
  const castPermissionId = resolveCastPermissionId(source);
  if (!castPermissionId) return {};
  return {
    castPermissionId,
    graveyardPermissionId: castPermissionId,
  };
}

export function isFreeCastIntent(source: CastIntentSource | null | undefined): boolean {
  if (!source || typeof source !== 'object') return false;
  if (source.castWithoutPayingManaCost === true) return true;
  if (String(source.alternateCostId || '').trim().toLowerCase() === 'free') return true;
  if (String(source.graveyardPermissionCostMode || '').trim() === 'without_paying_mana_cost') return true;
  if (String(source.libraryPermissionCostMode || '').trim() === 'without_paying_mana_cost') return true;
  const nested = source.card;
  if (nested && typeof nested === 'object') {
    return isFreeCastIntent({
      ...nested,
      card: undefined,
    });
  }
  return false;
}

/** Normalize free-cast payment intent without inventing a second candidate. */
export function buildFreeCastIntentFields(
  source?: CastIntentSource | null | undefined,
  options?: { force?: boolean },
): FreeCastIntentFields | Record<string, never> {
  if (options?.force === true || isFreeCastIntent(source)) {
    return {
      alternateCostId: 'free',
      castWithoutPayingManaCost: true,
    };
  }
  return {};
}

export function buildPersistedFreeCastIntentFields(
  source: CastIntentSource | null | undefined,
  alternateCostId?: unknown,
): FreeCastIntentFields | Record<string, never> {
  const resolvedAlternateCostId = String(alternateCostId || source?.alternateCostId || '').trim().toLowerCase();
  if (resolvedAlternateCostId === 'free' || isFreeCastIntent(source)) {
    return {
      alternateCostId: 'free',
      castWithoutPayingManaCost: true,
    };
  }
  return {};
}

export function stampFreeCastIntent(
  target: Record<string, any> | null | undefined,
  source?: CastIntentSource | null | undefined,
  options?: { force?: boolean },
): void {
  if (!target || typeof target !== 'object') return;
  const fields = buildFreeCastIntentFields(source, options);
  if (!('alternateCostId' in fields)) {
    return;
  }
  target.alternateCostId = 'free';
  target.castWithoutPayingManaCost = true;
}

export function buildPersistedWebSlingingCastIntentFields(
  source: CastIntentSource | null | undefined,
  alternateCostId?: unknown,
): Record<string, unknown> {
  const resolvedAlternateCostId = String(alternateCostId || source?.alternateCostId || '').trim().toLowerCase();
  if (resolvedAlternateCostId !== 'web_slinging') return {};

  const returnedCreatureId = String(
    source?.webSlingingReturnedCreatureId
    || source?.card?.webSlingingReturnedCreatureId
    || '',
  ).trim();

  return {
    alternateCostId: 'web_slinging',
    webSlingingCostWasPaid: true,
    ...(returnedCreatureId ? { webSlingingReturnedCreatureId: returnedCreatureId } : {}),
  };
}

export function preferCandidateByCastPermissionId<T extends { graveyardPermissionId?: string; castPermissionId?: string }>(
  candidates: readonly T[],
  castPermissionId: string | undefined,
): T | undefined {
  const wanted = String(castPermissionId || '').trim();
  if (!wanted || !Array.isArray(candidates) || candidates.length === 0) {
    return candidates[0];
  }

  const matched = candidates.find((candidate) =>
    String(candidate?.castPermissionId || candidate?.graveyardPermissionId || '').trim() === wanted
  );
  return matched || candidates[0];
}

export function resolveDurablePermissionForCastReplay(
  state: any,
  event: CastIntentSource | null | undefined,
  fallbackPermission: any,
): any {
  const castPermissionId = resolveCastPermissionId(event);
  if (!castPermissionId) return fallbackPermission;

  const durablePermissions = Array.isArray(state?.durablePermissions) ? state.durablePermissions : [];
  const byId = durablePermissions.find((entry: any) => String(entry?.id || '').trim() === castPermissionId);
  if (byId) return byId;

  // Synthetic / keyword cast permissions may not be mirrored into durablePermissions.
  // Still prefer the persisted id object so replay can stamp provenance consistently.
  if (fallbackPermission && String(fallbackPermission?.id || '').trim() === castPermissionId) {
    return fallbackPermission;
  }

  return {
    id: castPermissionId,
    ...(fallbackPermission && typeof fallbackPermission === 'object' ? fallbackPermission : {}),
  };
}

/** Merge mana-payment sacs with deferred additional-cost sacs for replay. */
export function buildPersistedSacrificedPermanentFields(
  sacrificedPaymentPermanentIds?: Iterable<unknown>,
  pendingAdditionalCostSacrificeIds?: unknown,
): { sacrificedPermanents: string[] } | Record<string, never> {
  const pending = (Array.isArray(pendingAdditionalCostSacrificeIds) ? pendingAdditionalCostSacrificeIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const fromPayment = Array.from(sacrificedPaymentPermanentIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const sacrificedPermanents = Array.from(new Set([...fromPayment, ...pending]));
  return sacrificedPermanents.length > 0 ? { sacrificedPermanents } : {};
}
