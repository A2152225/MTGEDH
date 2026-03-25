import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, splitIntoClauses } from './oracleIRParserUtils';
import {
  splitConservativeSacrificeLeadClause,
  tryParseLeadingConditionalStep,
} from './oracleIRParserSacrificeHelpers';
import { splitConservativeCreateTokenLeadClause } from './oracleIRParserTokenSimpleClauses';
import { splitConservativeExileFromLeadClause } from './oracleIRParserZoneAndRemovalActions';

function splitTrailingGrantedDiesTriggerFollowup(clause: string): string[] {
  const normalized = normalizeOracleText(clause).trim();
  if (!normalized) return [];

  const match = normalized.match(
    /^(.*?\bgains?\s+(?:(?:[^"]+?)\s+and\s+)?"when\s+(?:this creature|this permanent|it)\s+dies,\s+.+?"\s*(?:\([^)]*\))?)\s+([A-Z].+)$/i
  );
  if (!match) return [clause];

  return [String(match[1] || '').trim(), String(match[2] || '').trim()].filter(Boolean);
}

function splitConservativeActionConjunctionClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/\band\b/i.test(normalized)) return null;

  const splitMatch = normalized.match(
    /^(.*?)\s+and\s+((?:you|each player|each opponent|target player|target opponent|that player|that opponent|this permanent|this creature|that creature|it|they)\b.+)$/i
  );
  if (!splitMatch) return null;

  const first = String(splitMatch[1] || '').trim();
  const second = String(splitMatch[2] || '').trim();
  if (!first || !second) return null;

  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return [first, second];
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
    splitConservativeActionConjunctionClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeCreateTokenLeadClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeExileFromLeadClause({ rawClause: clause, parseEffectClauseToStep }) ??
    [clause]
  );
}
