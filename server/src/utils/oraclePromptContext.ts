import { parseOracleTextToIR } from '../../../rules-engine/src/oracleIRParser.js';
import { isOracleIrSpellPrimaryEnabled } from '../state/modules/oracleIrFeatureFlags.js';

export interface OraclePromptContext {
  readonly flags: {
    readonly hasTargets: boolean;
    readonly hasChoices: boolean;
    readonly hasModal: boolean;
    readonly hasConditions: boolean;
    readonly hasInterveningIf: boolean;
    readonly hasThen: boolean;
    readonly hasReplacement: boolean;
    readonly hasDuration: boolean;
    readonly hasTrigger: boolean;
  };
  /**
   * Heuristic step list derived from oracle text. Designed to be displayed to users
   * during prompts (targets/choices/etc.).
   */
  readonly steps: readonly string[];
  /** Extracted "target ..." phrases if present (best effort). */
  readonly targetPhrases?: readonly string[];
  /** Extracted "choose ..." phrases if present (best effort). */
  readonly choicePhrases?: readonly string[];
}

export interface OracleModalModeInfo {
  readonly minModes: number;
  readonly maxModes: number;
  readonly normalMinModes: number;
  readonly normalMaxModes: number;
  readonly entwineCost?: string;
  /** Season-style `{P}` budget ("Choose up to five {P} worth of modes"). */
  readonly pBudget?: number;
  readonly canRepeatModes?: boolean;
  readonly options: readonly {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    /** Raw option text as it appeared in oracle. */
    readonly raw: string;
    /** `{P}` cost for Season-style budgets. */
    readonly pCost?: number;
  }[];
  /** True if every option appears to reference targets (heuristic). */
  readonly allOptionsHaveTargets: boolean;
}

function normalizeOracleText(text: string): string {
  return String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function splitTopLevelLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function splitIntoClauses(line: string): string[] {
  const parts: string[] = [];

  const firstPass = String(line)
    .split(/(?<=[.;])\s+/)
    .map(p => p.trim())
    .filter(Boolean);

  for (const p of firstPass) {
    const thenSplit = p.split(/\bthen\b/i).map(x => x.trim()).filter(Boolean);
    if (thenSplit.length === 1) {
      parts.push(p);
    } else {
      for (let idx = 0; idx < thenSplit.length; idx++) {
        const chunk = thenSplit[idx];
        if (!chunk) continue;
        parts.push(idx === 0 ? chunk : `then ${chunk}`);
      }
    }
  }

  return parts
    .map(p => p.replace(/[.;]\s*$/g, '').trim())
    .filter(Boolean);
}

function detectFlags(allClauses: string[]): OraclePromptContext['flags'] {
  const has = (re: RegExp) => allClauses.some(c => re.test(c));

  return {
    hasTargets: has(/\btarget\b/i) || has(/\bany target\b/i) || has(/\bup to (one|two|three) target\b/i),
    hasChoices: has(/\bchoose\b/i),
    hasModal: has(/^choose\s+(one|two|three|four)\b/i),
    hasConditions: has(/^(if|unless)\b/i) || has(/\bas long as\b/i) || has(/\bonly if\b/i),
    hasInterveningIf: has(/\bif you do\b/i) || has(/\bwhen you do\b/i) || has(/^(if|when) you do\b/i),
    hasThen: has(/^then\b/i) || has(/\bthen\b/i),
    hasReplacement: has(/\binstead\b/i) || has(/\bprevent\b/i),
    hasDuration: has(/\buntil end of turn\b/i) || has(/\bthis turn\b/i) || has(/\buntil your next turn\b/i),
    hasTrigger: has(/^(at|when|whenever)\b/i) || has(/\bat the beginning of\b/i),
  };
}

function extractPhrases(allClauses: string[], phraseType: 'target' | 'choose'): string[] {
  const phrases: string[] = [];

  for (const clause of allClauses) {
    if (phraseType === 'target') {
      // Capture leading "target ..." fragments.
      const m = clause.match(/\b(up to\s+(?:one|two|three)\s+)?target\s+([^.;]+)/i);
      if (m) {
        const phrase = `${(m[1] || '')}target ${m[2]}`.replace(/\s+/g, ' ').trim();
        phrases.push(phrase);
      } else if (/\bany target\b/i.test(clause)) {
        phrases.push('any target');
      }
    } else {
      const m = clause.match(/\bchoose\s+([^.;]+)/i);
      if (m) {
        const phrase = `choose ${m[1]}`.replace(/\s+/g, ' ').trim();
        phrases.push(phrase);
      }
    }
  }

  return Array.from(new Set(phrases)).slice(0, 8);
}

export function buildOraclePromptContext(oracleText: string, maxSteps = 12): OraclePromptContext | undefined {
  const normalized = normalizeOracleText(oracleText);
  if (!normalized) return undefined;

  const lines = splitTopLevelLines(normalized);
  const steps: string[] = [];

  for (const line of lines) {
    const clauses = splitIntoClauses(line);
    for (const c of clauses) {
      steps.push(c);
      if (steps.length >= maxSteps) break;
    }
    if (steps.length >= maxSteps) break;
  }

  const allClauses = lines.flatMap(splitIntoClauses);
  const flags = detectFlags(allClauses);

  const targetPhrases = flags.hasTargets ? extractPhrases(allClauses, 'target') : undefined;
  const choicePhrases = flags.hasChoices ? extractPhrases(allClauses, 'choose') : undefined;

  return {
    flags,
    steps,
    targetPhrases,
    choicePhrases,
  };
}

function normalizeForModalParse(text: string): string {
  return String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function extractInlineModalOptionsFromHeader(header: string): string[] {
  const headerMatch = String(header || '').match(/^choose\s+(one(?:\s+or\s+(?:both|more))?|two|three|four|any number)\b\s*-\s*(.+)$/i);
  if (!headerMatch) return [];

  const tail = String(headerMatch[2] || '').trim();
  if (!tail) return [];

  const bulletOptions = tail
    .split(/\s*(?:•|\*)\s*/)
    .map((option) => option.trim())
    .filter(Boolean);
  if (bulletOptions.length >= 2) {
    return bulletOptions;
  }

  const orSeparatedOptions = tail
    .split(/\s*;\s*or\s+/i)
    .map((option) => option.trim().replace(/[.;]\s*$/g, ''))
    .filter(Boolean);
  if (orSeparatedOptions.length >= 2) {
    return orSeparatedOptions;
  }

  return [];
}

/**
 * Best-effort extraction of modal "Choose one —" blocks.
 * This is intended for prompt ordering (mode selection before targets), not full rules execution.
 */
function wordToModeCount(word: string): number | undefined {
  const normalized = String(word || '').trim().toLowerCase();
  const table: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  if (table[normalized] != null) return table[normalized];
  const asNumber = Number.parseInt(normalized, 10);
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : undefined;
}

function extractPWorthModalModes(lines: readonly string[]): OracleModalModeInfo | undefined {
  const headerIndex = lines.findIndex((line) =>
    /^choose\s+up\s+to\s+\w+\s*\{P\}\s*worth\s+of\s+modes\b/i.test(line)
  );
  if (headerIndex === -1) return undefined;

  const header = lines[headerIndex];
  const budgetMatch = header.match(/^choose\s+up\s+to\s+(\w+)\s*\{P\}\s*worth\s+of\s+modes\b/i);
  const pBudget = wordToModeCount(String(budgetMatch?.[1] || ''));
  if (!pBudget) return undefined;

  const rawOptions: Array<{ raw: string; pCost: number }> = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const modeMatch = line.match(/^((?:\{P\})+)\s*-\s*(.+)$/i);
    if (!modeMatch) {
      if (rawOptions.length > 0 && !/^(?:choose|when|whenever|at\s+the)\b/i.test(line)) {
        const previous = rawOptions[rawOptions.length - 1];
        previous.raw = `${previous.raw} ${line}`.trim();
        continue;
      }
      break;
    }
    const pCost = (modeMatch[1].match(/\{P\}/gi) || []).length || 1;
    const effect = String(modeMatch[2] || '').trim();
    if (effect) rawOptions.push({ raw: `${modeMatch[1]} - ${effect}`, pCost });
  }

  if (rawOptions.length < 2) return undefined;

  const options = rawOptions.map((entry, idx) => {
    const label = entry.raw.length > 60 ? `${entry.raw.slice(0, 57)}...` : entry.raw;
    return {
      id: `Mode ${idx + 1}`,
      label,
      description: entry.raw,
      raw: entry.raw,
      pCost: entry.pCost,
    };
  });

  return {
    minModes: 0,
    maxModes: pBudget,
    normalMinModes: 0,
    normalMaxModes: pBudget,
    pBudget,
    canRepeatModes: /you may choose the same mode more than once/i.test(header),
    options,
    allOptionsHaveTargets: options.every(
      (option) => /\btarget\b/i.test(option.raw) || /\bany target\b/i.test(option.raw),
    ),
  };
}

export function extractModalModesFromOracleText(oracleText: string): OracleModalModeInfo | undefined {
  const text = normalizeForModalParse(oracleText);
  if (!text) return undefined;

  const lines = text
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean);

  const pWorth = extractPWorthModalModes(lines);
  if (pWorth) return pWorth;

  // Find the first modal header line.
  // Supported (best-effort):
  // - "Choose one —"
  // - "Choose one or both —"
  // - "Choose one or more —"
  // - "Choose any number —"
  // - "Choose up to five {P} worth of modes."
  const headerIndex = lines.findIndex((line, index) => {
    if (!/^choose\s+(one(?:\s+or\s+(?:both|more))?|two|three|four|any number)\b/i.test(line)) {
      return false;
    }

    if (/-/.test(line)) {
      return true;
    }

    return lines.slice(index + 1).some((nextLine) => /^(?:•|\*|-)\s+/.test(nextLine));
  });
  if (headerIndex === -1) return undefined;

  const header = lines[headerIndex];
  const headerLower = header.toLowerCase();

  // Defaults
  let minModes = 1;
  let maxModes = 1;

  if (/^choose\s+any number\b/i.test(headerLower)) {
    minModes = 0;
    maxModes = 99; // will be clamped to option count after parsing
  } else if (/^choose\s+one\s+or\s+both\b/i.test(headerLower)) {
    minModes = 1;
    maxModes = 2;
  } else if (/^choose\s+one\s+or\s+more\b/i.test(headerLower)) {
    minModes = 1;
    maxModes = 99; // will be clamped to option count after parsing
  } else {
    const headerMatch = header.match(/^choose\s+(one|two|three|four)\b/i);
    if (!headerMatch) return undefined;
    const word = headerMatch[1].toLowerCase();
    minModes = wordToModeCount(word) ?? 1;
    maxModes = minModes;
  }

  const normalMinModes = minModes;
  const normalMaxModes = maxModes;

  // Collect bullet lines that follow.
  const rawOptions: string[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^(?:•|\*|-)\s*(.+)$/);
    if (!bulletMatch) break;
    const opt = bulletMatch[1].trim();
    if (opt) rawOptions.push(opt);
  }

  if (rawOptions.length === 0) {
    rawOptions.push(...extractInlineModalOptionsFromHeader(header));
  }

  if (rawOptions.length < 2) return undefined;

  if (maxModes > rawOptions.length) {
    maxModes = rawOptions.length;
  }

  const entwineMatch = text.match(/\bentwine\s+((?:\{[^}]+\}\s*)+)/i);
  const entwineCost = entwineMatch
    ? entwineMatch[1].replace(/\s+/g, '').trim()
    : undefined;

  if (entwineCost && rawOptions.length > maxModes) {
    maxModes = rawOptions.length;
  }

  const options = rawOptions.map((raw, idx) => {
    const label = raw.length > 60 ? raw.slice(0, 57) + '...' : raw;
    return {
      id: `mode_${idx + 1}`,
      label,
      description: raw,
      raw,
    };
  });

  const allOptionsHaveTargets = rawOptions.every(o => /\btarget\b/i.test(o) || /\bany target\b/i.test(o));

  return { minModes, maxModes, normalMinModes, normalMaxModes, entwineCost, options, allOptionsHaveTargets };
}

/**
 * When Oracle IR spell primary is enabled, align cast-time modal option ids with
 * IR choose_mode labels while preserving legacy min/max/entwine/teamwork metadata.
 */
export function extractModalModesForSpellCast(
  oracleText: string,
  spellName = '',
): OracleModalModeInfo | undefined {
  const legacy = extractModalModesFromOracleText(oracleText);
  if (!isOracleIrSpellPrimaryEnabled()) {
    return legacy;
  }

  try {
    const ir = parseOracleTextToIR(oracleText, spellName);
    let chooseModeStep:
      | {
          modes?: readonly { label?: string; raw?: string; pCost?: number }[];
          minModes?: number;
          maxModes?: number;
          canRepeatModes?: boolean;
          pBudget?: number;
        }
      | undefined;
    for (const ability of ir.abilities || []) {
      for (const step of ability.steps || []) {
        if (step?.kind === 'choose_mode') {
          chooseModeStep = step as typeof chooseModeStep;
          break;
        }
      }
      if (chooseModeStep) break;
    }

    const irModes = Array.isArray(chooseModeStep?.modes) ? chooseModeStep.modes : [];
    if (irModes.length < 2) {
      return legacy;
    }

    const options = irModes.map((mode, idx) => {
      const raw = String(mode.raw || mode.label || '').trim();
      const label = raw.length > 60 ? `${raw.slice(0, 57)}...` : raw;
      const id = String(mode.label || `Mode ${idx + 1}`).trim();
      const pCost = Number(mode.pCost);
      return {
        id,
        label,
        description: raw,
        raw,
        ...(Number.isFinite(pCost) && pCost > 0 ? { pCost } : {}),
      };
    });

    // IR treats any "choose both instead" rider as maxModes=2. Cast-time commander /
    // other "If …, you may choose both instead" riders stay at the printed Choose-one
    // limits; adjustModalSpellInfoForCurrentCast raises maxModes when the condition holds.
    const hasConditionalChooseBoth = oracleTextHasConditionalChooseBothInstead(oracleText);
    const pBudget = Number(chooseModeStep?.pBudget);
    const irBase: OracleModalModeInfo = {
      minModes: hasConditionalChooseBoth
        ? (legacy?.minModes ?? 1)
        : Number(chooseModeStep?.minModes ?? legacy?.minModes ?? 1) || 0,
      maxModes: hasConditionalChooseBoth
        ? (legacy?.maxModes ?? 1)
        : Number(chooseModeStep?.maxModes ?? legacy?.maxModes ?? options.length) || options.length,
      normalMinModes: hasConditionalChooseBoth
        ? (legacy?.normalMinModes ?? 1)
        : Number(chooseModeStep?.minModes ?? legacy?.normalMinModes ?? 1) || 0,
      normalMaxModes: hasConditionalChooseBoth
        ? (legacy?.normalMaxModes ?? 1)
        : Number(chooseModeStep?.maxModes ?? legacy?.normalMaxModes ?? options.length) || options.length,
      ...(legacy?.entwineCost ? { entwineCost: legacy.entwineCost } : {}),
      ...(Number.isFinite(pBudget) && pBudget > 0 ? { pBudget } : {}),
      ...(chooseModeStep?.canRepeatModes || legacy?.canRepeatModes
        ? { canRepeatModes: true }
        : {}),
      options,
      allOptionsHaveTargets: options.every(
        (option) => /\btarget\b/i.test(option.raw) || /\bany target\b/i.test(option.raw),
      ),
    };

    return legacy
      ? {
          ...legacy,
          ...irBase,
          options,
        }
      : irBase;
  } catch {
    return legacy;
  }
}

function oracleTextHasConditionalChooseBothInstead(text: string): boolean {
  const normalized = String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[−–—]/g, '-');
  return /\bif\b[\s\S]+?(?:you may\s+)?choose both instead\b/i.test(normalized);
}

/**
 * Cast-time UI and tests still submit `mode_1` / `mode_2` while SPELL_PRIMARY=1
 * queues IR labels (`Mode 1`). Treat those as the same option.
 */
export function isAllowedModalModeSelectionId(
  selectedId: string,
  optionIds: readonly string[],
): boolean {
  const id = String(selectedId || '').trim();
  if (!id) return false;
  if (optionIds.some((optionId) => optionId === id)) return true;

  const indexMatch = /^mode[_-]?(\d+)$/i.exec(id) || /^mode\s+(\d+)$/i.exec(id);
  if (indexMatch) {
    const idx = parseInt(indexMatch[1], 10) - 1;
    if (idx >= 0 && idx < optionIds.length) return true;
  }

  const normalized = id.toLowerCase().replace(/[\s_-]+/g, '');
  return optionIds.some((optionId, idx) => {
    const optionNorm = String(optionId || '').toLowerCase().replace(/[\s_-]+/g, '');
    return optionNorm === normalized || optionNorm === `mode${idx + 1}`;
  });
}

export function matchModalModeOptions(
  modalInfo: OracleModalModeInfo,
  selectedModeIds: readonly string[],
): OracleModalModeInfo['options'] {
  const matched: OracleModalModeInfo['options'][number][] = [];

  for (const rawId of selectedModeIds) {
    const id = String(rawId || '').trim();
    if (!id) continue;

    const direct = modalInfo.options.find((option) => option.id === id);
    if (direct) {
      matched.push(direct);
      continue;
    }

    const modeIndexMatch = /^mode[_-]?(\d+)$/i.exec(id);
    if (modeIndexMatch) {
      const option = modalInfo.options[parseInt(modeIndexMatch[1], 10) - 1];
      if (option) {
        matched.push(option);
        continue;
      }
    }

    const byLabel = modalInfo.options.find((option) => option.label === id);
    if (byLabel) {
      matched.push(byLabel);
    }
  }

  return matched;
}

export function getOracleTextFromResolutionStep(step: unknown): string | undefined {
  const s = step as any;

  const candidates: Array<string | undefined> = [
    s?.oracleText,
    s?.abilityText,
    s?.effectText,
    s?.spellCastContext?.oracleText,
    s?.spellCastContext?.oracle_text,
    s?.card?.oracle_text,
    s?.revealedCard?.oracle_text,
    s?.actualCard?.oracle_text,
    s?.hitCard?.oracle_text,
    s?.sourceCard?.oracle_text,
    s?.source?.oracle_text,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }

  return undefined;
}
