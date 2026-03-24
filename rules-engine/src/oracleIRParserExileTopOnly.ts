import type { OracleEffectStep, OraclePlayerSelector, OracleQuantity } from './oracleIR';
import {
  isThoseOpponentsPossessiveSource,
  normalizeClauseForParse,
  normalizeOracleText,
  parseQuantity,
} from './oracleIRParserUtils';

function normalizePossessive(value: string): string {
  return normalizeOracleText(String(value || '')).replace(/[’]/g, "'").trim().toLowerCase();
}

function mapLibrarySourceToPlayerSelector(rawSource: string): OraclePlayerSelector | null {
  const src = normalizePossessive(rawSource);
  if (src === 'your') return { kind: 'you' };
  if (src === 'their' || src === 'his or her') return { kind: 'target_player' };
  if (src === "target player's" || src === "that player's") return { kind: 'target_player' };
  if (src === "target opponent's" || src === "that opponent's") return { kind: 'target_opponent' };
  if (src === "each player's" || src === "each players'") return { kind: 'each_player' };
  if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) {
    return { kind: 'each_opponent' };
  }
  if (isThoseOpponentsPossessiveSource(src)) return { kind: 'each_of_those_opponents' };
  return null;
}

export function tryParseExileTopOnly(params: {
  clauses: string[];
  idx: number;
}): { step: OracleEffectStep; consumed: number } | null {
  const { clauses, idx } = params;
  const first = String(clauses[idx] || '').trim();
  const second = String(clauses[idx + 1] || '').trim();
  if (!first) return null;

  const normalizedFirst = normalizeClauseForParse(first);
  const normalizedSecond = second ? normalizeClauseForParse(second) : null;
  const firstToParse = String(normalizedFirst.clause || '').trim();
  const secondToParse = normalizedSecond ? String(normalizedSecond.clause || '').trim() : '';

  let amount: OracleQuantity | null = null;
  let who: OraclePlayerSelector | null = null;
  let consumed = 1;

  const quantityPattern = '(a|an|\\d+|x|[a-z]+)';
  const sourcePattern =
    "(your|target player's|target opponent's|that player's|that opponent's|each player's|each players'|each opponent's|each opponents'|each of your opponents'|each of those opponents'|those opponents'|all of those opponents'|all those opponents'|their|his or her)";
  const exileSecondClause = /^(?:then\s+)?exile\s+(?:it|that card|them|those cards|the cards)(?:\s+face down)?\s*$/i;

  {
    const directMany = firstToParse.match(
      new RegExp(
        `^exile\\s+the\\s+top\\s+${quantityPattern}\\s+cards?\\s+of\\s+${sourcePattern}\\s+librar(?:y|ies)(?:\\s+face down)?\\s*$`,
        'i'
      )
    );
    if (directMany) {
      amount = parseQuantity(directMany[1]);
      who = mapLibrarySourceToPlayerSelector(directMany[2]);
    }

    if (!amount) {
      const directOne = firstToParse.match(
        new RegExp(`^exile\\s+the\\s+top\\s+card\\s+of\\s+${sourcePattern}\\s+librar(?:y|ies)(?:\\s+face down)?\\s*$`, 'i')
      );
      if (directOne) {
        amount = { kind: 'number', value: 1 };
        who = mapLibrarySourceToPlayerSelector(directOne[1]);
      }
    }
  }

  if (!amount && secondToParse) {
    const lookClause = firstToParse.match(
      new RegExp(`^look at the top (?:(?:${quantityPattern})\\s+cards?|card) of ${sourcePattern} librar(?:y|ies)\\s*$`, 'i')
    );
    if (lookClause && exileSecondClause.test(secondToParse)) {
      amount = lookClause[1] ? parseQuantity(lookClause[1]) : { kind: 'number', value: 1 };
      who = mapLibrarySourceToPlayerSelector(lookClause[2]);
      consumed = 2;
    }
  }

  if (!amount) {
    const clean = (value: string): string =>
      normalizeOracleText(String(value || ''))
        .trim()
        .replace(/^then\b\s*/i, '')
        .replace(/,+\s*$/g, '')
        .trim();
    const firstClean = clean(firstToParse);

    const lookMany = firstClean.match(
      new RegExp(
        `^look at the top ${quantityPattern} cards? of ${sourcePattern} librar(?:y|ies)(?:,)? and exile (?:them|those cards|the cards)(?: face down)?\\s*$`,
        'i'
      )
    );
    if (lookMany) {
      amount = parseQuantity(lookMany[1]);
      who = mapLibrarySourceToPlayerSelector(lookMany[2]);
    }

    if (!amount) {
      const lookOne = firstClean.match(
        new RegExp(
          `^look at the top card of ${sourcePattern} librar(?:y|ies)(?:,)? and exile (?:it|that card|them|those cards|the cards)(?: face down)?\\s*$`,
          'i'
        )
      );
      if (lookOne) {
        amount = { kind: 'number', value: 1 };
        who = mapLibrarySourceToPlayerSelector(lookOne[1]);
      }
    }
  }

  if (!amount || !who) return null;

  const out: any = {
    kind: 'exile_top',
    who,
    amount,
    raw:
      clauses
        .slice(idx, idx + consumed)
        .map(clause => String(clause || '').trim())
        .filter(Boolean)
        .join('. ') + '.',
  };
  if (normalizedFirst.sequence) out.sequence = normalizedFirst.sequence;
  if (normalizedFirst.optional) out.optional = true;

  return {
    step: out,
    consumed,
  };
}
