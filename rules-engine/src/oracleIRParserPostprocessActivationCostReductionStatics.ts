// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: activated-ability cost-reduction statics (expansion plus the recovery pass that puts
// back a static the earlier parse dropped) and the generic "until your next turn" residual grant
// parser that feeds the structured trigger-residual chain.
//
// Public entry points:
//   expandActivatedAbilityCostReductionStaticAbilities
//   recoverDroppedActivationCostReductionStaticAbilities
//   tryParseGenericUntilNextTurnResidualGrant

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { tryParseBareStaticCostReductionSteps } from './oracleIRParserPostprocessBareStaticCostReductionSentences';
import { buildTemporaryGrantStepFields } from './oracleIRParserPostprocessTemporaryGrantStepBuilders';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { normalizeClauseForParse, normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';
import type { ParsedAbility } from './oracleTextParser';
import { AbilityType } from './oracleTextParser';

export function expandActivatedAbilityCostReductionStaticAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type !== AbilityType.STATIC) return ability;
    const text = String(ability.effectText || ability.text || '').trim();
    if (!/less to activate/i.test(text)) return ability;

    const hasCostReductionGrant = ability.steps.some((step) => {
      if (step.kind !== 'grant_static_ability') return false;
      const effectLines = Array.isArray((step as { effectText?: readonly string[] }).effectText)
        ? (step as { effectText?: readonly string[] }).effectText || []
        : [];
      return effectLines.some((line) => /less to activate/i.test(String(line || '')));
    });
    if (hasCostReductionGrant) return ability;

    const parsedSteps = tryParseBareStaticCostReductionSteps(text, {});
    if (!parsedSteps || parsedSteps.length === 0) return ability;
    return { ...ability, steps: [...parsedSteps] };
  });
}

export function recoverDroppedActivationCostReductionStaticAbilities(
  abilities: readonly OracleIRAbility[],
  parsedAbilities: readonly ParsedAbility[],
): OracleIRAbility[] {
  const normalizedPresent = new Set(
    abilities.map((ability) => normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/[.!?]+$/g, '')
      .trim()
      .toLowerCase()),
  );

  const recovered: OracleIRAbility[] = [];
  for (const parsedAbility of parsedAbilities) {
    if (parsedAbility.type !== AbilityType.STATIC) continue;
    const line = String(parsedAbility.text || '').trim();
    if (!/less to activate/i.test(line)) continue;
    const normalizedLine = normalizeOracleText(line).replace(/[.!?]+$/g, '').trim().toLowerCase();
    if (normalizedPresent.has(normalizedLine)) continue;

    const expanded = expandActivatedAbilityCostReductionStaticAbilities([{
      type: AbilityType.STATIC,
      text: line,
      effectText: line,
      steps: [],
    }]);
    const candidate = expanded[0];
    if (!candidate) continue;
    const hasGrant = candidate.steps.some((step) => {
      if (step.kind !== 'grant_static_ability') return false;
      const effectLines = Array.isArray((step as { effectText?: readonly string[] }).effectText)
        ? (step as { effectText?: readonly string[] }).effectText || []
        : [];
      return effectLines.some((effectLine) => /less to activate/i.test(String(effectLine || '')));
    });
    if (hasGrant) recovered.push(candidate);
  }

  return recovered.length > 0 ? [...abilities, ...recovered] as OracleIRAbility[] : [...abilities];
}

function tryParseGenericUntilNextTurnResidualGrant(
  raw: string,
  sequence: { sequence?: 'then' },
): readonly OracleEffectStep[] | null {
  const drawThenUntilNextTurnCost = raw.match(
    /^(.+)\.\s+until your next turn,\s*(.+?\bspells?\b.+?)\s+cost\s+(\{[^}]+\})\s+less to cast\.?$/i,
  );
  if (drawThenUntilNextTurnCost) {
    const drawRaw = String(drawThenUntilNextTurnCost[1] || '').trim();
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(drawRaw).clause,
      rawClause: drawRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (drawStep?.kind === 'draw') {
      const spellsText = String(drawThenUntilNextTurnCost[2] || '').trim();
      return [
        drawStep,
        {
          kind: 'grant_temporary_ability',
          target: parseObjectSelector(/\bthat player\b/i.test(spellsText) ? 'that player' : 'you'),
          duration: 'until_next_turn',
          effectText: [`${spellsText} cost ${String(drawThenUntilNextTurnCost[3] || '').trim()} less to cast`],
          raw: `Until your next turn, ${spellsText} cost ${String(drawThenUntilNextTurnCost[3] || '').trim()} less to cast`,
          sequence: 'then',
        } as unknown as OracleEffectStep,
      ];
    }
  }

  const gyReanimateThenWard = raw.match(
    /^target opponent puts a creature card of their choice from their graveyard onto the battlefield under your control(?:\.\s+that creature gains ward\s+(\{[^}]+\}|\d+))?\.?$/i,
  );
  if (gyReanimateThenWard) {
    const steps: OracleEffectStep[] = [{
      kind: 'move_zone',
      what: parseObjectSelector("a creature card of their choice from target opponent's graveyard"),
      to: 'battlefield',
      toRaw: 'the battlefield under your control',
      raw: 'Target opponent puts a creature card of their choice from their graveyard onto the battlefield under your control',
      ...sequence,
    } as unknown as OracleEffectStep];
    const wardCost = String(gyReanimateThenWard[1] || '').trim();
    if (wardCost) {
      const wardText = /^\{/.test(wardCost) ? `ward ${wardCost}` : `ward {${wardCost}}`;
      steps.push({
        kind: 'grant_static_ability',
        target: parseObjectSelector('that creature'),
        abilities: [wardText],
        duration: 'static',
        raw: `That creature gains ${wardText}`,
        sequence: 'then',
      } as unknown as OracleEffectStep);
    }
    return steps;
  }

  const prefixUntilNextTurnPtAndKeyword = raw.match(
    /^until your next turn,\s*(.+?)\s+gets?\s+([+-]\d+)\s*\/\s*([+-]\d+)\s+and\s+(gains?|loses?)\s+(.+?)\.?$/i,
  );
  if (prefixUntilNextTurnPtAndKeyword) {
    const targetText = String(prefixUntilNextTurnPtAndKeyword[1] || '').trim();
    const verb = String(prefixUntilNextTurnPtAndKeyword[4] || '').trim().toLowerCase();
    const keywordRaw = String(prefixUntilNextTurnPtAndKeyword[5] || '').trim();
    const grantFields = verb.startsWith('lose')
      ? { abilities: [`loses ${keywordRaw}`], effectText: [`loses ${keywordRaw}`] }
      : buildTemporaryGrantStepFields(keywordRaw);
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector(targetText),
        power: Number.parseInt(String(prefixUntilNextTurnPtAndKeyword[2] || '0'), 10) || 0,
        toughness: Number.parseInt(String(prefixUntilNextTurnPtAndKeyword[3] || '0'), 10) || 0,
        duration: 'until_next_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(targetText),
        duration: 'until_next_turn',
        ...grantFields,
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const suffixUntilNextTurnPtAndKeyword = raw.match(
    /^(.+?)\s+gets?\s+([+-]\d+)\s*\/\s*([+-]\d+)\s+and\s+(gains?|loses?)\s+(.+?)\s+until your next turn\.?$/i,
  );
  if (suffixUntilNextTurnPtAndKeyword) {
    const targetText = String(suffixUntilNextTurnPtAndKeyword[1] || '').trim();
    const verb = String(suffixUntilNextTurnPtAndKeyword[4] || '').trim().toLowerCase();
    const keywordRaw = String(suffixUntilNextTurnPtAndKeyword[5] || '').trim();
    const grantFields = verb.startsWith('lose')
      ? { abilities: [`loses ${keywordRaw}`], effectText: [`loses ${keywordRaw}`] }
      : buildTemporaryGrantStepFields(keywordRaw);
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector(targetText),
        power: Number.parseInt(String(suffixUntilNextTurnPtAndKeyword[2] || '0'), 10) || 0,
        toughness: Number.parseInt(String(suffixUntilNextTurnPtAndKeyword[3] || '0'), 10) || 0,
        duration: 'until_next_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(targetText),
        duration: 'until_next_turn',
        ...grantFields,
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const prefixCantAttackOrBlock = raw.match(
    /^until your next turn,\s*(.+?)\s+can(?:'|�)t attack or block\.?$/i,
  );
  if (prefixCantAttackOrBlock) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector(String(prefixCantAttackOrBlock[1] || '').trim()),
      duration: 'until_next_turn',
      effectText: ["can't attack or block"],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const suffixCantAttackOrBlock = raw.match(
    /^(.+?)\s+can(?:'|�)t attack or block until your next turn\.?$/i,
  );
  if (suffixCantAttackOrBlock) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector(String(suffixCantAttackOrBlock[1] || '').trim()),
      duration: 'until_next_turn',
      effectText: ["can't attack or block"],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const untilNextTurnWhenever = raw.match(/^until your next turn,\s*(whenever\b.+)$/i);
  if (untilNextTurnWhenever) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('you'),
      duration: 'until_next_turn',
      effectText: [String(untilNextTurnWhenever[1] || '').trim()],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const untilNextTurnSpellCost = raw.match(
    /^until your next turn,\s*(.+?\bspells?\b.+?)\s+cost\s+(\{[^}]+\})\s+less to cast\.?$/i,
  );
  if (untilNextTurnSpellCost) {
    const spellsText = String(untilNextTurnSpellCost[1] || '').trim();
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector(/\bthat player\b/i.test(spellsText) ? 'that player' : 'you'),
      duration: 'until_next_turn',
      effectText: [`${spellsText} cost ${String(untilNextTurnSpellCost[2] || '').trim()} less to cast`],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const untilNextTurnAnimate = raw.match(
    /^until your next turn,\s*(.+?)\s+becomes?\s+a\s+(\d+)\/(\d+)(?:\s+(.+?))?\s+creature(?:\s+in addition to its other types)?\.?$/i,
  );
  if (untilNextTurnAnimate) {
    const typeText = String(untilNextTurnAnimate[4] || '').trim();
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector(String(untilNextTurnAnimate[1] || '').trim()),
      power: Number.parseInt(String(untilNextTurnAnimate[2] || '0'), 10),
      toughness: Number.parseInt(String(untilNextTurnAnimate[3] || '0'), 10),
      addTypes: typeText ? [...typeText.split(/\s+/).filter(Boolean), 'creature'] : ['creature'],
      duration: 'until_next_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const modalScaledPt = raw.match(
    /^(.+?)\s+gets?\s+([+-]?x)\s*\/\s*([+-]?x)\s+or\s+([+-]?x)\s*\/\s*([+-]?x)\s+until end of turn(?:,\s+where\s+(.+))?\.?$/i,
  );
  if (modalScaledPt) {
    const targetText = String(modalScaledPt[1] || '').trim();
    const whereRaw = String(modalScaledPt[6] || '').replace(/[.]+$/g, '').trim();
    const whereCondition = whereRaw ? { kind: 'where' as const, raw: whereRaw } : undefined;
    const signed = (token: string): { value: number; usesX: boolean } => ({
      value: token.trim().startsWith('-') ? -1 : 1,
      usesX: true,
    });
    const firstPower = signed(String(modalScaledPt[2] || ''));
    const firstToughness = signed(String(modalScaledPt[3] || ''));
    const secondPower = signed(String(modalScaledPt[4] || ''));
    const secondToughness = signed(String(modalScaledPt[5] || ''));
    const buildModeStep = (
      power: { value: number; usesX: boolean },
      toughness: { value: number; usesX: boolean },
      label: string,
    ): OracleEffectStep => ({
      kind: 'modify_pt',
      target: parseObjectSelector(targetText),
      power: power.value,
      toughness: toughness.value,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      ...(whereCondition ? { condition: whereCondition } : {}),
      raw: `${targetText} gets ${label} until end of turn`,
    } as OracleEffectStep);
    const firstLabel = `${String(modalScaledPt[2] || '').trim()}/${String(modalScaledPt[3] || '').trim()}`;
    const secondLabel = `${String(modalScaledPt[4] || '').trim()}/${String(modalScaledPt[5] || '').trim()}`;
    return [{
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
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const perpetualPt = raw.match(
    /^(.+?)\s+perpetually\s+gets?\s+([+-]\d+)\s*\/\s*([+-]?\d+)\.?$/i,
  );
  if (perpetualPt) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(perpetualPt[1] || '').trim()),
      power: Number.parseInt(String(perpetualPt[2] || '0'), 10),
      toughness: Number.parseInt(String(perpetualPt[3] || '0'), 10),
      duration: 'static',
      effectText: [`perpetually gets ${String(perpetualPt[2] || '').trim()}/${String(perpetualPt[3] || '').trim()}`],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  return null;
}


export { tryParseGenericUntilNextTurnResidualGrant };
