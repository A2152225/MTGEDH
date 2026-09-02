import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

/**
 * Matches modal headers such as:
 * - "Choose one -"
 * - "Choose one that hasn't been chosen -"
 * - "Choose one or more -"
 * - "Choose one or both -"
 * - "Choose up to three -"
 * - "Choose four. You may choose the same mode more than once."
 * - "Choose any number of modes -"
 */
const CHOOSE_MODE_HEADER_RE =
  /^(?:You\s+(?:may\s+)?)?Choose\s+(?:one\s+at\s+random|one\s+that\s+has(?:n't| not)\s+been\s+chosen|one\s+or\s+both|one\s+or\s+more|up\s+to\s+one|one|two|three|four|up\s+to\s+(?:that\s+many|one|two|three|four|five|six|seven|eight|nine|ten|\w+)(?:\s*\{P\}\s*worth\s+of\s+modes)?|any\s+number(?:\s+of\s+modes?)?)(?:\.\s*If\s+[^.]*?(?:you\s+may\s+)?choose\s+(?:both|any\s+number)\s+instead[.\u2014-]?)?(?:\.\s*You may choose the same mode more than once\.)?\s*(?:[-\u2014]|\.|)\s*(?:Each mode must target a different player\.?)?\s*$/i;

const P_WORTH_HEADER_RE =
  /^Choose\s+up\s+to\s+(\w+)\s*\{P\}\s*worth\s+of\s+modes\.(?:\s*You may choose the same mode more than once\.)?\s*$/i;

function splitChooseModeHeaderText(headerText: string): {
  readonly prefixText: string;
  readonly headerText: string;
} | null {
  let headerStart = -1;
  const chooseMatchRe = /\b(?:You\s+(?:may\s+)?)?Choose\s+/gi;

  for (const match of headerText.matchAll(chooseMatchRe)) {
    const start = Number(match.index ?? -1);
    if (start < 0) continue;

    const candidateHeader = headerText.slice(start).trim();
    if (CHOOSE_MODE_HEADER_RE.test(candidateHeader)) {
      headerStart = start;
    }
  }

  if (headerStart < 0) return null;

  return {
    prefixText: headerText.slice(0, headerStart).trim(),
    headerText: headerText.slice(headerStart).trim(),
  };
}

function resolveChooseModeLimits(headerText: string): {
  readonly minModes: number;
  readonly maxModes: number;
  readonly canRepeatModes: boolean;
  readonly rememberChosenModes: boolean;
  readonly teamworkChooseBoth?: boolean;
  readonly kickerChooseBoth?: boolean;
  readonly optional?: boolean;
  readonly distinctPlayerTargets?: boolean;
} {
  let minModes = 1;
  let maxModes = 1;
  const normalizedHeaderText = headerText.toLowerCase();
  const canRepeatModes = /you may choose the same mode more than once/i.test(headerText);
  const rememberChosenModes = /choose\s+one\s+that\s+has(?:n't| not)\s+been\s+chosen/i.test(headerText);
  const teamworkChooseBoth = /if this spell was cast using teamwork,\s*choose both instead/i.test(headerText);
  const kickerChooseBoth = /if it was kicked,\s*choose both instead/i.test(headerText);
  const optional = /^you\s+may\s+choose\b/i.test(normalizedHeaderText);
  const distinctPlayerTargets = /each mode must target a different player/i.test(headerText);
  const chooseHeaderText = normalizedHeaderText.replace(/^you\s+may\s+/i, '');
  const chooseBothInstead = !teamworkChooseBoth && !kickerChooseBoth && /(?:you may\s+)?choose both instead/i.test(headerText);
  const chooseAnyNumberInstead = /(?:you may\s+)?choose any number instead/i.test(headerText);
  const oneOrBothMatch = chooseHeaderText.match(/^choose\s+one\s+or\s+both\b/i);
  const oneOrMoreMatch = chooseHeaderText.match(/^choose\s+one\s+or\s+more\b/i);
  const chooseOneAtRandomMatch = chooseHeaderText.match(/^choose\s+one\s+at\s+random\b/i);
  const thatManyMatch = chooseHeaderText.match(/^choose\s+up\s+to\s+that\s+many\b/i);
  const upToMatch = chooseHeaderText.match(/^choose\s+up\s+to\s+(\w+)/i);
  const exactMatch = chooseHeaderText.match(/^choose\s+(one|two|three|four)\b/i);

  if (chooseOneAtRandomMatch) {
    minModes = 1;
    maxModes = 1;
  } else if (oneOrBothMatch || chooseBothInstead) {
    minModes = 1;
    maxModes = 2;
  } else if (kickerChooseBoth) {
    // Unkicked: exactly one. Kicked: executor forces both via kickerChooseBoth + wasKicked.
    minModes = 1;
    maxModes = 1;
  } else if (oneOrMoreMatch || chooseAnyNumberInstead) {
    minModes = 1;
    maxModes = 99;
  } else if (thatManyMatch) {
    minModes = 0;
    maxModes = 99;
  } else if (upToMatch) {
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

  return {
    minModes,
    maxModes,
    canRepeatModes,
    rememberChosenModes,
    ...(teamworkChooseBoth ? { teamworkChooseBoth: true } : {}),
    ...(kickerChooseBoth ? { kickerChooseBoth: true } : {}),
    ...(optional ? { optional: true } : {}),
    ...(distinctPlayerTargets ? { distinctPlayerTargets: true } : {}),
  };
}

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
    case 'five':
      return 5;
    case 'six':
      return 6;
    case 'seven':
      return 7;
    case 'eight':
      return 8;
    case 'nine':
      return 9;
    case 'ten':
      return 10;
    default: {
      const asNumber = Number.parseInt(normalized, 10);
      return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : null;
    }
  }
}

function countPSymbols(text: string): number {
  const matches = String(text || '').match(/\{P\}/gi);
  return matches ? matches.length : 0;
}

/**
 * Season-style modal blocks:
 *   Choose up to five {P} worth of modes. You may choose the same mode more than once.
 *   {P} — Put a +1/+1 counter…
 *   {P}{P} — Choose artifact or enchantment…
 */
function tryParsePWorthChooseModeBlock(
  effectText: string,
  parseModeEffectSteps: (effectText: string) => readonly OracleEffectStep[]
): (OracleEffectStep & { kind: 'choose_mode' }) | null {
  const normalized = normalizeOracleText(effectText);
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const headerMatch = lines[0].match(P_WORTH_HEADER_RE);
  if (!headerMatch) return null;

  const pBudget = resolveModeCount(headerMatch[1] || '') ?? 0;
  if (pBudget <= 0) return null;

  const modeLines = lines.slice(1);
  if (!modeLines.every((line) => /^\{P\}/i.test(line))) return null;

  const modes = modeLines.map((line, idx) => {
    const modeMatch = line.match(/^((?:\{P\})+)\s*[—–-]\s*([\s\S]+)$/i);
    const pCost = countPSymbols(modeMatch?.[1] || line) || 1;
    const modeEffectText = String(modeMatch?.[2] || line).trim();
    return {
      label: `Mode ${idx + 1}`,
      raw: line,
      pCost,
      steps: [...parseModeEffectSteps(modeEffectText)],
    };
  });

  if (modes.length === 0) return null;

  return {
    kind: 'choose_mode',
    minModes: 0,
    maxModes: pBudget,
    canRepeatModes: /you may choose the same mode more than once/i.test(lines[0]),
    pBudget,
    modes,
    raw: normalized.slice(0, 300),
  };
}

export function tryParseChooseModeBlock(
  effectText: string,
  parseModeEffectSteps: (effectText: string) => readonly OracleEffectStep[]
): (OracleEffectStep & { kind: 'choose_mode' }) | null {
  const pWorth = tryParsePWorthChooseModeBlock(effectText, parseModeEffectSteps);
  if (pWorth) return pWorth;

  const normalized = normalizeOracleText(effectText);
  const firstBulletIndex = normalized.search(/[\u2022•]\s+/);
  if (firstBulletIndex < 0) return null;

  const rawHeaderText = normalized.slice(0, firstBulletIndex).trim();
  const bodyText = normalized.slice(firstBulletIndex).trim();
  if (!/[\u2022•]/.test(bodyText)) return null;

  const rawBullets = bodyText
    .split(/\n?\s*[\u2022•]\s+/)
    .map(b => b.trim())
    .filter(Boolean);
  if (rawBullets.length === 0) return null;

  const tieredMatch = rawHeaderText.match(/^Tiered\s*\([^)]*\)\s*\n([\s\S]+)$/i);
  if (tieredMatch) {
    const sharedEffectText = String(tieredMatch[1] || '').trim();
    if (!sharedEffectText) return null;
    const tieredTargetText = String(
      sharedEffectText.match(/^(?:Until end of turn,\s+)?(.+?)\s+gains?\s+"/i)?.[1] || 'target creature you control'
    ).trim();

    const modes = rawBullets.map((bulletText, idx) => {
      const bulletMatch = bulletText.match(
        /^(.+?)\s*-\s*(\{[^}]+\}|[^-]+?)\s*-\s*(\d+)\s*\/\s*(\d+)\.?\s*$/i
      );
      const label = String(bulletMatch?.[1] || `Mode ${idx + 1}`).trim();
      const power = Number.parseInt(String(bulletMatch?.[3] || ''), 10);
      const toughness = Number.parseInt(String(bulletMatch?.[4] || ''), 10);
      const modeEffectText = Number.isFinite(power) && Number.isFinite(toughness)
        ? sharedEffectText
          .replace(
            /\s+and\s+has\s+the\s+chosen\s+base\s+power\s+and\s+toughness\b/i,
            `. Until end of turn, ${tieredTargetText} has base power and toughness ${power}/${toughness}`
          )
          .replace(
            /\bchosen\s+base\s+power\s+and\s+toughness\b/i,
            `base power and toughness ${power}/${toughness}`
          )
        : sharedEffectText;

      return {
        label,
        raw: bulletText,
        steps: [...parseModeEffectSteps(modeEffectText)],
      };
    });

    return {
      kind: 'choose_mode',
      minModes: 1,
      maxModes: 1,
      canRepeatModes: false,
      modes,
      raw: normalized.slice(0, 300),
    };
  }

  const headerMatch = splitChooseModeHeaderText(rawHeaderText);
  if (!headerMatch || headerMatch.prefixText) return null;

  const headerText = headerMatch.headerText;

  if (!CHOOSE_MODE_HEADER_RE.test(headerText)) return null;

  const {
    minModes,
    maxModes,
    canRepeatModes,
    rememberChosenModes,
    teamworkChooseBoth,
    kickerChooseBoth,
    optional,
    distinctPlayerTargets,
  } = resolveChooseModeLimits(headerText);
  const resolvedMaxModes = maxModes === 99 ? rawBullets.length : maxModes;

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
    maxModes: resolvedMaxModes,
    canRepeatModes,
    ...(rememberChosenModes ? { rememberChosenModes: true } : {}),
    ...(teamworkChooseBoth ? { teamworkChooseBoth: true } : {}),
    ...(kickerChooseBoth ? { kickerChooseBoth: true } : {}),
    ...(optional ? { optional: true } : {}),
    ...(distinctPlayerTargets ? { distinctPlayerTargets: true } : {}),
    modes,
    raw: normalized.slice(0, 300),
  };
}

export function tryParseChooseModeHeaderOnly(
  clause: string,
  withMeta: <T extends OracleEffectStep>(step: T) => T
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(clause || '').trim());
  if (!normalized || !CHOOSE_MODE_HEADER_RE.test(normalized)) return null;

  const {
    minModes,
    maxModes,
    canRepeatModes,
    rememberChosenModes,
    teamworkChooseBoth,
    kickerChooseBoth,
    optional,
    distinctPlayerTargets,
  } = resolveChooseModeLimits(normalized);

  return withMeta({
    kind: 'choose_mode',
    minModes,
    maxModes,
    canRepeatModes,
    ...(rememberChosenModes ? { rememberChosenModes: true } : {}),
    ...(teamworkChooseBoth ? { teamworkChooseBoth: true } : {}),
    ...(kickerChooseBoth ? { kickerChooseBoth: true } : {}),
    ...(optional ? { optional: true } : {}),
    ...(distinctPlayerTargets ? { distinctPlayerTargets: true } : {}),
    modes: [],
    raw: normalized,
  });
}

export function tryParseChooseModeBlockWithPrelude(
  effectText: string,
  parseModeEffectSteps: (effectText: string) => readonly OracleEffectStep[],
  parsePreludeEffectSteps: (effectText: string) => readonly OracleEffectStep[]
): readonly OracleEffectStep[] | null {
  const normalized = normalizeOracleText(effectText);
  const firstBulletIndex = normalized.search(/[\u2022•]\s+/);
  if (firstBulletIndex < 0) return null;

  const headerMatch = splitChooseModeHeaderText(normalized.slice(0, firstBulletIndex).trim());
  if (!headerMatch || !headerMatch.prefixText) return null;

  const chooseModeStep = tryParseChooseModeBlock(
    `${headerMatch.headerText}\n${normalized.slice(firstBulletIndex).trim()}`,
    parseModeEffectSteps
  );
  if (!chooseModeStep) return null;

  const prefixSteps = parsePreludeEffectSteps(headerMatch.prefixText).filter(Boolean);
  if (prefixSteps.length === 0) return [chooseModeStep];
  return [...prefixSteps, chooseModeStep];
}
