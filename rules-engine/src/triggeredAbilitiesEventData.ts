import type { GameState } from '../../shared/src';
import type { OracleIRExecutionEventHint } from './oracleIRExecutor';

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
  };

  if (
    !hint.targetPlayerId &&
    !hint.targetOpponentId &&
    !hint.targetPermanentId &&
    !hint.tapOrUntapChoice &&
    !hint.affectedPlayerIds &&
    !hint.affectedOpponentIds &&
    !hint.opponentsDealtDamageIds &&
    !hint.spellType
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
