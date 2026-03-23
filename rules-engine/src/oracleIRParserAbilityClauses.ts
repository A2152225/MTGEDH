import type { OracleEffectStep } from './oracleIR';
import { splitIntoClauses } from './oracleIRParserUtils';
import {
  splitConservativeSacrificeLeadClause,
  tryParseLeadingConditionalStep,
} from './oracleIRParserSacrificeHelpers';

export function buildAbilityClauses(args: {
  effectText: string;
  cardName?: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] {
  const { effectText, cardName, parseEffectClauseToStep } = args;
  const combinedClauses: string[] = [];
  const rawClauses = splitIntoClauses(effectText);

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
    splitConservativeSacrificeLeadClause({ rawClause: clause, cardName, parseEffectClauseToStep }) ?? [clause]
  );
}
