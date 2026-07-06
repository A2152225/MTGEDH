/**
 * Helpers for regex matching on individual oracle lines while preserving
 * global indices into the full multi-line oracle string.
 *
 * Line-local `match.index` values must not be passed to effect extraction
 * against the full oracle (see Myrel / "pponents" slice bug).
 */

export function getOracleLines(oracleText: string): string[] {
  return String(oracleText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function globalizeLineRegexMatch(
  oracleText: string,
  line: string,
  lineStartIndex: number,
  match: RegExpMatchArray,
): RegExpMatchArray {
  if (typeof match.index !== 'number' || lineStartIndex <= 0) {
    return match;
  }
  const globalMatch = [...match] as RegExpMatchArray;
  globalMatch.index = lineStartIndex + match.index;
  return globalMatch;
}

/**
 * Run one or more patterns against each non-skipped oracle line and return the
 * first match with a global index into `oracleText`.
 */
export function findRegexMatchAcrossOracleLines(
  oracleText: string,
  shouldSkipLine: (line: string) => boolean,
  matchLine: (line: string) => RegExpMatchArray | null,
): RegExpMatchArray | null {
  const source = String(oracleText || '');
  let searchFrom = 0;
  for (const line of getOracleLines(source)) {
    const lineStart = source.indexOf(line, searchFrom);
    if (lineStart < 0) {
      return null;
    }
    searchFrom = lineStart + line.length;
    if (shouldSkipLine(line)) {
      continue;
    }
    const match = matchLine(line);
    if (match) {
      return globalizeLineRegexMatch(source, line, lineStart, match);
    }
  }
  return null;
}

/**
 * Run multiple patterns per line (first line+pattern hit wins).
 */
export function findFirstRegexMatchAcrossOracleLines(
  oracleText: string,
  shouldSkipLine: (line: string) => boolean,
  patterns: RegExp[],
): RegExpMatchArray | null {
  return findRegexMatchAcrossOracleLines(oracleText, shouldSkipLine, (line) => {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) return match;
    }
    return null;
  });
}

/**
 * When a regex was matched on a single line, `match.index` may be line-local.
 * Re-locate `match[0]` in the full oracle before slicing effect text.
 */
export function resolveGlobalTimingMatchIndex(
  oracleText: string,
  match: RegExpMatchArray,
): number {
  const source = String(oracleText || '');
  const fullMatch = String(match[0] || '');
  if (!fullMatch) {
    return typeof match.index === 'number' ? match.index : -1;
  }

  const reportedIndex = typeof match.index === 'number' ? match.index : source.indexOf(fullMatch);
  if (reportedIndex < 0) return reportedIndex;

  const sliceAtReported = source.slice(reportedIndex, reportedIndex + fullMatch.length);
  if (sliceAtReported.toLowerCase() === fullMatch.toLowerCase()) {
    return reportedIndex;
  }

  const lowerSource = source.toLowerCase();
  const lowerFull = fullMatch.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < lowerSource.length) {
    const found = lowerSource.indexOf(lowerFull, searchFrom);
    if (found < 0) break;
    if (source.slice(found, found + fullMatch.length).toLowerCase() === lowerFull) {
      return found;
    }
    searchFrom = found + 1;
  }

  return reportedIndex;
}
