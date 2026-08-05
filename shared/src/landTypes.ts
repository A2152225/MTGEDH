/**
 * Basic land type helpers for chosen-type lands (Thran Portal, Multiversal Passage, etc.).
 */

export const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
export type BasicLandType = (typeof BASIC_LAND_TYPES)[number];

const BASIC_LAND_TYPE_TO_MANA: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
  plains: 'W',
  island: 'U',
  swamp: 'B',
  mountain: 'R',
  forest: 'G',
};

export function normalizeBasicLandType(raw: string | null | undefined): BasicLandType | null {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return null;
  const match = BASIC_LAND_TYPES.find((landType) => landType.toLowerCase() === key);
  return match || null;
}

/**
 * True when the permanent's oracle grants it the chosen basic land type
 * (intrinsic type change), not merely for filtering other effects.
 */
export function permanentAddsChosenBasicLandTypeToSelf(
  permanent: {
    chosenBasicLandType?: string;
    card?: { oracle_text?: string; chosenBasicLandType?: string; type_line?: string };
    oracle_text?: string;
  } | null | undefined,
): boolean {
  const chosen = String(
    permanent?.chosenBasicLandType || permanent?.card?.chosenBasicLandType || '',
  ).trim();
  if (!chosen) return false;

  const oracle = String(permanent?.oracle_text || permanent?.card?.oracle_text || '').toLowerCase();
  return (
    /\bis the chosen type\b/.test(oracle)
    || /\bbecomes? the chosen type\b/.test(oracle)
    || /\bis the chosen (?:basic )?land type\b/.test(oracle)
    || /\bgains? the chosen (?:basic )?land type\b/.test(oracle)
  );
}

/**
 * Effective basic land types on a permanent, including chosen-type grants.
 */
export function getEffectiveBasicLandTypes(
  permanent: {
    chosenBasicLandType?: string;
    card?: { oracle_text?: string; chosenBasicLandType?: string; type_line?: string };
    oracle_text?: string;
    type_line?: string;
  } | null | undefined,
): BasicLandType[] {
  if (!permanent) return [];
  const typeLine = String(permanent.type_line || permanent.card?.type_line || '').toLowerCase();
  const types: BasicLandType[] = [];
  for (const landType of BASIC_LAND_TYPES) {
    if (typeLine.includes(landType.toLowerCase())) {
      types.push(landType);
    }
  }

  if (permanentAddsChosenBasicLandTypeToSelf(permanent)) {
    const chosen = normalizeBasicLandType(
      permanent.chosenBasicLandType || permanent.card?.chosenBasicLandType,
    );
    if (chosen && !types.includes(chosen)) {
      types.push(chosen);
    }
  }

  return types;
}

export function manaColorForBasicLandType(landType: string | null | undefined): 'W' | 'U' | 'B' | 'R' | 'G' | null {
  const normalized = normalizeBasicLandType(landType);
  if (!normalized) return null;
  return BASIC_LAND_TYPE_TO_MANA[normalized.toLowerCase()] || null;
}
