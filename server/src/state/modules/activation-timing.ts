/**
 * Activation timing restrictions parsed from oracle / ability text.
 *
 * Used by canAct / canRespond / canActivateAnyAbility so restricted abilities
 * (e.g. "Activate this ability only during your upkeep") do not block auto-pass
 * outside their legal window. Always-on activates (Trading Post style) are unaffected.
 */

export type ActivationTimingRestriction =
  | 'your_upkeep'
  | 'opponent_upkeep'
  | 'your_turn'
  | 'sorcery';

export interface ActivationTimingStateLike {
  step?: unknown;
  phase?: unknown;
  turnPlayer?: unknown;
  activePlayer?: unknown;
  stack?: unknown;
}

function normalizeStepPhase(state: ActivationTimingStateLike): { step: string; phase: string } {
  return {
    step: String(state?.step || '').toUpperCase(),
    phase: String(state?.phase || '').toUpperCase(),
  };
}

function getTurnPlayerId(state: ActivationTimingStateLike): string {
  return String(state?.turnPlayer ?? state?.activePlayer ?? '');
}

export function isInUpkeepStep(state: ActivationTimingStateLike): boolean {
  const { step, phase } = normalizeStepPhase(state);
  return step.includes('UPKEEP') || phase.includes('UPKEEP');
}

export function isInMainPhase(state: ActivationTimingStateLike): boolean {
  const { step, phase } = normalizeStepPhase(state);
  return (
    step === 'MAIN1' ||
    step === 'MAIN2' ||
    step === 'MAIN' ||
    step === 'MAIN_1' ||
    step === 'MAIN_2' ||
    phase.includes('MAIN') ||
    phase.includes('PRECOMBAT') ||
    phase.includes('POSTCOMBAT')
  );
}

/**
 * Collect the ability clause used for timing scans: prefer the matched ability
 * block (from matchIndex through the next ability line) so a restriction on one
 * ability does not incorrectly gate siblings on the same card.
 */
export function getAbilityTimingSourceText(
  fullAbilityText: string,
  oracleText?: string,
  matchIndex?: number,
): string {
  const ability = String(fullAbilityText || '').trim();
  const oracle = String(oracleText || '');
  if (typeof matchIndex === 'number' && Number.isFinite(matchIndex) && oracle) {
    const from = oracle.slice(Math.max(0, matchIndex));
    const nextAbility = from.search(
      /\n(?=(?:\{[TQWUBRGCX0-9/P]+\}\s*[,:]?|[+-]\d+\s*:|Equip\b|Crew\b|Station\b|Level up\b|Outlast\b|Cycling\b|Embalm\b|Unearth\b))/i,
    );
    const clause = (nextAbility >= 0 ? from.slice(0, nextAbility) : from).trim();
    if (clause) return clause;
  }
  return ability || oracle;
}

/**
 * Detect the most specific activation timing restriction in text.
 * More specific windows (upkeep) win over broader ones (your turn / sorcery).
 */
export function detectActivationTimingRestriction(text: string): ActivationTimingRestriction | null {
  const src = String(text || '');
  if (!src.trim()) return null;

  if (/activate\s+(?:this\s+ability\s+|these\s+abilities\s+)?only\s+during\s+(?:an?\s+)?opponent'?s?\s+upkeep/i.test(src)) {
    return 'opponent_upkeep';
  }
  if (/activate\s+(?:this\s+ability\s+|these\s+abilities\s+)?only\s+during\s+your\s+upkeep/i.test(src)) {
    return 'your_upkeep';
  }
  // Generic "only during ... upkeep" without "your"/"opponent" - treat as controller's upkeep.
  if (/activate\s+(?:this\s+ability\s+|these\s+abilities\s+)?only\s+during\s+(?:the\s+)?upkeep/i.test(src)) {
    return 'your_upkeep';
  }
  if (/activate\s+(?:this\s+ability\s+|these\s+abilities\s+)?only\s+during\s+your\s+turn/i.test(src)) {
    return 'your_turn';
  }
  if (/(?:activate|use)\s+(?:this\s+ability\s+|these\s+abilities\s+)?only\s+(?:as\s+a\s+sorcery|any\s+time\s+you\s+could\s+cast\s+a\s+sorcery)/i.test(src)) {
    return 'sorcery';
  }
  return null;
}

export function isActivationTimingMet(
  state: ActivationTimingStateLike,
  playerId: string,
  restriction: ActivationTimingRestriction | null | undefined,
): boolean {
  if (!restriction) return true;

  const turnPlayer = getTurnPlayerId(state);
  const isTurnPlayer = turnPlayer !== '' && turnPlayer === String(playerId || '');
  const inUpkeep = isInUpkeepStep(state);
  const stackEmpty = !Array.isArray(state?.stack) || (state.stack as unknown[]).length === 0;

  switch (restriction) {
    case 'your_upkeep':
      return isTurnPlayer && inUpkeep;
    case 'opponent_upkeep':
      return !isTurnPlayer && turnPlayer !== '' && inUpkeep;
    case 'your_turn':
      return isTurnPlayer;
    case 'sorcery':
      return isTurnPlayer && isInMainPhase(state) && stackEmpty;
    default:
      return true;
  }
}

/**
 * True when the ability/oracle text is legal to activate right now for timing.
 * Missing/empty restriction text => legal (Trading Post-style always-on activates).
 */
export function isActivatedAbilityTimingLegal(
  state: ActivationTimingStateLike,
  playerId: string,
  fullAbilityText: string,
  oracleText?: string,
  matchIndex?: number,
): boolean {
  const source = getAbilityTimingSourceText(fullAbilityText, oracleText, matchIndex);
  const restriction = detectActivationTimingRestriction(source);
  return isActivationTimingMet(state, playerId, restriction);
}
