/*
 * Shallow oracle-text parser: splits MTG oracle text into ordered clauses/steps and
 * tags them for interaction points (targets/choices), gating (if/unless), and
 * sequencing (then, at the beginning of, until end of turn, etc.).
 *
 * This is intentionally heuristic. The goal is high recall and stable structure,
 * not perfect rules-level semantics.
 */

function normalizeOracleText(text) {
  return String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ') // nbsp
    .trim();
}

function splitTopLevelBlocks(text) {
  // Keep newlines meaningful: most oracle text uses them to separate abilities/modes.
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function looksLikeModalHeader(line) {
  return /^choose\s+(one|two|three|four)\b/i.test(line) && /—|-/.test(line);
}

function splitModalOptions(blockLines, startIndex) {
  // Parses modal blocks like:
  // "Choose one —"
  // "• Destroy target creature."
  // "• Draw two cards."
  const header = blockLines[startIndex];
  const options = [];
  let i = startIndex + 1;
  for (; i < blockLines.length; i++) {
    const line = blockLines[i];
    const m = line.match(/^(?:•|\*)\s*(.+)$/);
    if (m) {
      options.push(m[1].trim());
      continue;
    }
    // Stop when modal bullets stop.
    break;
  }
  return { header, options, nextIndex: i };
}

function splitIntoClauses(sentence) {
  // First split on strong separators.
  // Keep "then" as a boundary marker as well.
  const rawParts = [];

  // Split on semicolons and periods, but keep content.
  const firstPass = String(sentence)
    .split(/(?<=[.;])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const p of firstPass) {
    // Further split on "then" when used as a sequencing keyword.
    const thenSplit = p.split(/\bthen\b/i).map((x) => x.trim()).filter(Boolean);
    if (thenSplit.length === 1) {
      rawParts.push(p);
    } else {
      for (let idx = 0; idx < thenSplit.length; idx++) {
        const part = thenSplit[idx];
        if (!part) continue;
        // Re-add a synthetic "then" marker for all but the first.
        rawParts.push(idx === 0 ? part : `then ${part}`);
      }
    }
  }

  // Clean trailing punctuation (but keep internal punctuation)
  return rawParts
    .map((p) => p.replace(/[.;]\s*$/g, '').trim())
    .filter(Boolean);
}

function classifyClause(text) {
  const t = text.trim();
  const lower = t.toLowerCase();

  const tags = [];

  // Gating / condition
  if (/^(if|unless)\b/i.test(t) || /\bas long as\b/i.test(lower) || /\bonly if\b/i.test(lower)) {
    tags.push('condition');
  }

  // Intervening "if you do/when you do" references
  if (/^(if|when) you do\b/i.test(t) || /\bif you do\b/i.test(lower) || /\bwhen you do\b/i.test(lower)) {
    tags.push('ref:prior-step');
  }

  // Targets
  if (/\btarget\b/i.test(t) || /\bany target\b/i.test(lower) || /\bup to (one|two|three) target\b/i.test(lower)) {
    tags.push('target');
  }

  // Choices / modes
  if (/\bchoose\b/i.test(t) || /^choose\s+(one|two|three|four)\b/i.test(t) || /\bchoose a\b/i.test(lower)) {
    tags.push('choice');
  }

  // Optionality
  if (/\byou may\b/i.test(lower) || /\bmay\b/i.test(lower)) {
    tags.push('may');
  }

  // Replacement/prevention
  if (/\binstead\b/i.test(lower) || /\bprevent\b/i.test(lower)) {
    tags.push('replacement');
  }

  // Timing & duration
  if (/\buntil end of turn\b/i.test(lower) || /\bthis turn\b/i.test(lower) || /\buntil your next turn\b/i.test(lower)) {
    tags.push('duration');
  }
  if (/\bat the beginning of\b/i.test(lower) || /^(at|when|whenever)\b/i.test(t)) {
    tags.push('trigger');
  }

  // Sequencing marker
  if (/^then\b/i.test(t)) {
    tags.push('then');
  }

  // Very rough action verb detection (useful for summaries)
  const verbMatch = lower.match(/^([a-z]+)\b/);
  if (verbMatch) tags.push(`verb:${verbMatch[1]}`);

  // Choose a primary kind for convenience
  let kind = 'effect';
  if (tags.includes('choice') || tags.includes('modal')) kind = 'choice';
  if (tags.includes('target')) kind = 'target';
  if (tags.includes('condition')) kind = 'condition';
  if (tags.includes('trigger')) kind = 'trigger';

  return { kind, tags };
}

function parseOracleTextToSteps(oracleText) {
  const normalized = normalizeOracleText(oracleText);
  if (!normalized) {
    return {
      normalized: '',
      blocks: [],
      flags: {},
    };
  }

  const lines = splitTopLevelBlocks(normalized);

  // Modal blocks are multi-line; collect into blocks.
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (looksLikeModalHeader(line)) {
      const { header, options, nextIndex } = splitModalOptions(lines, i);
      const modalClauses = [];

      modalClauses.push({
        text: header,
        kind: 'choice',
        tags: ['modal', 'choice'],
      });

      for (const opt of options) {
        const clauses = splitIntoClauses(opt);
        for (const c of clauses) {
          const cls = classifyClause(c);
          modalClauses.push({ text: c, kind: cls.kind, tags: [...new Set([...cls.tags, 'modal-option'])] });
        }
      }

      blocks.push({
        raw: [header, ...options.map((o) => `• ${o}`)].join('\n'),
        clauses: modalClauses.map((c, idx) => ({ index: idx, ...c })),
      });

      i = nextIndex - 1;
      continue;
    }

    const clauses = splitIntoClauses(line);
    const parsedClauses = clauses.map((c, idx) => {
      const cls = classifyClause(c);
      return { index: idx, text: c, kind: cls.kind, tags: cls.tags };
    });

    blocks.push({ raw: line, clauses: parsedClauses });
  }

  const allClauses = blocks.flatMap((b) => b.clauses);
  const has = (tag) => allClauses.some((c) => c.tags.includes(tag));

  const flags = {
    hasTargets: has('target'),
    hasChoices: has('choice'),
    hasModal: has('modal'),
    hasConditions: has('condition'),
    hasInterveningIf: has('ref:prior-step'),
    hasThen: has('then'),
    hasReplacement: has('replacement'),
    hasDuration: has('duration'),
    hasTrigger: has('trigger'),
  };

  return { normalized, blocks, flags };
}

module.exports = {
  normalizeOracleText,
  parseOracleTextToSteps,
};
