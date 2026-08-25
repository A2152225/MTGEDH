// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: normalizePluralSubtype, typeLineHasSubtype.
// Public entries: normalizePluralSubtype, typeLineHasSubtype.

import type { BattlefieldPermanent } from '../../shared/src';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

export function normalizePluralSubtype(raw: string): string {
  const normalized = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (/ies$/i.test(normalized)) return `${normalized.slice(0, -3)}y`;
  if (/s$/i.test(normalized) && !/ss$/i.test(normalized)) return normalized.slice(0, -1);
  return normalized;
}

export function typeLineHasSubtype(permanent: BattlefieldPermanent, subtype: string): boolean {
  const normalizedSubtype = normalizePluralSubtype(subtype);
  if (!normalizedSubtype) return false;
  const escaped = normalizedSubtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}s?($|[^a-z0-9])`, 'i').test(getExecutorTypeLineLower(permanent));
}

