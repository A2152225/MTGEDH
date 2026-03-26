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
    /^(.*?)\s+and\s+((?:you|each player|each opponent|target player|target opponent|that player|that opponent|this permanent|this creature|that creature|it|they|suspect|create|draw|discard|exile|return|put|destroy|gain|lose|deal|tap|untap|mill|surveil|scry|investigate|populate|goad)\b.+)$/i
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

function splitConservativeModifyPtGrantedDiesTriggerClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/\bgets\b/i.test(normalized) || !/\band gains?\s+"/i.test(normalized)) return null;

  const match = normalized.match(
    /^(until end of turn,\s+)?(.+?)\s+gets\s+(.+?)\s+and\s+gains?\s+("when\s+(?:this creature|this permanent|it)\s+dies(?:\s+this\s+turn)?,\s+.+")$/i
  );
  if (!match) return null;

  const durationPrefix = String(match[1] || '');
  const targetText = String(match[2] || '').trim();
  const modifyText = String(match[3] || '').trim();
  const quotedTrigger = String(match[4] || '').trim();
  if (!targetText || !modifyText || !quotedTrigger) return null;
  const normalizedTargetText = targetText.replace(/^another\s+/i, '').trim();
  if (!normalizedTargetText) return null;

  const first = durationPrefix
    ? `${normalizedTargetText} gets ${modifyText} until end of turn`
    : `${normalizedTargetText} gets ${modifyText}`;
  const second = `${durationPrefix}${normalizedTargetText} gains ${quotedTrigger}`.trim();
  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return [first, second];
}

function splitConservativeTemporaryAbilityEvasionClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/\bgains?\b/i.test(normalized) || !/\band\b/i.test(normalized) || !/\bcan't be blocked\b/i.test(normalized)) {
    return null;
  }

  const match = normalized.match(
    /^(?:until end of turn,\s+)?(.+?)\s+gains?\s+(.+?)\s+until end of turn\s+and\s+(can't be blocked(?: by .+?)?(?: this turn)?)$/i
  );
  if (!match) return null;

  const targetText = String(match[1] || '').trim();
  const gainsText = String(match[2] || '').trim();
  const evasionText = String(match[3] || '').trim();
  if (!targetText || !gainsText || !evasionText) return null;

  const first = `${targetText} gains ${gainsText} until end of turn`;
  const second = `${targetText} ${evasionText}`;
  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return [first, second];
}

function splitConservativeGrantedDiesTriggerSetBasePtClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/\band\s+has\s+/i.test(normalized) || !/\bgains?\s+"/i.test(normalized)) return null;

  const match = normalized.match(
    /^(until end of turn,\s+)?(.+?)\s+gains?\s+("when\s+(?:this creature|this permanent|it)\s+dies,\s+.+")\s+and\s+has\s+(?:the\s+)?base power and toughness\s+(\d+)\s*\/\s*(\d+)$/i
  );
  if (!match) return null;

  const durationPrefix = String(match[1] || '');
  const targetText = String(match[2] || '').trim();
  const quotedTrigger = String(match[3] || '').trim();
  const power = String(match[4] || '').trim();
  const toughness = String(match[5] || '').trim();
  if (!targetText || !quotedTrigger || !power || !toughness) return null;

  const first = `${durationPrefix}${targetText} gains ${quotedTrigger}`.trim();
  const second = `${durationPrefix}${targetText} has base power and toughness ${power}/${toughness}`.trim();
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
    splitConservativeTemporaryAbilityEvasionClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeGrantedDiesTriggerSetBasePtClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeModifyPtGrantedDiesTriggerClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeActionConjunctionClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeCreateTokenLeadClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeExileFromLeadClause({ rawClause: clause, parseEffectClauseToStep }) ??
    [clause]
  );
}
