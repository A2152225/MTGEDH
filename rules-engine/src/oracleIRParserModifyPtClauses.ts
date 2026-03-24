import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

export function tryParseTemporaryModifyPtClause(params: {
  clause: string;
  rawClause: string;
  withMeta: <T extends OracleEffectStep>(step: T) => T;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = params;

  const parseSignedPtComponent = (raw: string): { value: number; usesX: boolean } | null => {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return null;
    if (/^[+-]?x$/.test(s)) {
      return { value: s.startsWith('-') ? -1 : 1, usesX: true };
    }
    if (/^[+-]?\d+$/.test(s)) {
      return { value: parseInt(s, 10) || 0, usesX: false };
    }
    return null;
  };

  let workingClause = clause;
  let leadingCondition: any | undefined;
  const leadingIf = workingClause.match(/^if\s+([^,]+),\s*(.+)$/i);
  if (leadingIf) {
    leadingCondition = { kind: 'if', raw: String(leadingIf[1] || '').trim() };
    workingClause = String(leadingIf[2] || '').trim();
  }

  const match = workingClause.match(
    /^(?:then\s+)?(target\s+creature(?:\s+you\s+control|\s+your\s+opponents\s+control|\s+an\s+opponent\s+controls)?|the\s+creature)\s+gets\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+(.+)$/i
  );
  if (!match) return null;

  const targetRaw = String(match[1] || '').trim().toLowerCase();
  const powerComponent = parseSignedPtComponent(String(match[2] || ''));
  const toughnessComponent = parseSignedPtComponent(String(match[3] || ''));
  if (!powerComponent || !toughnessComponent) return null;

  let tail = normalizeOracleText(String(match[4] || ''))
    .replace(/[,.;]\s*$/g, '')
    .trim();

  if (!/\buntil\s+end\s+of\s+turn\b/i.test(tail)) return null;

  tail = tail
    .replace(/\buntil\s+end\s+of\s+turn\b/i, '')
    .replace(/^,\s*/i, '')
    .trim();

  let scaler: any | undefined;
  let condition: any | undefined = leadingCondition;
  if (tail) {
    const forEachMatch = tail.match(/^for\s+each\s+(.+)$/i);
    if (forEachMatch) {
      const eachRaw = `for each ${String(forEachMatch[1] || '').trim()}`.trim();
      scaler = /^for\s+each\s+card\s+revealed\s+this\s+way$/i.test(eachRaw)
        ? { kind: 'per_revealed_this_way' }
        : { kind: 'unknown', raw: eachRaw };
    } else {
      const ifMatch = tail.match(/^if\s+(.+)$/i);
      if (ifMatch) {
        condition = { kind: 'if', raw: String(ifMatch[1] || '').trim() };
      } else {
        const asLongAsMatch = tail.match(/^as\s+long\s+as\s+(.+)$/i);
        if (asLongAsMatch) {
          condition = { kind: 'as_long_as', raw: String(asLongAsMatch[1] || '').trim() };
        } else {
          const whereMatch = tail.match(/^where\s+(.+)$/i);
          if (whereMatch) {
            condition = { kind: 'where', raw: String(whereMatch[1] || '').trim() };
          }
        }
      }
    }
  }

  if (tail && !scaler && !condition) return null;

  const step: any = {
    kind: 'modify_pt',
    target: targetRaw === 'the creature' ? { kind: 'equipped_creature' } : { kind: 'raw', text: targetRaw },
    power: powerComponent.value,
    toughness: toughnessComponent.value,
    ...(powerComponent.usesX ? { powerUsesX: true } : {}),
    ...(toughnessComponent.usesX ? { toughnessUsesX: true } : {}),
    duration: 'end_of_turn',
    raw: rawClause,
  };
  if (scaler) step.scaler = scaler;
  if (condition) step.condition = condition;
  return withMeta(step as OracleEffectStep);
}
