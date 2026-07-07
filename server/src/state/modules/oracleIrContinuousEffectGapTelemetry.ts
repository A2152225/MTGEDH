/**
 * Phase 5 continuous-effect gap telemetry.
 *
 * Records `owned_but_unhandled` when a battlefield permanent has a compiled overlay
 * that cannot drive declarative static/replacement specs (fallback_to_bespoke,
 * validation failure, or empty STATIC/REPLACEMENT ability).
 *
 * Called from syncDerivedContinuousEffects (SBA). Fingerprints are deduped per process
 * so high-frequency recomputation does not flood the telemetry ring buffer.
 */

import { validateCompiledOverlayEnvelope } from '../../../../rules-engine/src/oracleIRCompilerEnvelope.js';
import { peekCompiledOracleIROverlayPayloadSync } from '../../services/oracleIrCompiledOverlayStore.js';
import {
  recordOracleIrGapTelemetry,
  resetOracleIrGapTelemetryLoggedFingerprints,
  type OracleIrGapTelemetryScope,
} from './oracleIrGapTelemetry.js';
import { extractOracleCardLookupKeys } from './oracleIrCompiledOverlayLookup.js';

const recordedFingerprints = new Set<string>();

export function resetContinuousEffectGapTelemetryForTests(): void {
  recordedFingerprints.clear();
  resetOracleIrGapTelemetryLoggedFingerprints();
}

function recordContinuousEffectGapOnce(input: {
  scope: OracleIrGapTelemetryScope;
  label: string;
  reasons: readonly string[];
  effectText?: string;
  gameId?: string;
}): void {
  const fingerprint = `${input.scope}|${input.label}|${input.reasons.join(';')}`;
  if (recordedFingerprints.has(fingerprint)) return;
  recordedFingerprints.add(fingerprint);
  recordOracleIrGapTelemetry({
    kind: 'owned_but_unhandled',
    scope: input.scope,
    label: input.label,
    reasons: input.reasons,
    effectText: input.effectText,
    gameId: input.gameId,
  });
}

function readAbilityDeclarativeCounts(ability: Record<string, unknown>): {
  staticCount: number;
  replacementCount: number;
  stepCount: number;
} {
  const staticSpecs = ability.static_specs ?? ability.staticSpecs;
  const replacementSpecs = ability.replacement_specs ?? ability.replacementSpecs;
  const steps = ability.steps;
  return {
    staticCount: Array.isArray(staticSpecs) ? staticSpecs.length : 0,
    replacementCount: Array.isArray(replacementSpecs) ? replacementSpecs.length : 0,
    stepCount: Array.isArray(steps) ? steps.length : 0,
  };
}

function analyzeOverlayPayloadGap(
  payload: string,
): { scope: OracleIrGapTelemetryScope; reasons: string[]; effectText?: string } | null {
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {
      scope: 'static',
      reasons: ['overlay_json_invalid'],
    };
  }

  if (envelope.fallback_to_bespoke === true) {
    return {
      scope: 'static',
      reasons: ['overlay_fallback_to_bespoke'],
      effectText: String(
        (envelope.abilities as Array<{ effect_text?: string }> | undefined)?.[0]?.effect_text || '',
      ).trim() || undefined,
    };
  }

  const abilities = Array.isArray(envelope.abilities) ? envelope.abilities : [];
  for (const ability of abilities) {
    if (!ability || typeof ability !== 'object') continue;
    const record = ability as Record<string, unknown>;
    const abilityType = String(record.ability_type || '').toUpperCase();
    const { staticCount, replacementCount, stepCount } = readAbilityDeclarativeCounts(record);
    const effectText = String(record.effect_text || '').trim() || undefined;

    if (abilityType === 'REPLACEMENT' && replacementCount === 0 && stepCount === 0) {
      return {
        scope: 'replacement',
        reasons: ['overlay_replacement_specs_empty'],
        effectText,
      };
    }
    if (abilityType === 'STATIC' && staticCount === 0 && replacementCount === 0 && stepCount === 0) {
      return {
        scope: 'static',
        reasons: ['overlay_static_specs_empty'],
        effectText,
      };
    }
  }

  const validation = validateCompiledOverlayEnvelope(envelope as any);
  if (!validation.ok) {
    const scope: OracleIrGapTelemetryScope = validation.errors.some((error) => /REPLACEMENT/i.test(error))
      ? 'replacement'
      : 'static';
    return {
      scope,
      reasons: ['overlay_validation_failed', ...validation.errors.slice(0, 2)],
    };
  }

  return null;
}

/** Scan battlefield overlays for undeclarative static/replacement gaps (Phase 5 soak signal). */
export function scanBattlefieldContinuousEffectOverlayGaps(state: unknown): void {
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  if (battlefield.length === 0) return;

  const gameId = String((state as { id?: string; gameId?: string })?.id
    || (state as { gameId?: string })?.gameId
    || '').trim() || undefined;

  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    if ((perm as { phasedOut?: boolean }).phasedOut === true) continue;

    const card = (perm as { card?: { name?: string } }).card;
    if (!card) continue;

    const label = String(card.name || (perm as { name?: string }).name || 'Unknown').trim();
    const lookupKeys = extractOracleCardLookupKeys({ card, effectiveCard: card });
    const payload = peekCompiledOracleIROverlayPayloadSync({
      cardId: lookupKeys.cardId,
      name: lookupKeys.cardName,
    });
    if (!payload) continue;

    const gap = analyzeOverlayPayloadGap(payload);
    if (!gap) continue;

    recordContinuousEffectGapOnce({
      scope: gap.scope,
      label,
      reasons: gap.reasons,
      effectText: gap.effectText,
      gameId,
    });
  }
}
