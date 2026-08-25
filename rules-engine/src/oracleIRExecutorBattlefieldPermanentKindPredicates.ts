// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: permanentIsHistoric, permanentIsOutlaw, permanentIsAlly, permanentIsMonocolored.
// Public entries: those four predicates.

import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';

export function permanentIsHistoric(perm: any): boolean {
  const typeLine = getExecutorTypeLineLower(perm);
  return (
    permanentMatchesType(perm, 'artifact') ||
    /\blegendary\b/.test(typeLine) ||
    typeLineHasSubtype(perm, 'saga')
  );
}

export function permanentIsOutlaw(perm: any): boolean {
  return (
    typeLineHasSubtype(perm, 'assassin') ||
    typeLineHasSubtype(perm, 'mercenary') ||
    typeLineHasSubtype(perm, 'pirate') ||
    typeLineHasSubtype(perm, 'rogue') ||
    typeLineHasSubtype(perm, 'warlock')
  );
}

export function permanentIsAlly(perm: any): boolean {
  return typeLineHasSubtype(perm, 'ally');
}

export function permanentIsMonocolored(perm: any): boolean {
  const colors = Array.isArray((perm as any)?.colors)
    ? (perm as any).colors
    : Array.isArray((perm as any)?.card?.colors)
      ? (perm as any).card.colors
      : [];
  const normalized = colors.map((color: unknown) => String(color || '').trim()).filter(Boolean);
  return normalized.length === 1;
}
