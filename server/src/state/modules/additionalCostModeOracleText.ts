/**
 * Shared Spree / Tiered additional-cost mode extraction and resolve-time oracle scoping.
 * Cast (game-actions) and IR resolve must use the same helper so selected modes cannot diverge.
 */

export type AdditionalCostModeOption = {
  id: string;
  label: string;
  cost: string;
  effect: string;
};

export type AdditionalCostModeInfo = {
  purpose: 'spree' | 'tiered';
  minModes: number;
  maxModes: number;
  preservedLines: string[];
  options: AdditionalCostModeOption[];
};

export function extractAdditionalCostModesFromOracleText(oracleText: string): AdditionalCostModeInfo | undefined {
  const normalizedText = String(oracleText || '')
    .replace(/[’']/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\r\n?/g, '\n');
  const lines = normalizedText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headerIndex = lines.findIndex((line) => /^spree\b/i.test(line) || /^tiered\b/i.test(line));
  if (headerIndex === -1) return undefined;

  const purpose: 'spree' | 'tiered' = /^tiered\b/i.test(lines[headerIndex]) ? 'tiered' : 'spree';
  const options: AdditionalCostModeOption[] = [];
  const preservedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === headerIndex) continue;

    if (index < headerIndex) {
      preservedLines.push(line);
      continue;
    }

    if (purpose === 'spree') {
      const spreeMatch = line.match(/^\+\s*((?:\{[^}]+\}\s*)+)\s*-\s*(.+)$/i);
      if (spreeMatch) {
        const cost = String(spreeMatch[1] || '').replace(/\s+/g, '').trim();
        const effect = String(spreeMatch[2] || '').trim();
        options.push({
          id: `spree_${options.length}`,
          label: `Pay ${cost}`,
          cost,
          effect,
        });
        continue;
      }
    } else {
      const tieredMatch = line.match(/^(?:•|\*|-)\s*(.+?)\s*-\s*((?:\{[^}]+\}\s*)+)\s*-\s*(.+)$/i);
      if (tieredMatch) {
        const label = String(tieredMatch[1] || '').trim();
        const cost = String(tieredMatch[2] || '').replace(/\s+/g, '').trim();
        const effect = String(tieredMatch[3] || '').trim();
        options.push({
          id: `tiered_${options.length}`,
          label,
          cost,
          effect,
        });
        continue;
      }
    }

    preservedLines.push(line);
  }

  if (options.length === 0) return undefined;

  return {
    purpose,
    minModes: 1,
    maxModes: purpose === 'tiered' ? 1 : options.length,
    preservedLines,
    options,
  };
}

/**
 * Restrict oracle text to preserved framing lines + selected Spree/Tiered mode effects.
 * When no selection is provided, returns the original text unchanged.
 */
export function getSelectedAdditionalCostOracleText(
  oracleText: string,
  selectedAdditionalCostModes?: unknown,
): string {
  const selectedModeIds = Array.isArray(selectedAdditionalCostModes)
    ? selectedAdditionalCostModes.map((mode: unknown) => String(mode || '')).filter(Boolean)
    : [];

  if (selectedModeIds.length === 0) return oracleText;

  const additionalCostModeInfo = extractAdditionalCostModesFromOracleText(oracleText);
  if (!additionalCostModeInfo) return oracleText;

  const selectedSet = new Set(selectedModeIds);
  const selectedEffects = additionalCostModeInfo.options
    .filter((mode) => selectedSet.has(mode.id))
    .map((mode) => mode.effect);

  if (selectedEffects.length === 0) return oracleText;

  const scopedLines = [...additionalCostModeInfo.preservedLines, ...selectedEffects].filter(Boolean);
  return scopedLines.length > 0 ? scopedLines.join('\n') : oracleText;
}

/** Prefer explicit additional-cost selection; fall back to selectedModes (cast resume). */
export function resolveSelectedAdditionalCostModeIds(
  selectedAdditionalCostModes?: unknown,
  selectedModes?: unknown,
): string[] {
  if (Array.isArray(selectedAdditionalCostModes) && selectedAdditionalCostModes.length > 0) {
    return selectedAdditionalCostModes.map((mode) => String(mode || '')).filter(Boolean);
  }
  if (Array.isArray(selectedModes) && selectedModes.length > 0) {
    return selectedModes.map((mode) => String(mode || '')).filter(Boolean);
  }
  return [];
}
