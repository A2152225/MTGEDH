function escapeRegex(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildSelfReferenceAliases(cardName?: string): string[] {
  const raw = String(cardName || '').trim();
  if (!raw) return [];

  const aliases = new Set<string>();
  const pushAlias = (value: string): void => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    aliases.add(normalized);
  };

  pushAlias(raw);

  for (const face of raw.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    pushAlias(face);

    const commaHead = face.split(',')[0]?.trim();
    if (commaHead && commaHead.length >= 4) {
      pushAlias(commaHead);
    }
  }

  return [...aliases].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

const CONTINUATION_SENTENCE_PATTERNS = [
  /^then\b/i,
  /^\(/,
  /^you\b/i,
  /^if\b/i,
  /^spell mastery\b/i,
  /^choose\b/i,
  /^when\s+you\s+do\b/i,
  /^whenever\s+you\s+do\b/i,
  /^unless\b/i,
  /^where\b/i,
  /^when\b/i,
  /^whenever\b/i,
  /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step\b/i,
  /^at\s+end\s+of\s+combat\b/i,
  /^at\s+(?:the\s+)?end\s+of\s+turn\b/i,
  /^create\b/i,
  /^its owner\b/i,
  /^its controller\b/i,
  /^those\b/i,
  /^that\b/i,
  /^return\b/i,
  /^it\b/i,
  /^until\b/i,
  /^through\b/i,
  /^as\s+long\s+as\b/i,
  /^during\b/i,
  /^put\b/i,
  /^activate\b/i,
  /^this\b/i,
  /^for\b/i,
  /^spend\b/i,
  /^they\b/i,
  /^each\b/i,
  /^otherwise\b/i,
  /^instead\b/i,
  /^draw\b/i,
  /^exile\b/i,
  /^shuffle\b/i,
  /^(?:sacrifice|exile)\s+(?:it|them|that token|those tokens|the token|the tokens)\b/i,
];

export function isContinuationSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  return CONTINUATION_SENTENCE_PATTERNS.some(pattern => pattern.test(trimmed));
}

export function mergeContinuationSentences(sentences: string[]): string[] {
  const merged: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (merged.length > 0 && isContinuationSentence(trimmed)) {
      merged[merged.length - 1] = merged[merged.length - 1] + ' ' + trimmed;
    } else {
      merged.push(trimmed);
    }
  }

  return merged;
}

export function normalizeOracleTextSelfReferences(oracleText: string, cardName?: string): string {
  return buildSelfReferenceAliases(cardName).reduce((text, alias) => {
    const pattern = new RegExp(`(^|[^a-z0-9])(${escapeRegex(alias)})(?=[^a-z0-9]|$)`, 'gi');
    return text.replace(pattern, '$1this permanent');
  }, oracleText);
}

function isDieRollResultsTableLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) return false;
  return /^\d+(?:\s*[\u2013\u2014-]\s*\d+|\+)?\s*\|/i.test(normalized);
}

export function splitOracleTextIntoParseLines(oracleText: string): string[] {
  const rawLines = oracleText.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const abilityLines: string[] = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    let raw = rawLines[index];
    if (/^Tiered\s*\(/i.test(raw) && index + 1 < rawLines.length && !/^[\u2022â€¢]\s+/.test(rawLines[index + 1])) {
      raw = `${raw}\n${rawLines[index + 1]}`;
      index += 1;
    }
    if (isDieRollResultsTableLine(raw) && abilityLines.length > 0) {
      abilityLines[abilityLines.length - 1] = `${abilityLines[abilityLines.length - 1]}\n${raw}`;
    } else if (/^[\u2022â€¢]\s+/.test(raw) && abilityLines.length > 0) {
      abilityLines[abilityLines.length - 1] = `${abilityLines[abilityLines.length - 1]}\n${raw}`;
    } else {
      abilityLines.push(raw);
    }
  }

  const lines: string[] = [];
  for (const abilityLine of abilityLines) {
    const isModalBulletBlock = /\n\s*[\u2022â€¢]\s+/.test(abilityLine);
    const hasDieRollResultsTable = /\n\s*\d+(?:\s*[\u2013\u2014-]\s*\d+|\+)?\s*\|/i.test(abilityLine);
    if (isModalBulletBlock || hasDieRollResultsTable) {
      lines.push(abilityLine);
      continue;
    }

    const sentences = abilityLine.split(/(?<=[.!])\s+/).filter(sentence => sentence.trim());
    lines.push(...mergeContinuationSentences(sentences));
  }

  return lines;
}
