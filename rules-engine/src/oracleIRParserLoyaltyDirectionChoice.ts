// New sibling for leftover black-border planeswalker loyalty phrasing.
//
// Cluster: "Choose left or right." compounds that reminder-prune used to drop,
// leaving only the follow-up `gain_control` / `grant_temporary_ability` stub.
// Covers Aminatou, the Fateshifter −6 and Teyo, Geometric Tactician −2.
//
// Public entry symbols:
//   tryParseChooseLeftOrRightLoyaltySteps
//   expandChooseLeftOrRightLoyaltyAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector } from './oracleIRParserUtils';

const CHOOSE_LEFT_OR_RIGHT_PREFIX = /^choose left or right\.\s+/i;

const GAIN_CONTROL_TAIL =
  /^each player gains control of all nonland permanents other than .+? controlled by the next player in the chosen direction\.?$/i;

const ATTACK_RESTRICTION_TAIL =
  /^until your next turn, each player may attack only the nearest opponent in the last chosen direction and planeswalkers controlled by that opponent\.?$/i;

function normalizeLoyaltyDirectionText(raw: string): string {
  return normalizeOracleText(String(raw || ''))
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '.')
    .trim();
}

function buildChooseLeftOrRightModes(
  raw: string,
  sequence: { sequence?: 'then' },
  buildFollowup: (direction: 'left' | 'right') => OracleEffectStep,
): OracleEffectStep[] {
  return [{
    kind: 'choose_mode',
    minModes: 1,
    maxModes: 1,
    modes: [
      {
        label: 'Left',
        raw: 'Choose left',
        steps: [buildFollowup('left')],
      },
      {
        label: 'Right',
        raw: 'Choose right',
        steps: [buildFollowup('right')],
      },
    ],
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];
}

function buildGainControlFollowup(direction: 'left' | 'right'): OracleEffectStep {
  return {
    kind: 'gain_control',
    what: parseObjectSelector(
      'all nonland permanents other than this permanent controlled by the next player in the chosen direction',
    ),
    newController: parsePlayerSelector('each player'),
    duration: 'indefinite',
    raw: `Each player gains control of all nonland permanents other than this permanent controlled by the next player to the ${direction}`,
  } as OracleEffectStep;
}

function buildAttackRestrictionFollowup(direction: 'left' | 'right'): OracleEffectStep {
  const effect =
    `Until your next turn, each player may attack only the nearest opponent to the ${direction} and planeswalkers controlled by that opponent`;
  return {
    kind: 'grant_temporary_ability',
    target: parseObjectSelector('each player'),
    duration: 'until_next_turn',
    effectText: [effect],
    raw: effect,
  } as OracleEffectStep;
}

export function tryParseChooseLeftOrRightLoyaltySteps(
  raw: string,
  sequence: { sequence?: 'then' } = {},
): OracleEffectStep[] | null {
  const normalized = normalizeLoyaltyDirectionText(raw);
  if (!normalized) return null;

  let tail = normalized;
  if (CHOOSE_LEFT_OR_RIGHT_PREFIX.test(normalized)) {
    tail = normalized.replace(CHOOSE_LEFT_OR_RIGHT_PREFIX, '').trim();
  }

  if (GAIN_CONTROL_TAIL.test(tail)) {
    return buildChooseLeftOrRightModes(normalized, sequence, buildGainControlFollowup);
  }
  if (ATTACK_RESTRICTION_TAIL.test(tail)) {
    return buildChooseLeftOrRightModes(normalized, sequence, buildAttackRestrictionFollowup);
  }
  return null;
}

function leftoverDirectionTailFromSteps(steps: readonly OracleEffectStep[]): string | null {
  if (!Array.isArray(steps) || steps.length !== 1) return null;
  const step = steps[0];
  const raw = normalizeLoyaltyDirectionText(String(step?.raw || ''));
  if (step.kind === 'gain_control' && GAIN_CONTROL_TAIL.test(raw)) return raw;
  if (step.kind === 'grant_temporary_ability' && ATTACK_RESTRICTION_TAIL.test(raw)) return raw;
  return null;
}

export function expandChooseLeftOrRightLoyaltyAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const text = String(ability.effectText || ability.text || '').trim();
    const fromText = tryParseChooseLeftOrRightLoyaltySteps(text);
    if (fromText) return { ...ability, steps: fromText };

    const leftoverTail = leftoverDirectionTailFromSteps(ability.steps || []);
    if (!leftoverTail) return ability;
    const reconstructed = tryParseChooseLeftOrRightLoyaltySteps(`Choose left or right. ${leftoverTail}`);
    if (!reconstructed) return ability;
    return { ...ability, steps: reconstructed };
  });
}
