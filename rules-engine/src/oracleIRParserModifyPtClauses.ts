import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

export function tryParseTemporaryModifyPtClause(params: {
  clause: string;
  rawClause: string;
  withMeta: <T extends OracleEffectStep>(step: T) => T;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = params;

  const parseModifyPtTarget = (raw: string): any => {
    const targetRaw = String(raw || '').trim().toLowerCase();
    return targetRaw === 'the creature' || targetRaw === 'equipped creature'
      ? { kind: 'equipped_creature' }
      : { kind: 'raw', text: targetRaw };
  };

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

  const choiceMatch = workingClause.match(
    /^(?:then\s+)?((?:[a-z][a-z\s,/-]*?\s+you\s+control)|target\s+(?:[a-z][a-z -]+\s+)?creature(?:\s+you\s+control|\s+your\s+opponents\s+control|\s+an\s+opponent\s+controls)?|target\s+attacking\s+creature|each\s+(?:non[- ]?[a-z]+\s+)?creature(?:\s+your\s+opponents\s+control)?|each\s+other\s+attacking\s+creature|each\s+attacking\s+creature|other\s+attacking\s+creatures|(?:non[- ]?[a-z]+\s+)?creatures\s+you\s+control|(?:[a-z]+\s+)?creatures\s+your\s+opponents\s+control|(?:[a-z]+\s+)?creatures|all\s+creatures\s+you\s+control|creatures\s+your\s+opponents\s+control|all\s+creatures\s+your\s+opponents\s+control|all\s+creatures(?:\s+of\s+(?:that|the\s+chosen)\s+type)?|creatures\s+that\s+aren't\s+of\s+the\s+chosen\s+type|each\s+creature|each\s+other\s+creature|equipped\s+creature|enchanted\s+creature|that\s+creature|the\s+creature|this\s+creature|this\s+permanent|it)\s+get(?:s)?\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+or\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+until\s+end\s+of\s+turn$/i
  );
  if (choiceMatch) {
    const targetText = String(choiceMatch[1] || '').trim();
    const target = parseModifyPtTarget(targetText);
    const firstPower = parseSignedPtComponent(String(choiceMatch[2] || ''));
    const firstToughness = parseSignedPtComponent(String(choiceMatch[3] || ''));
    const secondPower = parseSignedPtComponent(String(choiceMatch[4] || ''));
    const secondToughness = parseSignedPtComponent(String(choiceMatch[5] || ''));
    if (!firstPower || !firstToughness || !secondPower || !secondToughness) return null;

    const buildModeStep = (
      power: { value: number; usesX: boolean },
      toughness: { value: number; usesX: boolean },
      label: string
    ): OracleEffectStep => ({
      kind: 'modify_pt',
      target,
      power: power.value,
      toughness: toughness.value,
      ...(power.usesX ? { powerUsesX: true } : {}),
      ...(toughness.usesX ? { toughnessUsesX: true } : {}),
      duration: 'end_of_turn',
      raw: `${targetText} gets ${label} until end of turn`,
    } as OracleEffectStep);

    const firstLabel = `${String(choiceMatch[2] || '').trim()}/${String(choiceMatch[3] || '').trim()}`;
    const secondLabel = `${String(choiceMatch[4] || '').trim()}/${String(choiceMatch[5] || '').trim()}`;
    return withMeta({
      kind: 'choose_mode',
      minModes: 1,
      maxModes: 1,
      modes: [
        {
          label: firstLabel,
          raw: `${targetText} gets ${firstLabel} until end of turn`,
          steps: [buildModeStep(firstPower, firstToughness, firstLabel)],
        },
        {
          label: secondLabel,
          raw: `${targetText} gets ${secondLabel} until end of turn`,
          steps: [buildModeStep(secondPower, secondToughness, secondLabel)],
        },
      ],
      raw: rawClause,
    } as OracleEffectStep);
  }

  const match = workingClause.match(
    /^(?:then\s+)?((?:[a-z][a-z\s,/-]*?\s+you\s+control)|target\s+(?:[a-z][a-z -]+\s+)?creature(?:\s+you\s+control|\s+your\s+opponents\s+control|\s+an\s+opponent\s+controls)?|target\s+attacking\s+creature|each\s+(?:non[- ]?[a-z]+\s+)?creature(?:\s+your\s+opponents\s+control)?|each\s+other\s+attacking\s+creature|each\s+attacking\s+creature|other\s+attacking\s+creatures|(?:non[- ]?[a-z]+\s+)?creatures\s+you\s+control|(?:[a-z]+\s+)?creatures\s+your\s+opponents\s+control|(?:[a-z]+\s+)?creatures|all\s+creatures\s+you\s+control|creatures\s+your\s+opponents\s+control|all\s+creatures\s+your\s+opponents\s+control|all\s+creatures(?:\s+of\s+(?:that|the\s+chosen)\s+type)?|creatures\s+that\s+aren't\s+of\s+the\s+chosen\s+type|each\s+creature|each\s+other\s+creature|equipped\s+creature|enchanted\s+creature|that\s+creature|the\s+creature|this\s+creature|this\s+permanent|it)\s+get(?:s)?\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+(.+)$/i
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
                    : { kind: 'reference_scaler', raw: eachRaw };
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
    target: parseModifyPtTarget(targetRaw),
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

  const parseBasePtComponent = (raw: string): { value: number; usesX: boolean } | null => {
    const normalized = String(raw || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'x') return { value: 1, usesX: true };
    if (/^\d+$/.test(normalized)) return { value: Number.parseInt(normalized, 10), usesX: false };
    return null;
  };

  const parseBasePtTarget = (raw: string): any => {
    const targetRaw = String(raw || '').trim().toLowerCase();
    return targetRaw === 'the creature'
      ? { kind: 'equipped_creature' }
      : { kind: 'raw', text: targetRaw };
  };

  const becomeMatch = clause.match(
    /^(?:until end of turn,\s+)?(.+?)\s+(?:has\s+base\s+power\s+and\s+toughness|have\s+base\s+power\s+and\s+toughness|base\s+power\s+and\s+toughness\s+becomes?|becomes?\s+base\s+power\s+and\s+toughness)\s+(\d+|x)\s*\/\s*(\d+|x)(?:\s+until end of turn)?$/i
  );
  if (becomeMatch && (/^until end of turn,/i.test(clause) || /\buntil end of turn\b/i.test(clause))) {
    const power = parseBasePtComponent(String(becomeMatch[2] || ''));
    const toughness = parseBasePtComponent(String(becomeMatch[3] || ''));
    if (!power || !toughness) return null;

    return withMeta({
      kind: 'set_base_pt',
      target: parseBasePtTarget(String(becomeMatch[1] || '').trim()),
      power: power.value,
      toughness: toughness.value,
      ...(power.usesX ? { powerUsesX: true } : {}),
      ...(toughness.usesX ? { toughnessUsesX: true } : {}),
      duration: 'end_of_turn',
      raw: rawClause,
    } as OracleEffectStep);
  }

  const match = clause.match(
    /^(?:until end of turn,\s+)?(target\s+creature(?:\s+you\s+control|\s+your\s+opponents\s+control|\s+an\s+opponent\s+controls)?|enchanted\s+creature|that\s+creature|the\s+creature|this\s+creature|this\s+permanent|it|creatures\s+you\s+control|all\s+creatures\s+you\s+control|all\s+creatures|each\s+creature)\s+ha(?:s|ve)\s+(?:the\s+)?base power and toughness\s+(\d+|x)\s*\/\s*(\d+|x)(?:\s+until end of turn)?$/i
  );
  if (!match) return null;

  const targetRaw = String(match[1] || '').trim().toLowerCase();
  const power = parseBasePtComponent(String(match[2] || ''));
  const toughness = parseBasePtComponent(String(match[3] || ''));
  if (!power || !toughness) return null;

  return withMeta({
    kind: 'set_base_pt',
    target: parseBasePtTarget(targetRaw),
    power: power.value,
    toughness: toughness.value,
    ...(power.usesX ? { powerUsesX: true } : {}),
    ...(toughness.usesX ? { toughnessUsesX: true } : {}),
    duration: 'end_of_turn',
    raw: rawClause,
  } as OracleEffectStep);
}
