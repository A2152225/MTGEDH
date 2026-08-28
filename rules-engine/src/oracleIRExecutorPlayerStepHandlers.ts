import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  PlayerStepHandlerResult,
  UnlessDiscardsResult,
  UnlessPaysLifeResult,
  UnlessPaysManaResult,
} from './oracleIRExecutorPlayerStepTypes';
export type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import { getNormalizedChosenIds } from './oracleIRExecutorPlayerStepShared';
import { applyDiscardStep } from './oracleIRExecutorPlayerDiscardStep';
import {
  type OracleIRReplayMutation,
} from './oracleIRReplayMutations';
import { payManaCost } from './spellCasting';
import { createEmptyManaPool } from './types/mana';
import {
  adjustLife,
  getCardManaValue,
  normalizeOracleText,
  resolvePlayers,
} from './oracleIRExecutorPlayerUtils';
export { buildLookSelectTopSelectionOptions } from './oracleIRExecutorPlayerLookSelectTopOptions';


function chooseCollectEvidenceCardIds(
  graveyard: readonly any[],
  requiredManaValue: number,
  chosenObjectIds?: readonly string[]
): string[] {
  const normalizedRequiredManaValue = Math.max(0, Number(requiredManaValue) || 0);
  if (normalizedRequiredManaValue <= 0) return [];

  const cards = (Array.isArray(graveyard) ? graveyard : [])
    .map((card: any, index: number) => ({
      id: String(card?.id || '').trim(),
      manaValue: Math.max(0, Number(getCardManaValue(card) ?? 0)),
      index,
    }))
    .filter(card => Boolean(card.id));

  const chosenIdSet = new Set(
    (Array.isArray(chosenObjectIds) ? chosenObjectIds : [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  if (chosenIdSet.size > 0) {
    return cards.filter(card => chosenIdSet.has(card.id)).map(card => card.id);
  }

  let best: { ids: string[]; total: number; count: number; indices: number[] } | null = null;
  if (cards.length <= 12) {
    const visit = (index: number, ids: string[], total: number, indices: number[]): void => {
      if (total >= normalizedRequiredManaValue) {
        const candidate = { ids: [...ids], total, count: ids.length, indices: [...indices] };
        if (
          !best ||
          candidate.count < best.count ||
          (candidate.count === best.count && candidate.total < best.total) ||
          (
            candidate.count === best.count &&
            candidate.total === best.total &&
            candidate.indices.join(',') < best.indices.join(',')
          )
        ) {
          best = candidate;
        }
        return;
      }
      if (index >= cards.length) return;
      if (best && ids.length >= best.count) return;

      visit(index + 1, [...ids, cards[index].id], total + cards[index].manaValue, [...indices, cards[index].index]);
      visit(index + 1, ids, total, indices);
    };
    visit(0, [], 0, []);
  }

  if (best) {
    return best.ids;
  }

  let total = 0;
  const greedy = [...cards]
    .sort((a, b) => (b.manaValue - a.manaValue) || (a.index - b.index))
    .filter(card => {
      if (total >= normalizedRequiredManaValue) return false;
      total += card.manaValue;
      return true;
    })
    .map(card => card.id);

  return total >= normalizedRequiredManaValue ? greedy : [];
}

export {
  applyAssembleStep,
  applyBecomeMonarchStep,
  applyLearnStep,
  applyOpenAttractionStep,
  applyPlaneswalkStep,
  applyRollVisitAttractionsStep,
  applyTakeInitiativeStep,
} from './oracleIRExecutorPlayerLearnAttractionPlaneswalkSteps';


export { applyVentureIntoDungeonStep } from './oracleIRExecutorPlayerVentureIntoDungeonStep';


function getSchemeIdentityCandidates(value: any): string[] {
  const candidates = [
    String(value?.id || '').trim(),
    String(value?.name || '').trim(),
    String(value?.card?.id || '').trim(),
    String(value?.card?.name || '').trim(),
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function schemeMatchesSource(scheme: any, sourceId: string, sourceName: string, chosenIds: readonly string[]): boolean {
  const candidates = getSchemeIdentityCandidates(scheme);
  if (candidates.length === 0) return false;
  if (sourceId && candidates.includes(sourceId)) return true;
  if (sourceName && candidates.includes(sourceName)) return true;
  return chosenIds.some(id => candidates.includes(id));
}

export function applyAbandonSchemeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'abandon_scheme' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const targetText = normalizeOracleText(String((step.target as any)?.text || ''));
  if (targetText !== 'this scheme' && targetText !== 'that scheme') {
    return {
      applied: false,
      message: `Skipped abandon scheme (unsupported target): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const stateAny = state as any;
  const ongoingSchemes = Array.isArray(stateAny.ongoingSchemes) ? [...stateAny.ongoingSchemes] : [];
  if (ongoingSchemes.length === 0) {
    return {
      applied: false,
      message: `Skipped abandon scheme (no ongoing schemes): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const chosenIds = getNormalizedChosenIds(ctx);
  const schemeIndex = ongoingSchemes.findIndex((scheme: any) => schemeMatchesSource(scheme, sourceId, sourceName, chosenIds));
  if (schemeIndex < 0) {
    return {
      applied: false,
      message: `Skipped abandon scheme (source scheme not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const [scheme] = ongoingSchemes.splice(schemeIndex, 1);
  const nextSchemeDeck = [...(Array.isArray(stateAny.schemeDeck) ? stateAny.schemeDeck : []), scheme];

  return {
    applied: true,
    state: {
      ...stateAny,
      ongoingSchemes,
      schemeDeck: nextSchemeDeck,
    } as GameState,
    log: [`${String(sourceName || getSchemeIdentityCandidates(scheme)[1] || getSchemeIdentityCandidates(scheme)[0] || 'Scheme')} was abandoned`],
  };
}

export function applySetInMotionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'set_in_motion' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const targetText = normalizeOracleText(String((step.target as any)?.text || ''));
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const chosenIds = getNormalizedChosenIds(ctx);

  let scheme: any = null;
  if (targetText === 'that scheme') {
    scheme = (ctx as any).lastSetInMotionScheme || null;
  } else if (targetText === 'this scheme') {
    const ongoingSchemes = Array.isArray((state as any).ongoingSchemes) ? (state as any).ongoingSchemes : [];
    scheme = ongoingSchemes.find((entry: any) => schemeMatchesSource(entry, sourceId, sourceName, chosenIds)) || null;
  }

  if (!scheme) {
    return {
      applied: false,
      message: `Skipped set in motion (scheme reference not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  return {
    applied: true,
    state,
    log: [`${String(getSchemeIdentityCandidates(scheme)[1] || getSchemeIdentityCandidates(scheme)[0] || 'Scheme')} was set in motion again`],
    lastSetInMotionScheme: scheme,
  };
}

export function applyCollectEvidenceStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'collect_evidence' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amountValue = step.amount.kind === 'number' ? step.amount.value : null;
  if (amountValue === null || amountValue <= 0) {
    return {
      applied: false,
      message: `Skipped collect evidence (unsupported amount): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped collect evidence (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped collect evidence (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const selectedIds = chooseCollectEvidenceCardIds(graveyard, amountValue, ctx.selectorContext?.chosenObjectIds);
  const selectedIdSet = new Set(selectedIds);
  const selectedCards = graveyard.filter((card: any) => selectedIdSet.has(String(card?.id || '').trim()));
  const totalManaValue = selectedCards.reduce(
    (sum: number, card: any) => sum + Math.max(0, Number(getCardManaValue(card) ?? 0)),
    0
  );

  if (selectedCards.length === 0 || totalManaValue < amountValue) {
    return {
      applied: true,
      state,
      log: [`Collect evidence ${amountValue} could not be completed`],
      lastCollectedEvidence: false,
      lastMovedCards: [],
    };
  }

  const nextPlayers = (state.players || []).map((entry: any) => {
    if (String(entry?.id || '').trim() !== playerId) return entry;

    const remainingGraveyard = graveyard.filter((card: any) => !selectedIdSet.has(String(card?.id || '').trim()));
    const nextExile = [...(Array.isArray(entry?.exile) ? entry.exile : []), ...selectedCards];
    return {
      ...entry,
      graveyard: remainingGraveyard,
      exile: nextExile,
    };
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      players: nextPlayers as any,
    } as GameState,
    log: [`Collected evidence ${amountValue} by exiling ${selectedCards.length} card(s)`],
    lastCollectedEvidence: true,
    lastMovedCards: selectedCards,
  };
}

export {
  buildMoveZoneSelectionOptions,
  buildPlayerChoiceAmongThemSelectionOptions,
  buildSearchLibrarySelectionOptions,
  getChosenObjectIds,
} from './oracleIRExecutorPlayerSelectionOptions';

import { parseSupportedManaCostString } from './oracleIRExecutorPlayerGraveyardPermissionHelpers';


export {
  applyCreateEmblemStep,
  applyGrantExilePermissionStep,
  applyGrantGraveyardKeywordAbilityStep,
  applyGrantGraveyardPermissionStep,
  applyJoinForcesStep,
  applyTemptingOfferStep,
  applyModifyGraveyardPermissionsStep,
  applyModifyTokenCreationStep,
  mergeGrantedGraveyardPermissionSourceText,
} from './oracleIRExecutorPlayerGraveyardPermissionSteps';


export { applyPayManaStep } from './oracleIRExecutorPlayerPayManaStep';
export { resolveVariableAmount } from './oracleIRExecutorPlayerVariableAmount';

export {
  applyClashStep,
  applyFatesealStep,
  applyScryStep,
  applyVoteStep,
} from './oracleIRExecutorPlayerScryVoteClashSteps';


export { applySearchLibraryStep } from './oracleIRExecutorPlayerSearchLibraryStep';


export {
  applyChangeTargetStep,
  applyChoosePileStep,
  applyExileNamedCardsFromZonesStep,
  applyShuffleLibraryStep,
  applyShuffleZonesIntoLibraryStep,
} from './oracleIRExecutorPlayerShuffleChangeTargetSteps';


export {
  applyLookSelectTopStep,
  applyLookTopStep,
  applyRevealTopStep,
  applySurveilStep,
} from './oracleIRExecutorPlayerSurveilLookRevealSteps';


export {
  applyLookChooseFromTopStep,
  buildLookChooseFromTopSelectionOptions,
} from './oracleIRExecutorPlayerLookChooseFromTopStep';


export { applyMillStep, applyPutOnBottomStep } from './oracleIRExecutorPlayerMillPutOnBottomSteps';


export {
  applyDiscardStep,
  buildDiscardSelectionOptions,
  buildDiscardSelectionOptionsForPlayer,
  collectDiscardSelectionOptionsForStep,
  discardSelectorRequiresPlayerChoice,
} from './oracleIRExecutorPlayerDiscardStep';


export function applyRevealHandStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'reveal_hand' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    const opponentCount = (state.players || []).filter(
      (player: any) => String(player?.id || '').trim() !== String(ctx.controllerId || '').trim()
    ).length;
    const requiresChoice = step.who.kind === 'target_opponent' && opponentCount > 1;
    return {
      applied: false,
      message: `Skipped reveal hand (${requiresChoice ? 'requires player choice' : 'unsupported player selector'}): ${step.raw}`,
      reason: requiresChoice ? 'player_choice_required' : 'unsupported_player_selector',
      options: requiresChoice ? { classification: 'player_choice' } : undefined,
    };
  }

  const log: string[] = [];
  let lastRevealedCardCount = 0;
  const revealedCards: any[] = [];
  const revealRandomSingle = /at random/i.test(String(step.raw || ''));
  for (const playerId of players) {
    const player = state.players.find(entry => entry.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped reveal hand (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const hand = Array.isArray(player.hand) ? player.hand : [];
    const cardsToReveal =
      revealRandomSingle && hand.length > 0 ? [hand[0]] : hand;
    lastRevealedCardCount = Math.max(lastRevealedCardCount, cardsToReveal.length);
    revealedCards.push(...cardsToReveal);
    const revealedNames = cardsToReveal
      .map((card: any) => String(card?.name || card?.card?.name || card?.id || '').trim())
      .filter(Boolean);
    log.push(
      `${playerId} reveals their hand: ${revealedNames.length > 0 ? revealedNames.join(', ') : '(empty)'}`
    );
  }

  return {
    applied: true,
    state,
    log,
    lastRevealedCardCount,
    ...(revealedCards.length > 0 ? { lastMovedCards: revealedCards } : {}),
  };
}

export function applyLookHandStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_hand' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    const opponentCount = (state.players || []).filter(
      (player: any) => String(player?.id || '').trim() !== String(ctx.controllerId || '').trim()
    ).length;
    const requiresChoice = step.who.kind === 'target_opponent' && opponentCount > 1;
    return {
      applied: false,
      message: `Skipped look at hand (${requiresChoice ? 'requires player choice' : 'unsupported player selector'}): ${step.raw}`,
      reason: requiresChoice ? 'player_choice_required' : 'unsupported_player_selector',
      options: requiresChoice ? { classification: 'player_choice' } : undefined,
    };
  }

  const log: string[] = [];
  for (const playerId of players) {
    const player = state.players.find(entry => entry.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped look at hand (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const hand = Array.isArray(player.hand) ? player.hand : [];
    log.push(`${ctx.controllerId} looks at ${playerId}'s hand (${hand.length} card(s))`);
  }

  return {
    applied: true,
    state,
    log,
  };
}

export {
  applyAddPlayerCounterStep,
  applyConniveStep,
  applyDoublePlayerCountersStep,
  applyDrawStep,
  applyExploreStep,
  applyGainLifeStep,
  applyLoseLifeStep,
  applyManifestDreadStep,
  applyRegisterLoseGameReplacementStep,
  buildExploreDecisionFromStep,
} from './oracleIRExecutorPlayerExploreLifeDrawSteps';


import { TEMPORARY_RETAINED_MANA_COLORS } from './oracleIRExecutorPlayerAddManaStep';
export { applyAddManaStep, TEMPORARY_RETAINED_MANA_COLORS } from './oracleIRExecutorPlayerAddManaStep';


function poolColorCounts(pool: any): Record<(typeof TEMPORARY_RETAINED_MANA_COLORS)[number], number> {
  return {
    white: Math.max(0, Number(pool?.white || 0)),
    blue: Math.max(0, Number(pool?.blue || 0)),
    black: Math.max(0, Number(pool?.black || 0)),
    red: Math.max(0, Number(pool?.red || 0)),
    green: Math.max(0, Number(pool?.green || 0)),
    colorless: Math.max(0, Number(pool?.colorless || 0)),
  };
}

function addTemporaryRetainedMana(
  state: GameState,
  playerId: PlayerID,
  duration: 'until_end_of_turn' | 'until_end_of_combat',
  amounts: Record<string, number>,
): Record<string, any> {
  const bucketKey = duration === 'until_end_of_combat' ? 'untilEndCombat' : 'untilEndTurn';
  const existing = { ...((((state as any).temporaryRetainedMana || {}) as Record<string, any>)) };
  const playerBuckets = { ...(existing[playerId] || {}) };
  const bucket = { ...(playerBuckets[bucketKey] || {}) };
  for (const color of TEMPORARY_RETAINED_MANA_COLORS) {
    const n = Math.max(0, Number(amounts[color] || 0));
    if (n <= 0) continue;
    bucket[color] = Math.max(0, Number(bucket[color] || 0)) + n;
  }
  playerBuckets[bucketKey] = bucket;
  existing[playerId] = playerBuckets;
  return existing;
}

export function applyRetainManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'retain_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped retain mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const sourceId = String(ctx.sourceId || ctx.sourceName || step.raw || 'oracle-ir-retain-mana');
  const producedByPlayer = ((((state as any).lastOracleIrProducedMana || {}) as Record<string, any>) || {});
  let temporaryRetainedMana = { ...((((state as any).temporaryRetainedMana || {}) as Record<string, any>)) };

  for (const playerId of players) {
    const produced = producedByPlayer[playerId];
    const amounts = produced && typeof produced === 'object'
      ? produced
      : poolColorCounts((((state as any).manaPool || {}) as any)[playerId]);
    temporaryRetainedMana = addTemporaryRetainedMana(state, playerId, step.duration, amounts);
    // addTemporaryRetainedMana reads state.temporaryRetainedMana; keep it current across players.
    (state as any).temporaryRetainedMana = temporaryRetainedMana;
  }

  const existingEffects = Array.isArray((state as any).manaRetentionEffects)
    ? [...(state as any).manaRetentionEffects]
    : [];
  const createdAtTurn = (state as any).turnNumber ?? (state as any).turn;
  for (const playerId of players) {
    const alreadyRecorded = existingEffects.some((effect: any) => (
      String(effect?.playerId || '') === String(playerId) &&
      String(effect?.sourceId || '') === sourceId &&
      String(effect?.duration || '') === step.duration
    ));
    if (!alreadyRecorded) {
      existingEffects.push({
        playerId,
        sourceId,
        duration: step.duration,
        createdAtTurn,
        raw: step.raw,
      });
    }
  }

  // Duration-limited "this mana" (Tanuki, Birgi, firebending) is tracked in
  // temporaryRetainedMana. Do not stamp pool.doesNotEmpty — that is pool-wide and
  // would keep expired combat/EOT mana through later phase changes (CR 106.4).
  return {
    applied: true,
    state: {
      ...(state as any),
      temporaryRetainedMana,
      manaRetentionEffects: existingEffects,
    } as any,
    log: players.map(playerId => `${playerId} doesn't lose this mana as steps and phases end (${step.duration.replace(/_/g, ' ')})`),
  };
}

export function evaluateUnlessPaysLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_pays_life' }>,
  ctx: OracleIRExecutionContext
): UnlessPaysLifeResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-pays-life step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
          lifeAmount: step.amount,
        },
      },
    };
  }

  const payerId = players[0];
  const payer = (state.players || []).find(player => String(player?.id || '').trim() === String(payerId || '').trim()) as any;
  if (!payer) {
    return {
      applied: false,
      message: `Skipped unless-pays-life step (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const lifeTotal = Number(payer.life);
  const canPayLife = Number.isFinite(lifeTotal) && lifeTotal >= step.amount;
  const explicitChoice =
    ctx.unlessPaysLifeChoice === 'pay' || ctx.unlessPaysLifeChoice === 'decline'
      ? ctx.unlessPaysLifeChoice
      : (ctx.selectorContext?.unlessPaysLifeChoice === 'pay' || ctx.selectorContext?.unlessPaysLifeChoice === 'decline'
          ? ctx.selectorContext.unlessPaysLifeChoice
          : undefined);
  if (canPayLife) {
    if (explicitChoice === 'pay') {
      const payment = adjustLife(state, payerId, -step.amount);
      return {
        applied: true,
        shouldApplyNestedSteps: false,
        state: payment.state,
        log: [
          ...payment.log,
          `Resolved unless-pays-life step (payer chose to pay ${step.amount} life): ${step.raw}`,
        ],
      };
    }

    if (explicitChoice === 'decline') {
      return {
        applied: true,
        shouldApplyNestedSteps: true,
        log: [`Resolved unless-pays-life step (payer declined to pay ${step.amount} life): ${step.raw}`],
      };
    }

    return {
      applied: false,
      message: `Skipped unless-pays-life step (opponent choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          payerId,
          payerLife: lifeTotal,
          lifeAmount: step.amount,
        },
      },
    };
  }

  return {
    applied: true,
    shouldApplyNestedSteps: true,
    log: [`Resolved unless-pays-life step (payer cannot pay ${step.amount} life): ${step.raw}`],
  };
}

export function evaluateUnlessDiscardsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_discards' }>,
  ctx: OracleIRExecutionContext
): UnlessDiscardsResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-discards step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
          discardAmount: step.amount,
        },
      },
    };
  }

  const discarderId = players[0];
  const discarder = (state.players || []).find(player => String(player?.id || '').trim() === String(discarderId || '').trim()) as any;
  if (!discarder) {
    return {
      applied: false,
      message: `Skipped unless-discards step (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const handSize = Array.isArray(discarder.hand) ? discarder.hand.length : 0;
  const discardAmount = Math.max(0, step.amount | 0);
  const canDiscard = handSize >= discardAmount;
  const explicitChoice =
    ctx.unlessDiscardsChoice === 'discard' || ctx.unlessDiscardsChoice === 'decline'
      ? ctx.unlessDiscardsChoice
      : (ctx.selectorContext?.unlessDiscardsChoice === 'discard' || ctx.selectorContext?.unlessDiscardsChoice === 'decline'
          ? ctx.selectorContext.unlessDiscardsChoice
          : undefined);

  if (canDiscard) {
    if (explicitChoice === 'discard') {
      const discardStep = {
        kind: 'discard',
        who: step.who,
        amount: { kind: 'number', value: discardAmount },
        raw: step.raw,
      } as Extract<OracleEffectStep, { kind: 'discard' }>;
      const discardResult = applyDiscardStep(state, discardStep, ctx);
      if (discardResult.applied === false) {
        return {
          applied: false,
          message: discardResult.message,
          reason: discardResult.reason,
          state: discardResult.state,
          options: discardResult.options,
          innerStep: discardStep,
        };
      }
      return {
        applied: true,
        shouldApplyNestedSteps: false,
        state: discardResult.state,
        log: [
          ...discardResult.log,
          `Resolved unless-discards step (${discarderId} discarded ${discardAmount} card(s)): ${step.raw}`,
        ],
      };
    }

    if (explicitChoice === 'decline') {
      return {
        applied: true,
        shouldApplyNestedSteps: true,
        log: [`Resolved unless-discards step (${discarderId} declined to discard): ${step.raw}`],
      };
    }

    return {
      applied: false,
      message: `Skipped unless-discards step (opponent choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          discarderId,
          handSize,
          discardAmount,
        },
      },
    };
  }

  return {
    applied: true,
    shouldApplyNestedSteps: true,
    log: [`Resolved unless-discards step (${discarderId} cannot discard ${discardAmount} card(s)): ${step.raw}`],
  };
}

export function evaluateUnlessPaysManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_pays_mana' }>,
  ctx: OracleIRExecutionContext
): UnlessPaysManaResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
          manaCost: step.mana,
        },
      },
    };
  }

  const payerId = players[0];
  const payer = (state.players || []).find(player => String(player?.id || '').trim() === String(payerId || '').trim()) as any;
  if (!payer) {
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const manaCost = parseSupportedManaCostString(step.mana, Number(ctx.xValue));
  if (!manaCost) {
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (unsupported mana cost): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  const explicitChoice =
    ctx.unlessPaysManaChoice === 'pay' || ctx.unlessPaysManaChoice === 'decline'
      ? ctx.unlessPaysManaChoice
      : (ctx.selectorContext?.unlessPaysManaChoice === 'pay' || ctx.selectorContext?.unlessPaysManaChoice === 'decline'
          ? ctx.selectorContext.unlessPaysManaChoice
          : (ctx.unlessPaysLifeChoice === 'pay' || ctx.unlessPaysLifeChoice === 'decline'
              ? ctx.unlessPaysLifeChoice
              : (ctx.selectorContext?.unlessPaysLifeChoice === 'pay' || ctx.selectorContext?.unlessPaysLifeChoice === 'decline'
                  ? ctx.selectorContext.unlessPaysLifeChoice
                  : undefined)));

  const manaPoolRecord: Record<PlayerID, any> = { ...((((state as any).manaPool || {}) as any) || {}) };
  const currentPool = manaPoolRecord[payerId] || createEmptyManaPool();
  const payment = payManaCost(currentPool, manaCost);
  const canPayMana = Boolean(payment.success && payment.remainingPool);

  if (canPayMana) {
    if (explicitChoice === 'pay') {
      manaPoolRecord[payerId] = payment.remainingPool;
      return {
        applied: true,
        shouldApplyNestedSteps: false,
        state: { ...(state as any), manaPool: manaPoolRecord } as any,
        log: [`Resolved unless-pays-mana step (payer chose to pay ${step.mana}): ${step.raw}`],
      };
    }

    if (explicitChoice === 'decline') {
      return {
        applied: true,
        shouldApplyNestedSteps: true,
        log: [`Resolved unless-pays-mana step (payer declined to pay ${step.mana}): ${step.raw}`],
      };
    }

    return {
      applied: false,
      message: `Skipped unless-pays-mana step (opponent choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          payerId,
          manaCost: step.mana,
        },
      },
    };
  }

  return {
    applied: true,
    shouldApplyNestedSteps: true,
    log: [`Resolved unless-pays-mana step (payer cannot pay ${step.mana}): ${step.raw}`],
  };
}

function readPlayerLifeTotal(state: GameState, playerId: string): number {
  const normalizedId = String(playerId || '').trim();
  if (!normalizedId) return 0;

  const lifeRecord = (state as any).life as Record<string, number> | undefined;
  if (lifeRecord && Number.isFinite(Number(lifeRecord[normalizedId]))) {
    return Math.max(0, Math.floor(Number(lifeRecord[normalizedId])));
  }

  const player = (state.players || []).find((entry) => String(entry?.id || '').trim() === normalizedId) as any;
  if (player && Number.isFinite(Number(player.life))) {
    return Math.max(0, Math.floor(Number(player.life)));
  }

  return Math.max(0, Math.floor(Number((state as any).startingLife ?? 40)));
}

function setPlayerLifeTotal(
  state: GameState,
  playerId: string,
  nextLife: number,
): { state: GameState; delta: number } {
  const normalizedId = String(playerId || '').trim() as PlayerID;
  const safeLife = Math.max(0, Math.floor(Number(nextLife) || 0));
  const currentLife = readPlayerLifeTotal(state, normalizedId);
  const delta = safeLife - currentLife;

  const updatedPlayers = (state.players || []).map((player) =>
    String(player?.id || '').trim() === normalizedId ? { ...player, life: safeLife } : player,
  );

  const nextState = {
    ...state,
    players: updatedPlayers as any,
    life: {
      ...(((state as any).life && typeof (state as any).life === 'object') ? (state as any).life : {}),
      [normalizedId]: safeLife,
    },
  } as GameState;

  return { state: nextState, delta };
}

export function applyRedistributeLifeTotalsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'redistribute_life_totals' }>,
  ctx: OracleIRExecutionContext,
): PlayerStepHandlerResult {
  const redistributionRaw = (ctx.selectorContext as any)?.lifeRedistributionByPlayerId;
  const redistribution =
    redistributionRaw && typeof redistributionRaw === 'object' && !Array.isArray(redistributionRaw)
      ? redistributionRaw as Record<string, number>
      : null;

  const activePlayers = (state.players || [])
    .map((player) => String(player?.id || '').trim())
    .filter(Boolean);

  if (activePlayers.length <= 1) {
    return {
      applied: true,
      state,
      log: [`Redistribute life totals had no other players: ${step.raw}`],
    };
  }

  if (redistribution) {
    const participantIds = Object.keys(redistribution)
      .map((playerId) => String(playerId || '').trim())
      .filter((playerId) => activePlayers.includes(playerId));

    if (participantIds.length === 0) {
      return {
        applied: true,
        state,
        log: [`Redistribute life totals: no players selected (${step.raw})`],
      };
    }

    const poolTotal = participantIds.reduce(
      (sum, playerId) => sum + readPlayerLifeTotal(state, playerId),
      0,
    );
    const assignedTotal = participantIds.reduce(
      (sum, playerId) => sum + Math.max(0, Math.floor(Number(redistribution[playerId]) || 0)),
      0,
    );
    if (assignedTotal !== poolTotal) {
      return {
        applied: false,
        message: `Skipped redistribute life totals (assigned total ${assignedTotal} != pool ${poolTotal}): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input' },
      };
    }

    let nextState = state;
    const log: string[] = [];
    const replayMutations: OracleIRReplayMutation[] = [];

    for (const playerId of participantIds) {
      const nextLife = Math.max(0, Math.floor(Number(redistribution[playerId]) || 0));
      const currentLife = readPlayerLifeTotal(nextState, playerId);
      if (nextLife === currentLife) continue;
      const result = setPlayerLifeTotal(nextState, playerId, nextLife);
      nextState = result.state;
      if (result.delta !== 0) {
        log.push(`${playerId} life total set to ${nextLife} (was ${currentLife})`);
        replayMutations.push({ kind: 'adjustLife', playerId: playerId as PlayerID, delta: result.delta });
      }
    }

    return {
      applied: true,
      state: nextState,
      log: log.length > 0 ? log : [`Redistribute life totals left life unchanged (${step.raw})`],
      ...(replayMutations.length > 0 ? { replayMutations } : {}),
    };
  }

  return {
    applied: false,
    message: `Skipped redistribute life totals (requires player choice): ${step.raw}`,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
      metadata: {
        playerIds: activePlayers,
        playerLifeTotals: Object.fromEntries(
          activePlayers.map((playerId) => [playerId, readPlayerLifeTotal(state, playerId)]),
        ),
      },
    },
  };
}
