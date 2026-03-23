import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionEventHint } from './oracleIRExecutor';
import {
  createMayAbilityEvent,
  createModeSelectionEvent,
  createOptionChoiceEvent,
  createTargetSelectionEvent,
  type ChoiceEvent,
} from './choiceEvents';
import { parseOracleTextToIR } from './oracleIRParser';

export interface TriggerEventData {
  readonly sourceId?: string;
  readonly sourceControllerId?: string;
  readonly targetId?: string;
  readonly targetControllerId?: string;
  readonly targetPermanentId?: string;
  readonly targetPlayerId?: string;
  readonly targetOpponentId?: string;
  readonly tapOrUntapChoice?: 'tap' | 'untap';
  readonly selectedModeIds?: readonly string[];
  readonly permanentTypes?: readonly string[];
  readonly creatureCount?: number;
  readonly landCount?: number;
  readonly artifactCount?: number;
  readonly enchantmentCount?: number;
  readonly lifeTotal?: number;
  readonly lifeLost?: number;
  readonly lifeGained?: number;
  readonly damageDealt?: number;
  readonly cardsDrawn?: number;
  readonly spellType?: string;
  readonly wonCoinFlip?: boolean;
  readonly winningVoteChoice?: string | null;
  readonly isYourTurn?: boolean;
  readonly isOpponentsTurn?: boolean;
  readonly creatureTypes?: readonly string[];
  readonly colors?: readonly string[];
  readonly controlledCreatures?: readonly string[];
  readonly controlledPermanents?: readonly string[];
  readonly graveyard?: readonly string[];
  readonly hand?: readonly string[];
  readonly handAtBeginningOfTurn?: readonly string[];
  readonly affectedPlayerIds?: readonly string[];
  readonly affectedOpponentIds?: readonly string[];
  readonly opponentsDealtDamageIds?: readonly string[];
  readonly battlefield?: readonly { id: string; types?: string[]; controllerId?: string }[];
}

export interface ResolvedTriggeredAbilityChoice {
  readonly type: 'target_selection' | 'option_choice' | 'mode_selection';
  readonly selections?: unknown;
  readonly targetTypes?: readonly string[];
  readonly mayAbilityPrompt?: boolean;
}

type TriggeredAbilityOracleIRAbility = {
  readonly controllerId: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly effect: string;
  readonly optional?: boolean;
};

export function buildTriggerEventDataFromPayloads(
  sourceControllerId?: string,
  ...payloads: any[]
): TriggerEventData {
  const toId = (value: any): string | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const id = String(value).trim();
    return id.length > 0 ? id : undefined;
  };

  const pickFirstString = (...values: any[]): string | undefined => {
    for (const value of values) {
      const id = toId(value);
      if (id) return id;
    }
    return undefined;
  };

  const normalizedSourceControllerId = toId(sourceControllerId);

  const scalarString = (field: string): string | undefined => {
    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      const value = toId((payload as any)[field]);
      if (value) return value;
    }
    return undefined;
  };

  const scalarNumber = (field: string): number | undefined => {
    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      const raw = (payload as any)[field];
      if (raw === undefined || raw === null) continue;
      const num = Number(raw);
      if (Number.isFinite(num)) return num;
    }
    return undefined;
  };

  const scalarBool = (field: string): boolean | undefined => {
    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      const raw = (payload as any)[field];
      if (typeof raw === 'boolean') return raw;
    }
    return undefined;
  };

  const collectIds = (...fields: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: any) => {
      const id = toId(value);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };

    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      for (const field of fields) {
        const value = (payload as any)[field];
        if (Array.isArray(value)) {
          for (const item of value) push(item);
        } else {
          push(value);
        }
      }
    }

    return out;
  };

  const collectCombatOpponentIds = (): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: any) => {
      const id = toId(value);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };

    const processAssignments = (assignments: any[]) => {
      for (const assignment of assignments) {
        if (!assignment || typeof assignment !== 'object') continue;
        push((assignment as any).defendingPlayerId);
        push((assignment as any).targetOpponentId);
        push((assignment as any).targetPlayerId);
      }
    };

    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      const direct = (payload as any).attackers;
      if (Array.isArray(direct)) processAssignments(direct);
      const damageAssignments = (payload as any).damageAssignments;
      if (Array.isArray(damageAssignments)) processAssignments(damageAssignments);
      const combatAttackers = (payload as any).combat?.attackers;
      if (Array.isArray(combatAttackers)) processAssignments(combatAttackers);
    }

    return out;
  };

  const explicitAffectedPlayerIds = collectIds('affectedPlayerIds');
  const explicitAffectedOpponentIds = collectIds('affectedOpponentIds');
  const explicitOpponentsDealtDamageIds = collectIds('opponentsDealtDamageIds');
  const combatOpponentIds = collectCombatOpponentIds();
  const singleton = (ids: readonly string[]): string | undefined =>
    Array.isArray(ids) && ids.length === 1 ? ids[0] : undefined;
  const isOpponentId = (id: string | undefined): boolean =>
    Boolean(id) && (!normalizedSourceControllerId || id !== normalizedSourceControllerId);

  const targetIds = collectIds(
    'target',
    'targetId',
    'targetPermanentId',
    'targetPlayerId',
    'targetOpponentId',
    'targets',
    'targetIds',
    'targetPlayerIds',
    'targetOpponentIds'
  );

  const playerScopedTargetIds = collectIds(
    'targetPlayerId',
    'targetOpponentId',
    'targetPlayerIds',
    'targetOpponentIds'
  );

  const explicitTargetPlayerId = scalarString('targetPlayerId');
  const explicitTargetOpponentId = scalarString('targetOpponentId');

  const targetPlayerId = pickFirstString(
    explicitTargetPlayerId,
    explicitTargetOpponentId,
    singleton(explicitAffectedPlayerIds)
  );

  const targetOpponentId = pickFirstString(
    (() => {
      const id = explicitTargetOpponentId;
      return isOpponentId(id) ? id : undefined;
    })(),
    singleton(explicitAffectedOpponentIds.filter(id => isOpponentId(id))),
    singleton(explicitOpponentsDealtDamageIds.filter(id => isOpponentId(id))),
    singleton(combatOpponentIds.filter(id => isOpponentId(id)))
  );

  const affectedPlayerIds =
    explicitAffectedPlayerIds.length > 0
      ? explicitAffectedPlayerIds
      : playerScopedTargetIds.length > 0
        ? playerScopedTargetIds
        : undefined;

  const affectedOpponentIdsRaw =
    explicitAffectedOpponentIds.length > 0
      ? explicitAffectedOpponentIds
      : combatOpponentIds.length > 0
        ? combatOpponentIds
        : affectedPlayerIds?.filter(id => id !== sourceControllerId) || [];
  const affectedOpponentIdsSanitized = affectedOpponentIdsRaw.filter(id => isOpponentId(id));

  const opponentsDealtDamageIdsRaw =
    explicitOpponentsDealtDamageIds.length > 0
      ? explicitOpponentsDealtDamageIds
      : combatOpponentIds;
  const opponentsDealtDamageIdsSanitized = opponentsDealtDamageIdsRaw.filter(id => isOpponentId(id));

  const sourceId = scalarString('sourceId');
  const targetPermanentId =
    scalarString('targetPermanentId') ??
    (targetPlayerId || targetOpponentId ? undefined : singleton(targetIds));
  const targetId = scalarString('targetId') ?? targetPlayerId ?? targetOpponentId;
  const hand = collectIds('hand');
  const handAtBeginningOfTurn = collectIds('handAtBeginningOfTurn');
  const rawTapOrUntapChoice = scalarString('tapOrUntapChoice');
  const tapOrUntapChoice = rawTapOrUntapChoice === 'tap' || rawTapOrUntapChoice === 'untap' ? rawTapOrUntapChoice : undefined;

  return {
    sourceId,
    sourceControllerId: normalizedSourceControllerId,
    targetId,
    targetControllerId: scalarString('targetControllerId'),
    targetPermanentId,
    targetPlayerId,
    targetOpponentId,
    tapOrUntapChoice,
    lifeTotal: scalarNumber('lifeTotal'),
    lifeLost: scalarNumber('lifeLost'),
    lifeGained: scalarNumber('lifeGained'),
    damageDealt: scalarNumber('damageDealt'),
    cardsDrawn: scalarNumber('cardsDrawn'),
    spellType: scalarString('spellType'),
    wonCoinFlip: scalarBool('wonCoinFlip'),
    winningVoteChoice: scalarString('winningVoteChoice'),
    isYourTurn: scalarBool('isYourTurn'),
    isOpponentsTurn: scalarBool('isOpponentsTurn'),
    hand: hand.length > 0 ? hand : undefined,
    handAtBeginningOfTurn: handAtBeginningOfTurn.length > 0 ? handAtBeginningOfTurn : undefined,
    affectedPlayerIds: affectedPlayerIds && affectedPlayerIds.length > 0 ? affectedPlayerIds : undefined,
    affectedOpponentIds:
      affectedOpponentIdsSanitized.length > 0 ? affectedOpponentIdsSanitized : undefined,
    opponentsDealtDamageIds:
      opponentsDealtDamageIdsSanitized.length > 0 ? opponentsDealtDamageIdsSanitized : undefined,
  };
}

export function buildStackTriggerMetaFromEventData(
  effectText: string | undefined,
  sourceId: string,
  sourceControllerId: string,
  sourceName?: string,
  eventData?: TriggerEventData
): {
  effectText?: string;
  sourceName?: string;
  triggerEventDataSnapshot?: {
    sourceId?: string;
    sourceControllerId?: string;
    targetId?: string;
    targetControllerId?: string;
    targetPermanentId?: string;
    targetPlayerId?: string;
    targetOpponentId?: string;
    tapOrUntapChoice?: 'tap' | 'untap';
    affectedPlayerIds?: readonly string[];
    affectedOpponentIds?: readonly string[];
    opponentsDealtDamageIds?: readonly string[];
    lifeTotal?: number;
    lifeLost?: number;
    lifeGained?: number;
    damageDealt?: number;
    cardsDrawn?: number;
    spellType?: string;
    wonCoinFlip?: boolean;
    winningVoteChoice?: string | null;
    isYourTurn?: boolean;
    isOpponentsTurn?: boolean;
    hand?: readonly string[];
    handAtBeginningOfTurn?: readonly string[];
    battlefield?: readonly { id: string; types?: string[]; controllerId?: string }[];
  };
} {
  const normalized = buildTriggerEventDataFromPayloads(
    sourceControllerId,
    eventData,
    { sourceId, sourceControllerId }
  );

  return {
    effectText,
    sourceName,
    triggerEventDataSnapshot: {
      sourceId: normalized.sourceId,
      sourceControllerId: normalized.sourceControllerId,
      targetId: normalized.targetId,
      targetControllerId: normalized.targetControllerId,
      targetPermanentId: normalized.targetPermanentId,
      targetPlayerId: normalized.targetPlayerId,
      targetOpponentId: normalized.targetOpponentId,
      tapOrUntapChoice: normalized.tapOrUntapChoice,
      affectedPlayerIds: normalized.affectedPlayerIds,
      affectedOpponentIds: normalized.affectedOpponentIds,
      opponentsDealtDamageIds: normalized.opponentsDealtDamageIds,
      lifeTotal: normalized.lifeTotal,
      lifeLost: normalized.lifeLost,
      lifeGained: normalized.lifeGained,
      damageDealt: normalized.damageDealt,
      cardsDrawn: normalized.cardsDrawn,
      spellType: normalized.spellType,
      wonCoinFlip: normalized.wonCoinFlip,
      winningVoteChoice: normalized.winningVoteChoice ?? undefined,
      isYourTurn: normalized.isYourTurn,
      isOpponentsTurn: normalized.isOpponentsTurn,
      hand: normalized.hand,
      handAtBeginningOfTurn: normalized.handAtBeginningOfTurn,
      battlefield: normalized.battlefield,
    },
  };
}

export function buildOracleIRExecutionEventHintFromTriggerData(
  eventData?: TriggerEventData
): OracleIRExecutionEventHint | undefined {
  if (!eventData) return undefined;

  const normalizeId = (value: unknown): string | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized || undefined;
  };

  const normalizedSourceControllerId = String(eventData.sourceControllerId || '').trim() || undefined;
  const normalizedTargetPlayerId = normalizeId(eventData.targetPlayerId);
  const normalizedRawTargetOpponentId = normalizeId(eventData.targetOpponentId);
  const normalizedTargetPermanentId = normalizeId(eventData.targetPermanentId);

  const isOpponentId = (id: string | undefined): boolean => {
    if (!id) return false;
    return !normalizedSourceControllerId || id !== normalizedSourceControllerId;
  };

  const dedupe = (ids: readonly string[] | undefined): readonly string[] | undefined => {
    if (!Array.isArray(ids) || ids.length === 0) return undefined;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const normalized = normalizeId(id);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out.length > 0 ? out : undefined;
  };

  const dedupeOpponents = (ids: readonly string[] | undefined): readonly string[] | undefined =>
    dedupe((ids || []).filter(id => isOpponentId(id)));

  const singleton = (ids: readonly string[] | undefined): string | undefined =>
    Array.isArray(ids) && ids.length === 1 ? ids[0] : undefined;

  const dedupedAffectedOpponents = dedupeOpponents(eventData.affectedOpponentIds);
  const dedupedOpponentsDealtDamage = dedupeOpponents(eventData.opponentsDealtDamageIds);

  const targetOpponentId = isOpponentId(normalizedRawTargetOpponentId)
    ? normalizedRawTargetOpponentId
    : singleton(dedupedAffectedOpponents) ??
      singleton(dedupedOpponentsDealtDamage);

  const hint: OracleIRExecutionEventHint = {
    targetPlayerId: normalizedTargetPlayerId,
    targetOpponentId,
    targetPermanentId: normalizedTargetPermanentId,
    tapOrUntapChoice: eventData.tapOrUntapChoice,
    affectedPlayerIds: dedupe(eventData.affectedPlayerIds),
    affectedOpponentIds: dedupedAffectedOpponents,
    opponentsDealtDamageIds: dedupedOpponentsDealtDamage,
    spellType: eventData.spellType,
    wonCoinFlip: eventData.wonCoinFlip,
    winningVoteChoice: eventData.winningVoteChoice ?? undefined,
  };

  if (
    !hint.targetPlayerId &&
    !hint.targetOpponentId &&
    !hint.targetPermanentId &&
    !hint.tapOrUntapChoice &&
    !hint.affectedPlayerIds &&
    !hint.affectedOpponentIds &&
    !hint.opponentsDealtDamageIds &&
    !hint.spellType &&
    typeof hint.wonCoinFlip !== 'boolean' &&
    typeof hint.winningVoteChoice === 'undefined'
  ) {
    return undefined;
  }

  return hint;
}

export function buildResolutionEventDataFromGameState(
  state: GameState,
  controllerId: string,
  base?: TriggerEventData
): TriggerEventData {
  const normalizeId = (value: unknown): string | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized || undefined;
  };

  const normalizedControllerId = normalizeId(controllerId) ?? normalizeId(base?.sourceControllerId);
  const normalizedTurnPlayerId = normalizeId((state as any).turnPlayer);

  const battlefield = ((state.battlefield || []) as any[]).map(p => ({
    id: normalizeId(p?.id) || '',
    controllerId: normalizeId(p?.controller) || '',
    types: String((p?.card?.type_line || '') as any)
      .split(/[\sâ€”-]+/)
      .map(t => t.trim())
      .filter(Boolean),
  }));

  const controller = (state.players || []).find(
    (p: any) => normalizeId(p?.id) === normalizedControllerId
  ) as any;
  const hasValidController = Boolean(controller);
  const resolvedHand = Array.isArray(controller?.hand)
    ? controller.hand
        .map((card: any) => normalizeId(card?.id))
        .filter((id: string | undefined): id is string => Boolean(id))
    : Array.isArray(base?.hand)
      ? [...base.hand]
      : undefined;
  const turnStartHandSnapshot = (state as any)?.turnStartHandSnapshot;
  const resolvedHandAtBeginningOfTurn = normalizedControllerId && turnStartHandSnapshot && Array.isArray(turnStartHandSnapshot[normalizedControllerId])
    ? turnStartHandSnapshot[normalizedControllerId]
        .map((id: any) => normalizeId(id))
        .filter((id: string | undefined): id is string => Boolean(id))
    : Array.isArray(base?.handAtBeginningOfTurn)
      ? [...base.handAtBeginningOfTurn]
      : undefined;
  const resolvedLifeTotal = (() => {
    const controllerLife = Number(controller?.life);
    if (Number.isFinite(controllerLife)) return controllerLife;
    const baseLife = Number(base?.lifeTotal);
    return Number.isFinite(baseLife) ? baseLife : undefined;
  })();

  return {
    ...base,
    sourceControllerId: normalizedControllerId,
    lifeTotal: resolvedLifeTotal,
    isYourTurn:
      hasValidController && normalizedTurnPlayerId !== undefined
        ? normalizedTurnPlayerId === normalizedControllerId
        : Boolean(base?.isYourTurn),
    isOpponentsTurn:
      hasValidController && normalizedTurnPlayerId !== undefined
        ? normalizedTurnPlayerId !== normalizedControllerId
        : Boolean(base?.isOpponentsTurn),
    hand: resolvedHand,
    handAtBeginningOfTurn: resolvedHandAtBeginningOfTurn,
    battlefield,
  };
}

function extractTriggeredChoiceSelectionId(selection: unknown): string | undefined {
  if (typeof selection === 'string') {
    const normalized = selection.trim();
    return normalized || undefined;
  }

  if (Array.isArray(selection)) {
    for (const entry of selection) {
      const extracted = extractTriggeredChoiceSelectionId(entry);
      if (extracted) return extracted;
    }
    return undefined;
  }

  if (selection && typeof selection === 'object') {
    const id = typeof (selection as any).id === 'string' ? (selection as any).id.trim() : '';
    if (id) return id;

    const value = typeof (selection as any).value === 'string' ? (selection as any).value.trim() : '';
    if (value) return value;

    const choiceId = typeof (selection as any).choiceId === 'string' ? (selection as any).choiceId.trim() : '';
    if (choiceId) return choiceId;
  }

  return undefined;
}

function extractTriggeredChoiceSelectionIds(selection: unknown): string[] {
  if (typeof selection === 'string') {
    const normalized = selection.trim();
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(selection)) {
    return selection
      .flatMap((entry: unknown) => extractTriggeredChoiceSelectionIds(entry))
      .filter((id: string, index: number, items: string[]) => items.indexOf(id) === index);
  }

  const extracted = extractTriggeredChoiceSelectionId(selection);
  return extracted ? [extracted] : [];
}

export function buildTriggeredAbilityEventDataFromChoices(
  state: GameState,
  controllerId: string,
  choices: readonly ResolvedTriggeredAbilityChoice[]
): TriggerEventData {
  const overrides: Record<string, unknown> = {};
  const playerIds = new Set(
    ((state.players || []) as any[])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean)
  );

  for (const choice of choices) {
    if (choice?.mayAbilityPrompt) {
      continue;
    }

    if (choice?.type === 'target_selection') {
      const selectedIds = extractTriggeredChoiceSelectionIds(choice?.selections);
      if (selectedIds.length === 0) continue;

      const normalizedTargetTypes = Array.isArray(choice?.targetTypes)
        ? choice.targetTypes.map((entry: any) => String(entry || '').toLowerCase())
        : [];

      if (normalizedTargetTypes.includes('opponent')) {
        if (selectedIds.length === 1) {
          overrides.targetOpponentId = selectedIds[0];
          overrides.targetPlayerId = selectedIds[0];
        } else {
          overrides.affectedOpponentIds = selectedIds;
          overrides.affectedPlayerIds = selectedIds;
        }
        continue;
      }

      if (normalizedTargetTypes.includes('player')) {
        if (selectedIds.length === 1) {
          overrides.targetPlayerId = selectedIds[0];
          if (selectedIds[0] !== controllerId) {
            overrides.targetOpponentId = selectedIds[0];
          }
        } else {
          overrides.affectedPlayerIds = selectedIds;
          const opponentIds = selectedIds.filter((id: string) => id !== controllerId);
          if (opponentIds.length > 0) {
            overrides.affectedOpponentIds = opponentIds;
          }
        }
        continue;
      }

      const nonPlayerIds = selectedIds.filter((id: string) => !playerIds.has(id));
      if (nonPlayerIds.length === 1) {
        overrides.targetPermanentId = nonPlayerIds[0];
      }
      continue;
    }

    if (choice?.type === 'option_choice') {
      const selectedId = extractTriggeredChoiceSelectionId(choice?.selections);
      if (selectedId === 'tap' || selectedId === 'untap') {
        overrides.tapOrUntapChoice = selectedId;
      }
      continue;
    }

    if (choice?.type === 'mode_selection') {
      overrides.selectedModeIds = extractTriggeredChoiceSelectionIds(choice?.selections);
    }
  }

  return overrides as TriggerEventData;
}

export function normalizeTriggerContextId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

export function buildEnrichedTriggerExecutionEventData(
  state: GameState,
  ability: TriggeredAbilityOracleIRAbility,
  eventData?: TriggerEventData,
  options: { inferTapOrUntapChoice?: boolean } = {}
): TriggerEventData | undefined {
  const normalizedEventData = buildTriggerEventDataFromPayloads(
    ability.controllerId,
    eventData,
    {
      sourceId: ability.sourceId,
      sourceControllerId: ability.controllerId,
    }
  );

  const playerIds = new Set(
    (state.players || [])
      .map((player: any) => normalizeTriggerContextId(player?.id))
      .filter((id: string | undefined): id is string => Boolean(id))
  );

  const inferredTargetPermanentId = (() => {
    const explicit = normalizeTriggerContextId(normalizedEventData.targetPermanentId ?? eventData?.targetPermanentId);
    if (explicit) return explicit;
    const fallbackTargetId = normalizeTriggerContextId(normalizedEventData.targetId ?? eventData?.targetId);
    if (fallbackTargetId && !playerIds.has(fallbackTargetId)) return fallbackTargetId;
    return undefined;
  })();

  const inferredTapOrUntapChoice = (() => {
    if (!options.inferTapOrUntapChoice) return undefined;
    const explicit = normalizedEventData.tapOrUntapChoice ?? eventData?.tapOrUntapChoice;
    if (explicit === 'tap' || explicit === 'untap') return explicit;
    if (!inferredTargetPermanentId) return undefined;
    const permanent = ((state.battlefield || []) as any[]).find(
      perm => normalizeTriggerContextId(perm?.id) === inferredTargetPermanentId
    );
    if (!permanent) return undefined;
    return Boolean((permanent as any)?.tapped) ? 'untap' : 'tap';
  })();

  const hasBaseEventData = Boolean(eventData) || Object.keys(normalizedEventData).length > 0;
  if (!hasBaseEventData && !inferredTargetPermanentId && !inferredTapOrUntapChoice) {
    return undefined;
  }

  return {
    ...((eventData as Record<string, unknown> | undefined) || {}),
    ...normalizedEventData,
    ...(inferredTargetPermanentId ? { targetPermanentId: inferredTargetPermanentId } : {}),
    ...(inferredTapOrUntapChoice ? { tapOrUntapChoice: inferredTapOrUntapChoice } : {}),
  } as TriggerEventData;
}

function getTriggerSourceImage(state: GameState, sourceId: string | undefined): string | undefined {
  const normalizedSourceId = normalizeTriggerContextId(sourceId);
  if (!normalizedSourceId) return undefined;
  const permanent = ((state.battlefield || []) as any[]).find(
    perm => normalizeTriggerContextId(perm?.id) === normalizedSourceId
  ) as any;
  const images = permanent?.card?.image_uris;
  return images?.small || images?.normal || undefined;
}

function buildPermanentTargetChoiceOptions(state: GameState): readonly { id: string; name: string; imageUrl?: string }[] {
  return ((state.battlefield || []) as any[])
    .map((perm: any) => {
      const id = normalizeTriggerContextId(perm?.id);
      if (!id) return undefined;
      const card = perm?.card || {};
      const name = String(card?.name || perm?.name || id).trim() || id;
      const imageUrl = card?.image_uris?.small || card?.image_uris?.normal || undefined;
      const option: { id: string; name: string; imageUrl?: string } = { id, name };
      if (imageUrl) {
        option.imageUrl = imageUrl;
      }
      return option;
    })
    .filter((option): option is { id: string; name: string; imageUrl?: string } => Boolean(option));
}

function buildPlayerTargetChoiceOptions(
  state: GameState,
  controllerId: string,
  mode: 'player' | 'opponent'
): readonly { id: string; name: string }[] {
  return ((state.players || []) as any[])
    .map((player: any) => {
      const id = normalizeTriggerContextId(player?.id);
      if (!id) return undefined;
      if (mode === 'opponent' && id === controllerId) return undefined;
      return {
        id,
        name: String(player?.name || id).trim() || id,
      };
    })
    .filter((option): option is { id: string; name: string } => Boolean(option));
}

function getUnresolvedPlayerTargetKinds(steps: readonly any[]): { needsPlayerTarget: boolean; needsOpponentTarget: boolean } {
  let needsPlayerTarget = false;
  let needsOpponentTarget = false;

  for (const step of steps) {
    const whoKind = String((step as any)?.who?.kind || '').trim();
    if (whoKind === 'target_player') needsPlayerTarget = true;
    if (whoKind === 'target_opponent') needsOpponentTarget = true;
  }

  return { needsPlayerTarget, needsOpponentTarget };
}

function getUnresolvedChooseModeSteps(steps: readonly any[]): readonly any[] {
  return steps.filter((step: any) => step?.kind === 'choose_mode');
}

export function buildTriggeredAbilityChoiceEvents(
  state: GameState,
  ability: TriggeredAbilityOracleIRAbility,
  eventData?: TriggerEventData
): readonly ChoiceEvent[] {
  const ir = parseOracleTextToIR(ability.effect, ability.sourceName);
  const steps = ir.abilities.flatMap(a => a.steps);
  const enrichedEventData = buildEnrichedTriggerExecutionEventData(state, ability, eventData, {
    inferTapOrUntapChoice: false,
  });
  const sourceImage = getTriggerSourceImage(state, ability.sourceId);
  const choiceEvents: ChoiceEvent[] = [];
  const unresolvedPlayerTargets = getUnresolvedPlayerTargetKinds(steps as any[]);
  const unresolvedChooseModeSteps = getUnresolvedChooseModeSteps(steps as any[]);

  if (ability.optional || steps.some(step => Boolean((step as any).optional))) {
    choiceEvents.push(
      createMayAbilityEvent(
        ability.controllerId as PlayerID,
        ability.sourceId,
        ability.sourceName,
        ability.effect,
        undefined,
        sourceImage
      )
    );
  }

  if (unresolvedPlayerTargets.needsOpponentTarget && !enrichedEventData?.targetOpponentId) {
    const validTargets = buildPlayerTargetChoiceOptions(state, ability.controllerId, 'opponent');
    if (validTargets.length > 0) {
      choiceEvents.push(
        createTargetSelectionEvent(
          ability.controllerId as PlayerID,
          ability.sourceId,
          ability.sourceName,
          validTargets,
          ['opponent'],
          1,
          1,
          true,
          sourceImage
        )
      );
    }
  }

  if (unresolvedPlayerTargets.needsPlayerTarget && !enrichedEventData?.targetPlayerId) {
    const validTargets = buildPlayerTargetChoiceOptions(state, ability.controllerId, 'player');
    if (validTargets.length > 0) {
      choiceEvents.push(
        createTargetSelectionEvent(
          ability.controllerId as PlayerID,
          ability.sourceId,
          ability.sourceName,
          validTargets,
          ['player'],
          1,
          1,
          true,
          sourceImage
        )
      );
    }
  }

  if (!Array.isArray(enrichedEventData?.selectedModeIds)) {
    for (const step of unresolvedChooseModeSteps) {
      const modes = Array.isArray((step as any)?.modes) ? (step as any).modes : [];
      if (modes.length === 0) continue;
      choiceEvents.push(
        createModeSelectionEvent(
          ability.controllerId as PlayerID,
          ability.sourceId,
          ability.sourceName,
          modes.map((mode: any) => ({
            id: String(mode?.label || '').trim(),
            text: String(mode?.raw || mode?.label || '').trim() || String(mode?.label || '').trim(),
          })),
          Math.max(0, Number((step as any)?.minModes ?? 0) || 0),
          Number((step as any)?.maxModes ?? -1) || -1,
          sourceImage
        )
      );
    }
  }

  for (const step of steps) {
    if (step.kind !== 'tap_or_untap') continue;

    if (!enrichedEventData?.targetPermanentId) {
      const validTargets = buildPermanentTargetChoiceOptions(state);
      if (validTargets.length > 0) {
        choiceEvents.push(
          createTargetSelectionEvent(
            ability.controllerId as PlayerID,
            ability.sourceId,
            ability.sourceName,
            validTargets,
            ['permanent'],
            1,
            1,
            true,
            sourceImage
          )
        );
      }
    }

    if (!enrichedEventData?.tapOrUntapChoice) {
      const targetPermanentName = (() => {
        const targetPermanentId = normalizeTriggerContextId(enrichedEventData?.targetPermanentId);
        if (!targetPermanentId) return 'the target permanent';
        const permanent = ((state.battlefield || []) as any[]).find(
          perm => normalizeTriggerContextId(perm?.id) === targetPermanentId
        ) as any;
        return String(permanent?.card?.name || permanent?.name || 'the target permanent').trim() || 'the target permanent';
      })();

      choiceEvents.push(
        createOptionChoiceEvent(
          ability.controllerId as PlayerID,
          ability.sourceId,
          ability.sourceName,
          `Choose whether ${ability.sourceName} taps or untaps ${targetPermanentName}`,
          [
            { id: 'tap', label: 'Tap', description: `Tap ${targetPermanentName}` },
            { id: 'untap', label: 'Untap', description: `Untap ${targetPermanentName}` },
          ],
          1,
          1
        )
      );
    }
  }

  return choiceEvents;
}
