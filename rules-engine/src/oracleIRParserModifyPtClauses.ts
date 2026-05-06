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

  const workingClause = normalizeOracleText(clause)
    .replace(/^[\u2022â€¢]\s+/, '')
    .replace(/^have\s+(?=target|that|the|this|it\b|each|all|creatures?\b)/i, '')
    .trim();

  const possessiveSwitchMatch = workingClause.match(
    /^switch\s+(.+?)(?:'s|’s)\s+power\s+and\s+toughness\s+until\s+end\s+of\s+turn$/i
  );
  if (possessiveSwitchMatch) {
    return withMeta({
      kind: 'switch_power_toughness',
      target: parseSwitchTarget(String(possessiveSwitchMatch[1] || '').trim()),
      duration: 'end_of_turn',
      raw: rawClause,
    } as OracleEffectStep);
  }

  const ofSwitchMatch = workingClause.match(
    /^switch\s+the\s+power\s+and\s+toughness\s+of\s+(.+?)\s+until\s+end\s+of\s+turn$/i
  );
  if (ofSwitchMatch) {
    return withMeta({
      kind: 'switch_power_toughness',
      target: parseSwitchTarget(String(ofSwitchMatch[1] || '').trim()),
      duration: 'end_of_turn',
      raw: rawClause,
    } as OracleEffectStep);
  }

  const match = workingClause.match(
    /^(?:then\s+)?((?:[a-z][a-z\s,/-]*?\s+you\s+control)|target\s+(?:[a-z][a-z -]+\s+)?creature(?:\s+you\s+control|\s+your\s+opponents\s+control|\s+an\s+opponent\s+controls)?|target\s+attacking\s+creature|each\s+(?:non[- ]?[a-z]+\s+)?creature(?:\s+your\s+opponents\s+control)?|each\s+other\s+attacking\s+creature|each\s+attacking\s+creature|other\s+attacking\s+creatures|(?:non[- ]?[a-z]+\s+)?creatures\s+you\s+control|(?:[a-z]+\s+)?creatures\s+your\s+opponents\s+control|(?:[a-z]+\s+)?creatures|all\s+creatures\s+you\s+control|creatures\s+your\s+opponents\s+control|all\s+creatures\s+your\s+opponents\s+control|all\s+creatures|creatures\s+that\s+aren't\s+of\s+the\s+chosen\s+type|each\s+creature|each\s+other\s+creature|equipped\s+creature|enchanted\s+creature|that\s+creature|the\s+creature|this\s+creature|this\s+permanent|it)\s+get(?:s)?\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+(.+)$/i
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
  let condition: any | undefined;
  if (tail) {
    const forEachMatch = tail.match(/^for\s+each\s+(.+)$/i);
    if (forEachMatch) {
      const eachRaw = `for each ${String(forEachMatch[1] || '').trim()}`.trim();
      scaler = /^for\s+each\s+card\s+revealed\s+this\s+way$/i.test(eachRaw)
        ? { kind: 'per_revealed_this_way' }
        : /^for\s+each\s+creature\s+blocking\s+it$/i.test(eachRaw)
          ? { kind: 'per_creature_blocking_it' }
          : /^for\s+each\s+basic\s+land\s+type\s+among\s+lands\s+you\s+control$/i.test(eachRaw)
            ? { kind: 'per_basic_land_type_among_lands_you_control' }
              : /^for\s+each\s+artifact\s+you\s+control$/i.test(eachRaw)
                ? { kind: 'per_artifact_you_control' }
                : /^for\s+each\s+creature\s+tapped\s+this\s+way$/i.test(eachRaw)
                  ? { kind: 'per_creature_tapped_this_way' }
                  : /^for\s+each\s+other\s+attacking\s+aurochs$/i.test(eachRaw)
                    ? { kind: 'per_other_attacking_aurochs' }
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
    target:
      targetRaw === 'the creature' || targetRaw === 'equipped creature'
        ? { kind: 'equipped_creature' }
        : { kind: 'raw', text: targetRaw },
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

function parseSwitchTarget(raw: string): any {
  const targetRaw = String(raw || '').trim().toLowerCase();
  return targetRaw === 'the creature'
    ? { kind: 'equipped_creature' }
    : { kind: 'raw', text: targetRaw };
}

export function tryParseTemporarySetBasePtClause(params: {
  clause: string;
  rawClause: string;
  withMeta: <T extends OracleEffectStep>(step: T) => T;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = params;

  const becomeMatch = clause.match(
    /^(?:until end of turn,\s+)?(.+?)\s+(?:has\s+base\s+power\s+and\s+toughness|base\s+power\s+and\s+toughness\s+becomes?|becomes?\s+base\s+power\s+and\s+toughness)\s+(\d+)\s*\/\s*(\d+)(?:\s+until end of turn)?$/i
  );
  if (becomeMatch && (/^until end of turn,/i.test(clause) || /\buntil end of turn\b/i.test(clause))) {
    const power = Number.parseInt(String(becomeMatch[2] || ''), 10);
    const toughness = Number.parseInt(String(becomeMatch[3] || ''), 10);
    if (!Number.isFinite(power) || !Number.isFinite(toughness)) return null;

    return withMeta({
      kind: 'set_base_pt',
      target: parseSwitchTarget(String(becomeMatch[1] || '').trim()),
      power,
      toughness,
      duration: 'end_of_turn',
      raw: rawClause,
    });
  }

  const match = clause.match(
    /^(?:until end of turn,\s+)?(target\s+creature(?:\s+you\s+control|\s+your\s+opponents\s+control|\s+an\s+opponent\s+controls)?|enchanted\s+creature|that\s+creature|the\s+creature|this\s+creature|this\s+permanent|it)\s+has\s+(?:the\s+)?base power and toughness\s+(\d+)\s*\/\s*(\d+)(?:\s+until end of turn)?$/i
  );
  if (!match) return null;

  const targetRaw = String(match[1] || '').trim().toLowerCase();
  const power = Number.parseInt(String(match[2] || ''), 10);
  const toughness = Number.parseInt(String(match[3] || ''), 10);
  if (!Number.isFinite(power) || !Number.isFinite(toughness)) return null;

  return withMeta({
    kind: 'set_base_pt',
    target:
      targetRaw === 'the creature'
        ? { kind: 'equipped_creature' }
        : { kind: 'raw', text: targetRaw },
    power,
    toughness,
    duration: 'end_of_turn',
    raw: rawClause,
  });
}
