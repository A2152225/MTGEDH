/**
 * Resolution for round 67 effects that are queued with a linked object.
 * Origin parent: stackExecuteTriggerEffectPrefaceUtils.ts (preface, before Oracle IR).
 * Cluster: controllers-sacrifice-them, counter-that-ability-unless-pay, quest-counter-then-copy,
 *   you-may-copy-that-ability, reveal-tops-and-change-targets, additional-combat-after-this-phase.
 * Public: tryResolveRound67QueuedEffect, removeCounteredStackAbility, uniqueGreatestManaValuePlayer.
 */
import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';
import { appendEvent } from '../../../db/index.js';
import { ResolutionStepType } from '../../resolution/index.js';
import { queueResolveTopOfStackPrompt } from '../resolutionPromptEvents.js';
import { sacrificePermanent } from '../upkeep-triggers.js';
import { updateCounters } from '../counters_tokens.js';
import { addExtraCombat } from '../turn-handlers/turnScheduledStepsAndExtras.js';
import { cardManaValue } from '../../utils.js';
import { queueOptionalPaymentStep } from '../../../socket/optional-payment-prompts.js';
import { payManaCostWithAvailableSources } from '../../../socket/util.js';
import {
  appendCopyTriggeredAbilityResolveEvent,
  cloneStackItemForAbilityCopy,
  queueAbilityCopyRetargetPrompt,
} from '../triggerAbilityCopyUtils.js';
import { extractStackItemTargetIds } from './targeted.js';

function gameIdOf(ctx: GameContext): string {
  const gameId = String((ctx as any)?.gameId || '').trim();
  return gameId && gameId !== 'unknown' ? gameId : '';
}

function seqOf(ctx: GameContext): number {
  return Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx as any).state?.seq ?? 0);
}

function linkedStackItemId(item: any): string {
  return String(item?.triggeringStackItemId || item?.effectData?.triggeringStackItemId || '').trim();
}

function findStackItem(state: any, stackItemId: string): any | null {
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  return stack.find((entry: any) => entry && String(entry.id || '') === stackItemId) || null;
}

function libraryTopCard(state: any, ctx: GameContext, playerId: string): any | null {
  const fromZones = state?.zones?.[playerId]?.library;
  if (Array.isArray(fromZones) && fromZones.length > 0) return fromZones[0];
  const libraries = (ctx as any).libraries;
  if (libraries && typeof libraries.get === 'function') {
    const lib = libraries.get(playerId) || [];
    if (Array.isArray(lib) && lib.length > 0) return lib[0];
  }
  return null;
}

export function uniqueGreatestManaValuePlayer(
  rows: Array<{ playerId: string; manaValue: number }>,
): string | null {
  let best = -1;
  let winner: string | null = null;
  let tied = false;
  for (const row of rows) {
    const manaValue = Number(row.manaValue) || 0;
    if (winner == null || manaValue > best) {
      best = manaValue;
      winner = row.playerId;
      tied = false;
    } else if (manaValue === best) {
      tied = true;
    }
  }
  return tied ? null : winner;
}

function sacrificeListedPermanents(ctx: GameContext, ids: string[]): void {
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanentId of ids) {
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
    if (!permanent) continue;
    const playerId = String(permanent.controller || '');
    const sacrificed = sacrificePermanent(ctx, permanentId, playerId);
    if (!sacrificed) continue;
    const gameId = gameIdOf(ctx);
    if (!gameId || (ctx as any).isReplaying) continue;
    try {
      appendEvent(gameId, seqOf(ctx), 'sacrificePermanent', { playerId, permanentId });
    } catch {
      // the live sacrifice already happened
    }
  }
}

/** Drop a countered ability. Replay of counterStackObject removes it again if it is still there. */
export function removeCounteredStackAbility(ctx: GameContext, stackItemId: string): boolean {
  const id = String(stackItemId || '').trim();
  if (!id) return false;
  const state = (ctx as any).state;
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const index = stack.findIndex((entry: any) => entry && String(entry.id || '') === id);
  if (index < 0) return false;
  const [removed] = stack.splice(index, 1);
  const gameId = gameIdOf(ctx);
  if (gameId && !(ctx as any).isReplaying) {
    try {
      appendEvent(gameId, seqOf(ctx), 'counterStackObject', {
        stackItemId: id,
        wasSpell: false,
        destination: 'cease',
        ownerId: String(removed?.controller || ''),
      });
    } catch {
      // live removal already happened
    }
  }
  return true;
}

function offerCounterUnlessPay(ctx: GameContext, sourceName: string, item: any, manaCost: string): void {
  const causedId = linkedStackItemId(item);
  const caused = findStackItem((ctx as any).state, causedId);
  if (!caused) return;
  const payer = String(caused.controller || '') as PlayerID;
  const gameId = gameIdOf(ctx);
  if (!gameId || !payer) {
    return;
  }
  queueOptionalPaymentStep(gameId, {
    playerId: payer,
    sourceName,
    sourceId: String(item?.permanentId || item?.source || ''),
    description: `${sourceName}: Pay ${manaCost} or that ability is countered.`,
    mandatory: false,
    payChoiceId: 'pay',
    payLabel: `Pay ${manaCost}`,
    payDescription: 'The ability resolves.',
    declineChoiceId: 'decline',
    declineLabel: 'Decline',
    declineDescription: 'That ability is countered.',
    validationKind: 'mana',
    manaCost,
    stepData: { triggeringStackItemId: causedId, counterUnlessPay: true },
    onPay: async () => {
      payManaCostWithAvailableSources((ctx as any).state, payer, manaCost);
    },
    onDecline: async () => {
      removeCounteredStackAbility(ctx, causedId);
    },
  });
}

function offerOptionalCopy(ctx: GameContext, controller: PlayerID, sourceName: string, item: any, text: string): void {
  const causedId = linkedStackItemId(item);
  if (!causedId || !findStackItem((ctx as any).state, causedId)) return;
  const gameId = gameIdOf(ctx);
  if (!gameId) return;
  const allowsRetarget = /choose new targets for the copy/i.test(text);
  queueOptionalPaymentStep(gameId, {
    playerId: controller,
    sourceName,
    sourceId: String(item?.permanentId || item?.source || ''),
    description: `${sourceName}: You may copy that ability.`,
    mandatory: false,
    payChoiceId: 'copy',
    payLabel: 'Copy that ability',
    payDescription: 'Put a copy of that ability on the stack.',
    declineChoiceId: 'decline',
    declineLabel: "Don't copy",
    declineDescription: 'Do not copy that ability.',
    validationKind: 'none',
    stepData: { triggeringStackItemId: causedId, copyThatAbility: true },
    onPay: async () => {
      const copied = cloneStackItemForAbilityCopy(ctx, sourceName, controller, causedId, item);
      if (copied) {
        appendCopyTriggeredAbilityResolveEvent(ctx, {
          sourceId: String(item?.permanentId || item?.source || ''),
          sourceName,
          controllerId: String(controller),
          paid: true,
          triggerStackItemId: String(item?.id || ''),
          triggeringStackItemId: causedId,
          copiedStackItemId: String(copied.id || ''),
        });
      }
      if (copied && allowsRetarget) {
        const candidates = changeTargetCandidates((ctx as any).state, copied);
        if (candidates.length > 0) {
          copied.copyRetargetValidTargets = candidates;
          copied.copyRetargetMinTargets = Math.max(1, extractStackItemTargetIds(copied).length || 1);
          copied.copyRetargetMaxTargets = copied.copyRetargetMinTargets;
          copied.copyRetargetTargetDescription = 'target';
          queueAbilityCopyRetargetPrompt(ctx, sourceName, controller, copied);
        }
      }
    },
    onDecline: async () => {
      appendCopyTriggeredAbilityResolveEvent(ctx, {
        sourceId: String(item?.permanentId || item?.source || ''),
        sourceName,
        controllerId: String(controller),
        paid: false,
        triggerStackItemId: String(item?.id || ''),
        triggeringStackItemId: causedId,
      });
    },
  });
}

function changeTargetCandidates(state: any, stackItem: any): Array<{ id: string; name: string; kind: string }> {
  const ids = extractStackItemTargetIds(stackItem);
  const players = Array.isArray(state?.players) ? state.players : [];
  const playerIds = new Set(players.map((player: any) => String(player?.id || '')));
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const out: Array<{ id: string; name: string; kind: string }> = [];
  if (ids.some((id) => playerIds.has(id))) {
    for (const player of players) {
      const id = String(player?.id || '');
      if (!id) continue;
      out.push({ id, name: String(player?.name || id), kind: 'player' });
    }
  }
  const permanentIds = ids.filter((id) => !playerIds.has(id));
  if (permanentIds.length > 0) {
    const sample = battlefield.find((perm: any) => permanentIds.includes(String(perm?.id || '')));
    const wantCreature = /\bcreature\b/i.test(String(sample?.card?.type_line || ''));
    for (const perm of battlefield) {
      if (!perm?.id) continue;
      if (wantCreature && !/\bcreature\b/i.test(String(perm?.card?.type_line || ''))) continue;
      out.push({ id: String(perm.id), name: String(perm?.card?.name || perm.id), kind: 'permanent' });
    }
  }
  return out;
}

function offerChangeTargets(ctx: GameContext, sourceName: string, item: any): void {
  const state = (ctx as any).state;
  const players = Array.isArray(state?.players) ? state.players : [];
  const rows = players.map((player: any) => {
    const playerId = String(player?.id || '');
    const card = libraryTopCard(state, ctx, playerId);
    return card ? { playerId, name: String(card.name || 'a card'), manaValue: cardManaValue(card) } : null;
  }).filter(Boolean) as Array<{ playerId: string; name: string; manaValue: number }>;
  const winnerId = uniqueGreatestManaValuePlayer(rows);
  const caused = findStackItem(state, linkedStackItemId(item));
  const gameId = gameIdOf(ctx);
  if (!winnerId || !caused || !gameId) return;
  const candidates = changeTargetCandidates(state, caused);
  if (candidates.length === 0) return;
  const revealed = rows.map((row) => `${row.playerId} revealed ${row.name} (mana value ${row.manaValue})`).join('; ');
  const currentCount = Math.max(1, extractStackItemTargetIds(caused).length || 1);
  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: winnerId as PlayerID,
    description: `${sourceName}: ${revealed}. You may change the target or targets.`,
    mandatory: false,
    sourceId: String(caused.id || ''),
    sourceName,
    options: [
      { id: 'keep', label: 'Leave the targets unchanged' },
      { id: 'retarget', label: 'Change the targets' },
    ],
    minSelections: 1,
    maxSelections: 1,
    retargetAbilityCopy: true,
    retargetAbilityCopyStackItemId: String(caused.id || ''),
    retargetAbilityCopyValidTargets: candidates,
    retargetAbilityCopyTargetTypes: ['spell_target'],
    retargetAbilityCopyMinTargets: currentCount,
    retargetAbilityCopyMaxTargets: currentCount,
    retargetAbilityCopyTargetDescription: 'target',
    suppressChoosesTargets: true,
  } as any);
}

function questCount(permanent: any): number {
  const counters = permanent?.counters;
  if (counters && typeof counters === 'object') {
    for (const [key, value] of Object.entries(counters)) {
      if (key.toLowerCase() === 'quest') return Number(value) || 0;
    }
  }
  return 0;
}

/**
 * Resolve a round-67 effect that already carries its linked objects.
 * Returns true when this effect is owned here, so Oracle IR does not also apply it.
 */
export function tryResolveRound67QueuedEffect(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any,
): boolean {
  if ((ctx as any)?.isReplaying) return false;
  const text = String(description || triggerItem?.effect || '').trim();
  if (!text) return false;

  if (/^their controllers sacrifice them\.?$/i.test(text)) {
    const ids = Array.isArray(triggerItem?.effectData?.sacrificePermanentIds)
      ? triggerItem.effectData.sacrificePermanentIds.map((id: any) => String(id)).filter(Boolean)
      : [];
    sacrificeListedPermanents(ctx, ids);
    return true;
  }

  const unlessPay = text.match(/^counter that ability unless its controller pays (\{[^}]+\})\.?$/i);
  if (unlessPay) {
    offerCounterUnlessPay(ctx, sourceName, triggerItem, String(unlessPay[1] || '{2}'));
    return true;
  }

  if (/^put a quest counter on this (?:enchantment|permanent)\b/i.test(text)) {
    const permanentId = String(triggerItem?.permanentId || triggerItem?.source || '');
    if (permanentId) {
      updateCounters(ctx, permanentId, { quest: 1 }, { deferRunSBA: true });
    }
    const permanent = (Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [])
      .find((entry: any) => String(entry?.id || '') === permanentId);
    if (questCount(permanent) >= 4 && /you may copy that ability/i.test(text)) {
      offerOptionalCopy(ctx, controller, sourceName, triggerItem, text);
    }
    return true;
  }

  if (/^you may copy that ability\b/i.test(text)) {
    offerOptionalCopy(ctx, controller, sourceName, triggerItem, text);
    return true;
  }

  if (/^each player reveals the top card of their library\b/i.test(text)) {
    offerChangeTargets(ctx, sourceName, triggerItem);
    return true;
  }

  if (/^after this phase, there is an additional combat phase\.?$/i.test(text)) {
    addExtraCombat(ctx, sourceName, false);
    return true;
  }

  return false;
}
