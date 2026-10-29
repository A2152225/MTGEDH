/**
 * Origin parent: rules-engine/src/oracleIRParserParseOracleTextToIRLatePasses.ts
 * Cluster: "each player chooses N [types] they control, then sacrifices the rest"
 *   (Planetary Annihilation / Razia's Purification / Limited Resources family).
 * Public: rewriteEachPlayerChooseThenSacrificeRestSteps
 * Leaf must not import oracleIR.ts or oracleIRParserEffectClauseToStep.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep';
import type { OraclePlayerSelector } from './oracleIR-handlers/oracleIRSharedTypes';

const COUNT_WORD = 'a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+';
const CHOOSER = 'each player|each opponent|that player|target player|target opponent';
const CHOOSE_HEAD = new RegExp(
  `^(${CHOOSER})\\s+chooses\\s+(up to\\s+)?(${COUNT_WORD})\\s+(.+?)\\s+they\\s+control\\.?$`,
  'i',
);
const FULL_SENTENCE = new RegExp(
  `^(${CHOOSER})\\s+chooses\\s+(up to\\s+)?(${COUNT_WORD})\\s+(.+?)\\s+they\\s+control(?:\\s*,)?\\s+(?:then|and)\\s+sacrifices?\\s+the\\s+rest\\.?$`,
  'i',
);
const SACRIFICE_REST = /^then\s+sacrifices?\s+the\s+rest\.?$/i;

const COUNT_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
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

const KEEP_TYPE_WORDS = new Set([
  'creature',
  'enchantment',
  'artifact',
  'land',
  'planeswalker',
  'battle',
  'permanent',
]);

function normalizeClause(raw: unknown): string {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function parseCount(raw: string): number | null {
  const text = String(raw || '').trim().toLowerCase();
  const word = COUNT_WORDS[text];
  if (word) return word;
  const numeric = Number(text);
  if (Number.isInteger(numeric) && numeric > 0 && numeric < 100) return numeric;
  return null;
}

function parseChoosers(raw: string): OraclePlayerSelector | null {
  switch (String(raw || '').trim().toLowerCase()) {
    case 'each player':
      return { kind: 'each_player' };
    case 'each opponent':
      return { kind: 'each_opponent' };
    case 'that player':
      return { kind: 'raw', text: 'that player' };
    case 'target player':
      return { kind: 'target_player' };
    case 'target opponent':
      return { kind: 'target_opponent' };
    default:
      return null;
  }
}

/** One type, or an "or" list ("creature or planeswalker"). Rejects "from among" / counted piles. */
function parseKeepTypes(phrase: string): readonly string[] | null {
  const cleaned = String(phrase || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!cleaned || /[,:]|\b(?:from|among|each|number|nonland|other|with|that|equal)\b/.test(cleaned)) {
    return null;
  }
  const types: string[] = [];
  for (const part of cleaned.split(/\s+or\s+/)) {
    const word = part.endsWith('s') ? part.slice(0, -1) : part;
    if (!KEEP_TYPE_WORDS.has(word)) return null;
    types.push(word);
  }
  return types.length > 0 ? types : null;
}

function stepFromMatch(
  match: RegExpMatchArray,
  raw: string,
): Extract<OracleEffectStep, { kind: 'each_player_choose_then_sacrifice_rest' }> | null {
  const choosers = parseChoosers(String(match[1] || ''));
  const keepCount = parseCount(String(match[3] || ''));
  const keepTypes = parseKeepTypes(String(match[4] || ''));
  if (!choosers || !keepCount || !keepTypes) return null;
  const upTo = Boolean(String(match[2] || '').trim());
  return {
    kind: 'each_player_choose_then_sacrifice_rest',
    choosers,
    keepTypes,
    keepCount,
    ...(upTo ? { upTo: true } : {}),
    raw,
  };
}

export function rewriteEachPlayerChooseThenSacrificeRestSteps(
  steps: readonly OracleEffectStep[],
): readonly OracleEffectStep[] {
  let changed = false;
  const next: OracleEffectStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const raw = normalizeClause(step.raw);
    const full = raw.match(FULL_SENTENCE);
    if (
      full
      && (step.kind === 'grant_static_ability' || step.kind === 'unknown' || step.kind === 'sacrifice')
    ) {
      const parsed = stepFromMatch(full, String(step.raw || raw));
      if (parsed) {
        next.push(parsed);
        changed = true;
        continue;
      }
    }

    const head = raw.match(CHOOSE_HEAD);
    const following = steps[index + 1];
    const followingRaw = following ? normalizeClause(following.raw) : '';
    if (
      head
      && following
      && following.kind === 'sacrifice'
      && SACRIFICE_REST.test(followingRaw)
      && (step.kind === 'grant_static_ability' || step.kind === 'unknown')
    ) {
      const parsed = stepFromMatch(head, `${raw}, then sacrifices the rest`);
      if (parsed) {
        next.push(parsed);
        index += 1;
        changed = true;
        continue;
      }
    }

    next.push(step);
  }
  return changed ? next : steps;
}
