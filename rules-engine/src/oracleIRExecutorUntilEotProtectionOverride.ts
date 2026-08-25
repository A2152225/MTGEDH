/**
 * Origin parent: oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts
 * Cluster: until-EOT grant_static_ability lose / as-though hexproof-shroud
 *   stamps state.lastingEffects protectionKeywordOverride (Detection Tower /
 *   Arcane Lighthouse activations). Continuous statics stay StaticEffectSpec.
 * Public: tryApplyUntilEotProtectionOverrideGrant
 * Leaf must not import oracleIRExecutorMainLoop.ts.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';

const MARKER = 'until-eot-protection-override';
const THIS_TURN_DURATIONS = new Set(['this_turn', 'end_of_turn']);

function isAlchemySourceName(name: unknown): boolean {
  return /^A-/i.test(String(name || '').trim());
}

function grantEffectTokens(step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>): string[] {
  return [
    ...(Array.isArray(step.effectText) ? step.effectText : []),
    ...(Array.isArray(step.abilities) ? step.abilities : []),
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

export function tryApplyUntilEotProtectionOverrideGrant(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  const duration = String(step.duration || 'static').trim();
  if (!THIS_TURN_DURATIONS.has(duration)) return null;

  const tokens = grantEffectTokens(step);
  if (!tokens.some((token) => token.toLowerCase() === MARKER)) return null;

  const sourceName = String(ctx.sourceName || '').trim();
  if (isAlchemySourceName(sourceName)) {
    return {
      applied: true,
      state,
      log: [`Skipped Alchemy until-EOT protection override: ${step.raw}`],
    };
  }

  const modeToken = tokens.find((token) => (
    token === 'asThoughController'
    || token === 'asThoughAll'
    || token === 'remove'
  ));
  const abilities = tokens
    .filter((token) => token.startsWith('ability:'))
    .map((token) => token.slice('ability:'.length).trim().toLowerCase())
    .filter(Boolean);
  const scopes = tokens
    .filter((token) => token.startsWith('scope:'))
    .map((token) => token.slice('scope:'.length).trim())
    .filter(Boolean);
  if (!modeToken || abilities.length === 0 || scopes.length === 0) {
    return {
      applied: true,
      state,
      log: [`Skipped until-EOT protection override (incomplete grant): ${step.raw}`],
    };
  }

  const sourceController = String(ctx.controllerId || '').trim();
  if (!sourceController) {
    return {
      applied: true,
      state,
      log: [`Skipped until-EOT protection override (no controller): ${step.raw}`],
    };
  }

  const existing = Array.isArray((state as { lastingEffects?: unknown[] }).lastingEffects)
    ? [...((state as { lastingEffects: unknown[] }).lastingEffects)]
    : [];
  const alreadyStamped = existing.some((entry) => {
    const effect = entry as {
      type?: string;
      sourceController?: string;
      raw?: string;
    };
    return effect?.type === 'protectionKeywordOverride'
      && String(effect?.sourceController || '') === sourceController
      && String(effect?.raw || '') === String(step.raw || '');
  });
  if (alreadyStamped) {
    return {
      applied: true,
      state,
      log: [`Until-EOT protection override already stamped: ${step.raw}`],
    };
  }

  existing.push({
    type: 'protectionKeywordOverride',
    duration: 'end_of_turn',
    sourceController,
    mode: modeToken,
    abilities,
    scopes,
    source: sourceName || 'Until-EOT override',
    raw: step.raw,
  });

  return {
    applied: true,
    state: {
      ...(state as object),
      lastingEffects: existing,
    } as GameState,
    log: [`Stamped until-EOT protectionKeywordOverride (${modeToken}) for ${abilities.join(', ')}`],
  };
}
