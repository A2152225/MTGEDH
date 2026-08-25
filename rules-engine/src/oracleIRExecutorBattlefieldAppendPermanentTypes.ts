// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: escapeTypeRegex, addSubtypeToTypeLine, appendPermanentTypes.
// Public entry: appendPermanentTypes.

import type { BattlefieldPermanent } from '../../shared/src';

export function escapeTypeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addSubtypeToTypeLine(typeLine: string, subtype: string): string {
  const trimmed = String(typeLine || '').trim();
  const normalizedSubtype = String(subtype || '').trim();
  if (!normalizedSubtype) return trimmed;
  if (!trimmed) return normalizedSubtype;
  if (new RegExp(`(^|[^a-z])${escapeTypeRegex(normalizedSubtype.toLowerCase())}($|[^a-z])`, 'i').test(trimmed.toLowerCase())) {
    return trimmed;
  }
  if (/\s+[—-]\s+/.test(trimmed)) return `${trimmed} ${normalizedSubtype}`;
  return `${trimmed} - ${normalizedSubtype}`;
}

export function appendPermanentTypes(permanent: BattlefieldPermanent, addTypes: readonly string[]): BattlefieldPermanent {
  const normalizedTypes = addTypes.map(type => String(type || '').trim()).filter(Boolean);
  if (normalizedTypes.length === 0) return permanent;

  let changed = false;
  const grantedTypes = Array.isArray((permanent as any).grantedTypes) ? [...(permanent as any).grantedTypes] : [];
  const permanentSubtypes = Array.isArray((permanent as any).subtypes) ? [...(permanent as any).subtypes] : [];
  const cardSubtypes = Array.isArray((permanent as any)?.card?.subtypes) ? [...(permanent as any).card.subtypes] : [];
  let permanentTypeLine = String((permanent as any).type_line || (permanent as any)?.card?.type_line || '').trim();
  let cardTypeLine = String((permanent as any)?.card?.type_line || (permanent as any).type_line || '').trim();

  for (const typeName of normalizedTypes) {
    if (!grantedTypes.includes(typeName)) {
      grantedTypes.push(typeName);
      changed = true;
    }
    if (!permanentSubtypes.includes(typeName)) {
      permanentSubtypes.push(typeName);
      changed = true;
    }
    if (!cardSubtypes.includes(typeName)) {
      cardSubtypes.push(typeName);
      changed = true;
    }

    const nextPermanentTypeLine = addSubtypeToTypeLine(permanentTypeLine, typeName);
    const nextCardTypeLine = addSubtypeToTypeLine(cardTypeLine, typeName);
    if (nextPermanentTypeLine !== permanentTypeLine) {
      permanentTypeLine = nextPermanentTypeLine;
      changed = true;
    }
    if (nextCardTypeLine !== cardTypeLine) {
      cardTypeLine = nextCardTypeLine;
      changed = true;
    }
  }

  if (!changed) return permanent;

  return {
    ...(permanent as any),
    grantedTypes,
    subtypes: permanentSubtypes,
    type_line: permanentTypeLine,
    card: {
      ...((permanent as any).card || {}),
      subtypes: cardSubtypes,
      type_line: cardTypeLine,
    },
  } as any;
}

