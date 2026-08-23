/**
 * oracleIRParserPostprocessLookChooseFromTop.ts
 *
 * Early postprocess merge cluster for:
 * - look / reveal -> choose-from-top merges (pair, triple, chosen-type sequences)
 * - conditional look-choose-from-top merges
 * - surveil reminder look_top/graveyard rest pruning
 * - top-library -> bottom-random-tail merges (loot-style battlefield triples)
 * - Thassa's Oracle win-grant pruning
 *
 * Extracted from oracleIRParserPostprocess.ts; re-exported from that barrel.
 */

import type {
  OracleClauseCondition,
  OracleEffectStep,
  OracleIRAbility,
} from './oracleIR';
import {
  normalizeOracleText,
  parseQuantity,
} from './oracleIRParserUtils';

function appendFollowupSentence(base: string | undefined, followup: string | null): string {
  const trimmedBase = String(base || '')
    .trim()
    .replace(/[.\s]+$/g, '');
  const trimmedFollowup = String(followup || '')
    .trim()
    .replace(/^[.\s]+/g, '');

  if (!trimmedBase) return trimmedFollowup;
  if (!trimmedFollowup) return trimmedBase;
  return `${trimmedBase}. ${trimmedFollowup}`;
}

const REVEAL_FROM_AMONG_PUT_HAND =
  /^you may reveal (.+?) card from among them and put (?:it|that card) into your hand$/i;

const PUT_ONE_ON_TOP_REST_BOTTOM_RANDOM =
  /^put up to one of them on top of your library and the rest on the bottom of your library in a random order$/i;

const THASSA_ORACLE_WIN_CLAUSE =
  /^if x is greater than or equal to the number of cards in your library, you win the game$/i;


function isThassaOracleWinGrantStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_static_ability') return false;
  const normalized = normalizeOracleText(String(step.raw || '')).replace(/[.]+$/g, '').trim();
  return THASSA_ORACLE_WIN_CLAUSE.test(normalized);
}

function parseLookTopPutOneOnTopRestBottomPair(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (current.kind !== 'look_top') return null;
  if (next?.kind !== 'unknown' && next?.kind !== 'grant_static_ability') return null;

  const normalizedNext = normalizeOracleText(String(next.raw || '')).replace(/[.]+$/g, '').trim();
  if (!PUT_ONE_ON_TOP_REST_BOTTOM_RANDOM.test(normalizedNext)) return null;

  const amount = (current as { amount?: ReturnType<typeof parseQuantity> }).amount;
  if (!amount || amount.kind === 'unknown') return null;

  const whereX = (current as { whereX?: OracleClauseCondition }).whereX;
  const normalizedLook = normalizeOracleText(String(current.raw || '')).replace(/[.]+$/g, '').trim();

  return {
    kind: 'look_select_top',
    who: (current as { who?: { kind: 'you' } }).who ?? { kind: 'you' },
    amount,
    ...(whereX ? { whereX } : {}),
    choose: parseQuantity('one'),
    chooseMin: 0,
    destination: 'library_top',
    restDestination: 'library',
    restRandomOrder: true,
    // Looking at top X and putting the rest on the bottom is mandatory.
    // Only the "up to one on top" selection is optional (chooseMin: 0).
    optional: false,
    ...(current.sequence ? { sequence: current.sequence } : {}),
    raw: `${normalizedLook}. ${normalizedNext}`.trim(),
  };
}

function parseRevealUntilChooseFromTopPair(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined,
): OracleEffectStep | null {
  if (current.kind !== 'reveal_top') return null;
  if (next?.kind !== 'move_zone') return null;
  if (next.what.kind !== 'raw') return null;
  if (String(next.what.text || '').trim().toLowerCase() !== 'that card') return null;
  if (next.to !== 'battlefield' && next.to !== 'hand' && next.to !== 'exile') return null;

  const amount = (current as { amount?: ReturnType<typeof parseQuantity> }).amount;
  if (!amount || amount.kind !== 'reference_amount') return null;
  const amountRaw = String(amount.raw || '').trim();
  if (!/^until you reveal an? /i.test(amountRaw)) return null;

  const selectorText = String(amountRaw.replace(/^until you reveal an? /i, '').trim())
    .replace(/\s+card$/i, '')
    .trim();
  if (!selectorText) return null;

  const normalizedMoveRaw = normalizeOracleText(String(next.raw || '')).replace(/[.]+$/g, '').trim();
  const restOrder = /put the rest on the bottom of your library in any order/i.test(normalizedMoveRaw)
    ? 'any' as const
    : undefined;
  const normalizedReveal = normalizeOracleText(String(current.raw || '')).replace(/[.]+$/g, '').trim();

  return {
    kind: 'look_choose_from_top',
    who: (current as { who?: { kind: 'you' } }).who ?? { kind: 'you' },
    amount,
    selectorText,
    destination: next.to === 'hand' ? 'hand' : next.to === 'exile' ? 'exile' : 'battlefield',
    reveal: true,
    ...(restOrder ? { restOrder } : {}),
    optional: Boolean((next as { optional?: boolean }).optional),
    ...(current.sequence ? { sequence: current.sequence } : {}),
    raw: `${normalizedReveal}. ${normalizedMoveRaw}`.trim(),
  };
}

function parseLookChooseFromTopPair(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (current.kind !== 'look_top' && current.kind !== 'reveal_top') return null;

  const amount = (current as { amount?: ReturnType<typeof parseQuantity> }).amount;
  if (!amount || amount.kind === 'unknown') return null;
  if (!next) return null;

  const normalized = normalizeOracleText(String(next.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  if (next?.kind === 'move_zone' && next.optional === true) {
    if (next.to !== 'hand' && next.to !== 'exile' && next.to !== 'battlefield') return null;
    const moveMatch = normalized.match(
      /^you may (?:reveal and )?(?:put|exile) (.+?) from among them(?: and put (?:it|that card) into your hand)?\.\s*put the rest on the bottom of your library in (a random|any) order$/i,
    );
    if (!moveMatch) return null;
    const selectorText = String(moveMatch[1] || '')
      .trim()
      .replace(/^an?\s+/i, '')
      .replace(/\s+card(?=\s+with\b|$)/i, '')
      .trim();
    if (!selectorText) return null;
    const restOrder = /^any$/i.test(String(moveMatch[2] || '').replace(/^a\s+/i, '')) ? 'any' as const : undefined;
    return {
      kind: 'look_choose_from_top',
      who: (current as { who?: { kind: 'you' } }).who ?? { kind: 'you' },
      amount,
      selectorText,
      destination: next.to,
      ...(/\breveal\b/i.test(normalized) ? { reveal: true } : {}),
      ...(restOrder ? { restOrder } : {}),
      optional: true,
      ...(current.sequence ? { sequence: current.sequence } : {}),
      raw: `${normalizeOracleText(String(current.raw || '')).trim()}. ${normalized}`.trim(),
    };
  }
  {
    const exileOneRestBottom = normalized.match(
      /^(?:exile\s+)?one of those cards and put the rest on the bottom of your library in (a random|any) order$/i
    );
    const exileDestination =
      next.kind === 'exile' ||
      next.kind === 'unknown' ||
      (next.kind === 'move_zone' && next.to === 'exile');
    if (exileOneRestBottom && exileDestination) {
      const restOrder = /^any$/i.test(String(exileOneRestBottom[1] || '').replace(/^a\s+/i, ''))
        ? 'any' as const
        : undefined;
      return {
        kind: 'look_choose_from_top',
        who: (current as { who?: { kind: 'you' } }).who ?? { kind: 'you' },
        amount,
        ...((current as { whereX?: OracleClauseCondition }).whereX
          ? { whereX: (current as { whereX?: OracleClauseCondition }).whereX }
          : {}),
        selectorText: 'one of those cards',
        destination: 'exile',
        ...(restOrder ? { restOrder } : {}),
        ...(current.sequence ? { sequence: current.sequence } : {}),
        raw: `${normalizeOracleText(String(current.raw || '')).trim()}. ${normalized}`.trim(),
      };
    }
  }
  if (next?.kind !== 'unknown') return null;
  const combined = normalized.match(
    /^you may reveal (.+?) card from among them and put (?:it|that card) into your hand\.\s*put the rest on the bottom of your library in (a random|any) order$/i
  );
  if (!combined) return null;

  const selectorText = String(combined[1] || '')
    .trim()
    .replace(/^an?\s+/i, '');
  if (!selectorText) return null;

  const restOrder = /any$/i.test(String(combined[2] || '').replace(/^a\s+/i, '')) ? 'any' as const : undefined;

  return {
    kind: 'look_choose_from_top',
    who: (current as { who?: { kind: 'you' } }).who ?? { kind: 'you' },
    amount,
    selectorText,
    destination: 'hand',
    reveal: true,
    ...(restOrder ? { restOrder } : {}),
    optional: true,
    ...(current.sequence ? { sequence: current.sequence } : {}),
    raw: `${normalizeOracleText(String(current.raw || '')).trim()}. ${normalized}`.trim(),
  };
}

function parseLookChooseFromTopTriple(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined,
  after: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (current.kind !== 'unknown' || after?.kind !== 'unknown') return null;

  const normalizedLook = normalizeOracleText(String(current.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  const normalizedRest = normalizeOracleText(String(after.raw || '')).replace(/[.]+$/g, '').trim();
  const restOrder = getBottomLibraryRestOrder(after);
  if (!restOrder) {
    return null;
  }

  const lookMatch = normalizedLook.match(/^look at the top (a|an|\d+|x|[a-z]+) cards? of your library$/i);
  if (!lookMatch) return null;

  const amount = parseQuantity(String(lookMatch[1] || '').trim());
  if (amount.kind !== 'number') return null;

  if (next?.kind === 'unknown') {
    const normalizedChoose = normalizeOracleText(String(next.raw || '')).replace(/[.]+$/g, '').trim();
    const revealToHandMatch = normalizedChoose.match(REVEAL_FROM_AMONG_PUT_HAND);
    if (!revealToHandMatch) return null;

    return {
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount,
      selectorText: String(revealToHandMatch[1] || '').trim().replace(/^an?\s+/i, ''),
      destination: 'hand',
      reveal: true,
      ...(restOrder === 'any' ? { restOrder: 'any' as const } : {}),
      optional: true,
      ...(current.sequence ? { sequence: current.sequence } : {}),
      raw: `${normalizedLook}. ${normalizedChoose}. ${normalizedRest}`.trim(),
    };
  }

  if (next?.kind === 'move_zone' && next.optional === true && (next.to === 'hand' || next.to === 'exile' || next.to === 'battlefield')) {
    const selectorText = String((next.what as any)?.text || '').trim();
    const cleanedSelectorText = selectorText
      .replace(/\s+from\s+among\s+them$/i, '')
      .replace(/^an?\s+/i, '')
      .replace(/\s+card(?=\s+with\b|$)/i, '')
      .trim();
    if (!cleanedSelectorText) return null;

    return {
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount,
      selectorText: cleanedSelectorText,
      destination: next.to,
      ...(restOrder === 'any' ? { restOrder: 'any' as const } : {}),
      optional: true,
      ...(current.sequence ? { sequence: current.sequence } : {}),
      raw: `${normalizedLook}. ${normalizeOracleText(String(next.raw || '')).trim()}. ${normalizedRest}`.trim(),
    };
  }

  return null;
}

function isSurveilReminderLookTopStep(step: OracleEffectStep | undefined): boolean {
  if (!step || step.kind !== 'look_top') return false;
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  return /^look at the top /i.test(normalized);
}

function isSurveilGraveyardRestMoveZoneStep(step: OracleEffectStep | undefined): boolean {
  if (!step || step.kind !== 'move_zone') return false;
  if (step.what.kind !== 'raw') return false;
  const whatText = normalizeOracleText(String(step.what.text || '')).trim().toLowerCase();
  if (whatText !== 'any number of them') return false;
  if (step.to !== 'graveyard') return false;
  const toRaw = normalizeOracleText(String(step.toRaw || step.raw || '')).trim().toLowerCase();
  return /\brest\b.*\b(?:on\s+top|top)\b.*\blibrary\b/i.test(toRaw);
}

function parseLookSelectTopSurveilGraveyardPair(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (!isSurveilReminderLookTopStep(current) || !isSurveilGraveyardRestMoveZoneStep(next)) {
    return null;
  }

  const amount = (current as { amount?: ReturnType<typeof parseQuantity> }).amount;
  if (!amount || amount.kind === 'unknown') return null;

  const whereX = (current as { whereX?: OracleClauseCondition }).whereX;
  const normalizedLook = normalizeOracleText(String(current.raw || '')).replace(/[.]+$/g, '').trim();
  const normalizedMove = normalizeOracleText(String(next!.raw || '')).replace(/[.]+$/g, '').trim();

  return {
    kind: 'look_select_top',
    who: (current as { who?: { kind: 'you' } }).who ?? { kind: 'you' },
    amount,
    ...(whereX ? { whereX } : {}),
    choose: amount,
    chooseMin: 0,
    destination: 'graveyard',
    restDestination: 'library',
    restToTop: true,
    ...(current.sequence ? { sequence: current.sequence } : {}),
    raw: `${normalizedLook}. ${normalizedMove}`.trim(),
  };
}

export function pruneRedundantSurveilReminderSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const hasSurveil = ability.steps.some((step) => step.kind === 'surveil');
    if (!hasSurveil) return ability;

    const pruned = ability.steps.filter(
      (step) => !isSurveilReminderLookTopStep(step) && !isSurveilGraveyardRestMoveZoneStep(step)
    );
    const withoutMergedSurveilTail = pruned.filter(
      (step) =>
        !(
          step.kind === 'look_select_top'
          && step.destination === 'graveyard'
          && step.restDestination === 'library'
        )
    );

    return withoutMergedSurveilTail.length === ability.steps.length
      ? ability
      : { ...ability, steps: withoutMergedSurveilTail };
  });
}

function parseChosenTypeTopLookChooseFromTopSequence(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined,
  after: OracleEffectStep | undefined,
  fourth: OracleEffectStep | undefined,
): { step: OracleEffectStep; consumed: number } | null {
  const normalizeStepText = (step: OracleEffectStep | undefined): string =>
    normalizeOracleText(String(step?.raw || '')).replace(/[.]+$/g, '').trim().toLowerCase();

  if (current.kind === 'reveal_top') {
    const amount = (current as { amount?: ReturnType<typeof parseQuantity> }).amount;
    if (amount?.kind !== 'number' || amount.value !== 1) return null;
    if (after?.kind !== 'move_zone' || (after as { to?: string }).to !== 'graveyard') return null;
    if (next?.kind !== 'conditional') return null;

    const conditionRaw = normalizeStepText({ raw: String((next.condition as { raw?: string } | undefined)?.raw || '') } as unknown as OracleEffectStep);
    if (!conditionRaw.includes('chosen type')) return null;

    const creatureOnly = conditionRaw.includes('creature');
    const raws = [current, next, after].map((step) => String(step.raw || '').trim()).filter(Boolean);
    return {
      consumed: 3,
      step: {
        kind: 'look_choose_from_top',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        selectorText: creatureOnly ? 'creature card of the chosen type' : 'card of the chosen type',
        destination: 'hand',
        reveal: true,
        optional: false,
        nonMatchRest: 'graveyard',
        raw: raws.join('. '),
      },
    };
  }

  if (current.kind !== 'look_top') return null;
  const amount = (current as { amount?: ReturnType<typeof parseQuantity> }).amount;
  if (amount?.kind !== 'number' || amount.value !== 1) return null;

  const tailSteps = [next, after, fourth].filter(Boolean) as unknown as OracleEffectStep[];
  const tailRaw = tailSteps.map(normalizeStepText).join(' ');
  if (!tailRaw.includes('chosen type') || !tailRaw.includes('hand')) return null;

  const creatureOnly =
    tailRaw.includes('creature card of the chosen type')
    || tailRaw.includes("it's a creature card of the chosen type")
    || tailRaw.includes('creature cards of the chosen type');
  const hasGraveyardFallback =
    tailRaw.includes('put it into your graveyard')
    && tailRaw.includes("if you don't put the card into your hand");
  const optional =
    tailRaw.includes('you may reveal that card if')
    || tailRaw.includes('you may reveal it')
    || (tailRaw.includes('you may') && tailRaw.includes('put it into your hand'));

  const consumed = hasGraveyardFallback ? 3 : (tailSteps.length >= 2 ? 3 : 2);
  const raws = [current, ...tailSteps.slice(0, consumed - 1)].map((step) => String(step.raw || '').trim()).filter(Boolean);
  return {
    consumed,
    step: {
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      selectorText: creatureOnly ? 'creature card of the chosen type' : 'card of the chosen type',
      destination: 'hand',
      reveal: true,
      optional: optional || hasGraveyardFallback,
      nonMatchRest: 'library_top',
      ...(hasGraveyardFallback ? { declinedRest: 'graveyard' as const } : {}),
      raw: raws.join('. '),
    },
  };
}

export function mergeLookChooseFromTopAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      const after = ability.steps[i + 2];
      const fourth = ability.steps[i + 3];

      const chosenTypeTopReveal = parseChosenTypeTopLookChooseFromTopSequence(current, next, after, fourth);
      if (chosenTypeTopReveal) {
        merged.push(chosenTypeTopReveal.step);
        i += chosenTypeTopReveal.consumed - 1;
        continue;
      }

      const libraryReorder = parseLookTopPutOneOnTopRestBottomPair(current, next);
      if (libraryReorder) {
        merged.push(libraryReorder);
        i += 1;
        continue;
      }

      const surveilGraveyard = parseLookSelectTopSurveilGraveyardPair(current, next);
      if (surveilGraveyard) {
        merged.push(surveilGraveyard);
        i += 1;
        continue;
      }

      const lootBattlefield = parseLookTopLootStyleBattlefieldTriple(current, next, after);
      if (lootBattlefield) {
        merged.push(lootBattlefield);
        i += 2;
        continue;
      }

      const revealUntilChoose = parseRevealUntilChooseFromTopPair(current, next);
      if (revealUntilChoose) {
        merged.push(revealUntilChoose);
        i += 1;
        continue;
      }

      const paired = parseLookChooseFromTopPair(current, next);
      if (paired) {
        merged.push(paired);
        i += 1;
        continue;
      }
      const combined = parseLookChooseFromTopTriple(current, next, after);
      if (combined) {
        merged.push(combined);
        i += 2;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}

export function pruneThassaOracleWinGrantAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.filter(step => !isThassaOracleWinGrantStep(step));
    return steps.length === ability.steps.length ? ability : { ...ability, steps };
  });
}

function parseConditionalLookChooseFromTopPair(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (current.kind !== 'unknown' || next?.kind !== 'unknown') return null;

  const normalizedLook = normalizeOracleText(String(current.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const lookMatch = normalizedLook.match(/^if you do,\s*look at the top (a|an|\d+|x|[a-z]+) cards? of your library$/i);
  if (!lookMatch) return null;

  const amount = parseQuantity(String(lookMatch[1] || '').trim());
  if (amount.kind !== 'number') return null;

  const normalizedFollowup = normalizeOracleText(String(next.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const followupMatch = normalizedFollowup.match(
    /^you may reveal (.+?) card from among them and put (?:it|that card) into your hand\.\s*put the rest on the bottom of your library in (a random|any) order$/i
  );
  if (!followupMatch) return null;

  const selectorText = String(followupMatch[1] || '')
    .trim()
    .replace(/^an?\s+/i, '');
  if (!selectorText) return null;

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: 'you do' },
    steps: [
      {
        kind: 'look_choose_from_top',
        who: { kind: 'you' },
        amount,
        selectorText,
        destination: 'hand',
        reveal: true,
        ...(/^any$/i.test(String(followupMatch[2] || '').replace(/^a\s+/i, '')) ? { restOrder: 'any' as const } : {}),
        optional: true,
        raw: `${normalizedLook.replace(/^if you do,\s*/i, '')}. ${normalizedFollowup}`.trim(),
      },
    ],
    ...(current.sequence ? { sequence: current.sequence } : {}),
    raw: `${normalizedLook}. ${normalizedFollowup}`.trim(),
  };
}

export function mergeConditionalLookChooseFromTopAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      const combined = parseConditionalLookChooseFromTopPair(current, next);
      if (combined) {
        merged.push(combined);
        i += 1;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}

function getBottomLibraryRestOrder(step: OracleEffectStep | undefined): 'random' | 'any' | null {
  if (!step || (step.kind !== 'unknown' && step.kind !== 'move_zone' && step.kind !== 'grant_static_ability')) {
    return null;
  }

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (/^put the rest on the bottom(?: of your library)? in a random order$/i.test(normalized)) {
    return 'random';
  }
  if (/^put the rest on the bottom(?: of your library)? in any order$/i.test(normalized)) {
    return 'any';
  }
  return null;
}

function parseLookTopLootStyleBattlefieldTriple(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined,
  after: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (current.kind !== 'look_top') return null;
  if (next?.kind !== 'grant_static_ability' && next?.kind !== 'unknown') return null;

  const amount = (current as { amount?: ReturnType<typeof parseQuantity> }).amount;
  if (!amount || amount.kind !== 'number') return null;

  const normalizedChoose = normalizeOracleText(String(next.raw || '')).replace(/[.]+$/g, '').trim();
  const chooseMatch = normalizedChoose.match(
    /^you may reveal (.+?) from among them and put (?:it|that card) onto the battlefield$/i
  );
  if (!chooseMatch) return null;

  const restOrder = getBottomLibraryRestOrder(after);
  if (!restOrder) return null;

  let selectorText = String(chooseMatch[1] || '').trim().replace(/^an?\s+/i, '');
  selectorText = selectorText.replace(/\s+card(?=\s+with\b)/i, '');

  const normalizedLook = normalizeOracleText(String(current.raw || '')).replace(/[.]+$/g, '').trim();
  const normalizedRest = normalizeOracleText(String(after?.raw || '')).replace(/[.]+$/g, '').trim();

  return {
    kind: 'look_choose_from_top',
    who: (current as { who?: { kind: 'you' } }).who ?? { kind: 'you' },
    amount,
    selectorText,
    destination: 'battlefield',
    reveal: true,
    ...(restOrder === 'any' ? { restOrder: 'any' as const } : {}),
    optional: true,
    ...(current.sequence ? { sequence: current.sequence } : {}),
    raw: `${normalizedLook}. ${normalizedChoose}. ${normalizedRest}`.trim(),
  };
}

function isTopLibrarySelectionLeadUnknownStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  if (step.kind === 'look_top' || step.kind === 'reveal_top') return true;
  if (step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  return /^(?:if you do,\s+)?(?:look at|reveal) the top (?:a|an|\d+|x|[a-z]+) cards? of your library(?:, where .+)?$/i.test(normalized)
    || /^(?:if you do,\s+)?look at that many cards from the top of your library$/i.test(normalized)
    || /^reveal cards from the top of your library until you reveal an? .+ card$/i.test(normalized);
}

function isTopLibrarySelectionFollowupStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  if (step.kind !== 'unknown' && step.kind !== 'move_zone' && step.kind !== 'exile') return false;

  if (step.kind === 'move_zone' && step.what.kind === 'raw') {
    const normalizedWhat = normalizeOracleText(String(step.what.text || ''))
      .replace(/[.]+$/g, '')
      .trim();
    if (normalizedWhat === 'that card' && (step.to === 'battlefield' || step.to === 'hand' || step.to === 'exile')) {
      return true;
    }
  }

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  return /\bfrom among them\b/i.test(normalized)
    || /\bamong them\b/i.test(normalized)
    || /\bfrom among cards revealed this way\b/i.test(normalized)
    || /\bfrom among those cards\b/i.test(normalized)
    || /\bone of those cards\b/i.test(normalized);
}

function hasRecentTopLibrarySelectionContext(steps: readonly OracleEffectStep[], bottomTailIndex: number): boolean {
  const start = Math.max(0, bottomTailIndex - 5);
  for (let index = bottomTailIndex - 1; index >= start; index -= 1) {
    const step = steps[index];
    if (!step) continue;
    if (step.kind === 'look_top' || step.kind === 'reveal_top' || isTopLibrarySelectionFollowupStep(step)) {
      return true;
    }

    const normalized = normalizeOracleText(String(step.raw || ''))
      .replace(/^then\b\s*/i, '')
      .replace(/^[^-—]+[-—]\s*/i, '')
      .replace(/[.]+$/g, '')
      .trim();
    if (/^(?:if you do,\s+)?(?:look at|reveal) the top\b/i.test(normalized)
      || /^(?:if you do,\s+)?look at that many cards from the top of your library$/i.test(normalized)
      || /\bfrom among them\b/i.test(normalized)
      || /\bamong them\b/i.test(normalized)) {
      return true;
    }
  }
  return false;
}

function isTopLibrarySelectionFallbackStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();

  return /^if you don(?:'|’)?t, put it into your hand$/i.test(normalized);
}

export function mergeTopLibraryBottomRandomTailAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      const after = ability.steps[i + 2];

      if (getBottomLibraryRestOrder(current) && hasRecentTopLibrarySelectionContext(ability.steps, i)) {
        const previous = merged.pop();
        if (previous) {
          merged.push({
            ...previous,
            raw: appendFollowupSentence(previous.raw, String(current.raw || '').trim()),
          });
        }
        continue;
      }

      if (current.kind === 'impulse_exile_top' && getBottomLibraryRestOrder(next)) {
        merged.push({
          ...current,
          raw: appendFollowupSentence(current.raw, String(next?.raw || '').trim()),
        });
        i += 1;
        continue;
      }

      if (current.kind === 'impulse_exile_top' && next?.kind === 'conditional' && getBottomLibraryRestOrder(after)) {
        merged.push(current);
        merged.push({
          ...next,
          raw: appendFollowupSentence(next.raw, String(after?.raw || '').trim()),
        });
        i += 2;
        continue;
      }

      if (
        isTopLibrarySelectionLeadUnknownStep(current)
        && isTopLibrarySelectionFollowupStep(next)
        && getBottomLibraryRestOrder(after)
      ) {
        merged.push(current);
        merged.push({
          ...next,
          raw: appendFollowupSentence(next.raw, String(after?.raw || '').trim()),
        });
        i += 2;
        continue;
      }

      if (
        isTopLibrarySelectionLeadUnknownStep(current)
        && isTopLibrarySelectionFollowupStep(next)
        && after?.kind === 'conditional'
        && getBottomLibraryRestOrder(ability.steps[i + 3])
      ) {
        merged.push(current);
        merged.push(next);
        merged.push({
          ...after,
          raw: appendFollowupSentence(after.raw, String(ability.steps[i + 3]?.raw || '').trim()),
        });
        i += 3;
        continue;
      }

      if (
        isTopLibrarySelectionLeadUnknownStep(current)
        && isTopLibrarySelectionFollowupStep(next)
        && isTopLibrarySelectionFallbackStep(after)
        && getBottomLibraryRestOrder(ability.steps[i + 3])
      ) {
        merged.push(current);
        merged.push(next);
        merged.push({
          ...after,
          raw: appendFollowupSentence(after.raw, String(ability.steps[i + 3]?.raw || '').trim()),
        });
        i += 3;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}
