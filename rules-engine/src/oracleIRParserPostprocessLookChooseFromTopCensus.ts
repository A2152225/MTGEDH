/**
 * oracleIRParserPostprocessLookChooseFromTopCensus.ts
 *
 * Origin parent: oracleIRParserPostprocessLookChooseFromTop.ts
 * Cluster moved: SPELL_PRIMARY=1 census look/search merges that the loot-style
 *   battlefield triple and look_select_top pair do not cover —
 *   reveal/look X then any-number permanents to battlefield (rest graveyard),
 *   and look at target opponent's top cards then exile one face down (rest bottom).
 * Public entry symbols: parseRevealTopAnyNumberPermanentsToBattlefieldTriple,
 *   parseLookTopExileOneFaceDownRestBottom, parseLookTopReorderAllOnLibrary.
 * Called from mergeLookChooseFromTopAbilities; do not import the parent.
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

function normalizedStepRaw(step: OracleEffectStep | undefined): string {
  return normalizeOracleText(String(step?.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
}

function isTopLibraryLookOrRevealStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  return step.kind === 'look_top' || step.kind === 'reveal_top';
}

function isAnyNumberPermanentsToBattlefieldStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  if (step.kind === 'move_zone' && step.to !== 'battlefield') return false;
  if (step.kind !== 'move_zone' && step.kind !== 'unknown' && step.kind !== 'grant_static_ability') {
    return false;
  }

  const normalized = normalizedStepRaw(step);
  if (!/\bfrom among them\b/i.test(normalized) && !/\bamong them\b/i.test(normalized)) return false;
  if (!/\bany number of\b/i.test(normalized)) return false;
  if (!/\bpermanent cards?\b/i.test(normalized)) return false;
  if (!/\bmana value\b/i.test(normalized)) return false;
  if (!/\bonto the battlefield\b/i.test(normalized) && step.kind !== 'move_zone') return false;
  return true;
}

function isRevealedThisWayRestToGraveyardStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  if (step.kind === 'move_zone' && step.to !== 'graveyard') return false;
  if (step.kind !== 'move_zone' && step.kind !== 'unknown') return false;

  const normalized = normalizedStepRaw(step);
  return (
    /\binto your graveyard\b/i.test(normalized)
    && (
      /\brevealed this way\b/i.test(normalized)
      || /\bwere not put onto the battlefield\b/i.test(normalized)
      || /\bthe rest\b/i.test(normalized)
    )
  );
}

function extractAnyNumberPermanentSelector(raw: string): string | null {
  const normalized = normalizedStepRaw({ kind: 'unknown', raw } as OracleEffectStep);
  const match = normalized.match(
    /\bany number of ((?:permanent cards?|permanents) with mana value (?:x|\d+) or less)\b/i,
  );
  if (!match) return null;
  return `any number of ${String(match[1] || '').trim()}`;
}

export function parseRevealTopAnyNumberPermanentsToBattlefieldTriple(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined,
  after: OracleEffectStep | undefined,
): OracleEffectStep | null {
  if (!isTopLibraryLookOrRevealStep(current)) return null;
  if (!isAnyNumberPermanentsToBattlefieldStep(next)) return null;
  if (!isRevealedThisWayRestToGraveyardStep(after)) return null;

  const amount = (current as { amount?: ReturnType<typeof parseQuantity> }).amount;
  if (!amount || amount.kind === 'unknown') return null;

  const selectorText = extractAnyNumberPermanentSelector(String(next?.raw || ''));
  if (!selectorText) return null;

  const whereX = (current as { whereX?: OracleClauseCondition }).whereX;
  const who = (current as { who?: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>['who'] }).who
    ?? { kind: 'you' as const };

  return {
    kind: 'look_choose_from_top',
    who,
    amount,
    ...(whereX ? { whereX } : {}),
    selectorText,
    destination: 'battlefield',
    reveal: current.kind === 'reveal_top' || /\breveal\b/i.test(normalizedStepRaw(current)),
    nonMatchRest: 'graveyard',
    optional: true,
    ...(current.sequence ? { sequence: current.sequence } : {}),
    raw: [normalizedStepRaw(current), normalizedStepRaw(next), normalizedStepRaw(after)]
      .filter(Boolean)
      .join('. '),
  };
}

function isExileOneFaceDownStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  const toExile = step.kind === 'exile'
    || (step.kind === 'move_zone' && step.to === 'exile')
    || step.kind === 'unknown';
  if (!toExile) return false;

  const normalized = normalizedStepRaw(step);
  return (
    /\bexile\b/i.test(normalized)
    && /\bone of them\b/i.test(normalized)
    && /\bface down\b/i.test(normalized)
  );
}

function isOtherCardToLibraryBottomStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  if (step.kind === 'move_zone' && step.to !== 'library') return false;
  if (step.kind !== 'move_zone' && step.kind !== 'unknown' && step.kind !== 'put_on_bottom') {
    return false;
  }

  const normalized = normalizedStepRaw(step);
  return (
    (/\bthe other\b/i.test(normalized) || /\bthe rest\b/i.test(normalized))
    && /\bbottom of (?:that |your |their )?library\b/i.test(normalized)
  );
}

function isPlayExiledCardGrantStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  if (step.kind !== 'grant_static_ability' && step.kind !== 'unknown') return false;
  const normalized = normalizedStepRaw(step);
  return (
    /\byou may play the exiled card\b/i.test(normalized)
    || /\bplay the exiled card for as long as it remains exiled\b/i.test(normalized)
  );
}

function isCombinedExileOneFaceDownRestBottom(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  const normalized = normalizedStepRaw(step);
  return isExileOneFaceDownStep(step)
    && /\bput the other on the bottom of (?:that |your |their )?library\b/i.test(normalized);
}

export function parseLookTopExileOneFaceDownRestBottom(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined,
  after: OracleEffectStep | undefined,
  fourth: OracleEffectStep | undefined,
): { readonly step: OracleEffectStep; readonly consumed: number } | null {
  if (current.kind !== 'look_top') return null;

  const amount = (current as { amount?: ReturnType<typeof parseQuantity> }).amount;
  if (!amount || amount.kind === 'unknown') return null;

  const who = (current as { who?: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>['who'] }).who;
  if (!who) return null;

  const combinedNext = isCombinedExileOneFaceDownRestBottom(next);
  const splitNext = !combinedNext && isExileOneFaceDownStep(next) && isOtherCardToLibraryBottomStep(after);
  if (!combinedNext && !splitNext) return null;

  const grant = combinedNext
    ? (isPlayExiledCardGrantStep(after) ? after : undefined)
    : (isPlayExiledCardGrantStep(fourth) ? fourth : undefined);
  const consumed = combinedNext
    ? (grant ? 3 : 2)
    : (grant ? 4 : 3);

  const rawParts = [
    normalizedStepRaw(current),
    normalizedStepRaw(next),
    ...(combinedNext ? [] : [normalizedStepRaw(after)]),
    ...(grant ? [normalizedStepRaw(grant)] : []),
  ].filter(Boolean);

  return {
    consumed,
    step: {
      kind: 'look_choose_from_top',
      who,
      amount,
      selectorText: 'one of them',
      destination: 'exile',
      nonMatchRest: 'library_bottom',
      ...(current.sequence ? { sequence: current.sequence } : {}),
      raw: rawParts.join('. '),
    },
  };
}

const PUT_THEM_BACK_IN_ANY_ORDER =
  /^(?:then\s+)?put (?:them|those cards|it|that card) back in any order$/i;

function abilityHasPutThemBackReorder(ability: OracleIRAbility | undefined, current: OracleEffectStep): boolean {
  const blob = [
    ability?.text,
    ability?.effectText,
    current.raw,
  ].filter(Boolean).join(' ');
  return /put (?:them|those cards|it|that card) back in any order/i.test(blob);
}

function isOptionalShuffleLibraryStep(step: OracleEffectStep | undefined): boolean {
  return step?.kind === 'shuffle_library' && (step as { optional?: boolean }).optional === true;
}

function isPutThemBackReorderUnknownStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  if (step.kind !== 'unknown' && step.kind !== 'put_on_bottom') return false;
  return PUT_THEM_BACK_IN_ANY_ORDER.test(normalizedStepRaw(step));
}

/**
 * Index / Ponder / Halimar Depths: look at top N, put all of them back on
 * library in any order, optional shuffle. Emits look_select_top dest=library_top
 * with choose=amount so the server can queue PONDER_EFFECT instead of a
 * LIBRARY_SEARCH / optional-shuffle OPTION_CHOICE.
 */
export function parseLookTopReorderAllOnLibrary(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined,
  after: OracleEffectStep | undefined,
  ability?: OracleIRAbility,
): { readonly step: OracleEffectStep; readonly consumed: number } | null {
  if (current.kind !== 'look_top') return null;

  const amount = (current as { amount?: ReturnType<typeof parseQuantity> }).amount;
  if (!amount || amount.kind === 'unknown') return null;

  if (next?.kind === 'look_select_top' || next?.kind === 'look_choose_from_top') return null;
  if (next?.kind === 'move_zone') {
    const dest = String((next as { to?: string }).to || '');
    if (dest === 'hand' || dest === 'battlefield' || dest === 'exile' || dest === 'graveyard') {
      return null;
    }
  }

  const putBackStep = isPutThemBackReorderUnknownStep(next);
  const currentHasPutBack = /put (?:them|those cards|it|that card) back in any order/i.test(
    normalizedStepRaw(current),
  );
  const abilityHasPutBack = abilityHasPutThemBackReorder(ability, current);
  const shuffleAfterPutBack = putBackStep && isOptionalShuffleLibraryStep(after);
  const shuffleDirect = isOptionalShuffleLibraryStep(next);

  let consumed = 0;
  const rawParts = [normalizedStepRaw(current)];

  if (putBackStep) {
    consumed = 2;
    rawParts.push(normalizedStepRaw(next));
    if (shuffleAfterPutBack) {
      consumed = 3;
      rawParts.push(normalizedStepRaw(after));
    }
  } else if (shuffleDirect && (currentHasPutBack || abilityHasPutBack)) {
    consumed = 2;
    if (!currentHasPutBack) rawParts.push('put them back in any order');
    rawParts.push(normalizedStepRaw(next));
  } else if (!next && (currentHasPutBack || abilityHasPutBack)) {
    consumed = 1;
    if (!currentHasPutBack) rawParts.push('put them back in any order');
  } else {
    return null;
  }

  const who = (current as { who?: Extract<OracleEffectStep, { kind: 'look_select_top' }>['who'] }).who
    ?? { kind: 'you' as const };
  const whereX = (current as { whereX?: OracleClauseCondition }).whereX;

  return {
    consumed,
    step: {
      kind: 'look_select_top',
      who,
      amount,
      ...(whereX ? { whereX } : {}),
      choose: amount,
      destination: 'library_top',
      restDestination: 'library',
      ...(current.optional ? { optional: true } : {}),
      ...(current.sequence ? { sequence: current.sequence } : {}),
      raw: rawParts.filter(Boolean).join('. '),
    },
  };
}
