// New sibling for leftover resolution “if this spell was cast from your hand
// and you've cast another spell named [this card] this game, you win the game.
// Otherwise, put it seventh from the top and gain N life”
// (Approach of the Second Sun spell-win family).
//
// Cluster: generic win-if-cast-same-name-this-game — no card-name routing.
// The printed “named X” is treated as this spell’s current name at execute time.
// Public: tryParseWinIfCastSameNameThisGameStep, expandWinIfCastSameNameThisGameAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

export const WIN_IF_CAST_SAME_NAME_CONDITION_RAW =
  "this spell was cast from your hand and you've cast another spell with the same name this game";

const IF_WIN =
  /^if this spell was cast from your hand and you've cast another spell (?:named .+|with the same name) this game,\s*you win the game\.?$/i;

const FULL_COMPOUND =
  /^if this spell was cast from your hand and you've cast another spell (?:named .+|with the same name) this game,\s*you win the game\.?\s*otherwise,\s*put (?:this spell|this card|it|.+) into its owner's library seventh from the top and you gain (\d+) life\.?$/i;

const OTHERWISE_LIBRARY_LIFE =
  /^(?:otherwise,?\s*)?put (?:this spell|this card|it|.+) into its owner's library seventh from the top(?: and you gain (\d+) life)?\.?$/i;

const GAIN_LIFE = /^you gain (\d+) life\.?$/i;

function normalizeWinIfCastText(raw: string): string {
  return normalizeOracleText(String(raw || ''))
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
}

function buildWinGameStep(): Extract<OracleEffectStep, { kind: 'win_game' }> {
  return {
    kind: 'win_game',
    raw: 'you win the game',
  };
}

function buildOtherwiseSteps(lifeAmount: number): OracleEffectStep[] {
  const life = Number.isFinite(lifeAmount) && lifeAmount > 0 ? lifeAmount : 7;
  return [
    {
      kind: 'move_zone',
      what: parseObjectSelector('this card'),
      to: 'library',
      toRaw: "its owner's library seventh from the top",
      raw: "put this card into its owner's library seventh from the top",
    } as OracleEffectStep,
    {
      kind: 'gain_life',
      who: { kind: 'you' },
      amount: { kind: 'number', value: life },
      raw: `you gain ${life} life`,
    } as OracleEffectStep,
  ];
}

function asSequence(sequence?: { sequence?: 'then' }): { sequence: 'then' } | {} {
  return sequence?.sequence === 'then' ? { sequence: 'then' as const } : {};
}

export function tryParseWinIfCastSameNameThisGameStep(
  rawClause: string,
  sequence: { sequence?: 'then' } = {},
): Extract<OracleEffectStep, { kind: 'conditional' }> | null {
  const normalized = normalizeWinIfCastText(rawClause);
  if (!normalized) return null;

  const full = normalized.match(FULL_COMPOUND);
  if (full) {
    const lifeAmount = Number.parseInt(String(full[1] || '7'), 10) || 7;
    return {
      kind: 'conditional',
      condition: { kind: 'if', raw: WIN_IF_CAST_SAME_NAME_CONDITION_RAW },
      steps: [buildWinGameStep()],
      elseSteps: buildOtherwiseSteps(lifeAmount),
      raw: normalized,
      ...asSequence(sequence),
    };
  }

  if (IF_WIN.test(normalized)) {
    return {
      kind: 'conditional',
      condition: { kind: 'if', raw: WIN_IF_CAST_SAME_NAME_CONDITION_RAW },
      steps: [buildWinGameStep()],
      raw: normalized,
      ...asSequence(sequence),
    };
  }

  return null;
}

function leftoverSameNameWinRaw(step: OracleEffectStep): string | null {
  if (step.kind === 'unknown') {
    const raw = String(step.raw || '').trim();
    if (!raw) return null;
    const normalized = normalizeWinIfCastText(raw);
    if (IF_WIN.test(normalized) || FULL_COMPOUND.test(normalized)) return raw;
    return null;
  }
  if (step.kind !== 'conditional') return null;
  const raw = String((step as { raw?: string }).raw || '').trim();
  if (!raw) return null;
  const normalized = normalizeWinIfCastText(raw);
  if (IF_WIN.test(normalized) || FULL_COMPOUND.test(normalized)) return raw;
  return null;
}

function isSameNameWinConditional(step: OracleEffectStep): step is Extract<OracleEffectStep, { kind: 'conditional' }> {
  if (step.kind !== 'conditional') return false;
  const raw = String(step.condition?.raw || '').trim().toLowerCase().replace(/\u2019/g, "'");
  return /this spell was cast from your hand and you've cast another spell (?:named .+|with the same name) this game/i.test(raw);
}

function hasElseSteps(step: Extract<OracleEffectStep, { kind: 'conditional' }>): boolean {
  return Array.isArray(step.elseSteps) && step.elseSteps.length > 0;
}

function rewriteLibraryWhatToThisSpell(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'move_zone') return step;
  return {
    ...step,
    what: parseObjectSelector('this card'),
    toRaw: String((step as { toRaw?: string }).toRaw || '').trim()
      || "its owner's library seventh from the top",
  } as OracleEffectStep;
}

function isLibrarySeventhOtherwiseStep(step: OracleEffectStep): boolean {
  if (step.kind === 'unknown') {
    const normalized = normalizeWinIfCastText(String(step.raw || ''));
    return OTHERWISE_LIBRARY_LIFE.test(normalized);
  }
  if (step.kind !== 'move_zone') return false;
  if ((step as { to?: string }).to !== 'library') return false;
  const combined = `${String((step as { toRaw?: string }).toRaw || '')} ${String(step.raw || '')}`.toLowerCase();
  return /seventh from the top/.test(combined);
}

function isGainLifeStep(step: OracleEffectStep): boolean {
  if (step.kind === 'gain_life') return true;
  if (step.kind !== 'unknown') return false;
  return GAIN_LIFE.test(normalizeWinIfCastText(String(step.raw || '')));
}

function parseOtherwiseElseSteps(raw: string): OracleEffectStep[] | null {
  const normalized = normalizeWinIfCastText(raw);
  const match = normalized.match(OTHERWISE_LIBRARY_LIFE);
  if (!match) return null;
  const lifeAmount = Number.parseInt(String(match[1] || '7'), 10) || 7;
  return buildOtherwiseSteps(lifeAmount);
}

function takeOtherwiseSteps(
  steps: readonly OracleEffectStep[],
  start: number,
): { readonly elseSteps: OracleEffectStep[]; readonly count: number } {
  const first = steps[start];
  if (!first) return { elseSteps: [], count: 0 };

  if (first.kind === 'unknown') {
    const parsed = parseOtherwiseElseSteps(String(first.raw || ''));
    if (parsed && parsed.length > 0) {
      const extraGain = steps[start + 1] && isGainLifeStep(steps[start + 1]) && parsed.some((step) => step.kind === 'gain_life')
        ? 1
        : 0;
      return { elseSteps: parsed, count: 1 + extraGain };
    }
  }

  if (!isLibrarySeventhOtherwiseStep(first)) return { elseSteps: [], count: 0 };

  const elseSteps: OracleEffectStep[] = [rewriteLibraryWhatToThisSpell(first)];
  let count = 1;
  const next = steps[start + 1];
  if (next && isGainLifeStep(next)) {
    elseSteps.push(next);
    count += 1;
  } else if (first.kind === 'unknown') {
    const parsed = parseOtherwiseElseSteps(String(first.raw || ''));
    if (parsed) return { elseSteps: parsed, count: 1 };
  }
  return { elseSteps, count };
}

function normalizeExistingSameNameConditional(step: OracleEffectStep): OracleEffectStep {
  if (!isSameNameWinConditional(step)) return step;
  const current = String(step.condition.raw || '').trim();
  if (current === WIN_IF_CAST_SAME_NAME_CONDITION_RAW) return step;
  return {
    ...step,
    condition: { kind: 'if', raw: WIN_IF_CAST_SAME_NAME_CONDITION_RAW },
  };
}

export function expandWinIfCastSameNameThisGameAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const rewritten = (ability.steps || []).map((step) => {
      const leftover = leftoverSameNameWinRaw(step);
      if (leftover) {
        const sequence = step.sequence === 'then' ? { sequence: 'then' as const } : {};
        const parsed = tryParseWinIfCastSameNameThisGameStep(leftover, sequence);
        if (parsed) {
          changed = true;
          if (step.kind === 'conditional' && hasElseSteps(step as Extract<OracleEffectStep, { kind: 'conditional' }>)) {
            return {
              ...parsed,
              elseSteps: (step as Extract<OracleEffectStep, { kind: 'conditional' }>).elseSteps,
            };
          }
          return parsed;
        }
      }
      const normalized = normalizeExistingSameNameConditional(step);
      if (normalized !== step) changed = true;
      return normalized;
    });

    const stitched: OracleEffectStep[] = [];
    for (let index = 0; index < rewritten.length; index += 1) {
      const step = rewritten[index];
      if (
        isSameNameWinConditional(step)
        && !hasElseSteps(step)
      ) {
        const consumed = takeOtherwiseSteps(rewritten, index + 1);
        if (consumed.elseSteps.length > 0) {
          stitched.push({
            ...step,
            condition: { kind: 'if', raw: WIN_IF_CAST_SAME_NAME_CONDITION_RAW },
            elseSteps: consumed.elseSteps,
          });
          index += consumed.count;
          changed = true;
          continue;
        }
      }
      stitched.push(step);
    }

    return changed ? { ...ability, steps: stitched } : ability;
  });
}
