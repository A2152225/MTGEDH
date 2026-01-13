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
  readonly options: readonly {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    /** Raw option text as it appeared in oracle. */
    readonly raw: string;
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

/**
 * Best-effort extraction of modal "Choose one —" blocks.
 * This is intended for prompt ordering (mode selection before targets), not full rules execution.
 */
export function extractModalModesFromOracleText(oracleText: string): OracleModalModeInfo | undefined {
  const text = normalizeForModalParse(oracleText);
  if (!text) return undefined;

  const lines = text
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean);

  // Find the first modal header line.
  // Supported (best-effort):
  // - "Choose one —"
  // - "Choose one or both —"
  // - "Choose any number —"
  const headerIndex = lines.findIndex(l => /^choose\s+(one|two|three|four|any number)\b/i.test(l) && /-/.test(l));
  if (headerIndex === -1) return undefined;

  const header = lines[headerIndex];
  const headerLower = header.toLowerCase();

  const wordToCount: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

  // Defaults
  let minModes = 1;
  let maxModes = 1;

  if (/^choose\s+any number\b/i.test(headerLower)) {
    minModes = 0;
    maxModes = 99; // will be clamped to option count after parsing
  } else if (/^choose\s+one\s+or\s+both\b/i.test(headerLower)) {
    minModes = 1;
    maxModes = 2;
  } else {
    const headerMatch = header.match(/^choose\s+(one|two|three|four)\b/i);
    if (!headerMatch) return undefined;
    const word = headerMatch[1].toLowerCase();
    minModes = wordToCount[word] ?? 1;
    maxModes = minModes;
  }

  // Collect bullet lines that follow.
  const rawOptions: string[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^(?:•|\*|-)\s*(.+)$/);
    if (!bulletMatch) break;
    const opt = bulletMatch[1].trim();
    if (opt) rawOptions.push(opt);
  }

  if (rawOptions.length < 2) return undefined;

  if (maxModes > rawOptions.length) {
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

  return { minModes, maxModes, options, allOptionsHaveTargets };
}

export function getOracleTextFromResolutionStep(step: unknown): string | undefined {
  const s = step as any;

  const candidates: Array<string | undefined> = [
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
