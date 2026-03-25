import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, splitIntoClauses } from './oracleIRParserUtils';
import {
  splitConservativeSacrificeLeadClause,
  tryParseLeadingConditionalStep,
} from './oracleIRParserSacrificeHelpers';
import { splitConservativeCreateTokenLeadClause } from './oracleIRParserTokenSimpleClauses';

function splitTrailingGrantedDiesTriggerFollowup(clause: string): string[] {
  const normalized = normalizeOracleText(clause).trim();
  if (!normalized) return [];

  const match = normalized.match(
    /^(.*?\bgains?\s+(?:(?:[^"]+?)\s+and\s+)?"when\s+(?:this creature|this permanent|it)\s+dies,\s+.+?"\s*(?:\([^)]*\))?)\s+([A-Z].+)$/i
  );
  if (!match) return [clause];

  return [String(match[1] || '').trim(), String(match[2] || '').trim()].filter(Boolean);
}

export function buildAbilityClauses(args: {
  effectText: string;
  cardName?: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] {
  const { effectText, cardName, parseEffectClauseToStep } = args;
  const combinedClauses: string[] = [];
  const rawClauses = splitIntoClauses(effectText).flatMap(splitTrailingGrantedDiesTriggerFollowup);

  for (let clauseIndex = 0; clauseIndex < rawClauses.length; clauseIndex += 1) {
    const clause = rawClauses[clauseIndex];
    const nextClause = rawClauses[clauseIndex + 1];
    if (/^if\b/i.test(clause) && /^then\b/i.test(String(nextClause || ''))) {
      const combined = `${clause}, ${nextClause}`;
      if (tryParseLeadingConditionalStep({ rawClause: combined, cardName, parseEffectClauseToStep })) {
        combinedClauses.push(combined);
        clauseIndex += 1;
        continue;
      }
    }

    combinedClauses.push(clause);
  }

  return combinedClauses.flatMap(clause =>
    splitConservativeSacrificeLeadClause({ rawClause: clause, cardName, parseEffectClauseToStep }) ??
    splitConservativeCreateTokenLeadClause({ rawClause: clause, parseEffectClauseToStep }) ??
    [clause]
  );
}
