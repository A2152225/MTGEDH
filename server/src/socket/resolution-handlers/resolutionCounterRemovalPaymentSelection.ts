/**
 * socket/resolution-handlers/resolutionCounterRemovalPaymentSelection.ts
 *
 * Origin parent: server/src/socket/resolution.ts.
 * Cluster moved: the "remove N counters as a cost" selection parser/validator shared by the
 * ADDITIONAL_COST_PAYMENT handler and its pre-complete validation.
 * Public entry symbols: NormalizedCounterRemovalPayment, validateCounterRemovalPaymentSelection.
 *
 * Extracted as groundwork so the ADDITIONAL_COST_PAYMENT case could leave resolution.ts.
 * Must not import resolution.ts.
 */

import { isRemovableCounterType, permanentMatchesCounterRemovalFilter } from "../../state/modules/counter-removal-costs.js";

export type NormalizedCounterRemovalPayment = Array<{ permanentId: string; counterType: string; count: number }>;

function normalizeCounterRemovalPaymentSelections(rawSelections: any, stepData: any): { selections: NormalizedCounterRemovalPayment; error?: string } {
  const raw = rawSelections && typeof rawSelections === 'object' && !Array.isArray(rawSelections) && Array.isArray(rawSelections.counterSelections)
    ? rawSelections.counterSelections
    : rawSelections;
  const entries = Array.isArray(raw) ? raw : [raw].filter((entry) => entry != null);
  const availableCounters = Array.isArray(stepData?.availableCounters) ? stepData.availableCounters : [];
  const availableById = new Map<string, any>(
    availableCounters
      .map((entry: any) => [String(entry?.id || ''), entry] as const)
      .filter(([id]) => Boolean(id)),
  );
  const grouped = new Map<string, { permanentId: string; counterType: string; count: number }>();

  const addSelection = (permanentIdRaw: unknown, counterTypeRaw: unknown, countRaw: unknown): string | undefined => {
    const permanentId = String(permanentIdRaw || '').trim();
    const counterType = String(counterTypeRaw || '').trim();
    const count = Math.floor(Number(countRaw ?? 1));
    if (!permanentId || !counterType) return 'Missing counter selection details';
    if (!Number.isInteger(count) || count <= 0) return 'Counter selection counts must be positive integers';

    const key = `${permanentId}\u0000${counterType.toLowerCase()}`;
    const current = grouped.get(key);
    if (current) {
      current.count += count;
    } else {
      grouped.set(key, { permanentId, counterType, count });
    }
    return undefined;
  };

  for (const entry of entries) {
    if (typeof entry === 'string') {
      const option = availableById.get(String(entry || ''));
      if (!option) return { selections: [], error: 'Selected counter is not a valid choice' };
      const error = addSelection(option.permanentId, option.counterType, 1);
      if (error) return { selections: [], error };
      continue;
    }

    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const optionId = String((entry as any).id || '').trim();
      if (optionId && availableById.has(optionId)) {
        const option = availableById.get(optionId);
        const error = addSelection(option.permanentId, option.counterType, Number((entry as any).count ?? 1));
        if (error) return { selections: [], error };
        continue;
      }

      const error = addSelection(
        (entry as any).permanentId ?? (entry as any).permanent,
        (entry as any).counterType ?? (entry as any).type,
        (entry as any).count ?? (entry as any).amount ?? 1,
      );
      if (error) return { selections: [], error };
      continue;
    }

    return { selections: [], error: 'Invalid counter selection format' };
  }

  return { selections: Array.from(grouped.values()) };
}

/** Resolve and validate a counter-removal cost payload against the live battlefield. */
export function validateCounterRemovalPaymentSelection(
  game: any,
  playerId: string,
  stepData: any,
  rawSelections: any,
): { ok: true; selections: NormalizedCounterRemovalPayment } | { ok: false; code: string; message: string } {
  const amount = Math.max(0, Math.floor(Number(stepData?.amount || 0)));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: 'INVALID_STEP', message: 'Invalid counter-removal cost amount' };
  }

  const normalized = normalizeCounterRemovalPaymentSelections(rawSelections, stepData);
  if (normalized.error) {
    return { ok: false, code: 'INVALID_SELECTION', message: normalized.error };
  }

  const total = normalized.selections.reduce((sum, entry) => sum + Math.max(0, Number(entry.count || 0)), 0);
  if (total !== amount) {
    return { ok: false, code: 'INVALID_SELECTION', message: `Must remove exactly ${amount} counter${amount === 1 ? '' : 's'}.` };
  }

  const requiredCounterType = String(stepData?.counterType || '').trim().toLowerCase();
  const filter = String(stepData?.filter || 'creature').trim() || 'creature';
  const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
  const resolved: NormalizedCounterRemovalPayment = [];

  for (const selection of normalized.selections) {
    const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(selection.permanentId));
    if (!permanent || String(permanent.controller || '') !== String(playerId)) {
      return { ok: false, code: 'INVALID_SELECTION', message: 'Selected permanent is not a valid counter source' };
    }
    if (!permanentMatchesCounterRemovalFilter(permanent, filter)) {
      return { ok: false, code: 'INVALID_SELECTION', message: 'Selected permanent does not match the counter-removal requirement' };
    }

    const counters = permanent.counters && typeof permanent.counters === 'object' && !Array.isArray(permanent.counters)
      ? permanent.counters as Record<string, unknown>
      : {};
    const actualCounterType = Object.keys(counters).find((key) => key === selection.counterType)
      || Object.keys(counters).find((key) => key.toLowerCase() === selection.counterType.toLowerCase());
    if (!actualCounterType || !isRemovableCounterType(actualCounterType)) {
      return { ok: false, code: 'INVALID_SELECTION', message: 'Selected counter type is not available' };
    }
    if (requiredCounterType && actualCounterType.toLowerCase() !== requiredCounterType) {
      return { ok: false, code: 'INVALID_SELECTION', message: 'Selected counter type does not match the cost' };
    }

    const availableCount = Math.floor(Number(counters[actualCounterType] || 0));
    if (availableCount < selection.count) {
      return { ok: false, code: 'INSUFFICIENT_COUNTERS', message: 'Selected permanents no longer have enough counters' };
    }

    resolved.push({
      permanentId: String(selection.permanentId),
      counterType: actualCounterType,
      count: selection.count,
    });
  }

  return { ok: true, selections: resolved };
}
