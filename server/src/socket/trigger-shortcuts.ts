import {
  SHORTCUT_ELIGIBLE_TRIGGERS,
  type TriggerShortcut,
  type TriggerShortcutType,
} from '../../../shared/src/index.js';

export type TriggerAutoPassReason = 'yielded_source' | 'saved_always_resolve';
export type SavedMayAbilityTriggerDecision = 'yes' | 'no';

function normalizeTriggerCardName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function getSavedTriggerShortcutPreference(
  gameState: any,
  playerId: unknown,
  cardName: unknown
): TriggerShortcutType | undefined {
  const normalizedPlayerId = String(playerId || '').trim();
  const normalizedCardName = normalizeTriggerCardName(cardName);
  if (!normalizedPlayerId || !normalizedCardName) {
    return undefined;
  }

  const shortcuts = gameState?.triggerShortcuts?.[normalizedPlayerId];
  if (!Array.isArray(shortcuts)) {
    return undefined;
  }

  const shortcut = shortcuts.find((entry: TriggerShortcut | undefined) =>
    normalizeTriggerCardName(entry?.cardName) === normalizedCardName
  );

  return shortcut?.preference;
}

export function shouldSuppressMandatoryTriggeredAbilityPrompt(
  gameState: any,
  playerId: unknown,
  cardName: unknown,
  mandatory: unknown
): boolean {
  if (mandatory === false) {
    return false;
  }

  const normalizedCardName = normalizeTriggerCardName(cardName);
  if (!normalizedCardName) {
    return false;
  }

  const eligible = SHORTCUT_ELIGIBLE_TRIGGERS[normalizedCardName];
  if (!eligible || eligible.type !== 'mandatory') {
    return false;
  }

  return getSavedTriggerShortcutPreference(gameState, playerId, normalizedCardName) === 'always_resolve';
}

export function getTopTriggeredAbilityAutoPassReason(
  gameState: any,
  playerId: unknown
): TriggerAutoPassReason | undefined {
  const normalizedPlayerId = String(playerId || '').trim();
  if (!normalizedPlayerId) {
    return undefined;
  }

  const stack = Array.isArray(gameState?.stack) ? gameState.stack : [];
  const topStackItem = stack[stack.length - 1];
  if (!topStackItem || topStackItem.type !== 'triggered_ability') {
    return undefined;
  }

  const sourceId = String(topStackItem.source || '').trim();
  const yieldedSource = gameState?.yieldToTriggerSourcesForAutoPass?.[normalizedPlayerId]?.[sourceId];
  if (yieldedSource?.enabled) {
    return 'yielded_source';
  }

  if (
    shouldSuppressMandatoryTriggeredAbilityPrompt(
      gameState,
      normalizedPlayerId,
      topStackItem.sourceName,
      topStackItem.mandatory
    )
  ) {
    return 'saved_always_resolve';
  }

  return undefined;
}

export function getSavedMayAbilityTriggerDecision(
  gameState: any,
  playerId: unknown,
  cardName: unknown
): SavedMayAbilityTriggerDecision | undefined {
  const normalizedCardName = normalizeTriggerCardName(cardName);
  if (!normalizedCardName) {
    return undefined;
  }

  const eligible = SHORTCUT_ELIGIBLE_TRIGGERS[normalizedCardName];
  if (!eligible || eligible.type !== 'may_ability') {
    return undefined;
  }

  const preference = getSavedTriggerShortcutPreference(gameState, playerId, normalizedCardName);
  if (preference === 'always_yes') {
    return 'yes';
  }
  if (preference === 'always_no') {
    return 'no';
  }

  return undefined;
}