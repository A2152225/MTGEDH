import { extractCreatureTypes as extractCreatureTypesFromTypeLine } from '../../../shared/src/creatureTypes.js';

function normalizeCreatureType(type: string): string {
  return String(type || '')
    .trim()
    .toLowerCase();
}

function normalizeCreatureTypeList(types: unknown): string[] {
  if (!Array.isArray(types)) return [];
  return types
    .map(t => normalizeCreatureType(String(t)))
    .filter(t => t.length > 0);
}

function hasIntrinsicChangeling(permanent: any): boolean {
  const keywords: string[] = Array.isArray(permanent?.keywords)
    ? permanent.keywords
    : Array.isArray(permanent?.card?.keywords)
      ? permanent.card.keywords
      : [];

  if (keywords.some(k => String(k).toLowerCase() === 'changeling')) return true;

  // Fallback: card text based detection (changeling is a CDA, safe to treat as intrinsic)
  const oracle = String(permanent?.oracle_text || permanent?.card?.oracle_text || '').toLowerCase();
  return /\bchangeling\b/.test(oracle);
}

function hasIntrinsicEveryCreatureType(permanent: any): boolean {
  // Note: DO NOT treat "all creature types" as intrinsic; it is often conditional (e.g., "until end of turn").
  // We only treat explicit CDA-style wordings as intrinsic.
  const oracle = String(permanent?.oracle_text || permanent?.card?.oracle_text || '').toLowerCase();
  return /\bis every creature type\b/.test(oracle) || /\bis\s+every\s+creature\s+type\b/.test(oracle);
}

function getEffectiveTypeLine(permanent: any): string {
  const base = String(permanent?.card?.type_line || permanent?.type_line || '');

  // Honor type-replacement / type-change modifiers with an explicit newTypeLine.
  const mods: any[] = Array.isArray(permanent?.modifiers) ? permanent.modifiers : [];
  for (let i = mods.length - 1; i >= 0; i--) {
    const mod = mods[i];
    if (!mod || mod.active === false) continue;
    if (typeof mod.newTypeLine === 'string' && mod.newTypeLine.trim().length > 0) {
      return mod.newTypeLine;
    }
  }

  return base;
}

function permanentAddsChosenCreatureTypeToSelf(permanent: any): boolean {
  const chosen = normalizeCreatureType(String(permanent?.chosenCreatureType || ''));
  if (!chosen) return false;

  const oracle = String(permanent?.oracle_text || permanent?.card?.oracle_text || '').toLowerCase();

  // Covers templates like:
  // - "As ~ enters, choose a creature type. ~ is the chosen type in addition to its other types."
  // - "As ~ enters, choose a creature type. ~ is the chosen type."
  return /\bis the chosen type\b/.test(oracle) || /\bbecomes the chosen type\b/.test(oracle);
}

export function isCreatureNow(permanent: any): boolean {
  if (!permanent) return false;

  // Highest-priority explicit flags used by animation effects.
  if (permanent.isCreature === true) return true;
  if (permanent.animated === true) return true;

  // Some systems record a replaced type-set.
  if (permanent.typesReplaced === true) {
    if (Array.isArray(permanent.effectiveTypes)) {
      return permanent.effectiveTypes.includes('Creature');
    }
    return false;
  }

  // Honor active modifiers that add/remove/replace creature type.
  const mods: any[] = Array.isArray(permanent?.modifiers) ? permanent.modifiers : [];
  for (let i = mods.length - 1; i >= 0; i--) {
    const mod = mods[i];
    if (!mod || mod.active === false) continue;

    // Common animation-style modifiers.
    if (
      mod.type === 'animation' || mod.type === 'ANIMATION' ||
      mod.type === 'becomesCreature' || mod.type === 'BECOMES_CREATURE' ||
      mod.type === 'manland' || mod.type === 'karnAnimation' ||
      mod.type === 'nissaAnimation' || mod.type === 'tezzeret' ||
      mod.type === 'ensoulArtifact' || mod.type === 'marchOfTheMachines'
    ) {
      return true;
    }

    if (Array.isArray(mod.removesTypes) && mod.removesTypes.includes('Creature')) {
      return false;
    }
    if (typeof mod.newTypeLine === 'string' && mod.newTypeLine.trim().length > 0) {
      return mod.newTypeLine.toLowerCase().includes('creature');
    }
    if (Array.isArray(mod.addsTypes) && mod.addsTypes.includes('Creature')) {
      return true;
    }
  }

  // Loose type-grant tracking used by some effects.
  if (Array.isArray(permanent?.typeAdditions)) {
    if (permanent.typeAdditions.some((t: unknown) => String(t).toLowerCase() === 'creature')) {
      return true;
    }
  }
  if (Array.isArray(permanent?.grantedTypes)) {
    if (permanent.grantedTypes.includes('Creature')) return true;
  }

  const effectiveTypeLine = getEffectiveTypeLine(permanent).toLowerCase();
  return effectiveTypeLine.includes('creature');
}

export function getCreatureTypesNow(permanent: any): Set<string> {
  const out = new Set<string>();

  // Dynamic flags used by animation effects (e.g., Mutavault).
  if (permanent?.hasAllCreatureTypes === true) {
    out.add('*');
    return out;
  }

  if (hasIntrinsicChangeling(permanent) || hasIntrinsicEveryCreatureType(permanent)) {
    out.add('*');
    return out;
  }

  const effectiveTypeLine = getEffectiveTypeLine(permanent);

  // Parse subtypes from type line only (ignore oracle text here; it can be conditional).
  const fromTypeLine = extractCreatureTypesFromTypeLine(effectiveTypeLine, undefined);
  for (const t of fromTypeLine) out.add(normalizeCreatureType(t));

  // Some effects track creature types separately.
  for (const t of normalizeCreatureTypeList(permanent?.typeAdditions)) out.add(t);
  for (const t of normalizeCreatureTypeList(permanent?.grantedCreatureTypes)) out.add(t);

  // Legacy tracking (stack.addCreatureType)
  for (const t of normalizeCreatureTypeList(permanent?.addedTypes)) out.add(t);

  // Chosen-type permanents that themselves become the chosen type (Roaming Throne, Adaptive Automaton-style).
  if (permanentAddsChosenCreatureTypeToSelf(permanent)) {
    const chosen = normalizeCreatureType(String(permanent?.chosenCreatureType || ''));
    if (chosen) out.add(chosen);
  }

  return out;
}

export function permanentHasCreatureTypeNow(permanent: any, creatureType: string): boolean {
  const wanted = normalizeCreatureType(creatureType);
  if (!wanted) return false;

  const types = getCreatureTypesNow(permanent);
  if (types.has('*')) return true;
  return types.has(wanted);
}
