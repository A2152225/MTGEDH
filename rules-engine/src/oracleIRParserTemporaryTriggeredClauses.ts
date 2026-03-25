import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

function buildGrantedDiesTriggerStep(args: {
  targetText: string;
  effectText: string;
  rawClause: string;
  duration: Extract<Extract<OracleEffectStep, { kind: 'grant_temporary_dies_trigger' }>['duration'], string>;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { targetText, effectText, rawClause, duration, withMeta } = args;
  const target = String(targetText || '').trim();
  const effect = String(effectText || '').trim();
  if (!target || !effect) return null;

  return withMeta({
    kind: 'grant_temporary_dies_trigger',
    target: parseObjectSelector(target),
    effect: effect.endsWith('.') ? effect : `${effect}.`,
    duration,
    raw: rawClause,
  });
}

export function tryParseTemporaryGrantedDiesTriggerClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = normalizeOracleText(clause).trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^until end of turn,\s+(.+?)\s+gains?\s+(?:(?:[^"]+?)\s+and\s+)?"when\s+(?:this creature|this permanent|it)\s+dies,\s+(.+?)"\s*(?:\([^)]*\))?$/i
  );
  if (match) {
    return buildGrantedDiesTriggerStep({
      targetText: String(match[1] || ''),
      effectText: String(match[2] || ''),
      rawClause,
      duration: 'until_end_of_turn',
      withMeta,
    });
  }

  const permanentMatch = normalized.match(
    /^(.+?)\s+gains?\s+(?:(?:[^"]+?)\s+and\s+)?"when\s+(?:this creature|this permanent|it)\s+dies,\s+(.+?)"\s*(?:\([^)]*\))?$/i
  );
  if (!permanentMatch) return null;

  return buildGrantedDiesTriggerStep({
    targetText: String(permanentMatch[1] || ''),
    effectText: String(permanentMatch[2] || ''),
    rawClause,
    duration: 'while_on_battlefield',
    withMeta,
  });
}
