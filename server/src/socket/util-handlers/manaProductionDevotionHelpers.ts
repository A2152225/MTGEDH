// server/src/socket/util-handlers/manaProductionDevotionHelpers.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: shouldApplyDevotionColorChoiceMana plus the private
//   colorless-only / devotion-effect / first-tap-mana-line helpers.
// Public entry symbols: shouldApplyDevotionColorChoiceMana.
// Re-exported from util.ts so the "./util.js" import path keeps working.

function isDevotionColorChoiceManaEffect(text: string): boolean {
  const normalized = String(text || '').toLowerCase();
  return /\bchoose a color\b/.test(normalized) && /\bdevotion to that color\b/.test(normalized);
}

function isColorlessOnlyManaEffect(text: string): boolean {
  const normalized = String(text || '').toLowerCase();
  return /\badd\s*\{c\}\b/.test(normalized)
    && !/\bchoose a color\b/.test(normalized)
    && !/\bdevotion to that color\b/.test(normalized)
    && !/\bany color\b/.test(normalized)
    && !/\bany one color\b/.test(normalized);
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
