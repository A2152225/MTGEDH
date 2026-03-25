import type { GameState } from '../../shared/src';
import type { OracleIRExecutionEventHint } from './oracleIRExecutor';

export interface TriggerEventData {
  readonly sourceId?: string;
  readonly sourceControllerId?: string;
  readonly sourceOwnerId?: string;
  readonly sourceIsToken?: boolean;
  readonly sourceIsFaceDown?: boolean;
  readonly castFromZone?: string;
  readonly enteredFromZone?: string;
  readonly attachedByPermanentIds?: readonly string[];
  readonly sourceAttachedToPermanentIds?: readonly string[];
  readonly targetId?: string;
  readonly targetControllerId?: string;
  readonly targetPermanentId?: string;
  readonly chosenObjectIds?: readonly string[];
  readonly targetPlayerId?: string;
  readonly targetOpponentId?: string;
  readonly tapOrUntapChoice?: 'tap' | 'untap';
  readonly unlessPaysLifeChoice?: 'pay' | 'decline';
  readonly selectedModeIds?: readonly string[];
  readonly permanentTypes?: readonly string[];
  readonly creatureCount?: number;
  readonly landCount?: number;
  readonly artifactCount?: number;
  readonly enchantmentCount?: number;
  readonly keywords?: readonly string[];
  readonly lifeTotal?: number;
  readonly lifeLost?: number;
  readonly lifeGained?: number;
  readonly damageDealt?: number;
  readonly damagedByPermanentIds?: readonly string[];
  readonly cardsDrawn?: number;
  readonly spellType?: string;
  readonly wonCoinFlip?: boolean;
  readonly winningVoteChoice?: string | null;
  readonly isYourTurn?: boolean;
  readonly isOpponentsTurn?: boolean;
  readonly creatureTypes?: readonly string[];
  readonly colors?: readonly string[];
  readonly counters?: Readonly<Record<string, number>>;
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

  const scalarCounterMap = (...fields: string[]): Record<string, number> | undefined => {
    const out: Record<string, number> = {};

    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      for (const field of fields) {
        const raw = (payload as any)[field];
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        for (const [key, value] of Object.entries(raw)) {
          const normalizedKey = String(key || '').trim();
          const amount = Number(value);
          if (!normalizedKey || !Number.isFinite(amount) || amount <= 0) continue;
          out[normalizedKey] = amount;
        }
      }
    }

    return Object.keys(out).length > 0 ? out : undefined;
  };

  const collectStrings = (...fields: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: any) => {
      if (typeof value !== 'string' && typeof value !== 'number') return;
      const normalized = String(value).trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
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
    'chosenObjectIds',
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
  const chosenObjectIds = collectIds('chosenObjectIds', 'cardId', 'objectId');
  const permanentTypes = collectStrings('permanentTypes');
  const creatureTypes = collectStrings('creatureTypes');
  const colors = collectStrings('colors');
  const keywords = collectStrings('keywords');
  const targetPermanentId =
    scalarString('targetPermanentId') ??
    (targetPlayerId || targetOpponentId ? undefined : singleton(targetIds));
  const targetId = scalarString('targetId') ?? targetPlayerId ?? targetOpponentId;
  const hand = collectIds('hand');
  const handAtBeginningOfTurn = collectIds('handAtBeginningOfTurn');
  const rawTapOrUntapChoice = scalarString('tapOrUntapChoice');
  const tapOrUntapChoice = rawTapOrUntapChoice === 'tap' || rawTapOrUntapChoice === 'untap' ? rawTapOrUntapChoice : undefined;
  const rawUnlessPaysLifeChoice = scalarString('unlessPaysLifeChoice');
  const unlessPaysLifeChoice =
    rawUnlessPaysLifeChoice === 'pay' || rawUnlessPaysLifeChoice === 'decline'
      ? rawUnlessPaysLifeChoice
      : undefined;

  return {
    sourceId,
    sourceControllerId: normalizedSourceControllerId,
    sourceOwnerId: scalarString('sourceOwnerId') ?? scalarString('ownerId') ?? scalarString('owner'),
    sourceIsToken: scalarBool('sourceIsToken') ?? scalarBool('isToken'),
    sourceIsFaceDown: scalarBool('sourceIsFaceDown') ?? scalarBool('faceDown'),
    castFromZone: scalarString('castFromZone'),
    enteredFromZone: scalarString('enteredFromZone'),
    attachedByPermanentIds: (() => {
      const ids = collectIds('attachedByPermanentIds', 'attachmentSourceIds');
      return ids.length > 0 ? ids : undefined;
    })(),
    sourceAttachedToPermanentIds: (() => {
      const ids = collectIds('sourceAttachedToPermanentIds', 'sourceAttachedToIds', 'sourceEquippedPermanentIds');
      return ids.length > 0 ? ids : undefined;
    })(),
    targetId,
    targetControllerId: scalarString('targetControllerId'),
    targetPermanentId,
    chosenObjectIds: chosenObjectIds.length > 0 ? chosenObjectIds : undefined,
    targetPlayerId,
    targetOpponentId,
    tapOrUntapChoice,
    unlessPaysLifeChoice,
    permanentTypes: permanentTypes.length > 0 ? permanentTypes : undefined,
    creatureTypes: creatureTypes.length > 0 ? creatureTypes : undefined,
    colors: colors.length > 0 ? colors : undefined,
    counters: scalarCounterMap('counters', 'counterMap'),
    keywords: keywords.length > 0 ? keywords : undefined,
    lifeTotal: scalarNumber('lifeTotal'),
    lifeLost: scalarNumber('lifeLost'),
    lifeGained: scalarNumber('lifeGained'),
    damageDealt: scalarNumber('damageDealt'),
    damagedByPermanentIds: (() => {
      const ids = collectIds('damagedByPermanentIds', 'damageSourceIds');
      return ids.length > 0 ? ids : undefined;
    })(),
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
      sourceOwnerId?: string;
      sourceIsToken?: boolean;
      sourceIsFaceDown?: boolean;
      castFromZone?: string;
      enteredFromZone?: string;
      attachedByPermanentIds?: readonly string[];
      sourceAttachedToPermanentIds?: readonly string[];
      targetId?: string;
    targetControllerId?: string;
    targetPermanentId?: string;
      chosenObjectIds?: readonly string[];
      targetPlayerId?: string;
      targetOpponentId?: string;
      tapOrUntapChoice?: 'tap' | 'untap';
      unlessPaysLifeChoice?: 'pay' | 'decline';
      counters?: Readonly<Record<string, number>>;
      affectedPlayerIds?: readonly string[];
    affectedOpponentIds?: readonly string[];
    opponentsDealtDamageIds?: readonly string[];
    lifeTotal?: number;
    lifeLost?: number;
    lifeGained?: number;
    damageDealt?: number;
    damagedByPermanentIds?: readonly string[];
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
      sourceOwnerId: normalized.sourceOwnerId,
      sourceIsToken: normalized.sourceIsToken,
      sourceIsFaceDown: normalized.sourceIsFaceDown,
      castFromZone: normalized.castFromZone,
      enteredFromZone: normalized.enteredFromZone,
      attachedByPermanentIds: normalized.attachedByPermanentIds,
      sourceAttachedToPermanentIds: normalized.sourceAttachedToPermanentIds,
      targetId: normalized.targetId,
      targetControllerId: normalized.targetControllerId,
      targetPermanentId: normalized.targetPermanentId,
      chosenObjectIds: normalized.chosenObjectIds,
      targetPlayerId: normalized.targetPlayerId,
      targetOpponentId: normalized.targetOpponentId,
      tapOrUntapChoice: normalized.tapOrUntapChoice,
      unlessPaysLifeChoice: normalized.unlessPaysLifeChoice,
      counters: normalized.counters,
      affectedPlayerIds: normalized.affectedPlayerIds,
      affectedOpponentIds: normalized.affectedOpponentIds,
      opponentsDealtDamageIds: normalized.opponentsDealtDamageIds,
      lifeTotal: normalized.lifeTotal,
      lifeLost: normalized.lifeLost,
      lifeGained: normalized.lifeGained,
      damageDealt: normalized.damageDealt,
      damagedByPermanentIds: normalized.damagedByPermanentIds,
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

  const normalizedChosenObjectIds = dedupe(eventData.chosenObjectIds);

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
    chosenObjectIds: normalizedChosenObjectIds,
    tapOrUntapChoice: eventData.tapOrUntapChoice,
    unlessPaysLifeChoice: eventData.unlessPaysLifeChoice,
    affectedPlayerIds: dedupe(eventData.affectedPlayerIds),
    affectedOpponentIds: dedupedAffectedOpponents,
    opponentsDealtDamageIds: dedupedOpponentsDealtDamage,
    spellType: eventData.spellType,
    castFromZone: typeof eventData.castFromZone === 'string' ? eventData.castFromZone : undefined,
    enteredFromZone: typeof eventData.enteredFromZone === 'string' ? eventData.enteredFromZone : undefined,
    wonCoinFlip: eventData.wonCoinFlip,
    winningVoteChoice: eventData.winningVoteChoice ?? undefined,
  };

  if (
    !hint.targetPlayerId &&
    !hint.targetOpponentId &&
    !hint.targetPermanentId &&
    !hint.chosenObjectIds &&
    !hint.tapOrUntapChoice &&
    !hint.unlessPaysLifeChoice &&
    !hint.affectedPlayerIds &&
    !hint.affectedOpponentIds &&
    !hint.opponentsDealtDamageIds &&
    !hint.spellType &&
    !hint.castFromZone &&
    !hint.enteredFromZone &&
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
  const normalizedSourceId = normalizeId(base?.sourceId);
  const normalizedTargetPermanentId = normalizeId(base?.targetPermanentId);
  const findZoneCardById = (cardId: string | undefined): any => {
    const normalizedCardId = normalizeId(cardId);
    if (!normalizedCardId) return undefined;

    for (const player of state.players || []) {
      for (const zoneName of ['graveyard', 'hand', 'exile', 'library'] as const) {
        const zone = Array.isArray((player as any)?.[zoneName]) ? (player as any)[zoneName] : [];
        const found = zone.find((card: any) => normalizeId(card?.id) === normalizedCardId);
        if (found) return found;
      }
    }

    return undefined;
  };

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
  const resolvedGraveyard = Array.isArray(controller?.graveyard)
    ? controller.graveyard
        .map((card: any) => normalizeId(card?.id))
        .filter((id: string | undefined): id is string => Boolean(id))
    : Array.isArray(base?.graveyard)
      ? [...base.graveyard]
      : undefined;
  const referencedPermanent = ((state.battlefield || []) as any[]).find((perm: any) => {
    const permId = normalizeId(perm?.id);
    return Boolean(
      permId &&
      (
        (normalizedTargetPermanentId && permId === normalizedTargetPermanentId) ||
        (normalizedSourceId && permId === normalizedSourceId)
      )
    );
  }) as any;
  const referencedCard =
    findZoneCardById(normalizedTargetPermanentId) ??
    findZoneCardById(normalizedSourceId);
  const resolvedCastFromZone =
    base?.castFromZone ??
    normalizeId(referencedPermanent?.castFromZone) ??
    normalizeId(referencedPermanent?.card?.castFromZone);
  const resolvedEnteredFromZone =
    base?.enteredFromZone ??
    normalizeId(referencedPermanent?.enteredFromZone) ??
    normalizeId(referencedPermanent?.card?.enteredFromZone);
  const resolvedDamagedByPermanentIds =
    Array.isArray(base?.damagedByPermanentIds) && base.damagedByPermanentIds.length > 0
      ? [...base.damagedByPermanentIds]
      : Array.isArray((referencedPermanent as any)?.damageSourceIds) && (referencedPermanent as any).damageSourceIds.length > 0
        ? [...(referencedPermanent as any).damageSourceIds]
        : Array.isArray((referencedCard as any)?.damageSourceIds) && (referencedCard as any).damageSourceIds.length > 0
          ? [...(referencedCard as any).damageSourceIds]
          : undefined;
  const resolvedSourceAttachedToPermanentIds =
    Array.isArray(base?.sourceAttachedToPermanentIds) && base.sourceAttachedToPermanentIds.length > 0
      ? [...base.sourceAttachedToPermanentIds]
      : (() => {
          const sourcePermanent = ((state.battlefield || []) as any[]).find(
            (perm: any) => normalizeId(perm?.id) === normalizedSourceId
          ) as any;
          const attachedToId = normalizeId(sourcePermanent?.attachedTo ?? sourcePermanent?.enchanting);
          return attachedToId ? [attachedToId] : undefined;
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
    castFromZone: resolvedCastFromZone,
    enteredFromZone: resolvedEnteredFromZone,
    damagedByPermanentIds: resolvedDamagedByPermanentIds,
    sourceAttachedToPermanentIds: resolvedSourceAttachedToPermanentIds,
    graveyard: resolvedGraveyard,
    hand: resolvedHand,
    handAtBeginningOfTurn: resolvedHandAtBeginningOfTurn,
    battlefield,
  };
}
