/**
 * Origin parent: oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts
 * Cluster: this-turn grant_static_ability / grant_temporary_ability
 *   "you may play (up to) N additional land(s) this turn" stamps
 *   state.additionalLandsThisTurn so calculateMaxLandsPerTurn / canPlayLand
 *   / auto-pass see the extra drops (Summer Bloom, Explore, Imoen riders).
 * Public: parseAdditionalLandsThisTurnCount, tryApplyAdditionalLandsThisTurnGrant
 * Leaf must not import oracleIRExecutorMainLoop.ts or battlefield step parents.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';

const THIS_TURN_DURATIONS = new Set(['this_turn', 'end_of_turn']);

const WORD_TO_NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function grantEffectText(
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' | 'grant_temporary_ability' }>,
): string {
  return [
    ...(Array.isArray(step.effectText) ? step.effectText : []),
    ...(Array.isArray((step as { abilities?: readonly unknown[] }).abilities)
      ? (step as { abilities: readonly unknown[] }).abilities
      : []),
    String(step.raw || ''),
  ]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

/** Parse "play (up to) N additional land(s) this turn" counts; 0 if not a match. */
export function parseAdditionalLandsThisTurnCount(text: string): number {
  const lower = String(text || '').toLowerCase();
  if (!/additional\s+lands?\b/.test(lower)) return 0;
  // Continuous Exploration / Azusa / Wayward wording is battlefield-oracle driven.
  if (/\beach\s+of\s+(?:your|their)\s+turns\b|\bon\s+each\s+of\s+(?:your|their)\s+turns\b|\beach\s+turn\b/.test(lower)) {
    return 0;
  }

  const upToThisTurn = lower.match(/play\s+up\s+to\s+(\w+)\s+additional\s+lands?\s+this\s+turn\b/i);
  if (upToThisTurn) {
    const raw = String(upToThisTurn[1] || '').toLowerCase();
    return WORD_TO_NUM[raw] || parseInt(raw, 10) || 0;
  }

  const plainThisTurn = lower.match(/play\s+(\w+)\s+additional\s+lands?\s+this\s+turn\b/i);
  if (plainThisTurn) {
    const raw = String(plainThisTurn[1] || '').toLowerCase();
    return WORD_TO_NUM[raw] || parseInt(raw, 10) || 0;
  }

  // Duration-scoped grants may omit "this turn" in effectText (step.duration already scopes it).
  const upTo = lower.match(/play\s+up\s+to\s+(\w+)\s+additional\s+lands?\b/i);
  if (upTo) {
    const raw = String(upTo[1] || '').toLowerCase();
    return WORD_TO_NUM[raw] || parseInt(raw, 10) || 0;
  }

  const plain = lower.match(/play\s+(\w+)\s+additional\s+lands?\b/i);
  if (plain) {
    const raw = String(plain[1] || '').toLowerCase();
    return WORD_TO_NUM[raw] || parseInt(raw, 10) || 0;
  }

  return 0;
}

export function tryApplyAdditionalLandsThisTurnGrant(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' | 'grant_temporary_ability' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  const duration = String(step.duration || 'static').trim();
  if (!THIS_TURN_DURATIONS.has(duration) && duration !== 'static') return null;

  const effectText = grantEffectText(step);
  const bonus = parseAdditionalLandsThisTurnCount(effectText);
  if (bonus <= 0) return null;

  // Continuous "each of your turns" statics are battlefield-oracle driven; only this-turn
  // spell/ability grants stamp the temporary counter.
  if (duration === 'static' && /\beach\s+of\s+(?:your|their)\s+turns\b/.test(effectText)) {
    return null;
  }
  if (duration === 'static' && !/\bthis\s+turn\b|\buntil\s+end\s+of\s+turn\b/.test(effectText)) {
    return null;
  }

  const controllerId = String(ctx.controllerId || '').trim();
  if (!controllerId) {
    return {
      applied: false,
      message: `Skipped this-turn additional land plays (no controller): ${step.raw}`,
      reason: 'unsupported_player_selector',
      options: { classification: 'ambiguous' },
    };
  }

  const existing = {
    ...(((state as { additionalLandsThisTurn?: Record<string, number> }).additionalLandsThisTurn) || {}),
  };
  const current = Number(existing[controllerId] || 0) || 0;
  existing[controllerId] = current + bonus;

  const sourceName = String(ctx.sourceName || '').trim() || 'spell';
  return {
    applied: true,
    state: {
      ...state,
      additionalLandsThisTurn: existing,
    } as GameState,
    log: [
      `Granted ${bonus} additional land play(s) this turn to ${controllerId} via ${sourceName} (total bonus: ${existing[controllerId]})`,
    ],
  };
}
