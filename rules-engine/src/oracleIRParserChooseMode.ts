import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

/**
 * Matches modal headers such as:
 * - "Choose one -"
 * - "Choose up to three -"
 * - "Choose four. You may choose the same mode more than once."
 * - "Choose any number of modes -"
 */
const CHOOSE_MODE_HEADER_RE =
  /^Choose\s+(?:one|two|three|four|up\s+to\s+(?:one|two|three|four|\w+)|any\s+number(?:\s+of\s+modes?)?)(?:\.\s*You may choose the same mode more than once\.)?\s*(?:[-\u2014])?$/i;

function resolveModeCount(word: string): number | null {
  const normalized = String(word || '').trim().toLowerCase();
  switch (normalized) {
    case 'one':
      return 1;
    case 'two':
      return 2;
    case 'three':
      return 3;
    case 'four':
      return 4;
    default:
      return null;
  }
}

export function tryParseChooseModeBlock(
  effectText: string,
  parseModeEffectSteps: (effectText: string) => readonly OracleEffectStep[]
): (OracleEffectStep & { kind: 'choose_mode' }) | null {
  const normalized = normalizeOracleText(effectText);
  const firstBulletIndex = normalized.search(/[\u2022Ã¢â‚¬Â¢]\s+/);
  if (firstBulletIndex < 0) return null;

  const headerText = normalized.slice(0, firstBulletIndex).trim();
  const bodyText = normalized.slice(firstBulletIndex).trim();
  if (!CHOOSE_MODE_HEADER_RE.test(headerText) || !/[\u2022Ã¢â‚¬Â¢]/.test(bodyText)) return null;

  const rawBullets = bodyText
    .split(/\n?\s*[\u2022Ã¢â‚¬Â¢]\s+/)
    .map(b => b.trim())
    .filter(Boolean);
  if (rawBullets.length === 0) return null;

  let minModes = 1;
  let maxModes = 1;
  const normalizedHeaderText = headerText.toLowerCase();
  const canRepeatModes = /you may choose the same mode more than once/i.test(headerText);
  const upToMatch = normalizedHeaderText.match(/^choose\s+up\s+to\s+(\w+)/i);
  const exactMatch = normalizedHeaderText.match(/^choose\s+(one|two|three|four)\b/i);

  if (upToMatch) {
    minModes = 0;
    maxModes = resolveModeCount(upToMatch[1] || '') ?? 1;
  } else if (exactMatch) {
    const count = resolveModeCount(exactMatch[1] || '');
    minModes = count ?? 1;
    maxModes = count ?? 1;
  } else if (/any\s+number/.test(normalizedHeaderText)) {
    minModes = 0;
    maxModes = -1;
  }

  const namedLabelRe =
    /^((?:[A-Z][a-z]*(?:'[a-z]+)?|a|an|and|as|at|for|from|in|into|of|on|or|the|to|with)(?:\s+(?:[A-Z][a-z]*(?:'[a-z]+)?|a|an|and|as|at|for|from|in|into|of|on|or|the|to|with)){0,7})\s*-\s+(.+)$/;

  const modes = rawBullets.map((bulletText, idx) => {
    const labelMatch = bulletText.match(namedLabelRe);
    const label = labelMatch ? labelMatch[1].trim() : `Mode ${idx + 1}`;
    const modeEffectText = labelMatch ? labelMatch[2].trim() : bulletText;

    return {
      label,
      raw: bulletText,
      steps: [...parseModeEffectSteps(modeEffectText)],
    };
  });

  return {
    kind: 'choose_mode',
    minModes,
    maxModes,
    canRepeatModes,
    modes,
    raw: normalized.slice(0, 300),
  };
}
