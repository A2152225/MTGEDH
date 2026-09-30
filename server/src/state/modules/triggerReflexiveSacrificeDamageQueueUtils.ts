// server/src/state/modules/triggerReflexiveSacrificeDamageQueueUtils.ts
// Surtland Flinger shape: "you may sacrifice another creature. When you do, this creature deals damage
// equal to the sacrificed creature's power to any target."
// The Oracle IR executor marks the reflexive "When you do" clause as queued (CR 603.12) but the damage needs
// (a) the sacrifice's last-known snapshot and (b) a player-chosen "any target". The server therefore puts a
// real reflexive triggered ability on the stack that carries the snapshot and the target metadata, so the
// normal targeted-trigger prompt asks the player for the target and the IR trigger resolver deals the damage.

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { uid } from '../utils.js';
import { buildTriggerSourcePermanentSnapshot, getTriggerSourcePermanent } from './triggerSourceUtils.js';
import { inferTriggeredAbilityTargetMetadata } from './inferTriggeredAbilityTargetMetadata.js';

type ReflexiveStepLike = { kind?: string; timing?: string; raw?: string; effect?: string; steps?: readonly { raw?: string }[] };

export function isReflexiveSacrificedCreatureDamageText(text: string): boolean {
  const normalized = String(text || '');
  return /\bwhen you do(?: so)?\b/i.test(normalized)
    && /\bdeals?\b[^.]*\bdamage\b[^.]*\bsacrificed (?:creature|permanent)'?s? power\b/i.test(normalized);
}

export function queueOracleIrReflexiveSacrificeDamageFollowups(
  ctx: GameContext,
  state: any,
  result: {
    readonly appliedSteps?: readonly ReflexiveStepLike[];
    readonly lastSacrificedPermanents?: readonly any[];
  },
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    triggerItem?: any;
  },
): void {
  if ((ctx as any).isReplaying) return;
  const snapshots = Array.isArray(result.lastSacrificedPermanents) ? result.lastSacrificedPermanents : [];
  if (snapshots.length === 0) return;
  const delayedSteps = (result.appliedSteps || []).filter((step) =>
    String(step?.kind || '') === 'schedule_delayed_trigger'
    && String(step?.timing || '').trim() === 'on_event'
    && isReflexiveSacrificedCreatureDamageText(`${step.raw || ''} ${step.effect || ''}`),
  );
  if (delayedSteps.length === 0) return;

  const controller = String(params.controller || '').trim();
  if (!controller) return;
  const sourceName = String(params.sourceName || params.triggerItem?.sourceName || 'Reflexive trigger').trim() || 'Reflexive trigger';
  const sourceId = String(params.sourceId || params.triggerItem?.source || params.triggerItem?.permanentId || '').trim();
  const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(
    getTriggerSourcePermanent(state, params.triggerItem || { source: sourceId, permanentId: sourceId }),
  );

  for (const step of delayedSteps) {
    const full = String(step.effect || step.raw || '').trim();
    const head = full.replace(/^.*?\bwhen you do(?: so)?,?\s*/i, '').trim();
    if (!head) continue;
    // "If the sacrificed creature was a Giant, ... twice that much damage instead" is a nested sub-step of the
    // delayed trigger; keep it in the follow-up text so the resolver applies the doubling.
    const tail = (Array.isArray(step.steps) ? step.steps : [])
      .map((sub) => String(sub?.raw || '').trim())
      .filter(Boolean)
      .join('. ');
    const followup = tail && !head.includes(tail) ? `${head.replace(/[.\s]+$/, '')}. ${tail}` : head;
    const targetMetadata = inferTriggeredAbilityTargetMetadata(followup);
    const triggerId = uid('trigger');
    const lastSacrificedPermanents = snapshots.map((entry: any) => ({ ...entry }));
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller,
      source: sourceId || null,
      ...(sourceId ? { permanentId: sourceId } : {}),
      sourceName,
      description: followup,
      effect: followup,
      triggerType: 'reflexive_when_you_do',
      mandatory: true,
      ...targetMetadata,
      sourcePermanentSnapshot,
      lastSacrificedPermanents,
      card: sourcePermanentSnapshot?.card || params.triggerItem?.card,
    } as any;

    state.stack = Array.isArray(state.stack) ? state.stack : [];
    state.stack.push(stackItem);

    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? state.seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: sourceId || null,
          ...(sourceId ? { permanentId: sourceId } : {}),
          sourceName,
          controllerId: controller,
          description: followup,
          effect: followup,
          triggerType: 'reflexive_when_you_do',
          mandatory: true,
          ...targetMetadata,
          sourcePermanentSnapshot,
          card: stackItem.card,
          lastSacrificedPermanents,
        });
      } catch (err) {
        debugWarn(1, `[oracle-ir] appendEvent(pushTriggeredAbility reflexive sacrifice damage) failed for ${sourceName}:`, err);
      }
    }
    debug(2, `[oracle-ir] Queued reflexive sacrifice-damage follow-up for ${sourceName}`);
  }
}