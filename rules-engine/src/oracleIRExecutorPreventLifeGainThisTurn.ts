/**
 * Origin parent: oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts
 * Cluster: this-turn / end-of-turn grant_static_ability “can't gain life”
 *   stamps state.lastingEffects preventLifeGain (with duration) for the affected
 *   player(s). Cleanup expires this_turn / end_of_turn. Continuous duration
 *   'static' is not stamped (ReplacementEffectSpec owns that).
 * Public: tryApplyPreventLifeGainThisTurnGrant
 * Leaf must not import oracleIRExecutorMainLoop.ts or oracleIRExecutorBattlefieldStepHandlers.ts.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep, OraclePlayerSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerResolvePlayers';
import { parsePlayerSelector } from './oracleIRParserUtils';

const THIS_TURN_DURATIONS = new Set(['this_turn', 'end_of_turn']);

function isAlchemySourceName(name: unknown): boolean {
  return /^A-/i.test(String(name || '').trim());
}

function grantEffectText(step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>): string {
  return [
    ...(Array.isArray(step.effectText) ? step.effectText : []),
    ...(Array.isArray(step.abilities) ? step.abilities : []),
  ]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function playerSelectorFromGrantTarget(
  target: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>['target'],
): OraclePlayerSelector | null {
  const text = String((target as { text?: string; raw?: string } | undefined)?.text
    || (target as { raw?: string } | undefined)?.raw
    || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  if (!text) return null;
  const mapped =
    text === 'players' ? 'each player'
      : text === 'opponents' ? 'your opponents'
        : text;
  const selector = parsePlayerSelector(mapped);
  if (selector.kind === 'unknown') return null;
  return selector;
}

export function tryApplyPreventLifeGainThisTurnGrant(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  const duration = String(step.duration || 'static').trim();
  if (!THIS_TURN_DURATIONS.has(duration)) return null;

  const effectText = grantEffectText(step);
  if (!effectText.includes("can't gain life") && !effectText.includes('cannot gain life')) {
    return null;
  }

  const sourceName = String(ctx.sourceName || '').trim();
  if (isAlchemySourceName(sourceName)) {
    return {
      applied: true,
      state,
      log: [`Skipped Alchemy this-turn life-gain lock: ${step.raw}`],
    };
  }

  const selector = playerSelectorFromGrantTarget(step.target);
  if (!selector) return null;

  const playerIds = resolvePlayers(state, selector, ctx);
  const targetText = String((step.target as { text?: string } | undefined)?.text || '').trim();
  if (playerIds.length === 0 && /^target\b/i.test(targetText)) {
    return {
      applied: false,
      message: `Skipped this-turn life-gain lock (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (playerIds.length === 0) {
    return {
      applied: true,
      state,
      log: [`Skipped this-turn life-gain lock (no affected players): ${step.raw}`],
    };
  }

  const existing = Array.isArray(state.lastingEffects)
    ? [...state.lastingEffects]
    : [];
  const source = sourceName || 'This-turn lock';
  const nextEffects = [...existing];
  for (const playerId of playerIds) {
    const alreadyStamped = nextEffects.some((entry) => {
      const effect = entry as { type?: string; targetPlayer?: string };
      return effect?.type === 'preventLifeGain'
        && String(effect?.targetPlayer || '') === String(playerId);
    });
    if (alreadyStamped) continue;
    nextEffects.push({
      type: 'preventLifeGain',
      duration,
      targetPlayer: playerId,
      source,
    });
  }

  return {
    applied: true,
    state: {
      ...state,
      lastingEffects: nextEffects,
    },
    log: [`Stamped this-turn preventLifeGain for ${playerIds.join(', ')}`],
  };
}
