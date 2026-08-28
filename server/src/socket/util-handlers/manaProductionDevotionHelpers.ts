// server/src/socket/util-handlers/manaProductionDevotionHelpers.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: shouldApplyDevotionColorChoiceMana plus the private
//   colorless-only / devotion-effect / first-tap-mana-line helpers.
// Public entry symbols: shouldApplyDevotionColorChoiceMana,
//   shouldApplyChosenTypeColorChoiceMana, shouldSkipScalingManaForColorlessTap.
// Re-exported from util.ts so the "./util.js" import path keeps working.

function isDevotionColorChoiceManaEffect(text: string): boolean {
  const normalized = String(text || '').toLowerCase();
  return /\bchoose a color\b/.test(normalized) && /\bdevotion to that color\b/.test(normalized);
}

function isChosenTypeColorChoiceManaEffect(text: string): boolean {
  const normalized = String(text || '').toLowerCase();
  return /\bchoose a color\b/.test(normalized) && /\bcreatures of the chosen type\b/.test(normalized);
}

function isColorlessOnlyManaEffect(text: string): boolean {
  const normalized = String(text || '').toLowerCase();
  return /\badd\s*\{c\}(?!\w)/.test(normalized)
    && !/\bchoose a color\b/.test(normalized)
    && !/\bdevotion to that color\b/.test(normalized)
    && !/\bcreatures of the chosen type\b/.test(normalized)
    && !/\bany color\b/.test(normalized)
    && !/\bany one color\b/.test(normalized);
}

function isNativeColorlessManaAbilityId(abilityId?: string | null): boolean {
  const selectedId = String(abilityId || '').trim().toLowerCase();
  return selectedId === 'native_c' || /(?:^|-)(?:tap-)?mana-c(?:-|\d*$)/i.test(selectedId);
}

function extractSelectedManaEffectText(selectedAbilityText?: string | null): string {
  const raw = String(selectedAbilityText || '').trim();
  if (!raw) return '';
  return raw.includes(':') ? raw.split(':').slice(1).join(':').trim() : raw;
}

function getFirstTapManaEffectText(oracleText: string): string {
  const lines = String(oracleText || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!/\{t\}\s*:/i.test(line) || !/\badd\s*\{[wubrgc]\}/i.test(line)) continue;
    const match = line.match(/:\s*(.+)$/i);
    return String(match?.[1] || '').trim();
  }
  return '';
}

/** True when resolving the devotion color-choice mana ability (Nykthos {2} ability), not {T}: Add {C}. */
export function shouldApplyDevotionColorChoiceMana(
  cardName: string,
  selectedAbilityEffectText: string,
  manaOracleText: string,
  fullOracleText: string,
): boolean {
  const normalizedName = String(cardName || '').toLowerCase();
  const effectText = String(selectedAbilityEffectText || '').trim();

  if (effectText && isColorlessOnlyManaEffect(effectText)) {
    return false;
  }
  if (effectText && isDevotionColorChoiceManaEffect(effectText)) {
    return true;
  }
  if (effectText) {
    return false;
  }

  if (normalizedName.includes('nykthos') || normalizedName.includes('nyx lotus')) {
    const firstEffect = getFirstTapManaEffectText(fullOracleText);
    if (isColorlessOnlyManaEffect(firstEffect)) {
      return false;
    }
  }

  if (isDevotionColorChoiceManaEffect(manaOracleText)) {
    return true;
  }

  return String(fullOracleText || '').includes('devotion')
    && String(fullOracleText || '').includes('add')
    && !isColorlessOnlyManaEffect(manaOracleText);
}

/** True when resolving Three Tree City's {2} invest line, not `{T}: Add {C}`. */
export function shouldApplyChosenTypeColorChoiceMana(
  cardName: string,
  selectedAbilityEffectText: string,
  abilityId?: string | null,
  selectedLegacyAbilityId?: string | null,
): boolean {
  if (!String(cardName || '').toLowerCase().includes('three tree city')) {
    return false;
  }

  const effectText = String(selectedAbilityEffectText || '').trim();
  const abilityIdNorm = String(abilityId || '').trim().toLowerCase();
  const legacyId = String(selectedLegacyAbilityId || '').trim().toLowerCase();

  if (effectText && isColorlessOnlyManaEffect(effectText)) {
    return false;
  }
  if (isNativeColorlessManaAbilityId(abilityIdNorm) || isNativeColorlessManaAbilityId(legacyId)) {
    return false;
  }
  if (/-ability-0$/i.test(abilityIdNorm)) {
    return false;
  }
  if (effectText && isChosenTypeColorChoiceManaEffect(effectText)) {
    return true;
  }
  if (abilityIdNorm === 'native_dynamic' || legacyId === 'native_dynamic') {
    return true;
  }
  if (/-ability-1$/i.test(abilityIdNorm)) {
    return true;
  }

  return false;
}

/**
 * Dual-ability lands (Three Tree City, Nykthos) expose `{T}: Add {C}` plus a paid
 * scaling line. `getCreatureCountManaAmount` always describes the paid line — skip
 * it when the selected activation is the colorless tap (including a simple tap).
 */
export function shouldSkipScalingManaForColorlessTap(args: {
  cardName?: string | null;
  abilityId?: string | null;
  selectedAbilityText?: string | null;
  oracleText?: string | null;
}): boolean {
  const abilityId = String(args.abilityId || '').trim();
  const cardName = String(args.cardName || '').toLowerCase();
  const oracleText = String(args.oracleText || '').toLowerCase();
  const effectText = extractSelectedManaEffectText(args.selectedAbilityText);
  const isDualColorlessPlusScaling = /\{t\}:\s*add\s*\{c\}/.test(oracleText)
    && (
      cardName.includes('three tree city')
      || oracleText.includes('creatures of the chosen type')
      || oracleText.includes('devotion to that color')
    );

  if (isNativeColorlessManaAbilityId(abilityId)) {
    return true;
  }
  if (effectText && isColorlessOnlyManaEffect(effectText)) {
    return true;
  }
  if (isDualColorlessPlusScaling && (!abilityId || /-ability-0$/i.test(abilityId))) {
    return true;
  }
  return false;
}
