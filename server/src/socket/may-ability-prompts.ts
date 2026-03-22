import type { Server } from 'socket.io';

import type { PlayerID } from '../../../shared/src/types.js';
import { ResolutionQueueManager, ResolutionStepType } from '../state/resolution/index.js';
import { debug, debugError } from '../utils/debug.js';
import { getSavedMayAbilityTriggerDecision } from './trigger-shortcuts.js';

type PendingMayCallbackEntry = {
  onAccept: () => Promise<void>;
  onDecline?: () => Promise<void>;
};

const pendingMayCallbacks = new Map<string, Map<string, PendingMayCallbackEntry>>();

export function registerMayCallback(
  gameId: string,
  onAccept: () => Promise<void>,
  onDecline?: () => Promise<void>
): string {
  if (!pendingMayCallbacks.has(gameId)) {
    pendingMayCallbacks.set(gameId, new Map());
  }

  const id = `may_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingMayCallbacks.get(gameId)!.set(id, { onAccept, onDecline });
  return id;
}

export function consumeMayCallback(gameId: string, callbackId: string): PendingMayCallbackEntry | undefined {
  const gameCallbacks = pendingMayCallbacks.get(gameId);
  if (!gameCallbacks || !callbackId) {
    return undefined;
  }

  const entry = gameCallbacks.get(callbackId);
  if (!entry) {
    return undefined;
  }

  gameCallbacks.delete(callbackId);
  return entry;
}

export function clearMayCallback(gameId: string, callbackId: string): void {
  const gameCallbacks = pendingMayCallbacks.get(gameId);
  if (!gameCallbacks || !callbackId) {
    return;
  }
  gameCallbacks.delete(callbackId);
}

export function clearMayCallbacks(gameId: string): void {
  pendingMayCallbacks.delete(gameId);
}

export function queueMayAbilityStep(
  io: Server,
  gameId: string,
  game: any,
  playerId: string,
  sourceName: string,
  effectText: string,
  fullAbilityText: string | undefined,
  onAccept: () => Promise<void>,
  onDecline?: () => Promise<void>
): void {
  void io;

  const effectKey = `${sourceName.toLowerCase()}:${effectText.toLowerCase()}`;
  const prefs = (game.state as any)?.mayAutoPreferences ?? {};
  const playerPrefs = prefs[playerId] ?? {};
  const autoPref: 'yes' | 'no' | number | undefined = playerPrefs[effectKey];

  if (autoPref === 'yes') {
    debug(2, `[May] Auto-yes for ${effectKey} (player ${playerId})`);
    onAccept().catch(err => debugError(1, `[May] Auto-yes callback error:`, err));
    return;
  }

  if (autoPref === 'no') {
    debug(2, `[May] Auto-no for ${effectKey} (player ${playerId})`);
    onDecline?.().catch(err => debugError(1, `[May] Auto-no callback error:`, err));
    return;
  }

  if (typeof autoPref === 'number' && autoPref > 0) {
    const state = (game as any).state;
    const remaining = autoPref - 1;
    if (remaining <= 0) {
      delete state.mayAutoPreferences[playerId][effectKey];
    } else {
      state.mayAutoPreferences[playerId][effectKey] = remaining;
    }
    debug(2, `[May] Auto-yes countdown for ${effectKey} (player ${playerId}), ${remaining} remaining`);
    onAccept().catch(err => debugError(1, `[May] Auto-yes callback error:`, err));
    return;
  }

  const savedTriggerDecision = getSavedMayAbilityTriggerDecision((game as any)?.state, playerId, sourceName);
  if (savedTriggerDecision === 'yes') {
    debug(2, `[May] Trigger shortcut auto-yes for ${sourceName} (player ${playerId})`);
    onAccept().catch(err => debugError(1, `[May] Trigger shortcut auto-yes callback error:`, err));
    return;
  }

  if (savedTriggerDecision === 'no') {
    debug(2, `[May] Trigger shortcut auto-no for ${sourceName} (player ${playerId})`);
    onDecline?.().catch(err => debugError(1, `[May] Trigger shortcut auto-no callback error:`, err));
    return;
  }

  const callbackId = registerMayCallback(gameId, onAccept, onDecline);
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as PlayerID,
    description: `You may: ${effectText}`,
    mandatory: false,
    sourceId: undefined,
    sourceName,
    options: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    minSelections: 1,
    maxSelections: 1,
    mayAbilityPrompt: true,
    effectText,
    fullAbilityText,
    effectKey,
    pendingCallbackId: callbackId,
  } as any);

  debug(2, `[May] Queued option_choice MAY_ABILITY prompt for ${effectKey} (player ${playerId})`);
}