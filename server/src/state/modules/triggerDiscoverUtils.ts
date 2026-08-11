/**
 * Emit "whenever you discover" triggers (e.g. Curator of Sun's Creation).
 * Discover itself is applied via Oracle IR impulse exile; this closes the emit gap.
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { uid } from '../utils.js';
import { timingTriggerEffect } from './triggers/timing-effect-extraction.js';
import {
  hasUnsupportedTargetRequirement,
  inferGenericTriggeredAbilityTargetMetadata,
} from './triggers/target-metadata.js';

function snapshotPermanent(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;
  return {
    ...permanent,
    ...(permanent.card && typeof permanent.card === 'object' ? { card: { ...permanent.card } } : null),
    ...(permanent.counters && typeof permanent.counters === 'object'
      ? { counters: { ...permanent.counters } }
      : null),
  };
}

function normalizeDiscoverEffect(effect: string, discoverValue: number): string {
  const trimmed = String(effect || '')
    .replace(/\s*This ability triggers only once each turn\.?/gi, '')
    .trim();
  if (/^discover again for the same value\.?$/i.test(trimmed)) {
    return `Discover ${discoverValue}`;
  }
  if (/discover again for the same value/i.test(trimmed)) {
    return trimmed.replace(/discover again for the same value/gi, `Discover ${discoverValue}`);
  }
  return trimmed;
}

/**
 * Queue discover triggers for the discovering player.
 * Returns stack items pushed.
 */
export function processDiscoverTriggers(
  ctx: GameContext,
  controllerId: PlayerID | string,
  discoverValue: number,
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const ctrl = String(controllerId || '').trim();
  const value = Math.max(0, Math.floor(Number(discoverValue) || 0));
  if (!ctrl || !Number.isFinite(value)) return [];

  const state = (ctx as any).state;
  if (!state) return [];
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  state.discoverTriggersFiredThisTurn = state.discoverTriggersFiredThisTurn || {};
  const queued: any[] = [];
  const gameId = String((ctx as any).gameId || '').trim();

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    if (String(permanent.controller || '') !== ctrl) continue;

    const oracleText = String(permanent.card?.oracle_text || '');
    const discoverMatch = oracleText.match(/whenever you discover,?\s*([^.]+)/i);
    if (!discoverMatch) continue;

    const oncePerTurn = /this ability triggers only once each turn/i.test(oracleText);
    const cardName = String(permanent.card?.name || 'Triggered ability');
    const firedKey = `${cardName.toLowerCase()}_${String(permanent.id || '')}`;
    if (oncePerTurn && state.discoverTriggersFiredThisTurn[firedKey]) continue;

    const rawEffect = timingTriggerEffect(oracleText, discoverMatch);
    const effect = normalizeDiscoverEffect(rawEffect, value);
    if (!effect) continue;
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (hasUnsupportedTargetRequirement(targetMetadata)) continue;

    if (oncePerTurn) {
      state.discoverTriggersFiredThisTurn[firedKey] = true;
    }

    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = snapshotPermanent(permanent);
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: ctrl,
      source: permanent.id,
      permanentId: permanent.id,
      sourceName: cardName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: 'discover',
      mandatory: !/^you may\b/i.test(effect),
      oncePerTurn: oncePerTurn || undefined,
      effectData: {
        discoverValue: value,
        discoveringPlayerId: ctrl,
      },
    };

    state.stack = Array.isArray(state.stack) ? state.stack : [];
    state.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: permanent.id,
          permanentId: permanent.id,
          sourceName: stackItem.sourceName,
          controllerId: ctrl,
          description: effect,
          triggerType: 'discover',
          effect,
          ...targetMetadata,
          mandatory: stackItem.mandatory,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[discoverTrigger] Failed to persist discover trigger:', err);
      }
    }
  }

  if (queued.length > 0) {
    try {
      (ctx as any).bumpSeq?.();
    } catch {
      // best-effort
    }
  }

  return queued;
}

/** Extract discover N from an applied impulse_exile_top step raw/amount when possible. */
export function extractDiscoverValueFromImpulseStep(step: any): number | null {
  if (!step || String(step.kind || '') !== 'impulse_exile_top') return null;
  const raw = String(step.raw || '');
  const rawMatch = raw.match(
    /until you exile a nonland card with mana value (\d+|x) or less/i,
  );
  if (rawMatch) {
    const token = String(rawMatch[1] || '').trim();
    if (/^\d+$/.test(token)) return Number(token);
  }
  const amount = step.amount;
  if (amount?.kind === 'until_nonland_mana_value_lte') {
    const n = Number(amount.value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return null;
}
