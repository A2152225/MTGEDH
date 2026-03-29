import type { BattlefieldPermanent } from '../../shared/src';
import { isCurrentlyCreature } from './actions/combat';

const PRIMARY_PERMANENT_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'] as const;

function normalizeTypeEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: string[] = [];
  for (const entry of value) {
    const normalized = String(entry || '').toLowerCase().trim();
    if (normalized && !entries.includes(normalized)) {
      entries.push(normalized);
    }
  }
  return entries;
}

function getPrintedPermanentTypes(permanent: BattlefieldPermanent | any): string[] {
  const typeLine = [
    (permanent as any)?.cardType,
    (permanent as any)?.type_line,
    (permanent as any)?.card?.type_line,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');

  const printedTypes: string[] = [];
  for (const typeName of PRIMARY_PERMANENT_TYPES) {
    if (typeLine.includes(typeName) && !printedTypes.includes(typeName)) {
      printedTypes.push(typeName);
    }
  }

  return printedTypes;
}

export function getPermanentTypeNames(permanent: BattlefieldPermanent | any): string[] {
  const effectiveTypes = normalizeTypeEntries((permanent as any)?.effectiveTypes);
  const explicitTypes = normalizeTypeEntries((permanent as any)?.types);
  const grantedTypes = normalizeTypeEntries((permanent as any)?.grantedTypes);

  const typeNames = new Set<string>(
    effectiveTypes.length > 0
      ? effectiveTypes
      : explicitTypes.length > 0
        ? explicitTypes
        : getPrintedPermanentTypes(permanent),
  );

  for (const grantedType of grantedTypes) {
    typeNames.add(grantedType);
  }

  if (isCurrentlyCreature(permanent)) {
    typeNames.add('creature');
  } else {
    typeNames.delete('creature');
  }

  return [...typeNames];
}

export function hasPermanentType(permanent: BattlefieldPermanent | any, type: string): boolean {
  const normalizedType = String(type || '').toLowerCase().trim();
  if (!normalizedType) {
    return false;
  }

  const typeNames = getPermanentTypeNames(permanent);

  if (normalizedType === 'permanent') {
    return PRIMARY_PERMANENT_TYPES.some((typeName) => typeNames.includes(typeName));
  }

  if (normalizedType === 'nonland permanent') {
    return hasPermanentType(permanent, 'permanent') && !typeNames.includes('land');
  }

  return typeNames.includes(normalizedType);
}