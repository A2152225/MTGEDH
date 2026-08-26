// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: applyCreateEmblemStep, grant/modify graveyard+exile permission steps,
// applyModifyTokenCreationStep, applyJoinForcesStep (+ exclusive GY permission ID helpers).
// Public entries: applyCreateEmblemStep, applyGrantGraveyardPermissionStep,
// applyGrantGraveyardKeywordAbilityStep, applyGrantExilePermissionStep,
// applyModifyGraveyardPermissionsStep, applyModifyTokenCreationStep,
// applyJoinForcesStep, mergeGrantedGraveyardPermissionSourceText.

import type { GameState, PlayerID } from '../../shared/src';
import { createCustomEmblem } from './emblemSupport';
import { oracleGraveyardAdditionalCostToSerializable } from './graveyardPermissionAdditionalCost';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  buildTemporaryGraveyardKeywordGrantStamps,
  extractGrantedGraveyardKeywordFromRaw,
  findGraveyardOwnerIdForCard,
  mergeTemporaryGraveyardKeywordGrantStamps,
  normalizePermissionSelectorText,
  resolveExilePermissionTargets,
  resolveGraveyardPermissionTargets,
  resolvePrintedManaCostForGraveyardGrant,
} from './oracleIRExecutorPlayerGraveyardPermissionHelpers';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import {
  applyExilePermissionMarkers,
  applyGraveyardPermissionMarkers,
  getPlayableUntilTurnForImpulseDuration,
  normalizeOracleText,
  resolvePlayers,
} from './oracleIRExecutorPlayerUtils';

function sanitizeGrantedGraveyardPermissionIdPart(value: unknown): string {
  return normalizeOracleText(String(value || ''))
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function buildGrantedGraveyardPermissionId(options: {
  playerId: PlayerID;
  permission: 'play' | 'cast';
  sourceId?: string;
  sourceName?: string;
  qualifier?: string;
  cardIds?: string[];
  turnApplied: number;
}): string {
  const sourcePart = sanitizeGrantedGraveyardPermissionIdPart(options.sourceId || options.sourceName || 'source');
  const qualifierPart = sanitizeGrantedGraveyardPermissionIdPart(
    options.qualifier || (Array.isArray(options.cardIds) ? options.cardIds.join('_') : '') || 'cards'
  );
  return [
    'graveyard-permission',
    options.playerId,
    options.permission,
    sourcePart || 'source',
    qualifierPart || 'cards',
    Number(options.turnApplied || 0) || 0,
  ].map(sanitizeGrantedGraveyardPermissionIdPart).filter(Boolean).join(':');
}

function normalizeGrantedGraveyardPermissionDuration(duration: Extract<Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>['duration'], string>): 'this_turn' | 'until_end_of_next_turn' {
  switch (duration) {
    case 'during_next_turn':
    case 'until_end_of_next_turn':
    case 'until_end_of_combat_on_next_turn':
    case 'until_next_turn':
    case 'until_next_upkeep':
    case 'until_next_end_step':
      return 'until_end_of_next_turn';
    default:
      return 'this_turn';
  }
}

export function mergeGrantedGraveyardPermissionSourceText(
  existingSourceText: string,
  modifierSourceText: string,
): string {
  const base = String(existingSourceText || '').trim();
  const tail = String(modifierSourceText || '').trim();
  if (!base) {
    return tail;
  }
  if (!tail) {
    return base;
  }

  const collapse = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedBase = collapse(base);
  const normalizedTail = collapse(tail);

  if (normalizedBase.includes(normalizedTail)) {
    return base;
  }

  const byClauseMatch = base.match(/\bby\s+(.+?)\s+in addition to paying\b/i);
  if (byClauseMatch) {
    const byClause = collapse(byClauseMatch[1] || '');
    if (byClause.includes(normalizedTail) || normalizedTail.includes(byClause)) {
      return base;
    }
  }

  return `${base} ${tail}`.trim();
}

function buildFirstClassGrantedGraveyardPermission(
  state: GameState,
  playerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>,
  ctx: OracleIRExecutionContext,
  resolvedCards: readonly any[],
): any | undefined {
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const selectorText =
    step.what.kind === 'raw'
      ? normalizePermissionSelectorText(step.what.text)
      : normalizePermissionSelectorText((step.what as any).raw || '');
  const contextualReference = /^(?:it|that card|that spell|the discarded card|target .+?)$/.test(selectorText);
  const selfReference = /^(?:this card|this spell|this permanent|this creature)$/.test(selectorText);
  const cardIds = (contextualReference || selfReference)
    ? (Array.isArray(resolvedCards) ? resolvedCards : [])
        .map((card: any) => String(card?.id || card?.cardId || '').trim())
        .filter(Boolean)
    : [];
  const qualifier = !contextualReference && !selfReference ? selectorText : '';
  if (!qualifier && cardIds.length === 0) {
    return undefined;
  }

  const turnApplied = Number((state as any)?.turnNumber ?? (state as any)?.turn ?? 0) || 0;
  const rawText = String(step.raw || '').trim();
  return {
    id: buildGrantedGraveyardPermissionId({
      playerId,
      permission: step.permission,
      ...(sourceId ? { sourceId } : {}),
      ...(sourceName ? { sourceName } : {}),
      ...(qualifier ? { qualifier } : {}),
      ...(cardIds.length > 0 ? { cardIds } : {}),
      turnApplied,
    }),
    playerId,
    permission: step.permission,
    sourceZone: 'graveyard',
    cardFilter: {
      ...(qualifier ? { qualifier } : {}),
      ...(cardIds.length > 0 ? { cardIds } : {}),
    },
    costMode: 'normal',
    duration: normalizeGrantedGraveyardPermissionDuration(step.duration),
    turnApplied,
    ...(sourceId ? { sourceId } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(rawText ? { sourceText: rawText } : {}),
    ...( /\bonce during each of your turns\b/i.test(rawText)
      ? { usageLimit: { type: 'once_per_turn', maxUses: 1 } }
      : {}),
  };
}

export function applyCreateEmblemStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_emblem' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const player = (state.players || []).find(p => p?.id === controllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped create emblem (controller unavailable): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  // An emblem is named after the card that made it ("Liliana, Waker of the Dead Emblem"), so the
  // source name alone is not a usable emblem name. The parser supplies step.name already suffixed
  // when it knows the card, and this covers the case where it does not.
  const parsedEmblemName = String(step.name || '').trim();
  const sourceEmblemName = String(ctx.sourceName || '').trim();
  const emblemName =
    parsedEmblemName ||
    (sourceEmblemName ? (/\bemblem$/i.test(sourceEmblemName) ? sourceEmblemName : `${sourceEmblemName} Emblem`) : '') ||
    'Emblem';
  const result = createCustomEmblem(
    controllerId,
    emblemName,
    [...step.abilities],
    ctx.sourceName,
    ctx.sourceId
  );
  const currentEmblems = Array.isArray(player.emblems) ? [...player.emblems] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === controllerId ? ({ ...(p as any), emblems: [...currentEmblems, result.emblem] } as any) : p
  );

  return {
    applied: true,
    state: { ...state, players: updatedPlayers as any } as any,
    log: result.log,
  };
}

export function applyGrantGraveyardPermissionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped graveyard permission (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  let nextState = state;
  let granted = 0;
  const grantedCards: any[] = [];
  const grantedPermissionIds: string[] = [];
  const log: string[] = [];
  const keywordGrant = extractGrantedGraveyardKeywordFromRaw(step.raw);
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const stampKeywordGrants = Boolean(
    keywordGrant &&
    (step.duration === 'this_turn' || step.duration === 'until_end_of_next_turn' || step.duration === 'until_next_turn')
  );
  const keywordGrantStamps: ReturnType<typeof buildTemporaryGraveyardKeywordGrantStamps> = [];

  for (const playerId of players) {
    const resolved = resolveGraveyardPermissionTargets(nextState, playerId, step, ctx);
    if (resolved.reason === 'unsupported_selector') {
      return {
        applied: false,
        message: `Skipped graveyard permission (unsupported selector): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'ambiguous' },
      };
    }
    if (resolved.reason === 'failed_to_apply') {
      return {
        applied: false,
        message: `Skipped graveyard permission (referenced card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const markerResult = applyGraveyardPermissionMarkers(nextState, playerId, resolved.cards, {
      permission: step.permission,
      playableUntilTurn,
    });
    nextState = markerResult.state;

    const firstClassPermission = buildFirstClassGrantedGraveyardPermission(nextState, playerId, step, ctx, resolved.cards);
    if (firstClassPermission) {
      const nextStateAny: any = nextState as any;
      const existingPermissions = Array.isArray(nextStateAny.graveyardCastingPermissions)
        ? nextStateAny.graveyardCastingPermissions.filter((permission: any) => String(permission?.id || '') !== String(firstClassPermission.id || ''))
        : [];
      nextState = {
        ...(nextStateAny as any),
        graveyardCastingPermissions: [...existingPermissions, firstClassPermission],
      } as any;
      grantedPermissionIds.push(String(firstClassPermission.id || ''));
    }

    granted += markerResult.granted;
    grantedCards.push(...resolved.cards);
    if (markerResult.granted > 0) {
      log.push(`${playerId} may ${step.permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} graveyard card(s)`);
    }
    if (stampKeywordGrants && keywordGrant) {
      keywordGrantStamps.push(...buildTemporaryGraveyardKeywordGrantStamps({
        state: nextState,
        playerId,
        cards: resolved.cards,
        keyword: keywordGrant.keyword,
        resolveCost: (card) => keywordGrant.explicitCost || resolvePrintedManaCostForGraveyardGrant(card),
        ...(sourceId ? { sourceId } : {}),
        ...(sourceName ? { sourceName } : {}),
        expiresAt: step.duration === 'this_turn' ? 'end_of_turn' : step.duration,
      }));
    }
  }

  if (keywordGrantStamps.length > 0) {
    nextState = mergeTemporaryGraveyardKeywordGrantStamps(nextState, keywordGrantStamps);
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Granted no graveyard permissions: ${step.raw}`],
    lastGrantedGraveyardCards: grantedCards,
    lastGrantedGraveyardPermissionIds: grantedPermissionIds,
  };
}

export function applyGrantGraveyardKeywordAbilityStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_keyword_ability' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped graveyard keyword grant (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  let nextStateAny: any = { ...(state as any) };
  let changed = 0;
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const temporaryGrantEntries: any[] = [];
  for (const playerId of players) {
    const resolved = resolveGraveyardPermissionTargets(nextStateAny as GameState, playerId, step, ctx);
    if (resolved.reason === 'unsupported_selector') {
      return {
        applied: false,
        message: `Skipped graveyard keyword grant (unsupported selector): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'ambiguous' },
      };
    }
    if (resolved.reason === 'failed_to_apply') {
      return {
        applied: false,
        message: `Skipped graveyard keyword grant (referenced card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const targetIds = new Set(
      resolved.cards
        .map(card => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
        .filter(Boolean)
    );
      if (targetIds.size === 0) continue;

      const player = (nextStateAny.players || []).find((candidate: any) => String(candidate?.id || '').trim() === playerId) as any;
      if (!player) continue;

    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      const affectedIds: string[] = [];
    const nextGraveyard = graveyard.map((card: any) => {
      const cardId = String(card?.id ?? card?.cardId ?? '').trim();
      if (!cardId || !targetIds.has(cardId)) return card;

      const existingKeywordAbilities = Array.isArray(card?.graveyardKeywordAbilities)
        ? [...card.graveyardKeywordAbilities]
        : [];
      const keywordAbility = {
        keyword: step.keyword,
        type: step.keyword,
        ...(step.costRaw ? { costRaw: step.costRaw } : {}),
        duration: step.duration,
        playableUntilTurn,
        sourceId: sourceId || undefined,
        sourceName: sourceName || undefined,
      };
      const duplicate = existingKeywordAbilities.some((entry: any) =>
        String(entry?.keyword || entry?.type || '').trim().toLowerCase() === step.keyword &&
        String(entry?.costRaw || '').trim() === String(step.costRaw || '').trim() &&
        String(entry?.sourceId || '').trim() === sourceId
      );

      changed += 1;
      affectedIds.push(cardId);
      temporaryGrantEntries.push({
        playerId: String(playerId),
        cardId,
        keyword: step.keyword,
        ...(step.costRaw ? { cost: step.costRaw } : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(sourceName ? { sourceName } : {}),
        expiresAt: step.duration === 'this_turn' ? 'end_of_turn' : step.duration,
        turnApplied: Number((nextStateAny as any).turnNumber ?? (nextStateAny as any).turn ?? 0) || 0,
      });
      return {
        ...card,
        zone: 'graveyard',
        graveyardKeywordAbilities: duplicate ? existingKeywordAbilities : [...existingKeywordAbilities, keywordAbility],
        [`${step.keyword}Cost`]: step.costRaw,
        canActivateFromGraveyardBy: playerId,
        graveyardActivationUntilTurn: playableUntilTurn,
      };
    });

    nextStateAny = {
      ...nextStateAny,
      players: (nextStateAny.players || []).map((candidate: any) =>
        String(candidate?.id || '').trim() === playerId ? { ...candidate, graveyard: nextGraveyard } : candidate
      ),
    };

    if (affectedIds.length > 0) {
      nextStateAny.activatableFromGraveyard = { ...(nextStateAny.activatableFromGraveyard || {}) };
      nextStateAny.activatableFromGraveyard[playerId] = { ...(nextStateAny.activatableFromGraveyard[playerId] || {}) };
      for (const cardId of affectedIds) {
        nextStateAny.activatableFromGraveyard[playerId][cardId] = playableUntilTurn ?? Number.MAX_SAFE_INTEGER;
      }
    }
  }

  if (temporaryGrantEntries.length > 0) {
    const replacementKeys = new Set(temporaryGrantEntries.map(entry =>
      `${entry.playerId}:${entry.cardId}:${entry.keyword}:${String(entry.sourceId || '')}`
    ));
    const existingTemporaryGrants = Array.isArray(nextStateAny.temporaryGraveyardKeywordGrants)
      ? nextStateAny.temporaryGraveyardKeywordGrants
      : [];
    nextStateAny.temporaryGraveyardKeywordGrants = [
      ...existingTemporaryGrants.filter((entry: any) =>
        !replacementKeys.has(`${String(entry?.playerId || '')}:${String(entry?.cardId || '')}:${String(entry?.keyword || '')}:${String(entry?.sourceId || '')}`)
      ),
      ...temporaryGrantEntries,
    ];
  }

  return {
    applied: true,
    state: nextStateAny as GameState,
    log: changed > 0
      ? [`Granted ${step.keyword} to ${changed} graveyard card(s)`]
      : [`Granted no graveyard keyword abilities: ${step.raw}`],
  };
}

export function applyGrantExilePermissionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_exile_permission' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped exile permission (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  let nextState = state;
  const log: string[] = [];

  for (const playerId of players) {
    const resolved = resolveExilePermissionTargets(nextState, playerId, step, ctx);
    if (resolved.reason === 'unsupported_selector') {
      return {
        applied: false,
        message: `Skipped exile permission (unsupported selector): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'ambiguous' },
      };
    }
    if (resolved.reason === 'failed_to_apply') {
      return {
        applied: false,
        message: `Skipped exile permission (linked exiled cards unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const markerResult = applyExilePermissionMarkers(nextState, playerId, resolved.cards, {
      permission: step.permission,
      playableUntilTurn,
      castedPermanentEntersWithCounters: step.castedPermanentEntersWithCounters,
    });
    nextState = markerResult.state;
    if (markerResult.granted > 0) {
      log.push(`${playerId} may ${step.permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} exiled card(s)`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Granted no exile permissions: ${step.raw}`],
  };
}

export function applyModifyGraveyardPermissionsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_graveyard_permissions' }>,
  runtime: {
    readonly lastGrantedGraveyardCards?: readonly any[];
    readonly lastGrantedGraveyardPermissionIds?: readonly string[];
  }
): PlayerStepHandlerResult {
  const lastGrantedGraveyardCards = Array.isArray(runtime.lastGrantedGraveyardCards)
    ? runtime.lastGrantedGraveyardCards
    : [];
  const grantedPermissionIds = new Set(
    (Array.isArray(runtime.lastGrantedGraveyardPermissionIds) ? runtime.lastGrantedGraveyardPermissionIds : [])
      .map((permissionId) => String(permissionId || '').trim())
      .filter(Boolean)
  );
  const grantedIds = new Set(
    lastGrantedGraveyardCards
      .map(card => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
      .filter(Boolean)
  );

  const mergeGrantedGraveyardPermissionModifiers = (inputState: GameState): GameState => {
    const nextStateAny: any = { ...(inputState as any) };
    if (grantedPermissionIds.size === 0 || !Array.isArray(nextStateAny.graveyardCastingPermissions)) {
      return inputState;
    }

    const modifierSourceText = String(step.raw || '').trim();
    nextStateAny.graveyardCastingPermissions = nextStateAny.graveyardCastingPermissions.map((permission: any) => {
      const permissionId = String(permission?.id || '').trim();
      if (!permissionId || !grantedPermissionIds.has(permissionId)) {
        return permission;
      }

      const mergedSourceText = mergeGrantedGraveyardPermissionSourceText(
        String(permission?.sourceText || '').trim(),
        modifierSourceText,
      );

      const nextReplacement = permission?.replacement && typeof permission.replacement === 'object'
        ? { ...permission.replacement }
        : {};
      if (step.exileInsteadOfGraveyard) {
        nextReplacement.exileAfterResolution = true;
        if (!nextReplacement.sourceName && permission?.sourceName) {
          nextReplacement.sourceName = permission.sourceName;
        }
      }

      const structuredAdditionalCost = oracleGraveyardAdditionalCostToSerializable(step.additionalCost);

      return {
        ...permission,
        ...(mergedSourceText ? { sourceText: mergedSourceText } : {}),
        ...(structuredAdditionalCost ? { additionalCost: structuredAdditionalCost } : {}),
        ...( /\bonce during each of your turns\b/i.test(mergedSourceText)
          ? { usageLimit: { type: 'once_per_turn', maxUses: 1 } }
          : {}),
        ...(step.withoutPayingManaCost ? { costMode: 'without_paying_mana_cost' } : {}),
        ...(Object.keys(nextReplacement).length > 0 ? { replacement: nextReplacement } : {}),
      };
    });

    return nextStateAny as GameState;
  };

  if (step.scope !== 'last_granted_graveyard_cards' || grantedIds.size === 0) {
    if (
      step.castedPermanentEntersWithCounters ||
      step.castCost ||
      step.castCostRaw ||
      step.additionalCost ||
      step.withoutPayingManaCost ||
      /\bretrace\b/i.test(String(step.raw || '')) ||
      /\bcast from your graveyard\b/i.test(String(step.raw || ''))
    ) {
      return {
        applied: true,
        state: mergeGrantedGraveyardPermissionModifiers(state),
        log: [`Graveyard permission modifier recorded: ${step.raw}`],
      };
    }
    return {
      applied: false,
      message: `Skipped graveyard permission modifier (no granted cards in context): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  let changed = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    if (graveyard.length === 0) return player;

    let playerChanged = false;
    const updatedGraveyard = graveyard.map((card: any) => {
      const id = String(card?.id ?? card?.cardId ?? '').trim();
      if (!id || !grantedIds.has(id)) return card;
      playerChanged = true;
      changed += 1;
      return {
        ...card,
        ...(step.castCost ? { graveyardCastCost: step.castCost } : {}),
        ...(step.castCostRaw ? { graveyardCastCostRaw: step.castCostRaw } : {}),
        ...(step.withoutPayingManaCost ? { withoutPayingManaCost: true } : {}),
        ...(step.additionalCost ? { graveyardAdditionalCost: { ...step.additionalCost } } : {}),
        ...((step as any).exileInsteadOfGraveyard ? { exileInsteadOfGraveyard: true } : {}),
        ...((step as any).entersBattlefieldTransformed ? { entersBattlefieldTransformed: true } : {}),
        ...(step.castedPermanentEntersWithCounters
          ? { entersBattlefieldWithCounters: { ...step.castedPermanentEntersWithCounters } }
          : {}),
      };
    });

    return playerChanged ? ({ ...player, graveyard: updatedGraveyard } as any) : player;
  });

  const nextStateAny: any = { ...(state as any), players: updatedPlayers as any };
  const nextState = stampKeywordGrantsFromModifyStep(
    mergeGrantedGraveyardPermissionModifiers(nextStateAny as GameState) as any,
    step,
    lastGrantedGraveyardCards,
    grantedPermissionIds,
  );
  return {
    applied: true,
    state: nextState,
    log:
      changed > 0
        ? [`Updated graveyard permissions for ${changed} graveyard card(s)`]
        : [`Updated no graveyard permissions: ${step.raw}`],
  };
}

function stampKeywordGrantsFromModifyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_graveyard_permissions' }>,
  lastGrantedGraveyardCards: readonly any[],
  grantedPermissionIds: ReadonlySet<string>,
): GameState {
  if (lastGrantedGraveyardCards.length === 0) return state;

  const keywordGrant = extractGrantedGraveyardKeywordFromRaw(step.raw);
  const usesPrintedManaCost =
    step.castCost === 'mana_cost' ||
    Boolean(keywordGrant && /\bmana cost\b/i.test(String(step.raw || '')));
  if (!keywordGrant || !usesPrintedManaCost) return state;

  const permissions = Array.isArray((state as any).graveyardCastingPermissions)
    ? (state as any).graveyardCastingPermissions
    : [];
  const sourcePermission = permissions.find((permission: any) =>
    grantedPermissionIds.has(String(permission?.id || '').trim())
  );
  const sourceId = String(sourcePermission?.sourceId || '').trim();
  const sourceName = String(sourcePermission?.sourceName || '').trim();
  const expiresAt = String(sourcePermission?.duration || '') === 'this_turn' || !sourcePermission?.duration
    ? 'end_of_turn'
    : String(sourcePermission.duration);

  const stamps: ReturnType<typeof buildTemporaryGraveyardKeywordGrantStamps> = [];
  const cardsByPlayer = new Map<string, any[]>();
  for (const card of lastGrantedGraveyardCards) {
    const cardId = String((card as any)?.id ?? (card as any)?.cardId ?? '').trim();
    if (!cardId) continue;
    const playerId = findGraveyardOwnerIdForCard(state, cardId);
    if (!playerId) continue;
    const existing = cardsByPlayer.get(playerId) || [];
    existing.push(card);
    cardsByPlayer.set(playerId, existing);
  }

  for (const [playerId, cards] of cardsByPlayer.entries()) {
    stamps.push(...buildTemporaryGraveyardKeywordGrantStamps({
      state,
      playerId: playerId as any,
      cards,
      keyword: keywordGrant.keyword,
      resolveCost: (card) =>
        step.castCost === 'mana_cost' || usesPrintedManaCost
          ? resolvePrintedManaCostForGraveyardGrant(card)
          : String(step.castCostRaw || '').trim() || resolvePrintedManaCostForGraveyardGrant(card),
      ...(sourceId ? { sourceId } : {}),
      ...(sourceName ? { sourceName } : {}),
      expiresAt,
    }));
  }

  return mergeTemporaryGraveyardKeywordGrantStamps(state, stamps);
}

export function applyModifyTokenCreationStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_token_creation' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped token creation replacement (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const existing = Array.isArray((state as any).tokenCreationReplacementEffects)
    ? [...(state as any).tokenCreationReplacementEffects]
    : [];
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const replacement = {
    id: `${sourceId || sourceName || 'oracle'}:token-replacement:${existing.length + 1}`,
    sourceId: sourceId || undefined,
    sourceName: sourceName || undefined,
    controllerId: String(ctx.controllerId || '').trim() || undefined,
    playerIds: players,
    tokenTypes: step.tokenTypes.map(value => String(value || '').trim().toLowerCase()).filter(Boolean),
    mode: step.mode,
    additionalAmount: step.additionalAmount,
    raw: step.raw,
  };
  const duplicate = existing.some((entry: any) =>
    String(entry?.sourceId || '').trim() === String(replacement.sourceId || '').trim() &&
    String(entry?.raw || '').trim() === step.raw &&
    String(entry?.mode || '').trim() === step.mode
  );

  return {
    applied: true,
    state: {
      ...(state as any),
      tokenCreationReplacementEffects: duplicate ? existing : [...existing, replacement],
    } as GameState,
    log: [`Registered token creation replacement: ${step.raw}`],
  };
}

export function applyJoinForcesStep(
  _state: GameState,
  step: Extract<OracleEffectStep, { kind: 'join_forces' }>,
  _ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  return {
    applied: false,
    message: `Deferred join forces mana contributions (requires player choice): ${step.raw}`,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
    },
  };
}
