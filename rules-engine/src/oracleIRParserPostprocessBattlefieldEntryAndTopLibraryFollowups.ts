/**
 * Top-library reference and battlefield-entry follow-up merging for the oracle IR
 * postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 13988-14820 of the
 * pre-split file).
 * Cluster moved: standalone top-of-library info steps, cast-without-paying and standalone
 * keyword-cost fallbacks, hideaway and kinship reveal conditionals, immediate top-library
 * reference binding, and the follow-up merges that fold counters, entry characteristics and
 * aura / treasure rewrites into a preceding move_zone step.
 * Public entry symbols: expandStandaloneTopLibraryInfoAbilities,
 * expandCastWithoutPayingFallbackAbilities, expandStandaloneKeywordCostAbilities,
 * expandHideawayReminderAbilities, mergeKinshipRevealConditionalAbilities,
 * bindImmediateTopLibraryReferenceFollowups.
 */
import type {
  OracleClauseCondition,
  OracleEffectStep,
  OracleIRAbility,
  OraclePlayerSelector,
} from './oracleIR';
import { parseBattlefieldEntryCounterFollowupStep } from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';
import { hasNonBandingKeywordOnlyStaticText } from './oracleIRParserPostprocessKeywordStaticGrantSteps';
import {
  parseQuantityWithOptionalWhereX,
  tryParseExileTopClause,
  tryParseLookTopClause,
} from './oracleIRParserQuantityHelpers';
import { normalizeLeadingConditionalCondition } from './oracleIRParserSacrificeHelpers';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
  splitIntoClauses,
} from './oracleIRParserUtils';
import { AbilityType } from './oracleTextParser';

function parseTopLibraryInfoOwner(ownerRaw: string): OraclePlayerSelector | null {
  const normalized = normalizeOracleText(ownerRaw)
    .replace(/[.]+$/g, '')
    .trim();

  if (normalized === 'your') return { kind: 'you' };
  if (normalized === "target player's" || normalized === "that player's") return { kind: 'target_player' };
  if (normalized === "target opponent's" || normalized === "that opponent's") return { kind: 'target_opponent' };
  return null;
}

function parseStandaloneTopLibraryInfoUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[\u2022\u00b7\u25cf\u25e6\u25aa\u25ab\u25ba\u2794\ufffd]+\s*/u, '')
    .replace(/^then\b\s*/i, '')
    .replace(/^(?:\{[^}]+\}(?:,\s*)?)+\s*:\s*/i, '')
    .replace(/^when(?:ever)?\s+.+?,\s*/i, '')
    .replace(/^at\s+the\s+beginning\s+of\s+.+?,\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (!normalized) return null;

  const groupMatch = normalized.match(
    /^(each player|each opponent|each other player) reveals the top (?:(a|an|\d+|x|[a-z]+) cards?|card) of their library$/i
  );
  if (groupMatch) {
    const { amount, whereX } = parseQuantityWithOptionalWhereX(String(groupMatch[2] || 'card').trim());
    return {
      kind: 'reveal_top',
      who: parsePlayerSelector(String(groupMatch[1] || '').trim()),
      amount: groupMatch[2] ? amount : { kind: 'number', value: 1 },
      ...(whereX ? { whereX } : {}),
      ...(step.optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: String(step.raw || '').trim(),
    } as unknown as OracleEffectStep;
  }

  const thatManyFromTop = normalized.match(
    /^(?:you may\s+)?(look at|reveal)\s+that many cards from the top of (your|target player's|target opponent's|that player's|that opponent's)\s+library$/i
  );
  if (thatManyFromTop) {
    const who = parseTopLibraryInfoOwner(String(thatManyFromTop[2] || '').trim());
    if (!who) return null;
    return {
      kind: /^reveal/i.test(String(thatManyFromTop[1] || '').trim()) ? 'reveal_top' : 'look_top',
      who,
      amount: { kind: 'reference_amount', raw: 'that many' },
      ...(step.optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: String(step.raw || '').trim(),
    } as unknown as OracleEffectStep;
  }

  const match = normalized.match(
    /^(?:you may\s+)?(look at|reveal)\s+the\s+top\s+(.+?)\s+of\s+(your|target player's|target opponent's|that player's|that opponent's)\s+library(?:\s+any time)?(?:,\s*where\s+x\s+is\s+(.+))?$/i
  );
  if (!match) return null;

  const who = parseTopLibraryInfoOwner(String(match[3] || '').trim());
  if (!who) return null;

  const whereRaw = String(match[4] || '').trim();
  const quantityTail = whereRaw
    ? `${String(match[2] || '').trim()}, where x is ${whereRaw}`
    : String(match[2] || '').trim();
  const singularCard = /^card$/i.test(quantityTail);
  const { amount, whereX } = singularCard
    ? { amount: { kind: 'number' as const, value: 1 }, whereX: undefined }
    : parseQuantityWithOptionalWhereX(quantityTail);

  return {
    kind: /^reveal/i.test(String(match[1] || '').trim()) ? 'reveal_top' : 'look_top',
    who,
    amount,
    ...(whereX ? { whereX } : {}),
    ...(step.optional ? { optional: true } : {}),
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: String(step.raw || '').trim(),
  } as unknown as OracleEffectStep;
}

export function expandStandaloneTopLibraryInfoAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      return parseStandaloneTopLibraryInfoUnknownStep(step) || step;
    });

    return nextSteps.every((step, index) => step === ability.steps[index]) ? ability : { ...ability, steps: nextSteps };
  });
}

function parseHideawayInnerClauseSteps(innerText: string): OracleEffectStep[] {
  const working = normalizeOracleText(String(innerText || ''))
    .replace(/^when (?:this|that) (?:permanent|creature|land|artifact|enchantment|equipment|vehicle|battle) enters,?\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (!working) return [];

  const lookExileOne = working.match(
    /^look at the top (.+?) of (your|target player's|target opponent's|that player's|that opponent's) library,\s*exile (one|a card)(?: face down)?(?:,\s*then\s+.+)?$/i
  );
  if (lookExileOne) {
    const owner = String(lookExileOne[2] || '').trim();
    const who =
      owner === 'your'
        ? ({ kind: 'you' } as OraclePlayerSelector)
        : parsePlayerSelector(owner);
    if (who.kind !== 'unknown') {
      const { amount } = parseQuantityWithOptionalWhereX(String(lookExileOne[1] || '').trim());
      return [
        {
          kind: 'look_top',
          who,
          amount,
          raw: working,
        } as unknown as OracleEffectStep,
        {
          kind: 'exile_top',
          who,
          amount: { kind: 'number', value: 1 },
          raw: working,
        } as unknown as OracleEffectStep,
      ];
    }
  }

  const steps: OracleEffectStep[] = [];
  for (const rawClause of splitIntoClauses(working)) {
    const meta = normalizeClauseForParse(rawClause);
    const parsed =
      tryParseLookTopClause({ clause: meta.clause, rawClause, withMeta: value => value })
      || tryParseExileTopClause({ clause: meta.clause, rawClause, withMeta: value => value })
      || tryParseSimpleActionClause({
        clause: meta.clause,
        rawClause,
        withMeta: value => ({
          ...value,
          ...(meta.sequence ? { sequence: meta.sequence } : {}),
          ...(meta.optional ? { optional: true } : {}),
        }),
      });
    if (parsed && parsed.kind !== 'unknown') {
      steps.push(parsed as unknown as OracleEffectStep);
    }
  }
  return steps;
}

/** Expands standalone Ward / Madness keyword-cost fragments into static grant steps. */
export function expandCastWithoutPayingFallbackAbilities(
  abilities: readonly OracleIRAbility[],
  oracleText: string
): OracleIRAbility[] {
  const expandAbility = (ability: OracleIRAbility, fallbackText: string): OracleIRAbility[] => {
    const hasRecognized = ability.steps.some(step => step.kind !== 'unknown');
    if (hasRecognized) return [ability];

    const text = normalizeOracleText(String(ability.text || ability.effectText || fallbackText)).trim();
    if (!/\bwithout paying\b/i.test(text)) return [ability];

    const raw = text;
    const target = parseObjectSelector(
      /\bthis spell\b/i.test(text) || /\bthis card\b/i.test(text) ? 'this card' : 'that card'
    );

    return [{
      ...ability,
      type: AbilityType.STATIC,
      steps: [{
        kind: 'grant_static_ability',
        target,
        effectText: [raw],
        duration: 'static',
        raw,
      } as unknown as OracleEffectStep],
    }];
  };

  if (abilities.length > 0) {
    return abilities.flatMap(ability => expandAbility(ability, oracleText));
  }

  const normalized = normalizeOracleText(oracleText).replace(/\s+/g, ' ').trim();
  if (!/\bwithout paying\b/i.test(normalized)) {
    return [];
  }

  return expandAbility(
    {
      type: AbilityType.STATIC,
      text: normalized,
      steps: [],
    } as unknown as OracleIRAbility,
    normalized
  );
}

export function expandStandaloneKeywordCostAbilities(
  abilities: readonly OracleIRAbility[],
  oracleText: string
): OracleIRAbility[] {
  const expandAbility = (ability: OracleIRAbility, fallbackText: string): OracleIRAbility[] => {
    const text = normalizeOracleText(String(ability.text || ability.effectText || fallbackText)).trim();
    const wardMatch = text.match(/^ward\s*[-�]\s*(.+?)\.?$/i);
    if (wardMatch) {
      const hasRecognized = ability.steps.some(step => step.kind !== 'unknown');
      if (!hasRecognized) {
        const raw = text;
        return [{
          ...ability,
          type: AbilityType.STATIC,
          steps: [{
            kind: 'grant_static_ability',
            target: parseObjectSelector('this permanent'),
            effectText: [raw],
            duration: 'static',
            raw,
          } as unknown as OracleEffectStep],
        }];
      }
    }

    const spreeMatch = text.match(/^spree\s*\((.+)\)\.?$/i);
    if (spreeMatch) {
      const hasRecognized = ability.steps.some(step => step.kind !== 'unknown');
      if (!hasRecognized) {
        const raw = text;
        return [{
          ...ability,
          type: AbilityType.STATIC,
          steps: [{
            kind: 'grant_static_ability',
            target: parseObjectSelector('this card'),
            effectText: [raw],
            duration: 'static',
            raw,
          } as unknown as OracleEffectStep],
        }];
      }
    }

    const madnessMatch = text.match(/^madness\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
    if (madnessMatch) {
      const hasRecognized = ability.steps.some(step => step.kind !== 'unknown');
      if (!hasRecognized) {
        const raw = text.replace(/\s*\([^)]*$/g, '').trim() || text;
        return [{
          ...ability,
          type: AbilityType.STATIC,
          steps: [{
            kind: 'grant_static_ability',
            target: parseObjectSelector('this card'),
            abilities: ['madness'],
            effectText: [raw],
            duration: 'static',
            raw,
          } as unknown as OracleEffectStep],
        }];
      }
    }

    return [ability];
  };

  if (abilities.length > 0) {
    return abilities.flatMap(ability => expandAbility(ability, oracleText));
  }

  const normalized = normalizeOracleText(oracleText).replace(/\s+/g, ' ').trim();
  if (/\bbanding\b/i.test(normalized) && !hasNonBandingKeywordOnlyStaticText(normalized)) {
    return [];
  }

  const expanded = expandAbility(
    {
      type: AbilityType.STATIC,
      text: normalized,
      steps: [],
    } as unknown as OracleIRAbility,
    normalized
  );
  if (expanded.length === 1 && expanded[0].steps.length === 0) {
    return [];
  }
  return expanded;
}

/** Expands standalone Hideaway N (...) reminder lines into their executable ETB steps. */
export function expandHideawayReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const match = normalizedText.match(/^hideaway\s+\d+\s*\((.+)\)[.)]*$/i);
    if (!match) return [ability];

    const steps = parseHideawayInnerClauseSteps(String(match[1] || '').trim());
    if (steps.length === 0) return [ability];

    return [
      {
        ...ability,
        type: AbilityType.TRIGGERED,
        trigger: 'enters',
        steps,
        text: String(match[1] || '').trim(),
      },
    ];
  });
}

export function mergeKinshipRevealConditionalAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const mergedSteps: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const step = ability.steps[index];
      const next = ability.steps[index + 1];
      const third = ability.steps[index + 2];

      const normalizedRevealGate =
        next?.kind === 'unknown'
          ? normalizeOracleText(String(next.raw || ''))
              .replace(/^then\b\s*/i, '')
              .replace(/[.]+$/g, '')
              .trim()
          : '';
      const kinshipRevealMatch = normalizedRevealGate.match(
        /^if\s+(it|that card)\s+shares a creature type with\s+(this creature|this permanent),\s+you may reveal it$/i
      );
      const isIfYouDoConditional =
        third?.kind === 'conditional' &&
        normalizeLeadingConditionalCondition(String(third.condition?.raw || '').trim()) === 'you do';

      if (
        step?.kind === 'look_top' &&
        step.who.kind === 'you' &&
        step.amount.kind === 'number' &&
        step.amount.value === 1 &&
        kinshipRevealMatch &&
        isIfYouDoConditional
      ) {
        const conditionSubject = String(kinshipRevealMatch[1] || 'it').trim().toLowerCase();
        const conditionObject = String(kinshipRevealMatch[2] || 'this creature').trim().toLowerCase();
        const combinedRaw = `${String(next?.raw || '').trim()} ${String(third?.raw || '').trim()}`.trim();

        mergedSteps.push(step);
        mergedSteps.push({
          kind: 'conditional',
          condition: { kind: 'if', raw: `${conditionSubject} shares a creature type with ${conditionObject}` },
          steps: [
            {
              kind: 'reveal_top',
              who: step.who,
              amount: step.amount,
              optional: true,
              raw: 'You may reveal the top card of your library.',
            },
            third,
          ],
          ...(next?.sequence ? { sequence: next.sequence } : third?.sequence ? { sequence: third.sequence } : {}),
          raw: combinedRaw,
        });
        changed = true;
        index += 2;
        continue;
      }

      mergedSteps.push(step);
    }

    return changed ? { ...ability, steps: mergedSteps } : ability;
  });
}

function getSingleCardTopLibraryReferenceText(step: OracleEffectStep): string | null {
  if ((step.kind !== 'look_top' && step.kind !== 'reveal_top') || step.amount.kind !== 'number' || step.amount.value !== 1) {
    return null;
  }

  if (step.who.kind === 'you') return 'the top card of your library';
  if (step.who.kind === 'target_player') return "the top card of target player's library";
  if (step.who.kind === 'target_opponent') return "the top card of target opponent's library";
  return null;
}

function rewriteTopLibraryMoveZoneReference(step: OracleEffectStep, replacementText: string): OracleEffectStep {
  if (step.kind !== 'move_zone' || (step.what as any)?.kind !== 'raw') return step;

  const currentText = normalizeOracleText(String((step.what as any)?.text || ''));
  if (currentText !== 'it' && currentText !== 'that card') return step;

  return {
    ...step,
    what: { kind: 'raw', text: replacementText },
  };
}

function rewriteTopLibraryReferenceInsideConditional(step: OracleEffectStep, replacementText: string): OracleEffectStep {
  if (step.kind !== 'conditional') return step;

  const nextNestedSteps = step.steps.map(nested => rewriteTopLibraryMoveZoneReference(nested, replacementText));
  return nextNestedSteps.every((nested, index) => nested === step.steps[index])
    ? step
    : { ...step, steps: nextNestedSteps };
}

export function bindImmediateTopLibraryReferenceFollowups(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!Array.isArray(ability.steps) || ability.steps.length < 2) return ability;

    const rewritten = [...ability.steps];
    let changed = false;

    for (let i = 0; i < rewritten.length - 1; i += 1) {
      const replacementText = getSingleCardTopLibraryReferenceText(rewritten[i]);
      if (!replacementText) continue;

      const next = rewritten[i + 1];
      const rewrittenNext =
        next.kind === 'conditional'
          ? rewriteTopLibraryReferenceInsideConditional(next, replacementText)
          : rewriteTopLibraryMoveZoneReference(next, replacementText);

      if (rewrittenNext !== next) {
        rewritten[i + 1] = rewrittenNext;
        changed = true;
      }
    }

    return changed ? { ...ability, steps: rewritten } : ability;
  });
}

function mergeStepCounterFollowups(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const merged: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    const next = steps[i + 1];

    if (
      current?.kind === 'move_zone' &&
      current.to === 'battlefield'
    ) {
      const parsed = parseBattlefieldEntryCounterFollowupStep(next);
      if (parsed) {
        const existingCounters = current.withCounters || {};
        const combinedCounters: Record<string, number> = { ...existingCounters };
        for (const [counter, amount] of Object.entries(parsed.withCounters)) {
          combinedCounters[counter] = Math.max(0, Number(combinedCounters[counter] || 0) + amount);
        }

        merged.push({
          ...current,
          withCounters: combinedCounters,
          ...(parsed.condition ? { withCountersCondition: parsed.condition } : {}),
          raw: `${String(current.raw || '').trim()}. ${parsed.raw}`.trim(),
        });
        i += 1;
        continue;
      }
    }

    merged.push(current);
  }

  return merged;
}

const COLOR_WORD_TO_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function titleCaseTypeTerm(value: string): string {
  return String(value || '')
    .split('-')
    .map(part =>
      part
        .split(/\s+/g)
        .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word)
        .join(' ')
    )
    .join('-');
}

function parseBattlefieldEntryCharacteristicWords(value: string): {
  readonly addColors?: readonly string[];
  readonly addTypes?: readonly string[];
} {
  const normalized = String(value || '')
    .replace(/\band\b/gi, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return {};

  const addColors: string[] = [];
  const addTypes: string[] = [];
  for (const word of normalized.split(/\s+/g)) {
    const lower = String(word || '').trim().toLowerCase();
    if (!lower || lower === 'a' || lower === 'an') continue;

    const color = COLOR_WORD_TO_SYMBOL[lower];
    if (color) {
      if (!addColors.includes(color)) addColors.push(color);
      continue;
    }

    const typeName = titleCaseTypeTerm(lower);
    if (typeName && !addTypes.includes(typeName)) addTypes.push(typeName);
  }

  return {
    ...(addColors.length > 0 ? { addColors } : {}),
    ...(addTypes.length > 0 ? { addTypes } : {}),
  };
}

function parseBattlefieldEntryCharacteristicsFollowup(rawClause: string): {
  readonly condition?: OracleClauseCondition;
  readonly addColors?: readonly string[];
  readonly addTypes?: readonly string[];
} | null {
  let normalized = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  if (!normalized) return null;

  let condition: OracleClauseCondition | undefined;
  const leadingIfMatch = normalized.match(/^if\s+(.+?),\s+(.+)$/i);
  if (leadingIfMatch) {
    condition = { kind: 'if', raw: String(leadingIfMatch[1] || '').trim() };
    normalized = String(leadingIfMatch[2] || '').trim();
  }

  normalized = normalized.replace(/^it(?:'s| is)\b/i, 'it is');
  const match = normalized.match(
    /^(?:it|that card|that creature|that permanent)\s+is\s+(?:a|an)\s+(.+?)\s+in addition to its other (colors and types|types|creature types)$/i
  );
  if (!match) return null;

  const parsedWords = parseBattlefieldEntryCharacteristicWords(String(match[1] || '').trim());
  if (!parsedWords.addColors && !parsedWords.addTypes) return null;

  return {
    ...(condition ? { condition } : {}),
    ...(parsedWords.addColors ? { addColors: parsedWords.addColors } : {}),
    ...(parsedWords.addTypes ? { addTypes: parsedWords.addTypes } : {}),
  };
}

function mergeUniqueStrings(existing: readonly string[] | undefined, added: readonly string[] | undefined): readonly string[] | undefined {
  const merged: string[] = [];
  for (const list of [existing || [], added || []]) {
    for (const entry of list) {
      const normalized = String(entry || '').trim();
      if (normalized && !merged.includes(normalized)) merged.push(normalized);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

function mergeBattlefieldEntryCharacteristicsIntoMoveZone(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  parsed: {
    readonly condition?: OracleClauseCondition;
    readonly addColors?: readonly string[];
    readonly addTypes?: readonly string[];
  },
  rawClause: string
): Extract<OracleEffectStep, { kind: 'move_zone' }> | null {
  if (step.to !== 'battlefield') return null;
  if (!parsed.addColors && !parsed.addTypes) return null;
  if (
    step.battlefieldCharacteristicsCondition &&
    parsed.condition &&
    step.battlefieldCharacteristicsCondition.raw !== parsed.condition.raw
  ) {
    return null;
  }

  const mergedColors = mergeUniqueStrings(step.battlefieldAddColors, parsed.addColors);
  const mergedTypes = mergeUniqueStrings(step.battlefieldAddTypes, parsed.addTypes);

  return {
    ...step,
    ...(mergedColors ? { battlefieldAddColors: mergedColors } : {}),
    ...(mergedTypes ? { battlefieldAddTypes: mergedTypes } : {}),
    ...(step.battlefieldCharacteristicsCondition || parsed.condition
      ? { battlefieldCharacteristicsCondition: step.battlefieldCharacteristicsCondition || parsed.condition }
      : {}),
    raw: `${String(step.raw || '').trim()}. ${String(rawClause || '').trim()}`.trim(),
  };
}

function mergeBattlefieldEntryCharacteristicFollowups(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const merged: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    const next = steps[i + 1];

    if (next?.kind === 'unknown') {
      const parsed = parseBattlefieldEntryCharacteristicsFollowup(next.raw);
      if (parsed) {
        if (current?.kind === 'move_zone') {
          const mergedMove = mergeBattlefieldEntryCharacteristicsIntoMoveZone(current, parsed, next.raw);
          if (mergedMove) {
            merged.push(mergedMove);
            i += 1;
            continue;
          }
        }

        if (current?.kind === 'conditional') {
          const innerSteps = [...current.steps];
          const lastStep = innerSteps[innerSteps.length - 1];
          if (lastStep?.kind === 'move_zone') {
            const mergedMove = mergeBattlefieldEntryCharacteristicsIntoMoveZone(lastStep, parsed, next.raw);
            if (mergedMove) {
              innerSteps[innerSteps.length - 1] = mergedMove;
              merged.push({
                ...current,
                steps: innerSteps,
                raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
              });
              i += 1;
              continue;
            }
          }
        }

        if (current?.kind === 'schedule_delayed_trigger') {
          merged.push({
            ...current,
            effect: `${String(current.effect || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
            raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
          });
          i += 1;
          continue;
        }
      }
    }

    merged.push(current);
  }

  return merged;
}

function parseBattlefieldEntryAuraRewriteFollowup(rawClause: string): {
  readonly attachedTo: Extract<OracleEffectStep, { kind: 'move_zone' }>['battlefieldAttachedTo'];
  readonly setTypeLine: string;
  readonly setOracleText: string;
  readonly loseAllAbilities: true;
} | null {
  const normalized = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^it(?:'s| is)\s+an?\s+aura enchantment with enchant ([^"]+?) and "([^"]+)" and it loses all other abilities$/i
  );
  if (!match) return null;

  const enchantTarget = String(match[1] || '').trim();
  const grantedAbility = String(match[2] || '').trim();
  if (!enchantTarget || !grantedAbility) return null;

  return {
    attachedTo: parseObjectSelector(`a ${enchantTarget}`),
    setTypeLine: 'Enchantment - Aura',
    setOracleText: `Enchant ${enchantTarget}\n${grantedAbility}`,
    loseAllAbilities: true,
  };
}

function mergeBattlefieldEntryAuraRewriteIntoMoveZone(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  parsed: ReturnType<typeof parseBattlefieldEntryAuraRewriteFollowup>,
  rawClause: string
): Extract<OracleEffectStep, { kind: 'move_zone' }> | null {
  if (step.to !== 'battlefield' || !parsed) return null;
  if (step.battlefieldSetTypeLine || step.battlefieldSetOracleText) return null;

  return {
    ...step,
    battlefieldAttachedTo: step.battlefieldAttachedTo || parsed.attachedTo,
    battlefieldSetTypeLine: parsed.setTypeLine,
    battlefieldSetOracleText: parsed.setOracleText,
    battlefieldLoseAllAbilities: true,
    raw: `${String(step.raw || '').trim()}. ${String(rawClause || '').trim()}`.trim(),
  };
}

function parseBattlefieldEntryTreasureArtifactRewriteFollowup(rawClause: string): {
  readonly setTypeLine: string;
  readonly setOracleText: string;
} | null {
  const normalized = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^it(?:'s| is)\s+a\s+treasure\s+artifact\s+with\s+"([^"]+)"\s*,?\s+and\s+it\s+loses\s+all\s+other\s+card\s+types$/i
  );
  if (!match) return null;

  const grantedAbility = String(match[1] || '').trim();
  if (!grantedAbility) return null;

  return {
    setTypeLine: 'Artifact - Treasure',
    setOracleText: grantedAbility,
  };
}

function mergeBattlefieldEntryTreasureArtifactRewriteIntoMoveZone(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  parsed: ReturnType<typeof parseBattlefieldEntryTreasureArtifactRewriteFollowup>,
  rawClause: string
): Extract<OracleEffectStep, { kind: 'move_zone' }> | null {
  if (step.to !== 'battlefield' || !parsed) return null;
  if (step.battlefieldSetTypeLine || step.battlefieldSetOracleText) return null;

  return {
    ...step,
    battlefieldSetTypeLine: parsed.setTypeLine,
    battlefieldSetOracleText: parsed.setOracleText,
    raw: `${String(step.raw || '').trim()}. ${String(rawClause || '').trim()}`.trim(),
  };
}

function mergeBattlefieldEntryAuraRewriteFollowups(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const merged: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    const next = steps[i + 1];

    if (next?.kind === 'unknown') {
      const parsed = parseBattlefieldEntryAuraRewriteFollowup(next.raw);
      const parsedTreasureArtifact = parseBattlefieldEntryTreasureArtifactRewriteFollowup(next.raw);
      if (parsed) {
        if (current?.kind === 'move_zone') {
          const mergedMove = mergeBattlefieldEntryAuraRewriteIntoMoveZone(current, parsed, next.raw);
          if (mergedMove) {
            merged.push(mergedMove);
            i += 1;
            continue;
          }
        }

        if (current?.kind === 'conditional') {
          const innerSteps = [...current.steps];
          const lastStep = innerSteps[innerSteps.length - 1];
          if (lastStep?.kind === 'move_zone') {
            const mergedMove = mergeBattlefieldEntryAuraRewriteIntoMoveZone(lastStep, parsed, next.raw);
            if (mergedMove) {
              innerSteps[innerSteps.length - 1] = mergedMove;
              merged.push({
                ...current,
                steps: innerSteps,
                raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
              });
              i += 1;
              continue;
            }
          }
        }

        if (current?.kind === 'schedule_delayed_trigger') {
          merged.push({
            ...current,
            effect: `${String(current.effect || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
            raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
          });
          i += 1;
          continue;
        }
      }

      if (parsedTreasureArtifact) {
        if (current?.kind === 'move_zone') {
          const mergedMove = mergeBattlefieldEntryTreasureArtifactRewriteIntoMoveZone(current, parsedTreasureArtifact, next.raw);
          if (mergedMove) {
            merged.push(mergedMove);
            i += 1;
            continue;
          }
        }

        if (current?.kind === 'conditional') {
          const innerSteps = [...current.steps];
          const lastStep = innerSteps[innerSteps.length - 1];
          if (lastStep?.kind === 'move_zone') {
            const mergedMove = mergeBattlefieldEntryTreasureArtifactRewriteIntoMoveZone(
              lastStep,
              parsedTreasureArtifact,
              next.raw
            );
            if (mergedMove) {
              innerSteps[innerSteps.length - 1] = mergedMove;
              merged.push({
                ...current,
                steps: innerSteps,
                raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
              });
              i += 1;
              continue;
            }
          }
        }
      }
    }

    merged.push(current);
  }

  return merged;
}
export {
  mergeBattlefieldEntryAuraRewriteFollowups,
  mergeBattlefieldEntryCharacteristicFollowups,
  mergeStepCounterFollowups,
};
