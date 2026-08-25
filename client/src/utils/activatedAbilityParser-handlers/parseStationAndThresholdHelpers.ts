/**
 * Origin parent: client/src/utils/activatedAbilityParser.ts
 *
 * Cluster moved: parseStationThreshold, parseThresholdGatedAbilityLine,
 * normalizeAbilitySentence.
 *
 * Public entry symbols: parseStationThreshold, parseThresholdGatedAbilityLine,
 * normalizeAbilitySentence.
 */

export function parseStationThreshold(oracleText: string): number | undefined {
  const inlineMatch = oracleText.match(/station\s*(\d+)/i);
  if (inlineMatch) {
    return parseInt(inlineMatch[1], 10);
  }

  const thresholdLineMatch = oracleText.match(/station(?:\s*\([^)]*\))?\s*(?:\r?\n)+\s*(\d+)\+\s*\|/i);
  if (thresholdLineMatch) {
    return parseInt(thresholdLineMatch[1], 10);
  }

  return undefined;
}

export function parseThresholdGatedAbilityLine(
  line: string,
  activatedAbilityPattern: RegExp,
  textOnlyActivatedAbilityPattern: RegExp
): { threshold: number; cost: string; effect: string } | null {
  const gatedMatch = line.match(/^(\d+)\+\s*\|\s*(.+)$/);
  if (!gatedMatch) {
    return null;
  }

  const threshold = parseInt(gatedMatch[1], 10);
  if (!Number.isFinite(threshold)) {
    return null;
  }

  const abilityText = gatedMatch[2].trim();
  const activatedMatch = abilityText.match(activatedAbilityPattern);
  if (activatedMatch) {
    return {
      threshold,
      cost: activatedMatch[1].trim(),
      effect: activatedMatch[2].trim(),
    };
  }

  const textOnlyMatch = abilityText.match(textOnlyActivatedAbilityPattern);
  if (textOnlyMatch) {
    return {
      threshold,
      cost: textOnlyMatch[1].trim(),
      effect: textOnlyMatch[2].trim(),
    };
  }

  return null;
}

export function normalizeAbilitySentence(sentence: string): string {
  const trimmed = sentence.trim();
  if (trimmed.length < 2) return trimmed;

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const inner = trimmed.slice(1, -1).trim();
    if (/^(?:\{[^}]+\}|Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)/i.test(inner)) {
      return inner;
    }
  }

  return trimmed;
}

