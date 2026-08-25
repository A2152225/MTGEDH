// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: BASIC_LAND_TYPE_NAMES, BasicLandTypeName, normalizeBasicLandTypeName,
// setPermanentBasicLandType.
// Public entries: normalizeBasicLandTypeName, setPermanentBasicLandType.

import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

export const BASIC_LAND_TYPE_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
export type BasicLandTypeName = typeof BASIC_LAND_TYPE_NAMES[number];

export function normalizeBasicLandTypeName(value: unknown): BasicLandTypeName | null {
  const normalized = String(value || '').trim().toLowerCase();
  return BASIC_LAND_TYPE_NAMES.find(typeName => typeName.toLowerCase() === normalized) ?? null;
}

export function setPermanentBasicLandType(
  permanent: BattlefieldPermanent,
  basicLandType: BasicLandTypeName,
  duration: 'end_of_turn' | 'static',
  ctx: OracleIRExecutionContext
): BattlefieldPermanent {
  const permanentAny: any = permanent as any;
  const card = { ...(permanentAny.card || {}) };
  const currentTypeLine = String(permanentAny.type_line || card.type_line || 'Land').trim() || 'Land';
  const typeParts = currentTypeLine.split(/\s+[—-]\s+/);
  const frontMatter = typeParts[0] && /\bland\b/i.test(typeParts[0]) ? typeParts[0].trim() : 'Land';
  const nextTypeLine = `${frontMatter} - ${basicLandType}`;
  const currentModifiers = Array.isArray(permanentAny.modifiers) ? [...permanentAny.modifiers] : [];
  const nextModifiers = duration === 'end_of_turn'
    ? [
        ...currentModifiers,
        {
          type: 'setBasicLandType',
          basicLandType,
          duration: 'end_of_turn',
          sourceId: ctx.sourceId,
          originalTypeLine: permanentAny.type_line,
          originalSubtypes: Array.isArray(permanentAny.subtypes) ? [...permanentAny.subtypes] : undefined,
          originalGrantedTypes: Array.isArray(permanentAny.grantedTypes) ? [...permanentAny.grantedTypes] : undefined,
          originalCardTypeLine: card.type_line,
          originalCardSubtypes: Array.isArray(card.subtypes) ? [...card.subtypes] : undefined,
        },
      ]
    : currentModifiers;

  return {
    ...permanentAny,
    type_line: nextTypeLine,
    subtypes: [basicLandType],
    grantedTypes: [basicLandType],
    modifiers: nextModifiers,
    card: {
      ...card,
      type_line: nextTypeLine,
      subtypes: [basicLandType],
      basicLandType,
    },
  } as any;
}

