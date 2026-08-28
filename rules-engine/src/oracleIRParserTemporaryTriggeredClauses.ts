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

function trimGrantedDiesReminderTail(effectText: string): string {
  return String(effectText || '')
    .replace(/\s+\([^)]*$/g, '')
    .trim();
}

const DEALT_DAMAGE_THIS_WAY_DIES_THIS_TURN =
  /^when(?:ever)?\s+a\s+creature(\s+you\s+control)?\s+dealt\s+damage\s+this\s+way\s+dies\s+this\s+turn,?\s*(.+)$/i;

export function isDealtDamageThisWayDiesThisTurnSpellLine(text: string): boolean {
  const normalized = normalizeOracleText(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return DEALT_DAMAGE_THIS_WAY_DIES_THIS_TURN.test(normalized);
}

export function tryParseTemporaryGrantedDiesTriggerClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = normalizeOracleText(clause).trim();
  if (!normalized) return null;

  const thisWayDiesMatch = normalized.match(DEALT_DAMAGE_THIS_WAY_DIES_THIS_TURN);
  if (thisWayDiesMatch) {
    const youControl = Boolean(String(thisWayDiesMatch[1] || '').trim());
    return buildGrantedDiesTriggerStep({
      targetText: youControl
        ? 'creatures you control dealt damage this way'
        : 'creatures dealt damage this way',
      effectText: trimGrantedDiesReminderTail(String(thisWayDiesMatch[2] || '')),
      rawClause,
      duration: 'until_end_of_turn',
      withMeta,
    });
  }

  if (
    /^(?:until end of turn,\s+)?.+?\s+gets\s+.+?\s+and\s+gains?\s+"when\s+(?:this creature|this permanent|it)\s+dies(?:\s+this\s+turn)?,/i.test(
      normalized
    )
  ) {
    return null;
  }

  const match =
    normalized.match(
      /^until end of turn,\s+(.+?)\s+gains?\s+(?:(?:[^"]+?)\s+and\s+)?"when\s+(?:this creature|this permanent|it)\s+dies(?:\s+this\s+turn)?,\s+([^"]+)"\s*(?:\([^)]*\)?)?$/i
    ) ??
    normalized.match(
      /^until end of turn,\s+(.+?)\s+gains?\s+(?:(?:[^"]+?)\s+and\s+)?"when\s+(?:this creature|this permanent|it)\s+dies(?:\s+this\s+turn)?,\s+([^"]+)$/i
    );
  if (match) {
    return buildGrantedDiesTriggerStep({
      targetText: String(match[1] || ''),
      effectText: trimGrantedDiesReminderTail(String(match[2] || '')),
      rawClause,
      duration: 'until_end_of_turn',
      withMeta,
    });
  }

  const permanentMatch =
    normalized.match(
      /^(.+?)\s+gains?\s+(?:(?:[^"]+?)\s+and\s+)?"when\s+(?:this creature|this permanent|it)\s+dies(?:\s+this\s+turn)?,\s+([^"]+)"\s*(?:\([^)]*\)?)?$/i
    ) ??
    normalized.match(
      /^(.+?)\s+gains?\s+(?:(?:[^"]+?)\s+and\s+)?"when\s+(?:this creature|this permanent|it)\s+dies(?:\s+this\s+turn)?,\s+([^"]+)$/i
    );
  if (!permanentMatch) return null;

  return buildGrantedDiesTriggerStep({
    targetText: String(permanentMatch[1] || ''),
    effectText: trimGrantedDiesReminderTail(String(permanentMatch[2] || '')),
    rawClause,
    duration: 'while_on_battlefield',
    withMeta,
  });
}
