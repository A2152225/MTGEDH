import type { GameState, PlayerID } from '../../shared/src';
import { parseCopyTokenOverrides } from '../../shared/src/copyTokenOverrides.js';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { attachExistingBattlefieldPermanentToTarget } from './oracleIRExecutorZoneOps';
import {
  createCopiedTokenPermanent,
  typeLineHasWord,
} from './oracleIRExecutorTokenCopySource';
import {
  applyBlockingEntryToCreatedTokens,
  resolveBlockTargetPermanentId,
} from './oracleIRExecutorTokenBlockingEntry';
import {
  addTokensToBattlefield,
  resolveTokenAmount,
  resolveTokenCreationSpecsForReplacementEffects,
} from './oracleIRExecutorTokenBattlefieldAdd';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
import {
  collectThisWayDestroyedObjects,
  resolveReferencedObjectPlayerIds,
  type ReferencedObjectRole,
  type ReferencedObjectRuntime,
} from './oracleIRExecutorReferenceUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly createdTokenIds?: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unknown_amount' | 'unsupported_player_selector' | 'player_choice_required' | 'impossible_action';
  readonly options?: {
    readonly classification?: 'ambiguous' | 'player_choice';
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

export type TokenStepHandlerResult = StepApplyResult | StepSkipResult;

type TokenStepRuntime = {
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastMovedCards?: readonly any[];
  readonly lastMilledCards?: readonly any[];
  readonly lastReferenceAmount?: number;
  readonly lastSacrificedPermanents?: readonly any[];
  readonly lastCreatedTokenIds?: readonly string[];
};

type TokenCreationSpec = {
  readonly tokenHint: string;
  readonly amount: number;
};

function scheduleTokenCleanup(
  state: GameState,
  controllerId: PlayerID,
  sourceName: string | undefined,
  sourceId: string | undefined,
  tokenIds: readonly string[],
  timing: DelayedTriggerTiming,
  action: 'sacrifice' | 'exile'
): { state: GameState; log: string[] } {
  const normalizedTokenIds = tokenIds.map(id => String(id || '').trim()).filter(Boolean);
  if (normalizedTokenIds.length === 0) {
    return { state, log: [] };
  }

  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const effect =
    action === 'exile'
      ? normalizedTokenIds.length === 1
        ? 'Exile that token.'
        : 'Exile those tokens.'
      : normalizedTokenIds.length === 1
        ? 'Sacrifice that token.'
        : 'Sacrifice those tokens.';

  const delayedTrigger = createDelayedTrigger(
    String(sourceId || sourceName || 'oracle-ir'),
    String(sourceName || 'Delayed cleanup'),
    controllerId,
    timing,
    effect,
    currentTurn,
    {
      targets: [...normalizedTokenIds],
      eventDataSnapshot: {
        sourceId: sourceId ? String(sourceId).trim() : undefined,
        sourceControllerId: String(controllerId || '').trim() || undefined,
        targetPermanentId: normalizedTokenIds.length === 1 ? normalizedTokenIds[0] : undefined,
        chosenObjectIds: normalizedTokenIds,
      },
    }
  );

  const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
  return {
    state: {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState,
    log: [
      `Scheduled delayed ${action} for ${normalizedTokenIds.length} token(s) at ${timing.replace(/_/g, ' ')}`,
    ],
  };
}

function resolveForEachAttachedCopyHostId(
  ctx: OracleIRExecutionContext,
  raw: string
): string {
  const sourceId = String(ctx.sourceId || '').trim();
  if (/attached to (?:it|that creature)\b/i.test(raw)) {
    return String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.targetPermanentId ||
        ''
    ).trim();
  }
  return sourceId;
}

function resolveAttachedCopyAttachTargetId(
  ctx: OracleIRExecutionContext,
  runtime: TokenStepRuntime | undefined,
  raw: string,
  fallbackHostId: string
): string {
  if (/attached to this permanent twin\b/i.test(raw)) {
    const createdIds = Array.isArray(runtime?.lastCreatedTokenIds)
      ? runtime.lastCreatedTokenIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (createdIds.length === 1) return createdIds[0];
    const movedIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
      ? runtime.lastMovedBattlefieldPermanentIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (movedIds.length === 1) return movedIds[0];
  }
  if (/attached to that creature\b/i.test(raw)) return fallbackHostId;
  return '';
}

function tryApplyForEachAttachedCopyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime
): TokenStepHandlerResult | null {
  const raw = String(step.raw || '').toLowerCase();
  const wantsNontokenAttached = /for each nontoken permanent attached to (?:it|that creature|this permanent)\b/.test(raw);
  const wantsAuraEquipment = /for each aura and equipment attached to (?:this permanent|it|stangg)\b/.test(raw);
  if (!wantsNontokenAttached && !wantsAuraEquipment) return null;

  const hostId = resolveForEachAttachedCopyHostId(ctx, raw);
  if (!hostId) {
    return {
      applied: false,
      message: `Skipped token creation (copy source unavailable): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const attachments = (state.battlefield || []).filter((perm: any) => {
    if (String(perm?.attachedTo || '').trim() !== hostId) return false;
    if (wantsAuraEquipment) {
      return typeLineHasWord(perm, 'enchantment') || typeLineHasWord(perm, 'equipment');
    }
    return !perm?.isToken;
  });
  if (attachments.length === 0) {
    return { applied: true, state, log: ['No attached permanents to copy'], createdTokenIds: [] };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const attachTargetId = resolveAttachedCopyAttachTargetId(ctx, runtime, raw, hostId);
  let nextState = state;
  const log: string[] = [];
  const createdTokenIds: string[] = [];

  for (const attachment of attachments) {
    const token = createCopiedTokenPermanent({
      sourceObject: attachment,
      controllerId,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      copySourcePermanentId: String((attachment as any)?.id || '').trim(),
      overrides: parseCopyTokenOverrides(''),
    }) as any;
    nextState = {
      ...nextState,
      battlefield: [...(nextState.battlefield || []), token],
    };
    const tokenId = String(token.id || '').trim();
    if (tokenId) createdTokenIds.push(tokenId);
    if (attachTargetId) {
      const attachResult = attachExistingBattlefieldPermanentToTarget(nextState, tokenId, attachTargetId);
      if (attachResult.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped token creation (attachment target unavailable): ${step.raw}`,
          reason: 'impossible_action',
        };
      }
      nextState = attachResult.state;
      log.push(...attachResult.log);
    }
    log.push(`Created attached copy token for ${String((attachment as any)?.name || 'permanent')}`);
  }

  return { applied: true, state: nextState, log, createdTokenIds };
}

function tryApplyForEachAttackingCopyTokenStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime
): TokenStepHandlerResult | null {
  const raw = String(step.raw || '').toLowerCase();
  if (
    !/for each creature attacking you or a planeswalker you control,\s*create a token that's a copy of that creature and that's blocking that creature/i.test(
      raw
    )
  ) {
    return null;
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const attackers = (state.battlefield || []).filter((perm: any) => {
    if (!typeLineHasWord(perm, 'creature')) return false;
    const attacking = String(perm?.attacking || perm?.attackingPlayerId || '').trim();
    if (attacking === controllerId) return true;
    if (!attacking) return false;
    const attackedPermanent = (state.battlefield || []).find(
      (candidate: any) => String(candidate?.id || '').trim() === attacking
    ) as any;
    return (
      attackedPermanent &&
      String(attackedPermanent?.controller || '').trim() === controllerId &&
      typeLineHasWord(attackedPermanent, 'planeswalker')
    );
  });
  if (attackers.length === 0) {
    return { applied: true, state, log: ['No attacking creatures to copy'], createdTokenIds: [] };
  }

  let nextState = state;
  const log: string[] = [];
  const createdTokenIds: string[] = [];
  for (const attacker of attackers) {
    const attackerId = String((attacker as any)?.id || '').trim();
    const defendingPlayerId = String((attacker as any)?.attacking || (attacker as any)?.attackingPlayerId || '').trim();
    const result = addTokensToBattlefield(
      nextState,
      controllerId,
      1,
      'that creature',
      step.raw,
      ctx,
      { ...runtime, lastMovedCards: [attacker], lastMovedBattlefieldPermanentIds: attackerId ? [attackerId] : [] },
      step.entersTapped,
      step.withCounters,
      defendingPlayerId || undefined,
      step.grantsHaste === 'until_end_of_turn' ? ['haste'] : step.grantsAbilitiesUntilEndOfTurn,
      Array.from(new Set([...(step.grantsHaste === 'permanent' ? ['haste'] : []), ...((step as any).grantsAbilitiesPermanent || [])]))
    );
    if (!result.applied) return result;
    nextState = result.state;
    log.push(...result.log);
    createdTokenIds.push(...(result.createdTokenIds || []));
  }

  return { applied: true, state: nextState, log, createdTokenIds };
}


const FOR_EACH_DESTROYED_REFERENCED_CONTROLLER_CREATE =
  /^for each\s+(.+?),\s+(?:its|their)\s+(controller|owner)\s+creates/i;

const FOR_EACH_DESTROYED_CREATE_COPY =
  /^for each\s+(.+?)\s+destroyed this way,\s+create(?:\s+a)?\s+token(?:s)?\s+that(?:'s| is| are)\s+(?:a\s+)?copy\s+of\s+/i;

function tryApplyForEachDestroyedThisWayCreateCopyToken(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime,
): TokenStepHandlerResult | null {
  const raw = String(step.raw || '').trim();
  if (!FOR_EACH_DESTROYED_CREATE_COPY.test(raw)) return null;
  if (step.who?.kind && step.who.kind !== 'you') return null;

  const match = raw.match(FOR_EACH_DESTROYED_CREATE_COPY);
  const countedExpression = String(match?.[1] || '').trim();
  const controllerId = String(ctx.controllerId || '').trim() as PlayerID;
  const destroyedObjects = collectThisWayDestroyedObjects(
    ctx,
    countedExpression,
    runtime as ReferencedObjectRuntime | undefined,
    step,
  );
  if (destroyedObjects.length === 0) {
    return { applied: true, state, log: ['No destroyed objects for for-each copy rider'] };
  }

  let nextState = state;
  const log: string[] = [];
  const allCreatedTokenIds: string[] = [];

  for (const destroyedObject of destroyedObjects) {
    const objectId = String(destroyedObject?.id || destroyedObject?.objectId || '').trim();
    if (!objectId) continue;

    const iterationCtx = buildReferencedObjectIterationContext(ctx, objectId);
    const result = addTokensToBattlefield(
      nextState,
      controllerId,
      1,
      step.token,
      step.raw,
      iterationCtx,
      runtime,
      step.entersTapped,
      step.withCounters,
      step.attacking === 'defending_player'
        ? String(
            ctx.selectorContext?.targetOpponentId ||
              ctx.selectorContext?.targetPlayerId ||
              (ctx as any).targetOpponentId ||
              (ctx as any).targetPlayerId ||
              '',
          ).trim() || undefined
        : undefined,
      undefined,
      undefined,
      step.blocking === 'that_creature' ? resolveBlockTargetPermanentId(state, step, ctx) : undefined,
    );
    if (!result.applied) return result;
    nextState = result.state;
    log.push(...result.log);
    if (Array.isArray(result.createdTokenIds)) {
      allCreatedTokenIds.push(...result.createdTokenIds);
    }
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Created ${allCreatedTokenIds.length} copy token(s) for destroyed objects`],
    createdTokenIds: allCreatedTokenIds,
  };
}

function buildReferencedObjectIterationContext(
  ctx: OracleIRExecutionContext,
  objectId: string,
): OracleIRExecutionContext {
  const normalizedId = String(objectId || '').trim();
  const {
    targetPlayerId: _targetPlayerId,
    targetOpponentId: _targetOpponentId,
    ...ctxWithoutPlayerBinding
  } = ctx as OracleIRExecutionContext & { targetOpponentId?: string };
  const {
    targetPlayerId: _selectorTargetPlayerId,
    targetOpponentId: _selectorTargetOpponentId,
    ...selectorWithoutPlayerBinding
  } = (ctx.selectorContext || {}) as Record<string, unknown>;
  return {
    ...ctxWithoutPlayerBinding,
    targetPermanentId: normalizedId,
    targetCreatureId: normalizedId,
    lastReferencedPermanentId: normalizedId,
    selectorContext: {
      ...selectorWithoutPlayerBinding,
      chosenObjectIds: [normalizedId],
      targetPermanentId: normalizedId,
      targetCreatureId: normalizedId,
    },
  };
}

function tryApplyForEachDestroyedThisWayPerControllerCreateToken(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime,
): TokenStepHandlerResult | null {
  const raw = String(step.raw || '').trim();
  const match = raw.match(FOR_EACH_DESTROYED_REFERENCED_CONTROLLER_CREATE);
  if (!match) return null;

  const who = step.who as { kind?: string } | undefined;
  const role: ReferencedObjectRole =
    who?.kind === 'owner_of_referenced_object' ? 'owner' : 'controller';
  if (who?.kind !== 'controller_of_referenced_object' && who?.kind !== 'owner_of_referenced_object') {
    return null;
  }

  const countedExpression = String(match[1] || '').trim();
  const destroyedObjects = collectThisWayDestroyedObjects(
    ctx,
    countedExpression,
    runtime as ReferencedObjectRuntime | undefined,
    step,
  );
  if (destroyedObjects.length === 0) {
    return { applied: true, state, log: ['No destroyed objects for for-each token rider'] };
  }

  const defendingPlayerId = String(
    ctx.selectorContext?.targetOpponentId ||
      ctx.selectorContext?.targetPlayerId ||
      (ctx as any).targetOpponentId ||
      (ctx as any).targetPlayerId ||
      ''
  ).trim();
  const blockTargetPermanentId = resolveBlockTargetPermanentId(state, step, ctx);

  let nextState = state;
  const log: string[] = [];
  const allCreatedTokenIds: string[] = [];
  const runtimeRef: ReferencedObjectRuntime = {
    lastMovedCards: runtime?.lastMovedCards,
    lastSacrificedPermanents: runtime?.lastSacrificedPermanents,
  };

  for (const destroyedObject of destroyedObjects) {
    const objectId = String(destroyedObject?.id || destroyedObject?.objectId || '').trim();
    if (!objectId) continue;

    const iterationCtx = buildReferencedObjectIterationContext(ctx, objectId);
    const players = resolveReferencedObjectPlayerIds(state, iterationCtx, role, runtimeRef);
    const playerId = String(players[0] || '').trim() as PlayerID;
    if (!playerId) continue;

    const result = addTokensToBattlefield(
      nextState,
      playerId,
      1,
      step.token,
      step.raw,
      iterationCtx,
      runtime,
      step.entersTapped,
      step.withCounters,
      step.attacking === 'defending_player' ? defendingPlayerId : undefined,
      undefined,
      undefined,
      step.blocking === 'that_creature' ? blockTargetPermanentId : undefined,
    );
    if (!result.applied) return result;
    nextState = result.state;
    log.push(...result.log);
    if (Array.isArray(result.createdTokenIds)) {
      allCreatedTokenIds.push(...result.createdTokenIds);
    }
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Created ${allCreatedTokenIds.length} token(s) for destroyed objects`],
    createdTokenIds: allCreatedTokenIds,
  };
}

export function applyCreateTokenStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime
): TokenStepHandlerResult {
  const attachedCopyResult = tryApplyForEachAttachedCopyStep(state, step, ctx, runtime);
  if (attachedCopyResult) return attachedCopyResult;

  const attackingCopyResult = tryApplyForEachAttackingCopyTokenStep(state, step, ctx, runtime);
  if (attackingCopyResult) return attackingCopyResult;

  const forEachDestroyedCopyResult = tryApplyForEachDestroyedThisWayCreateCopyToken(
    state,
    step,
    ctx,
    runtime,
  );
  if (forEachDestroyedCopyResult) return forEachDestroyedCopyResult;

  const forEachDestroyedResult = tryApplyForEachDestroyedThisWayPerControllerCreateToken(
    state,
    step,
    ctx,
    runtime,
  );
  if (forEachDestroyedResult) return forEachDestroyedResult;

  const amount = resolveTokenAmount(state, step, ctx, runtime);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped token creation (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }
  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Created 0 tokens: ${step.raw}`],
      createdTokenIds: [],
    };
  }

  const players = resolvePlayers(state, step.who, ctx, {
    lastMovedCards: runtime?.lastMovedCards,
    lastSacrificedPermanents: runtime?.lastSacrificedPermanents,
  });
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped token creation (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const defendingPlayerId = String(
    ctx.selectorContext?.targetOpponentId ||
      ctx.selectorContext?.targetPlayerId ||
      (ctx as any).targetOpponentId ||
      (ctx as any).targetPlayerId ||
      ''
  ).trim();
  const blockTargetPermanentId = resolveBlockTargetPermanentId(state, step, ctx);

  let nextState = state;
  const log: string[] = [];
  const allCreatedTokenIds: string[] = [];
  for (const playerId of players) {
    const attackTargets =
      step.attacking === 'each_opponent'
        ? (nextState.players || [])
            .map((player: any) => String(player?.id || '').trim())
            .filter((id: string) => id.length > 0 && id !== playerId)
        : step.attacking === 'defending_player'
          ? [defendingPlayerId]
        : step.attacking === 'each_other_opponent'
          ? (nextState.players || [])
              .map((player: any) => String(player?.id || '').trim())
              .filter((id: string) => id.length > 0 && id !== playerId && id !== defendingPlayerId)
        : [undefined];

    for (const attackTarget of attackTargets) {
      const tokenSpecs = resolveTokenCreationSpecsForReplacementEffects(nextState, playerId, step.token, amount);
      const createdForAttackTarget: string[] = [];
      for (const tokenSpec of tokenSpecs) {
        const result = addTokensToBattlefield(
          nextState,
          playerId,
          tokenSpec.amount,
          tokenSpec.tokenHint,
          step.raw,
          ctx,
          runtime,
          step.entersTapped,
          step.withCounters,
          attackTarget,
          step.grantsHaste === 'until_end_of_turn' ? ['haste'] : step.grantsAbilitiesUntilEndOfTurn,
          Array.from(
            new Set([
              ...(step.grantsHaste === 'permanent' ? ['haste'] : []),
              ...((step as any).grantsAbilitiesPermanent || []),
            ]),
          ),
          blockTargetPermanentId,
        );
        if (!result.applied) return result;
        nextState = blockTargetPermanentId
          ? applyBlockingEntryToCreatedTokens(result.state, result.createdTokenIds, blockTargetPermanentId)
          : result.state;
        log.push(...result.log);
        allCreatedTokenIds.push(...result.createdTokenIds);
        createdForAttackTarget.push(...result.createdTokenIds);
      }

      if (createdForAttackTarget.length > 0 && step.battlefieldAttachedTo) {
        if ((step.battlefieldAttachedTo as any)?.kind !== 'raw') {
          return {
            applied: false,
            message: `Skipped token creation (unsupported attachment selector): ${step.raw}`,
            reason: 'unsupported_player_selector',
          };
        }

        const attachmentTargetText = String((step.battlefieldAttachedTo as any)?.text || '').trim().toLowerCase();
        const priorMovedIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
          ? runtime.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
          : [];
        const createdTokenIds = Array.isArray(runtime?.lastCreatedTokenIds)
          ? runtime.lastCreatedTokenIds.map((id) => String(id || '').trim()).filter(Boolean)
          : [];
        const battlefieldIds = new Set(
          ((nextState.battlefield || []) as any[])
            .map((perm: any) => String(perm?.id || '').trim())
            .filter(Boolean)
        );
        const isSelfReference =
          attachmentTargetText === 'that creature' ||
          attachmentTargetText === 'it' ||
          attachmentTargetText === 'enchanted creature' ||
          attachmentTargetText === 'enchanted permanent';
        // "return it to the battlefield, then create a token attached to it" gives the card a fresh
        // permanent id, so the recently moved id is tried before the now-stale bound target id.
        const attachmentCandidateIds =
          attachmentTargetText === 'this permanent twin'
            ? [
                createdTokenIds.length === 1 ? createdTokenIds[0] : '',
                priorMovedIds.length === 1 ? priorMovedIds[0] : '',
              ]
            : isSelfReference
              ? [
                  priorMovedIds.length === 1 ? priorMovedIds[0] : '',
                  String(ctx.targetPermanentId || ''),
                  String(ctx.targetCreatureId || ''),
                ]
              : [];
        const attachmentTargetId =
          attachmentCandidateIds
            .map((id) => String(id || '').trim())
            .find((id) => id.length > 0 && battlefieldIds.has(id)) || '';

        if (!attachmentTargetId) {
          return {
            applied: false,
            message: `Skipped token creation (attachment target unavailable): ${step.raw}`,
            reason: 'unsupported_player_selector',
          };
        }

        for (const tokenId of createdForAttackTarget) {
          const attachResult = attachExistingBattlefieldPermanentToTarget(nextState, tokenId, attachmentTargetId);
          if (attachResult.kind === 'impossible') {
            return {
              applied: false,
              message: `Skipped token creation (attachment target unavailable): ${step.raw}`,
              reason: 'unsupported_player_selector',
            };
          }
          nextState = attachResult.state;
          log.push(...attachResult.log);
        }
      }

      if (createdForAttackTarget.length > 0 && step.atNextEndStep) {
        const scheduled = scheduleTokenCleanup(
          nextState,
          playerId,
          ctx.sourceName,
          ctx.sourceId,
          createdForAttackTarget,
          DelayedTriggerTiming.NEXT_END_STEP,
          step.atNextEndStep
        );
        nextState = scheduled.state;
        log.push(...scheduled.log);
      }

      if (createdForAttackTarget.length > 0 && step.atEndOfCombat) {
        const scheduled = scheduleTokenCleanup(
          nextState,
          playerId,
          ctx.sourceName,
          ctx.sourceId,
          createdForAttackTarget,
          DelayedTriggerTiming.END_OF_COMBAT,
          step.atEndOfCombat
        );
        nextState = scheduled.state;
        log.push(...scheduled.log);
      }
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    createdTokenIds: allCreatedTokenIds,
  };
}
