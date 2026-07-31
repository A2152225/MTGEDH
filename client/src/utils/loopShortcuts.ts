import type { ClientGameView } from '../../../shared/src';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Characteristics of a recorded permanent choice, used to rebind to a live target. */
export type LoopShortcutTargetMatchProfile = {
  name?: string;
  typeLine?: string;
  isToken?: boolean;
  tapped?: boolean;
  isCommander?: boolean;
};

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
      preferTapped?: boolean;
      preferUntapped?: boolean;
      avoidCommanders?: boolean;
      matchProfiles?: LoopShortcutTargetMatchProfile[];
    };

const LOOP_SHORTCUT_DRAFTS_STORAGE_KEY = 'mtgedh:loopShortcutDrafts';
const LOOP_SHORTCUT_SAVED_STORAGE_KEY = 'mtgedh:loopShortcutSaved';

/** Soft cap — always allowed. Above this requires a self-sustaining loop. */
export const LOOP_SHORTCUT_MAX_ITERATIONS = 50;
/** Hard cap for self-sustaining loops (net resources do not decrease). */
export const LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS = 1000;

export function clampLoopShortcutIterations(raw: unknown): number {
  const n = Math.floor(Number(raw) || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS, n));
}

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

function getBattlefieldPermanent(view: ClientGameView | null | undefined, id: string): any | undefined {
  const battlefield = Array.isArray(view?.battlefield) ? view?.battlefield : [];
  const targetId = String(id || '');
  if (!targetId) return undefined;

  const direct = battlefield.find((permanent: any) => String(permanent?.id || '') === targetId);
  if (direct) return direct;

  // Server broadcast collapses identical tokens into one group entry (`group_<id>`).
  // Sacrifice / target prompts still use the real member IDs in groupedTokenIds.
  for (const permanent of battlefield) {
    if (permanent?.isGroupedTokens !== true) continue;
    const groupedIds = Array.isArray(permanent?.groupedTokenIds) ? permanent.groupedTokenIds : [];
    if (!groupedIds.some((entry: unknown) => String(entry || '') === targetId)) continue;

    return {
      ...permanent,
      id: targetId,
      isToken: true,
      isGroupedTokens: false,
      tokenCount: 1,
      groupedTokenIds: undefined,
    };
  }

  return undefined;
}

function getValidTargetEntry(step: any, id: string): any | undefined {
  const validTargets = Array.isArray(step?.validTargets) ? step.validTargets : [];
  return validTargets.find((entry: any) => String(entry?.id || '') === String(id || ''));
}

function resolveOptionalBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (value === true) return true;
    if (value === false) return false;
  }
  return undefined;
}

function looksLikeTokenId(id: string): boolean {
  return /^(tok|token|copytok|group_)/i.test(String(id || '').trim());
}

function getPermanentDisplayName(permanent: any, validTarget?: any): string {
  return String(
    permanent?.card?.name
    || permanent?.name
    || validTarget?.label
    || validTarget?.name
    || ''
  ).trim();
}

function getPermanentTypeLineValue(permanent: any, validTarget?: any): string {
  return String(
    permanent?.type_line
    || permanent?.card?.type_line
    || validTarget?.typeLine
    || validTarget?.description
    || ''
  ).trim();
}

function buildTargetMatchProfile(
  step: any,
  view: ClientGameView | null | undefined,
  id: string
): LoopShortcutTargetMatchProfile {
  const permanent = getBattlefieldPermanent(view, id);
  const validTarget = getValidTargetEntry(step, id);
  const name = getPermanentDisplayName(permanent, validTarget);
  const typeLine = getPermanentTypeLineValue(permanent, validTarget);
  const isToken = resolveOptionalBoolean(
    permanent?.isToken,
    permanent?.isCopyToken,
    permanent?.card?.isToken,
    validTarget?.isToken,
    // Fallback: token ids from createToken / grouped members.
    looksLikeTokenId(id) || looksLikeTokenId(String(permanent?.id || '')) ? true : undefined,
  );
  const tapped = resolveOptionalBoolean(permanent?.tapped, validTarget?.tapped);
  const isCommander = resolveOptionalBoolean(
    permanent?.isCommander,
    permanent?.card?.isCommander,
    validTarget?.isCommander
  );

  return {
    ...(name ? { name } : {}),
    ...(typeLine ? { typeLine } : {}),
    ...(typeof isToken === 'boolean' ? { isToken } : {}),
    ...(typeof tapped === 'boolean' ? { tapped } : {}),
    ...(typeof isCommander === 'boolean' ? { isCommander } : {}),
  };
}

function isTokenPermanent(
  view: ClientGameView | null | undefined,
  id: string,
  step?: any
): boolean {
  const profile = buildTargetMatchProfile(step, view, id);
  return profile.isToken === true;
}

function isExplicitNonTokenPermanent(
  view: ClientGameView | null | undefined,
  id: string,
  step?: any
): boolean {
  const profile = buildTargetMatchProfile(step, view, id);
  return profile.isToken === false;
}

function isCommanderPermanent(
  view: ClientGameView | null | undefined,
  id: string,
  step?: any
): boolean {
  return buildTargetMatchProfile(step, view, id).isCommander === true;
}

function isControlledBy(
  view: ClientGameView | null | undefined,
  id: string,
  playerId: string | null | undefined,
  step?: any
): boolean {
  if (!playerId) return false;
  const permanent = getBattlefieldPermanent(view, id);
  if (permanent) {
    return String(permanent?.controller || '') === String(playerId || '');
  }
  const validTarget = getValidTargetEntry(step, id);
  if (validTarget?.controller) {
    return String(validTarget.controller) === String(playerId || '');
  }
  return false;
}

function typeLineOverlapScore(left: string, right: string): number {
  const leftNorm = normalizeText(left);
  const rightNorm = normalizeText(right);
  if (!leftNorm || !rightNorm) return 0;
  if (leftNorm === rightNorm) return 60;

  const ignore = new Set(['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle', 'kindred', 'tribal']);
  const leftParts = leftNorm.split(/[^a-z0-9]+/).filter((part) => part && !ignore.has(part));
  const rightParts = new Set(rightNorm.split(/[^a-z0-9]+/).filter((part) => part && !ignore.has(part)));
  let overlap = 0;
  for (const part of leftParts) {
    if (rightParts.has(part)) overlap += 1;
  }
  return overlap * 20;
}

function scoreCandidateAgainstProfile(
  candidate: LoopShortcutTargetMatchProfile & { controllerMatched: boolean },
  profile: LoopShortcutTargetMatchProfile | undefined,
  template: Extract<LoopShortcutIdTemplate, { kind: 'select_valid_targets' }>
): number {
  let score = 0;

  if (template.preferTokens && candidate.isToken === true) score += 100;
  if (template.preferNonTokens && candidate.isToken === false) score += 100;
  if (template.requireSelfControlled && candidate.controllerMatched) score += 50;
  if (template.preferTapped && candidate.tapped === true) score += 80;
  if (template.preferUntapped && candidate.tapped === false) score += 80;
  if (template.avoidCommanders && candidate.isCommander === true) score -= 500;

  if (!profile) return score;

  if (profile.name && candidate.name && normalizeText(profile.name) === normalizeText(candidate.name)) {
    score += 200;
  }

  if (typeof profile.isToken === 'boolean') {
    if (candidate.isToken === profile.isToken) score += 100;
    else score -= 80;
  }

  if (typeof profile.tapped === 'boolean') {
    if (candidate.tapped === profile.tapped) score += 120;
    else score -= 60;
  }

  if (typeof profile.isCommander === 'boolean') {
    if (candidate.isCommander === profile.isCommander) score += 40;
    else if (profile.isCommander === false && candidate.isCommander === true) score -= 500;
  }

  if (profile.typeLine && candidate.typeLine) {
    score += typeLineOverlapScore(profile.typeLine, candidate.typeLine);
  }

  return score;
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

function filterDynamicCandidateIds(
  validTargetIds: string[],
  template: Extract<LoopShortcutIdTemplate, { kind: 'select_valid_targets' }>,
  profile: LoopShortcutTargetMatchProfile | undefined,
  step: any,
  view: ClientGameView | null | undefined
): string[] {
  let candidates = [...validTargetIds];

  const wantsTokens =
    template.preferTokens === true
    || profile?.isToken === true;
  if (wantsTokens) {
    const tokenIds = candidates.filter((id) => isTokenPermanent(view, id, step));
    if (tokenIds.length > 0) {
      candidates = tokenIds;
    }
  }

  const avoidCommanders =
    template.avoidCommanders === true
    || profile?.isCommander === false;
  if (avoidCommanders) {
    const nonCommanders = candidates.filter((id) => !isCommanderPermanent(view, id, step));
    if (nonCommanders.length > 0) {
      candidates = nonCommanders;
    }
  }

  if (template.preferTapped === true || profile?.tapped === true) {
    const tappedIds = candidates.filter((id) => buildTargetMatchProfile(step, view, id).tapped === true);
    if (tappedIds.length > 0) {
      candidates = tappedIds;
    }
  } else if (template.preferUntapped === true || profile?.tapped === false) {
    const untappedIds = candidates.filter((id) => buildTargetMatchProfile(step, view, id).tapped === false);
    if (untappedIds.length > 0) {
      candidates = untappedIds;
    }
  }

  return candidates;
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

  const profiles =
    Array.isArray(template.matchProfiles) && template.matchProfiles.length > 0
      ? template.matchProfiles.slice(0, Math.max(0, template.count))
      : Array.from({ length: Math.max(0, template.count) }, () => undefined);

  // Pad profiles when an older saved loop only stored aggregate preferences.
  while (profiles.length < Math.max(0, template.count)) {
    profiles.push(undefined);
  }

  const usedIds = new Set<string>();
  const selected: string[] = [];

  for (const profile of profiles) {
    const candidateIds = filterDynamicCandidateIds(
      validTargetIds.filter((id: string) => !usedIds.has(id)),
      template,
      profile,
      step,
      view
    );

    const rankedTargets: RankedTarget[] = candidateIds
      .map((id: string, index: number) => {
        const candidateProfile = buildTargetMatchProfile(step, view, id);
        const score = scoreCandidateAgainstProfile(
          {
            ...candidateProfile,
            controllerMatched: isControlledBy(view, id, playerId, step),
          },
          profile,
          template
        );

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

    const best = rankedTargets[0];
    if (!best) return null;
    usedIds.add(best.id);
    selected.push(best.id);
  }

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