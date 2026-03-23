import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

/**
 * Matches "Choose one -", "Choose two -", "Choose up to two -",
 * "Choose any number of modes -", etc.
 */
const CHOOSE_MODE_HEADER_RE = /^Choose\s+(?:one|two|three|up\s+to\s+(?:two|three|four|\w+)|any\s+number(?:\s+of\s+modes?)?)\s*[-—]/i;

export function tryParseChooseModeBlock(
  effectText: string,
  parseModeEffectSteps: (effectText: string) => readonly OracleEffectStep[]
): (OracleEffectStep & { kind: 'choose_mode' }) | null {
  const normalized = normalizeOracleText(effectText);
  if (!CHOOSE_MODE_HEADER_RE.test(normalized)) return null;
  if (!/[\u2022â€¢]/.test(normalized) && !/\n\s*â€¢/.test(normalized) && !/\n\s*\u2022/.test(normalized)) {
    return null;
  }

  const m = normalized.match(
    /^(Choose\s+(?:one|two|three|up\s+to\s+(?:two|three|four|\w+)|any\s+number(?:\s+of\s+modes?)?))(?:\s*[-—][^\n]*\n?)([\s\S]*)$/i
  );
  if (!m) return null;

  const headerText = m[1].toLowerCase().trim();
  const bodyText = (m[2] || '').trim();
  if (!/[\u2022â€¢]/.test(bodyText)) return null;

  const rawBullets = bodyText
    .split(/\n?\s*[\u2022â€¢]\s+/)
    .map(b => b.trim())
    .filter(Boolean);
  if (rawBullets.length === 0) return null;

  let minModes = 1;
  let maxModes = 1;
  if (/^choose\s+two/.test(headerText) && !/up\s+to/.test(headerText)) {
    minModes = 2;
    maxModes = 2;
  } else if (/^choose\s+three/.test(headerText) && !/up\s+to/.test(headerText)) {
    minModes = 3;
    maxModes = 3;
  } else if (/up\s+to\s+two/.test(headerText)) {
    minModes = 0;
    maxModes = 2;
  } else if (/up\s+to\s+three/.test(headerText)) {
    minModes = 0;
    maxModes = 3;
  } else if (/up\s+to\s+four/.test(headerText)) {
    minModes = 0;
    maxModes = 4;
  } else if (/any\s+number/.test(headerText)) {
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
    modes,
    raw: normalized.slice(0, 300),
  };
}
