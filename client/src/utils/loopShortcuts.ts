import type { ClientGameView } from '../../../shared/src';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type LoopShortcutIdTemplate =
  | {
      kind: 'specific_ids';
      ids: string[];
    }
  | {
      kind: 'select_valid_targets';
      count: number;
      preferTokens?: boolean;
      preferNonTokens?: boolean;
      requireSelfControlled?: boolean;
    };

const LOOP_SHORTCUT_DRAFTS_STORAGE_KEY = 'mtgedh:loopShortcutDrafts';
const LOOP_SHORTCUT_SAVED_STORAGE_KEY = 'mtgedh:loopShortcutSaved';

export type LoopShortcutPromptFingerprint = {
  stepType: string;
  sourceName?: string;
};

export type LoopShortcutPromptTemplate =
  | {
      kind: 'option_choice';
      optionIds: string[];
    }
  | LoopShortcutIdTemplate
  | {
      kind: 'selection_object';
      literalFields?: Record<string, JsonValue>;
      targetId?: LoopShortcutIdTemplate;
      targetIds?: LoopShortcutIdTemplate;
    }
  | {
      kind: 'literal_selection';
      selection: JsonValue;
    };

export type LoopShortcutDraft = {
  name: string;
  items: LoopShortcutSequenceItem[];
  iterationCount: number;
  updatedAt: number;
};

export type SavedLoopShortcut = LoopShortcutDraft & {
  id: string;
};

export type LoopShortcutSequenceItem =
  | {
      kind: 'emit';
      event: string;
      payload: Record<string, unknown>;
      label: string;
    }
  | {
      kind: 'resolution_response';
      fingerprint: LoopShortcutPromptFingerprint;
      template: LoopShortcutPromptTemplate;
      label: string;
    };

type RankedTarget = {
  id: string;
  index: number;
  score: number;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function clonePayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload ?? null));
}

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
    iterationCount: Math.max(1, Math.min(50, Number(raw.iterationCount) || 1)),
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

function getBattlefieldPermanent(view: ClientGameView | null | undefined, id: string): any | undefined {
  const battlefield = Array.isArray(view?.battlefield) ? view?.battlefield : [];
  return battlefield.find((permanent: any) => String(permanent?.id || '') === String(id || ''));
}

function isTokenPermanent(view: ClientGameView | null | undefined, id: string): boolean {
  const permanent = getBattlefieldPermanent(view, id);
  return Boolean(permanent?.isToken);
}

function isControlledBy(view: ClientGameView | null | undefined, id: string, playerId: string | null | undefined): boolean {
  if (!playerId) return false;
  const permanent = getBattlefieldPermanent(view, id);
  return String(permanent?.controller || '') === String(playerId || '');
}

function describePrompt(step: any): string {
  const sourceName = String(step?.sourceName || step?.cardName || 'Prompt').trim();
  const description = String(step?.description || '').trim();
  if (!description) return sourceName;
  return `${sourceName}: ${description}`;
}

function getPermanentTypeLine(permanent: any): string {
  return normalizeText(permanent?.type_line || permanent?.cardType || permanent?.card?.type_line);
}

function permanentMatchesType(permanent: any, type: string): boolean {
  if (type === 'permanent') return true;
  return getPermanentTypeLine(permanent).includes(normalizeText(type));
}

function getPromptValidTargetIds(
  step: any,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined
): string[] {
  const validTargets = Array.isArray(step?.validTargets) ? step.validTargets : [];
  if (validTargets.length > 0) {
    return validTargets.map((target: any) => String(target?.id || '')).filter(Boolean);
  }

  if (step?.type === 'tap_untap_target') {
    const battlefield = Array.isArray(view?.battlefield) ? view.battlefield : [];
    const types = Array.isArray(step?.targetFilter?.types)
      ? step.targetFilter.types.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [];
    const controllerFilter = normalizeText(step?.targetFilter?.controller || 'any');
    const tapStatus = normalizeText(step?.targetFilter?.tapStatus || 'any');
    const excludeSource = step?.targetFilter?.excludeSource === true;
    const sourceId = String(step?.sourceId || '');

    return battlefield
      .filter((permanent: any) => {
        if (!permanent?.id) return false;
        if (excludeSource && String(permanent.id) === sourceId) return false;
        if (types.length > 0 && !types.every((type: string) => permanentMatchesType(permanent, type))) return false;

        if (controllerFilter === 'you' && String(permanent?.controller || '') !== String(playerId || '')) {
          return false;
        }

        if (controllerFilter === 'opponent' && String(permanent?.controller || '') === String(playerId || '')) {
          return false;
        }

        if (tapStatus === 'tapped' && !permanent?.tapped) {
          return false;
        }

        if (tapStatus === 'untapped' && permanent?.tapped) {
          return false;
        }

        return true;
      })
      .map((permanent: any) => String(permanent.id));
  }

  return [];
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
    const selectedTokens = selectedIds.filter(id => isTokenPermanent(view, id));
    const selectedNonTokens = selectedIds.filter(id => !isTokenPermanent(view, id));
    const allSelfControlled = selectedIds.every(id => isControlledBy(view, id, playerId));

    return {
      kind: 'select_valid_targets',
      count: selectedIds.length,
      preferTokens: selectedTokens.length === selectedIds.length && selectedIds.length > 0,
      preferNonTokens: selectedNonTokens.length === selectedIds.length && selectedIds.length > 0,
      requireSelfControlled: allSelfControlled,
    };
  }

  return {
    kind: 'specific_ids',
    ids: selectedIds,
  };
}

function buildIdSelectionsPayload(
  template: LoopShortcutIdTemplate,
  step: any,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined
): string[] | null {
  if (template.kind === 'specific_ids') {
    const validIds = new Set(getPromptValidTargetIds(step, view, playerId));
    if (validIds.size === 0) {
      return [...template.ids];
    }

    const selected = template.ids.filter(id => validIds.has(String(id)));
    if (selected.length !== template.ids.length) return null;
    return selected;
  }

  const validTargetIds = getPromptValidTargetIds(step, view, playerId);
  if (validTargetIds.length === 0) return null;

  const rankedTargets: RankedTarget[] = validTargetIds
    .map((id: string, index: number) => {
      const permanent = getBattlefieldPermanent(view, id);
      const isToken = Boolean(permanent?.isToken);
      const isSelfControlled = String(permanent?.controller || '') === String(playerId || '');
      let score = 0;

      if (template.preferTokens && isToken) score += 100;
      if (template.preferNonTokens && !isToken) score += 100;
      if (template.requireSelfControlled && isSelfControlled) score += 50;

      return {
        id,
        index,
        score,
      };
    })
    .sort((left: RankedTarget, right: RankedTarget) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    });

  const selected = rankedTargets.slice(0, Math.max(0, template.count)).map((target: RankedTarget) => target.id);
  if (selected.length !== Math.max(0, template.count)) {
    return null;
  }

  return selected;
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

export function createRecordedResolutionResponseItem(
  step: any,
  selections: unknown,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined
): LoopShortcutSequenceItem | null {
  const fingerprint = buildPromptFingerprint(step);
  const selectedIds = extractTargetIds(step, selections);

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
      label: describePrompt(step),
    };
  }

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

export function buildResolutionResponsePayload(
  template: LoopShortcutPromptTemplate,
  step: any,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined
): { selections: unknown } | null {
  if (template.kind === 'option_choice') {
    return { selections: [...template.optionIds] };
  }

  if (template.kind === 'literal_selection') {
    return { selections: clonePayload(template.selection) };
  }

  if (template.kind === 'selection_object') {
    const selections: Record<string, unknown> = clonePayload(template.literalFields || {});

    if (template.targetId) {
      const targetIds = buildIdSelectionsPayload(template.targetId, step, view, playerId);
      if (!targetIds || targetIds.length === 0) return null;
      selections.targetId = targetIds[0];
    }

    if (template.targetIds) {
      const targetIds = buildIdSelectionsPayload(template.targetIds, step, view, playerId);
      if (!targetIds) return null;
      selections.targetIds = targetIds;
    }

    return { selections };
  }

  const selectedIds = buildIdSelectionsPayload(template, step, view, playerId);
  if (!selectedIds) {
    return null;
  }

  return { selections: selectedIds };
}

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