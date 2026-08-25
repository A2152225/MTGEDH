import type { ClientGameView } from '../../../shared/src';

import {
  LOOP_SHORTCUT_DRAFTS_STORAGE_KEY,
  LOOP_SHORTCUT_MAX_ITERATIONS,
  LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS,
  LOOP_SHORTCUT_SAVED_STORAGE_KEY,
  LITERAL_PRIMITIVE_STEP_TYPES,
  MANA_COLOR_NAME_RE,
  PAYMENT_OBJECT_KNOWN_KEYS,
  clampLoopShortcutIterations,
} from './loopShortcuts-handlers/loopShortcutsTypes';
import type {
  JsonValue,
  LoopShortcutDraft,
  LoopShortcutIdTemplate,
  LoopShortcutPaymentItemTemplate,
  LoopShortcutPromptFingerprint,
  LoopShortcutPromptTemplate,
  LoopShortcutSequenceItem,
  LoopShortcutTargetMatchProfile,
  SavedLoopShortcut,
  StorageLike,
} from './loopShortcuts-handlers/loopShortcutsTypes';
import { clonePayload, normalizeText } from './loopShortcuts-handlers/loopShortcutsTextUtils';
import {
  buildTargetMatchProfile,
  isControlledBy,
  isExplicitNonTokenPermanent,
  isTokenPermanent,
} from './loopShortcuts-handlers/loopShortcutsTargetMatchUtils';

export {
  LOOP_SHORTCUT_MAX_ITERATIONS,
  LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS,
  clampLoopShortcutIterations,
};
export type {
  LoopShortcutDraft,
  LoopShortcutPaymentItemTemplate,
  LoopShortcutPromptFingerprint,
  LoopShortcutPromptTemplate,
  LoopShortcutSequenceItem,
  LoopShortcutTargetMatchProfile,
  SavedLoopShortcut,
};



function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJsonRecord(storage: StorageLike, key: string): Record<string, unknown> {
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonRecord(storage: StorageLike, key: string, value: Record<string, unknown>): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
}

function parseLoopShortcutDraft(raw: unknown): LoopShortcutDraft | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.items)) {
    return null;
  }

  return {
    name: String(raw.name || 'Loop Shortcut').trim() || 'Loop Shortcut',
    items: clonePayload(raw.items) as LoopShortcutSequenceItem[],
    iterationCount: clampLoopShortcutIterations(raw.iterationCount),
    updatedAt: Number(raw.updatedAt || Date.now()),
  };
}

function parseSavedLoopShortcut(raw: unknown): SavedLoopShortcut | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const draft = parseLoopShortcutDraft(raw);
  if (!draft) {
    return null;
  }

  const id = String(raw.id || '').trim();
  if (!id) {
    return null;
  }

  return {
    id,
    ...draft,
  };
}

function getSelectionIds(selections: unknown): string[] {
  if (Array.isArray(selections)) {
    return selections.map(value => String(value)).filter(Boolean);
  }

  if (typeof selections === 'string' && selections.trim()) {
    return [selections.trim()];
  }

  return [];
}

function getObjectTargetIds(selections: unknown): string[] {
  if (!isPlainObject(selections)) {
    return [];
  }

  if (Array.isArray(selections.targetIds)) {
    return selections.targetIds.map(value => String(value)).filter(Boolean);
  }

  if (typeof selections.targetId === 'string' && selections.targetId.trim()) {
    return [selections.targetId.trim()];
  }

  return [];
}

function describePrompt(step: any): string {
  const sourceName = String(step?.sourceName || step?.cardName || 'Prompt').trim();
  const description = String(step?.description || '').trim();
  if (!description) return sourceName;
  return `${sourceName}: ${description}`;
}

function formatManaColorLabel(color: string): string {
  const key = normalizeText(color);
  const labels: Record<string, string> = {
    white: 'White',
    blue: 'Blue',
    black: 'Black',
    red: 'Red',
    green: 'Green',
    colorless: 'Colorless',
    w: 'White',
    u: 'Blue',
    b: 'Black',
    r: 'Red',
    g: 'Green',
    c: 'Colorless',
  };
  return labels[key] || color;
}

function formatAlternateCostLabel(alternateCostId: string | undefined): string | null {
  const id = String(alternateCostId || '').trim();
  if (!id || normalizeText(id) === 'normal') return null;
  return id;
}

function describePaymentSelectionLabel(
  step: any,
  payment: LoopShortcutPaymentItemTemplate[],
  alternateCostId?: string,
): string {
  const base = describePrompt(step);
  const parts: string[] = [];
  const altLabel = formatAlternateCostLabel(alternateCostId);
  if (altLabel) parts.push(`alternateCostId=${altLabel}`);

  if (payment.length === 0) {
    parts.push('no mana paid');
  } else {
    const summary = payment
      .map((item) => {
        const color = formatManaColorLabel(String(item.mana || ''));
        const name = item.permanentProfile?.name || item.permanentId || 'source';
        const count = Math.max(1, Number(item.count || 1));
        return count > 1 ? `${count}× ${color} from ${name}` : `${color} from ${name}`;
      })
      .join(', ');
    parts.push(summary);
  }

  return `${base} → ${parts.join('; ')}`;
}

function describeSelectionLabel(step: any, selections: unknown): string {
  const base = describePrompt(step);
  const stepType = normalizeText(step?.type);

  if (typeof selections === 'string' && selections.trim()) {
    if (stepType === 'mana_color_selection' || stepType === 'color_choice' || MANA_COLOR_NAME_RE.test(selections)) {
      return `${base} → ${formatManaColorLabel(selections.trim())}`;
    }
    if (stepType === 'card_name_choice' || stepType === 'creature_type_choice') {
      return `${base} → ${selections.trim()}`;
    }
  }

  if (typeof selections === 'number' && Number.isFinite(selections)) {
    return `${base} → ${selections}`;
  }

  if (typeof selections === 'boolean') {
    return `${base} → ${selections ? 'yes' : 'no'}`;
  }

  return base;
}

function isLiteralPrimitiveSelection(step: any, selections: unknown): boolean {
  const stepType = normalizeText(step?.type);
  if (LITERAL_PRIMITIVE_STEP_TYPES.has(stepType)) {
    return (
      typeof selections === 'string'
      || typeof selections === 'number'
      || typeof selections === 'boolean'
    );
  }

  if (typeof selections === 'number' || typeof selections === 'boolean') {
    return true;
  }

  if (typeof selections === 'string' && MANA_COLOR_NAME_RE.test(selections.trim())) {
    return true;
  }

  return false;
}

function isManaPaymentSelectionObject(step: any, selections: unknown): boolean {
  if (!isPlainObject(selections)) return false;
  const stepType = normalizeText(step?.type);
  if (stepType === 'mana_payment_choice' || stepType === 'extort_payment' || stepType === 'additional_cost_payment') {
    return true;
  }
  // Payment-shaped objects from cast confirm even if step type is missing in older drafts.
  return Array.isArray((selections as any).payment)
    || typeof (selections as any).alternateCostId === 'string'
    || Array.isArray((selections as any).convokeTappedCreatures);
}

function extractTargetIds(step: any, selections: unknown): string[] {
  const ids = getSelectionIds(selections);
  if (ids.length > 0) return ids;

  const objectTargetIds = getObjectTargetIds(selections);
  if (objectTargetIds.length > 0) return objectTargetIds;

  if (step?.type === 'player_choice' && selections && typeof selections === 'object') {
    const playerId = (selections as any).playerId;
    if (typeof playerId === 'string' && playerId.trim()) return [playerId.trim()];
  }

  return [];
}

function buildPromptFingerprint(step: any): LoopShortcutPromptFingerprint {
  return {
    stepType: String(step?.type || ''),
    sourceName: String(step?.sourceName || step?.cardName || '').trim() || undefined,
  };
}

function isPlayerTargetStep(step: any, selectedIds: string[]): boolean {
  if (step?.type === 'player_choice') return selectedIds.length > 0;

  const validTargets = Array.isArray(step?.validTargets) ? step.validTargets : [];
  if (validTargets.length === 0 || selectedIds.length === 0) return false;

  return selectedIds.every((selectedId: string) => {
    const target = validTargets.find((entry: any) => String(entry?.id || '') === selectedId);
    return normalizeText(target?.type) === 'player' || normalizeText(target?.description) === 'player';
  });
}

function shouldUseDynamicTargetSelection(step: any): boolean {
  const description = normalizeText(step?.description);
  return Boolean(
    step?.type === 'tap_untap_target' ||
    step?.tapCreaturesCost === true ||
      typeof step?.requiredCount === 'number' ||
      /sacrifice|tap .*untapped|choose target\(s\)|target selection/.test(description)
  );
}

function buildIdTemplate(
  step: any,
  selectedIds: string[],
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined
): LoopShortcutIdTemplate {
  if (shouldUseDynamicTargetSelection(step)) {
    const matchProfiles = selectedIds.map((id) => buildTargetMatchProfile(step, view, id));
    const selectedTokens = selectedIds.filter((id) => isTokenPermanent(view, id, step));
    const selectedExplicitNonTokens = selectedIds.filter((id) => isExplicitNonTokenPermanent(view, id, step));
    const allSelfControlled = selectedIds.every((id) => isControlledBy(view, id, playerId, step));
    const tappedFlags = matchProfiles
      .map((profile) => profile.tapped)
      .filter((value): value is boolean => typeof value === 'boolean');
    const allTapped = tappedFlags.length === selectedIds.length && tappedFlags.every(Boolean);
    const allUntapped = tappedFlags.length === selectedIds.length && tappedFlags.every((value) => value === false);
    const allNonCommanders = matchProfiles.every((profile) => profile.isCommander !== true);

    return {
      kind: 'select_valid_targets',
      count: selectedIds.length,
      preferTokens: selectedTokens.length === selectedIds.length && selectedIds.length > 0,
      // Only when every selected permanent is known nontoken — never when token status is unknown
      // (unknown used to falsely set preferNonTokens and steer Ashnod's Altar onto the commander).
      preferNonTokens: selectedExplicitNonTokens.length === selectedIds.length && selectedIds.length > 0,
      requireSelfControlled: allSelfControlled,
      preferTapped: allTapped,
      preferUntapped: allUntapped,
      avoidCommanders: allNonCommanders && selectedIds.length > 0,
      matchProfiles,
    };
  }

  return {
    kind: 'specific_ids',
    ids: selectedIds,
  };
}

function buildPaymentItemTemplate(
  step: any,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined,
  raw: unknown
): LoopShortcutPaymentItemTemplate | null {
  if (!isPlainObject(raw)) return null;
  const mana = String(raw.mana || '').trim();
  if (!mana) return null;

  const permanentId = String(raw.permanentId || '').trim();
  const permanentProfile = permanentId
    ? buildTargetMatchProfile(step, view, permanentId)
    : undefined;

  const sacrificedIds = Array.isArray(raw.sacrificedPermanentIds)
    ? raw.sacrificedPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  const sacrificedProfiles = sacrificedIds.map((id) => buildTargetMatchProfile(step, view, id));

  const item: LoopShortcutPaymentItemTemplate = {
    mana,
    ...(permanentId ? { permanentId } : {}),
    ...(permanentProfile && Object.keys(permanentProfile).length > 0 ? { permanentProfile } : {}),
  };

  if (typeof raw.abilityId === 'string' && raw.abilityId.trim()) {
    item.abilityId = raw.abilityId.trim();
  }
  if (typeof raw.paymentSourceId === 'string' && raw.paymentSourceId.trim()) {
    item.paymentSourceId = raw.paymentSourceId.trim();
  }
  if (Number.isFinite(Number(raw.count)) && Number(raw.count) > 0) {
    item.count = Number(raw.count);
  }
  if (Array.isArray(raw.producedColors) && raw.producedColors.length > 0) {
    item.producedColors = raw.producedColors.map((c: unknown) => String(c));
  }
  if (raw.fromRestrictedPool === true) {
    item.fromRestrictedPool = true;
  }
  if (Number.isFinite(Number(raw.restrictedIndex))) {
    item.restrictedIndex = Number(raw.restrictedIndex);
  }
  if (sacrificedProfiles.length > 0) {
    item.sacrificedProfiles = sacrificedProfiles;
  } else if (sacrificedIds.length > 0) {
    item.sacrificedPermanentIds = sacrificedIds;
  }

  return item;
}

function createPaymentSelectionTemplate(
  step: any,
  selections: Record<string, unknown>,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined
): Extract<LoopShortcutPromptTemplate, { kind: 'payment_selection' }> {
  const paymentRaw = Array.isArray(selections.payment) ? selections.payment : [];
  const payment = paymentRaw
    .map((entry) => buildPaymentItemTemplate(step, view, playerId, entry))
    .filter((entry): entry is LoopShortcutPaymentItemTemplate => Boolean(entry));

  const alternateCostId = typeof selections.alternateCostId === 'string'
    && selections.alternateCostId.trim()
    && normalizeText(selections.alternateCostId) !== 'normal'
    ? selections.alternateCostId.trim()
    : undefined;

  const xValue = Number.isFinite(Number(selections.xValue))
    ? Number(selections.xValue)
    : undefined;

  const convokeIds = Array.isArray(selections.convokeTappedCreatures)
    ? selections.convokeTappedCreatures.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  const convokeCreatureProfiles = convokeIds.length > 0
    ? convokeIds.map((id) => buildTargetMatchProfile(step, view, id))
    : undefined;

  const sneakId = typeof selections.sneakReturnedCreatureId === 'string'
    ? selections.sneakReturnedCreatureId.trim()
    : '';
  const sneakCreatureProfile = sneakId
    ? buildTargetMatchProfile(step, view, sneakId)
    : undefined;

  const otherLiteralFields: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(selections)) {
    if (PAYMENT_OBJECT_KNOWN_KEYS.has(key)) continue;
    otherLiteralFields[key] = clonePayload(value) as JsonValue;
  }

  return {
    kind: 'payment_selection',
    ...(alternateCostId ? { alternateCostId } : {}),
    ...(typeof xValue === 'number' ? { xValue } : {}),
    payment,
    ...(convokeCreatureProfiles ? { convokeCreatureProfiles } : {}),
    ...(sneakCreatureProfile ? { sneakCreatureProfile } : {}),
    ...(Object.keys(otherLiteralFields).length > 0 ? { otherLiteralFields } : {}),
  };
}

export function createRecordedEmitItem(
  event: string,
  payload: Record<string, unknown>,
  gameId: string
): LoopShortcutSequenceItem {
  const clonedPayload = clonePayload(payload || {});
  (clonedPayload as any).gameId = gameId;

  return {
    kind: 'emit',
    event,
    payload: clonedPayload,
    label: `${event}${(payload as any)?.abilityId ? ` ${(payload as any).abilityId}` : ''}`.trim(),
  };
}

/** Priority passes with an empty stack advance the turn; loops must not replay them. */
export function isLoopShortcutPhaseAdvanceEmit(item: LoopShortcutSequenceItem | null | undefined): boolean {
  return item?.kind === 'emit' && normalizeText(item.event) === 'passpriority';
}

export function sanitizeLoopShortcutItems(items: LoopShortcutSequenceItem[]): {
  items: LoopShortcutSequenceItem[];
  removedPassPriorityCount: number;
} {
  const next: LoopShortcutSequenceItem[] = [];
  let removedPassPriorityCount = 0;
  for (const item of items || []) {
    if (isLoopShortcutPhaseAdvanceEmit(item)) {
      removedPassPriorityCount += 1;
      continue;
    }
    next.push(item);
  }
  return { items: next, removedPassPriorityCount };
}

export function createRecordedResolutionResponseItem(
  step: any,
  selections: unknown,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined
): LoopShortcutSequenceItem | null {
  const fingerprint = buildPromptFingerprint(step);

  if (isLiteralPrimitiveSelection(step, selections)) {
    return {
      kind: 'resolution_response',
      fingerprint,
      template: {
        kind: 'literal_selection',
        selection: clonePayload(selections) as JsonValue,
      },
      label: describeSelectionLabel(step, selections),
    };
  }

  if (step?.type === 'option_choice' || step?.type === 'modal_choice') {
    const optionIds = getSelectionIds(selections);
    if (optionIds.length === 0) return null;

    return {
      kind: 'resolution_response',
      fingerprint,
      template: {
        kind: 'option_choice',
        optionIds,
      },
      label: describePrompt(step),
    };
  }

  if (isManaPaymentSelectionObject(step, selections) && isPlainObject(selections)) {
    const template = createPaymentSelectionTemplate(step, selections, view, playerId);
    return {
      kind: 'resolution_response',
      fingerprint,
      template,
      label: describePaymentSelectionLabel(step, template.payment, template.alternateCostId),
    };
  }

  if (isPlainObject(selections)) {
    const targetIds = getObjectTargetIds(selections);
    if (targetIds.length > 0) {
      const literalFields: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(selections)) {
        if (key === 'targetId' || key === 'targetIds') continue;
        literalFields[key] = clonePayload(value) as JsonValue;
      }

      return {
        kind: 'resolution_response',
        fingerprint,
        template: {
          kind: 'selection_object',
          literalFields,
          ...(Array.isArray((selections as any).targetIds)
            ? { targetIds: buildIdTemplate(step, targetIds, view, playerId) }
            : { targetId: buildIdTemplate(step, targetIds, view, playerId) }),
        },
        label: describePrompt(step),
      };
    }

    return {
      kind: 'resolution_response',
      fingerprint,
      template: {
        kind: 'literal_selection',
        selection: clonePayload(selections) as JsonValue,
      },
      label: describeSelectionLabel(step, selections),
    };
  }

  const selectedIds = extractTargetIds(step, selections);
  if (selectedIds.length === 0) {
    return null;
  }

  if (isPlayerTargetStep(step, selectedIds)) {
    return {
      kind: 'resolution_response',
      fingerprint,
      template: {
        kind: 'specific_ids',
        ids: selectedIds,
      },
      label: describePrompt(step),
    };
  }

  return {
    kind: 'resolution_response',
    fingerprint,
    template: buildIdTemplate(step, selectedIds, view, playerId),
    label: describePrompt(step),
  };
}

export function matchesPromptFingerprint(fingerprint: LoopShortcutPromptFingerprint, step: any): boolean {
  if (normalizeText(fingerprint.stepType) !== normalizeText(step?.type)) {
    return false;
  }

  if (fingerprint.sourceName && normalizeText(fingerprint.sourceName) !== normalizeText(step?.sourceName || step?.cardName)) {
    return false;
  }

  return true;
}

export type LoopShortcutCastSettleState = {
  cardId: string;
  sawNonEmptyStack: boolean;
  startedAt: number;
};

/**
 * After an emit or auto-answered prompt, wait for a quiet board before the next
 * emit: no pending resolution choices for the player, and an empty stack.
 * Prevents Summon-the-School-style loops from firing the next graveyard
 * activation while Aura Shards (etc.) are still resolving, or while a paid
 * spell is still being pushed onto the stack (empty queue ≠ cast finished).
 */
export function canAdvanceLoopShortcutAfterState(options: {
  view: ClientGameView | null | undefined;
  myPendingResolutionCount?: number;
  hasActiveResolutionPrompt?: boolean;
  waitingForCastCardId?: string | null;
  playerId?: string | null;
  castSettle?: LoopShortcutCastSettleState | null;
  /** Max ms to wait for the post-cast stack to appear before allowing advance. */
  castSettleTimeoutMs?: number;
}): boolean {
  const stack = Array.isArray(options.view?.stack) ? options.view!.stack : [];
  if (stack.length > 0) return false;
  if (Number(options.myPendingResolutionCount || 0) > 0) return false;
  if (options.hasActiveResolutionPrompt) return false;

  const waitingCardId = String(options.waitingForCastCardId || '').trim();
  const playerId = String(options.playerId || '').trim();
  if (waitingCardId) {
    const hand = playerId && Array.isArray(options.view?.zones?.[playerId]?.hand)
      ? options.view!.zones![playerId].hand
      : [];
    const stillInHand = hand.some((card: any) => String(card?.id || '') === waitingCardId);
    // Payment answered but cast applyEvent has not moved the card out of hand yet.
    if (stillInHand) return false;
  }

  // After a paid cast, the client can briefly see hand empty + stack empty before
  // the spell (and Reflections copy) lands. Do not advance into the next emit yet.
  const castSettle = options.castSettle;
  if (castSettle && !castSettle.sawNonEmptyStack) {
    const timeoutMs = Math.max(0, Number(options.castSettleTimeoutMs ?? 1200));
    const elapsed = Date.now() - Number(castSettle.startedAt || 0);
    if (elapsed < timeoutMs) return false;
  }

  return true;
}

/**
 * While a loop is running, pass priority only when something is on the stack.
 * Never pass on an empty stack (that advances the phase).
 * Smart Pass / idle auto-pass often will not drain the stack mid-loop because
 * casting clears autoPassForTurn and floating mana keeps the player "busy".
 */
export function shouldLoopShortcutAutoPassPriority(options: {
  view: ClientGameView | null | undefined;
  playerId?: string | null;
  /** Prefer the live socket `priority` field when view.priority is stale. */
  priorityPlayerId?: string | null;
  myPendingResolutionCount?: number;
  hasActiveResolutionPrompt?: boolean;
  waitingForCastCardId?: string | null;
}): boolean {
  const playerId = String(options.playerId || '').trim();
  if (!options.view || !playerId) return false;
  if (Number(options.myPendingResolutionCount || 0) > 0) return false;
  if (options.hasActiveResolutionPrompt) return false;

  const waitingCardId = String(options.waitingForCastCardId || '').trim();
  if (waitingCardId) {
    const hand = Array.isArray(options.view?.zones?.[playerId]?.hand)
      ? options.view!.zones![playerId].hand
      : [];
    if (hand.some((card: any) => String(card?.id || '') === waitingCardId)) {
      return false;
    }
  }

  const stack = Array.isArray(options.view.stack) ? options.view.stack : [];
  if (stack.length === 0) return false;

  const priorityHolder = String(
    options.priorityPlayerId
    || options.view.priority
    || '',
  ).trim();
  return priorityHolder === playerId;
}

export function buildLoopShortcutStackPassKey(
  view: ClientGameView | null | undefined,
  playerId?: string | null,
  priorityPlayerId?: string | null,
): string {
  const stack = Array.isArray(view?.stack) ? view!.stack : [];
  const stackIds = stack.map((entry: any) => String(entry?.id || '')).filter(Boolean).join(',');
  const priorityHolder = String(priorityPlayerId || view?.priority || '').trim();
  return `${String(playerId || '')}|${priorityHolder}|${stackIds}`;
}

export function noteLoopShortcutCastSettleStack(
  castSettle: LoopShortcutCastSettleState | null | undefined,
  view: ClientGameView | null | undefined,
): LoopShortcutCastSettleState | null {
  if (!castSettle) return null;
  const stack = Array.isArray(view?.stack) ? view!.stack : [];
  if (stack.length === 0 || castSettle.sawNonEmptyStack) return castSettle;
  return { ...castSettle, sawNonEmptyStack: true };
}

export { buildResolutionResponsePayload } from './loopShortcuts-handlers/loopShortcutsResolutionResponsePayload';

export function loadLoopShortcutDraft(storage: StorageLike, gameId: string): LoopShortcutDraft | null {
  const drafts = readJsonRecord(storage, LOOP_SHORTCUT_DRAFTS_STORAGE_KEY);
  return parseLoopShortcutDraft(drafts[String(gameId || '')]);
}

export function saveLoopShortcutDraft(storage: StorageLike, gameId: string, draft: LoopShortcutDraft): void {
  const drafts = readJsonRecord(storage, LOOP_SHORTCUT_DRAFTS_STORAGE_KEY);
  drafts[String(gameId || '')] = clonePayload(draft) as unknown as Record<string, unknown>;
  writeJsonRecord(storage, LOOP_SHORTCUT_DRAFTS_STORAGE_KEY, drafts);
}

export function clearLoopShortcutDraft(storage: StorageLike, gameId: string): void {
  const drafts = readJsonRecord(storage, LOOP_SHORTCUT_DRAFTS_STORAGE_KEY);
  delete drafts[String(gameId || '')];

  if (Object.keys(drafts).length === 0) {
    try {
      storage.removeItem(LOOP_SHORTCUT_DRAFTS_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    return;
  }

  writeJsonRecord(storage, LOOP_SHORTCUT_DRAFTS_STORAGE_KEY, drafts);
}

export function loadSavedLoopShortcuts(storage: StorageLike, gameId: string): SavedLoopShortcut[] {
  const record = readJsonRecord(storage, LOOP_SHORTCUT_SAVED_STORAGE_KEY);
  const rawValue = record[String(gameId || '')];
  const rawItems: unknown[] = Array.isArray(rawValue) ? rawValue : [];

  return rawItems
    .map(parseSavedLoopShortcut)
    .filter((item: SavedLoopShortcut | null): item is SavedLoopShortcut => Boolean(item))
    .sort((left: SavedLoopShortcut, right: SavedLoopShortcut) => right.updatedAt - left.updatedAt);
}

export function upsertSavedLoopShortcut(
  storage: StorageLike,
  gameId: string,
  shortcut: SavedLoopShortcut
): SavedLoopShortcut[] {
  const record = readJsonRecord(storage, LOOP_SHORTCUT_SAVED_STORAGE_KEY);
  const existing = loadSavedLoopShortcuts(storage, gameId).filter(item => item.id !== shortcut.id);
  const next = [...existing, clonePayload(shortcut)].sort((left, right) => right.updatedAt - left.updatedAt);
  record[String(gameId || '')] = next as unknown as JsonValue;
  writeJsonRecord(storage, LOOP_SHORTCUT_SAVED_STORAGE_KEY, record);
  return next;
}

export function deleteSavedLoopShortcut(
  storage: StorageLike,
  gameId: string,
  shortcutId: string
): SavedLoopShortcut[] {
  const record = readJsonRecord(storage, LOOP_SHORTCUT_SAVED_STORAGE_KEY);
  const next = loadSavedLoopShortcuts(storage, gameId).filter(item => item.id !== shortcutId);

  if (next.length === 0) {
    delete record[String(gameId || '')];
  } else {
    record[String(gameId || '')] = next as unknown as JsonValue;
  }

  if (Object.keys(record).length === 0) {
    try {
      storage.removeItem(LOOP_SHORTCUT_SAVED_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    return next;
  }

  writeJsonRecord(storage, LOOP_SHORTCUT_SAVED_STORAGE_KEY, record);
  return next;
}