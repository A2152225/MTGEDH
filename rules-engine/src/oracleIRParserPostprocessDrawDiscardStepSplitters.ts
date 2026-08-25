/**
 * Draw / discard / life step splitters for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 105-585).
 * Cluster moved: the compound-step splitters that break a single mis-parsed draw step into
 * draw + discard / untap / gain-life / creature-buff / treasure pieces, the villainous-choice
 * clause parser, and the orphan-connector merge plus malformed-ability prune helpers.
 * Public entry symbols: all of the splitters re-exported at the foot of this file; the
 * postprocess parent imports them back and remains the only caller.
 */
import type { OracleEffectStep } from './oracleIR';
import { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClauses';
import { parseLifeTailStep } from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { enrichCreateTokenCombatEntryFromRaw } from './oracleIRParserTokenFollowup';
import { tryParseSimpleCreateTokenClause } from './oracleIRParserTokenSimpleClauses';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
  parseQuantity,
} from './oracleIRParserUtils';

function stripTriggeredDrawPrefix(raw: string): string {
  const normalized = normalizeOracleText(raw).trim();
  const triggered = normalized.match(/^(?:when(?:ever)?|at the beginning of)\b[\s\S]+?,\s*(.+)$/i);
  return triggered ? String(triggered[1] || '').trim() : normalized;
}

function buildDrawThenDiscardSteps(params: {
  who: string;
  drawCards: string;
  discardCards: string;
  fullRaw: string;
}): readonly OracleEffectStep[] | null {
  const who = String(params.who || 'you').trim();
  const drawVerb = /^you$/i.test(who) ? 'draw' : 'draws';
  const discardVerb = /^you$/i.test(who) ? 'discard' : 'discards';
  const drawRaw = `${who} ${drawVerb} ${String(params.drawCards || '').trim()}`;
  const discardRaw = `${who} ${discardVerb} ${String(params.discardCards || '').trim()}`;
  const drawStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(drawRaw).clause,
    rawClause: params.fullRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const discardStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(discardRaw).clause,
    rawClause: discardRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (drawStep?.kind !== 'draw' || discardStep?.kind !== 'discard') return null;
  return [drawStep, { ...discardStep, sequence: 'then' }];
}

function splitDrawAndDiscardStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const body = stripTriggeredDrawPrefix(raw);
  const cardAmount = String.raw`(?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?`;

  const bareMatch = body.match(
    new RegExp(String.raw`^draws?\s+(${cardAmount}),\s*then\s+discards?\s+(${cardAmount})\.?$`, 'i'),
  );
  if (bareMatch) {
    return buildDrawThenDiscardSteps({
      who: 'you',
      drawCards: String(bareMatch[1] || '').trim(),
      discardCards: String(bareMatch[2] || '').trim(),
      fullRaw: raw,
    });
  }

  const subjectMatch = body.match(
    new RegExp(String.raw`^(.+?)\s+draws?\s+(${cardAmount}),\s*then\s+discards?\s+(${cardAmount})\.?$`, 'i'),
  );
  if (subjectMatch) {
    return buildDrawThenDiscardSteps({
      who: String(subjectMatch[1] || '').trim(),
      drawCards: String(subjectMatch[2] || '').trim(),
      discardCards: String(subjectMatch[3] || '').trim(),
      fullRaw: raw,
    });
  }

  if (step.amount?.kind === 'unknown') {
    const amountRaw = normalizeOracleText(String(step.amount.raw || '')).trim();
    const amountMatch = amountRaw.match(
      new RegExp(String.raw`^(${cardAmount}),\s*then\s+discards?\s+(${cardAmount})\.?$`, 'i'),
    );
    if (amountMatch) {
      const whoRaw = step.who?.kind === 'you'
        ? 'you'
        : String((step.who as { raw?: string; text?: string } | undefined)?.raw
          || (step.who as { text?: string } | undefined)?.text
          || 'you').trim();
      return buildDrawThenDiscardSteps({
        who: whoRaw,
        drawCards: String(amountMatch[1] || '').trim(),
        discardCards: String(amountMatch[2] || '').trim(),
        fullRaw: raw,
      });
    }
  }

  return null;
}

function splitDrawUntapTailStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const cardAmount = String.raw`(?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?`;
  const extract = (text: string): { drawCards: string; untapTail: string } | null => {
    const match = text.match(new RegExp(String.raw`^draws?\s+(${cardAmount}),\s+untap\s+(.+)$`, 'i'));
    if (match) {
      return {
        drawCards: String(match[1] || '').trim(),
        untapTail: String(match[2] || '').trim(),
      };
    }
    const amountMatch = text.match(new RegExp(String.raw`^(${cardAmount}),\s+untap\s+(.+)$`, 'i'));
    if (amountMatch) {
      return {
        drawCards: String(amountMatch[1] || '').trim(),
        untapTail: String(amountMatch[2] || '').trim(),
      };
    }
    return null;
  };

  const parts = extract(raw) || (step.amount?.kind === 'unknown' ? extract(String(step.amount.raw || '')) : null);
  if (!parts) return null;

  const drawRaw = `draw ${parts.drawCards}`;
  const drawStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(drawRaw).clause,
    rawClause: drawRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const untapRaw = `untap ${parts.untapTail}`;
  const untapStep =
    tryParseLifeAndCombatClause({
      clause: normalizeClauseForParse(untapRaw).clause,
      rawClause: untapRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    }) ??
    tryParseSimpleActionClause({
      clause: normalizeClauseForParse(untapRaw).clause,
      rawClause: untapRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
  if (drawStep?.kind !== 'draw' || !untapStep || untapStep.kind !== 'tap_or_untap') return null;
  return [drawStep, { ...untapStep, sequence: 'then' }];
}

function splitGainLifeDrawLeadFromDrawStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const match = raw.match(/^(?:you\s+)?gain (\d+) life, draw ((?:a|an|one|two|three|four|five|\d+|x)\s+cards?),?\s*$/i);
  if (!match) return null;

  const drawAmountRaw = String(match[2] || '').trim().replace(/\s+cards?$/i, '');
  return [
    {
      kind: 'gain_life',
      who: { kind: 'you' },
      amount: { kind: 'number', value: Number.parseInt(String(match[1] || '0'), 10) || 0 },
      raw: `you gain ${String(match[1] || '').trim()} life`,
    } as unknown as OracleEffectStep,
    {
      kind: 'draw',
      who: { kind: 'you' },
      amount: parseQuantity(drawAmountRaw),
      raw: `draw ${String(match[2] || '').trim()}`,
    } as unknown as OracleEffectStep,
  ];
}

function splitDrawAndCreatureBuffStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const amountRaw = step.amount?.kind === 'unknown' ? normalizeOracleText(String(step.amount.raw || '')).trim() : '';

  const fullMatch = raw.match(
    /^(.+?)\s+draws?\s+(x|\d+)\s+cards?\s+and\s+(?:the\s+)?(.+?)\s+get\s+(.+?)(?:,\s*where\s+x\s+is\s+.+)?\.?$/i,
  );
  const amountMatch = amountRaw.match(
    /^(x|\d+)\s+cards?\s+and\s+(?:the\s+)?(.+?)\s+get\s+(.+?)(?:,\s*where\s+x\s+is\s+.+)?\.?$/i,
  );

  const who = fullMatch ? String(fullMatch[1] || 'you').trim() : 'you';
  const drawAmount = String(fullMatch?.[2] || amountMatch?.[1] || '').trim();
  const targetText = String(fullMatch?.[3] || amountMatch?.[2] || '').trim();
  const buffText = String(fullMatch?.[4] || amountMatch?.[3] || '').trim();
  if (!drawAmount || !targetText || !buffText || !/\+x\/\+x/i.test(buffText)) return null;

  const drawVerb = /^you$/i.test(who) ? 'draw' : 'draws';
  const drawStep: OracleEffectStep = {
    kind: 'draw',
    who: parsePlayerSelector(who),
    amount: /^x$/i.test(drawAmount) ? { kind: 'x' } : parseQuantity(drawAmount),
    raw: `${who} ${drawVerb} ${drawAmount} cards`,
  };
  const steps: OracleEffectStep[] = [
    drawStep,
    {
      kind: 'modify_pt',
      target: parseObjectSelector(targetText),
      power: 1,
      toughness: 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      raw: `${targetText} get ${buffText.split(/,\s*where/i)[0]?.trim() || buffText}`,
      sequence: 'then',
    } as unknown as OracleEffectStep,
  ];

  const keywordMatch = buffText.match(/\band\s+gain\s+(trample|flying|hexproof|reach|haste|menace|deathtouch|lifelink|first strike|double strike)\b/i);
  if (keywordMatch) {
    steps.push({
      kind: 'grant_temporary_ability',
      target: parseObjectSelector(targetText),
      abilities: [String(keywordMatch[1] || '').trim().toLowerCase()],
      duration: 'end_of_turn',
      raw: `${targetText} gain ${String(keywordMatch[1] || '').trim()} until end of turn`,
      sequence: 'then',
    } as unknown as OracleEffectStep);
  }

  return steps;
}

function parseVillainousChoiceFromClause(rawClause: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawClause).replace(/^then\s+/i, '').trim();
  const match = normalized.match(/^(.+?)\s+faces a villainous choice\s*(?:\u2014|-)\s*(.+)$/i);
  if (!match) return null;

  const chooserText = String(match[1] || '').trim();
  const optionsText = String(match[2] || '').trim().replace(/[.]+$/g, '');
  if (/[.;]/.test(chooserText)) return null;
  const separatorIndex = optionsText.toLowerCase().indexOf(', or ');
  if (!chooserText || !optionsText || separatorIndex < 0) return null;

  const optionAText = optionsText.slice(0, separatorIndex).trim();
  const optionBText = optionsText.slice(separatorIndex + ', or '.length).trim();
  if (!optionAText || !optionBText) return null;

  const parseModeEffectSteps = (modeEffectText: string): readonly OracleEffectStep[] => {
    const clauseNormalized = normalizeClauseForParse(modeEffectText);
    const parsed = tryParseSimpleActionClause({
      clause: clauseNormalized.clause,
      rawClause: modeEffectText,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    return parsed && parsed.kind !== 'unknown' ? [parsed] : [];
  };

  return {
    kind: 'choose_mode',
    minModes: 1,
    maxModes: 1,
    modes: [
      { label: optionAText, raw: optionAText, steps: [...parseModeEffectSteps(optionAText)] },
      { label: optionBText, raw: optionBText, steps: [...parseModeEffectSteps(optionBText)] },
    ],
    raw: `${chooserText} faces a villainous choice - ${optionAText}, or ${optionBText}`,
  } as unknown as OracleEffectStep;
}

function splitMisparseVillainousChoiceDrawStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  if (!/\bfaces a villainous choice\b/i.test(raw)) return null;
  return parseVillainousChoiceFromClause(raw);
}

function splitCommaChainedPlayerEffectStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const amountRaw = step.amount?.kind === 'unknown' ? normalizeOracleText(String(step.amount.raw || '')).trim() : '';
  if (/\bfaces a villainous choice\b/i.test(raw)) return null;
  if (!/,\s*(?:you|they|that player|each opponent|each player)\b/i.test(raw)) return null;
  if (step.amount?.kind !== 'unknown' && !amountRaw.includes(',')) return null;

  const normalized = raw
    .replace(/^if .+?,\s*/i, '')
    .replace(/^then\s+/i, '')
    .trim();
  const segments = normalized
    .split(/,\s*(?=(?:you|they|that player|each opponent|each player)\b)/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 2) return null;

  const parsedSteps: OracleEffectStep[] = [];
  for (const segment of segments) {
    const clauseNormalized = normalizeClauseForParse(segment);
    let parsed = tryParseSimpleActionClause({
      clause: clauseNormalized.clause,
      rawClause: segment,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (!parsed || parsed.kind === 'unknown') {
      parsed = parseLifeTailStep(segment) ?? parsed;
    }
    if (!parsed || parsed.kind === 'unknown') {
      const lifeParsed = tryParseLifeAndCombatClause({
        clause: clauseNormalized.clause,
        rawClause: segment,
        withMeta: <T extends OracleEffectStep>(value: T) => value,
      });
      if (lifeParsed && lifeParsed.kind !== 'unknown') parsed = lifeParsed;
    }
    if ((!parsed || parsed.kind === 'unknown') && /\bcreate\b/i.test(segment)) {
      const tokenParsed = tryParseSimpleCreateTokenClause({
        clause: clauseNormalized.clause,
        rawClause: segment,
        withMeta: <T extends OracleEffectStep>(value: T) => value,
      });
      if (tokenParsed && tokenParsed.kind !== 'unknown') parsed = enrichCreateTokenCombatEntryFromRaw(tokenParsed);
    }
    if (!parsed || parsed.kind === 'unknown') return null;
    parsedSteps.push(parsed);
  }
  return parsedSteps;
}

function splitDrawCreateTreasureStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const amountRaw = step.amount?.kind === 'unknown' || step.amount?.kind === 'reference_amount'
    ? normalizeOracleText(String(step.amount.raw || '')).trim()
    : '';

  const fullMatch = raw.match(
    /^(.+?)\s+draws?\s+(that many|\d+)\s+cards,\s*create\s+(that many|\d+)\s+tapped\s+treasure\s+tokens?\.?$/i,
  );
  const amountMatch = amountRaw.match(
    /^(that many|\d+)\s+cards,\s*create\s+(that many|\d+)\s+tapped\s+treasure\s+tokens?\.?$/i,
  );
  const drawRef = String(fullMatch?.[2] || amountMatch?.[1] || '').trim();
  const createRef = String(fullMatch?.[3] || amountMatch?.[2] || '').trim();
  if (!drawRef || !createRef) return null;

  const who = fullMatch ? String(fullMatch[1] || 'you').trim() : 'you';
  const drawVerb = /^you$/i.test(who) ? 'draw' : 'draws';
  const drawAmount = /^that many$/i.test(drawRef)
    ? { kind: 'reference_amount' as const, raw: 'that many' }
    : parseQuantity(drawRef);
  const createAmount = /^that many$/i.test(createRef)
    ? { kind: 'reference_amount' as const, raw: 'that many' }
    : parseQuantity(createRef);

  return [
    {
      kind: 'draw',
      who: parsePlayerSelector(who),
      amount: drawAmount,
      raw: `${who} ${drawVerb} ${drawRef} cards`,
    },
    {
      kind: 'create_token',
      who: { kind: 'you' },
      amount: createAmount,
      token: 'Treasure',
      entersTapped: true,
      raw: `create ${createRef} tapped Treasure tokens`,
      sequence: 'then',
    } as unknown as OracleEffectStep,
  ];
}

function isKeywordReminderTailStep(step: OracleEffectStep): boolean {
  const raw = String(step.raw || '').trim();
  if (step.kind === 'conditional') {
    if (/^\(?When (?:a creature|this creature).*deals combat damage to a player/i.test(raw)) return true;
    if (/^\(This creature deals combat damage to/i.test(raw)) return true;
  }
  if (step.kind === 'deal_damage' && /firstest strike/i.test(raw)) return true;
  if (step.kind === 'grant_static_ability') {
    if (/^\(.*(?:[Dd]istribute|When a creature with renown)/i.test(raw)) return true;
    if (/^\(Yes, we know this doesn't actually work/i.test(raw)) return true;
    const targetText = String((step.target as { text?: string } | undefined)?.text || '').trim();
    if (/^reminder text$/i.test(targetText)) return true;
  }
  return false;
}

function mergeOrphanConnectorSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const merged: OracleEffectStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const next = steps[index + 1];
    const stepRaw = normalizeOracleText(String(step.raw || '')).trim();
    if (step.kind === 'unknown' && /^then\.?$/i.test(stepRaw) && next) {
      merged.push(
        next.sequence || !step.sequence
          ? next
          : ({ ...next, sequence: step.sequence } as unknown as OracleEffectStep),
      );
      index += 1;
      continue;
    }
    if (step.kind === 'unknown' && /^that player\.?$/i.test(stepRaw) && next?.kind === 'discard') {
      merged.push({
        ...next,
        who: parsePlayerSelector('that player'),
        raw: `That player ${String(next.raw || '').replace(/^then\s+/i, '')}`,
      } as unknown as OracleEffectStep);
      index += 1;
      continue;
    }
    merged.push(step);
  }
  return merged;
}

function pruneMalformedAbilitySteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const pruned = mergeOrphanConnectorSteps(steps).flatMap((step) => {
    if (step.kind === 'deal_damage' && /^firstest strike/i.test(String(step.raw || ''))) {
      return [{
        kind: 'grant_static_ability',
        target: parseObjectSelector('this creature'),
        effectText: ['firstest strike'],
        duration: 'static',
        raw: String(step.raw || ''),
      } as unknown as OracleEffectStep];
    }
    if (isKeywordReminderTailStep(step)) return [];
    return [step];
  });
  while (pruned.length > 0) {
    const last = pruned[pruned.length - 1];
    if (last?.kind === 'create_token' && /gains control of this permanent/i.test(String(last.raw || ''))) {
      pruned.pop();
      continue;
    }
    break;
  }
  return pruned.map((step) => {
    if (step.kind === 'grant_static_ability' && Array.isArray((step as { steps?: readonly OracleEffectStep[] }).steps)) {
      const effectText = (step as { effectText?: readonly string[] }).effectText;
      const nestedSteps = (step as { steps: readonly OracleEffectStep[] }).steps;
      const hasMalformedNested = nestedSteps.some((child) => {
        if (child.kind === 'unknown') return true;
        const amount = (child as { amount?: { kind?: string } }).amount;
        if (amount?.kind === 'unknown') return true;
        const who = (child as { who?: { kind?: string } }).who;
        return who?.kind === 'unknown';
      });
      if (Array.isArray(effectText) && effectText.length > 0 && hasMalformedNested) {
        const { steps: _removed, ...rest } = step as unknown as OracleEffectStep & { steps?: readonly OracleEffectStep[] };
        return rest as unknown as OracleEffectStep;
      }
      const nested = pruneMalformedAbilitySteps(nestedSteps);
      if (nested.length === 0) {
        const { steps: _removed, ...rest } = step as unknown as OracleEffectStep & { steps?: readonly OracleEffectStep[] };
        return rest as unknown as OracleEffectStep;
      }
      return nested !== (step as { steps: readonly OracleEffectStep[] }).steps ? { ...step, steps: nested } : step;
    }
    if (step.kind === 'conditional') {
      const nested = pruneMalformedAbilitySteps(step.steps);
      return nested !== step.steps ? { ...step, steps: nested } : step;
    }
    if (step.kind === 'choose_mode' && Array.isArray(step.modes)) {
      const modes = step.modes.map((mode) => ({
        ...mode,
        steps: pruneMalformedAbilitySteps(mode.steps || []),
      }));
      return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps)
        ? { ...step, modes }
        : step;
    }
    return step;
  });
}

function shouldSkipDrawMetadataCandidate(candidate: string): boolean {
  const normalized = normalizeOracleText(candidate).trim();
  if (/sacrifice this artifact:\s*draw/i.test(normalized) && /loses all other abilities/i.test(normalized)) return true;
  if (/^draw a card["']?\s*(?:and loses all other abilities|\.\s*\()/i.test(normalized)) return true;
  if (/\bequipped creature gets\b/i.test(normalized) && /\bhas\s+"/i.test(normalized)) return true;
  if (/\bwhen (?:this|target|enchanted|that) .+\b(?:draws?|discards?)\b/i.test(normalized)) return true;
  if (/\bdraws?\s+a\s+card\s+and\s+gains?\b/i.test(normalized)) return true;
  if (/\bdraws?\s+a\s+card\b/i.test(normalized) && /\bactivate only as a sorcery\b/i.test(normalized)) return true;
  if (/, then discard a card\b/i.test(normalized)) return true;
  return false;
}

function stripQuotedDrawBleedStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'draw') return null;
  const amountRaw = step.amount?.kind === 'unknown' ? normalizeOracleText(String(step.amount.raw || '')).trim() : '';
  if (!/^a card[,."']/i.test(amountRaw)) return null;
  const cleanedRaw = normalizeOracleText(String(step.raw || ''))
    .replace(/\bdraw\s+a\s+cards?[."'\s,]*(?:\([\s\S]*)?$/i, 'draw a card')
    .trim();
  return {
    ...step,
    amount: { kind: 'number', value: 1 },
    raw: cleanedRaw || 'draw a card',
  };
}

export {
  mergeOrphanConnectorSteps,
  pruneMalformedAbilitySteps,
  shouldSkipDrawMetadataCandidate,
  splitCommaChainedPlayerEffectStep,
  splitDrawAndCreatureBuffStep,
  splitDrawAndDiscardStep,
  splitDrawCreateTreasureStep,
  splitDrawUntapTailStep,
  splitGainLifeDrawLeadFromDrawStep,
  splitMisparseVillainousChoiceDrawStep,
  stripQuotedDrawBleedStep,
  stripTriggeredDrawPrefix,
};
