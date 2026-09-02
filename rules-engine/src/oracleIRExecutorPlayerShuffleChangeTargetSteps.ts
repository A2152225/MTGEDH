// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: applyExileNamedCardsFromZonesStep, applyShuffleLibraryStep,
// applyShuffleZonesIntoLibraryStep, applyChoosePileStep, applyChangeTargetStep.
// Public entries: applyExileNamedCardsFromZonesStep, applyShuffleLibraryStep,
// applyShuffleZonesIntoLibraryStep, applyChoosePileStep, applyChangeTargetStep.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleIRReplayMutation } from './oracleIRReplayMutations';
import { commitCardZoneChanges } from './oracleIRExecutorCardZoneTransitionCommit';
import {
  applyRandomRetargetToStackSpells,
  isRandomChangeTargetStep,
  resolveChangeTargetExcludeText,
  resolveChangeTargetSpellIds,
} from './oracleIRExecutorChangeTargetSupport';
import {
  getNormalizedChosenIds,
  shuffleArray,
  withDiscardLedgerFlags,
} from './oracleIRExecutorPlayerStepShared';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import { readPlayerZoneCards, resolvePlayers, writePlayerZoneCards } from './oracleIRExecutorPlayerUtils';
import { resolveReferencedObject } from './oracleIRExecutorReferenceUtils';
import { resolveOracleIrBoundTargetSpellId } from './oracleIrTargetBinding';
import { usedOracleIrServerBridge } from './oracleIRStepLedgerRuntime';

export function applyExileNamedCardsFromZonesStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile_named_cards_from_zones' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const chosenCardName = (() => {
    if (step.nameSource === 'target_spell_name') {
      const targetSpellId = resolveOracleIrBoundTargetSpellId(ctx);
      const stack = Array.isArray((state as any).stack) ? (state as any).stack : [];
      const spell = stack.find((entry: any) => String(entry?.id || '').trim() === targetSpellId);
      return String(spell?.card?.name || spell?.name || '').trim();
    }
    if (step.nameSource === 'referenced_card_name') {
      const referenced = resolveReferencedObject(state, ctx);
      return String(referenced?.card?.name || referenced?.name || '').trim();
    }
    return String(ctx.selectorContext?.chosenCardName || '').trim();
  })();
  if (!chosenCardName) {
    return {
      applied: false,
      message: `Skipped named-card exile (requires chosen card name): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped named-card exile (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const normalizedName = chosenCardName.toLowerCase();
  const maxResults = step.maxResults === 'any_number'
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Number(step.maxResults || Number.POSITIVE_INFINITY) || Number.POSITIVE_INFINITY);
  let nextState = state;
  const log: string[] = [];
  const allExiledCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeActive = usedOracleIrServerBridge(ctx);

  for (const playerId of players) {
    const player = nextState.players.find(p => p.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped named-card exile (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    let remainingSlots = maxResults;
    const selectedByZone = new Map<string, Set<number>>();
    const selectionsByZone = new Map<string, any[]>();
    const selectedCards: any[] = [];
    for (const zone of step.zones) {
      if (remainingSlots <= 0) break;
      const cards = readPlayerZoneCards(
        nextState,
        playerId,
        player,
        zone as 'hand' | 'graveyard' | 'library',
      );
      const selectedIndexes = new Set<number>();
      const zoneSelections: any[] = [];
      for (let index = 0; index < cards.length && remainingSlots > 0; index += 1) {
        const card = cards[index] as any;
        const name = String(card?.name || card?.card?.name || '').trim().toLowerCase();
        if (name !== normalizedName) continue;
        selectedIndexes.add(index);
        const exiledCard = { ...card, zone: 'exile' };
        zoneSelections.push(card);
        selectedCards.push(exiledCard);
        remainingSlots -= 1;
      }
      if (selectedIndexes.size > 0) {
        selectedByZone.set(zone, selectedIndexes);
        selectionsByZone.set(zone, zoneSelections);
      }
    }

    if (selectedCards.length === 0) {
      log.push(`${playerId} searched graveyard, hand, and library and found no ${chosenCardName}`);
      continue;
    }

    if (bridgeActive && Number.isFinite(ctx.currentStepIndex)) {
      for (const zone of step.zones) {
        const cards = selectionsByZone.get(zone) ?? [];
        if (cards.length === 0) continue;
        const commitResult = commitCardZoneChanges({
          state: nextState,
          playerId,
          cards: cards.map((card: any) => ({ ...card, ownerId: playerId, owner: playerId })),
          sourceZone: zone as 'hand' | 'graveyard' | 'library',
          intendedDestination: 'exile',
          stepIndex: Number(ctx.currentStepIndex),
          stepKind: step.kind,
          cause: 'oracle_ir:exile_named_cards_from_zones',
          ctx,
        });
        if (commitResult.halted) {
          return withDiscardLedgerFlags({
            applied: true,
            state: nextState,
            log,
            ...(allExiledCards.length > 0 ? { lastExiledCards: allExiledCards } : {}),
          }, ledgerRecordedViaBridge);
        }
        nextState = commitResult.state;
        allExiledCards.push(...commitResult.movedCards);
        if (commitResult.ledgerRecordedViaBridge) {
          ledgerRecordedViaBridge = true;
        }
      }
      log.push(`${playerId} exiled ${selectedCards.length} card(s) named ${chosenCardName}`);
      continue;
    }

    nextState = {
      ...(nextState as any),
      players: nextState.players.map((entry: any) => {
        if (entry.id !== playerId) return entry;
        const nextEntry: any = { ...entry };
        for (const zone of step.zones) {
          const selectedIndexes = selectedByZone.get(zone) ?? new Set<number>();
          if (selectedIndexes.size === 0) continue;
          const cards = Array.isArray(entry[zone]) ? entry[zone] : [];
          nextEntry[zone] = cards.filter((_: unknown, index: number) => !selectedIndexes.has(index));
        }
        nextEntry.exile = [...(Array.isArray(entry.exile) ? entry.exile : []), ...selectedCards];
        return nextEntry;
      }),
    } as GameState;
    log.push(`${playerId} exiled ${selectedCards.length} card(s) named ${chosenCardName}`);
    allExiledCards.push(...selectedCards);
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    ...(allExiledCards.length > 0 ? { lastExiledCards: allExiledCards } : {}),
  }, ledgerRecordedViaBridge);
}

export function applyShuffleLibraryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'shuffle_library' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  if (step.optional === true && ctx.interactivePlayerChoices === true) {
    return {
      applied: false,
      message: `Skipped optional shuffle (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  let players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0 && step.who.kind === 'target_player') {
    const spellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    if (spellId) {
      const stackItem = (state.stack || []).find((item: any) => String(item?.id || '').trim() === spellId) as any;
      const spellControllerId = String(stackItem?.controller || stackItem?.owner || '').trim();
      if (spellControllerId && (state.players || []).some((player: any) => String(player?.id || '').trim() === spellControllerId)) {
        players = [spellControllerId as PlayerID];
      }
    }
    if (players.length === 0 && /that player shuffles/i.test(String(step.raw || ''))) {
      const bound = String(
        ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || ctx.targetOpponentId || 'p2'
      ).trim();
      if ((state.players || []).some((player: any) => String(player?.id || '').trim() === bound)) {
        players = [bound as PlayerID];
      }
    }
  }
  if (players.length === 0 && /that player shuffles/i.test(String(step.raw || ''))) {
    const bound = String(
      ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || ctx.targetOpponentId || 'p2'
    ).trim();
    if (bound) players = [bound as PlayerID];
  }
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped shuffle library (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const replayMutations: OracleIRReplayMutation[] = [];

  for (const playerId of players) {
    const player = nextState.players.find(p => p.id === playerId) as any;
    if (!player) {
      log.push(`${playerId} shuffled their library (${step.raw})`);
      continue;
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    const shuffledLibrary = shuffleArray(library);
    const shuffledLibraryIds = shuffledLibrary
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    nextState = {
      ...(nextState as any),
      players: nextState.players.map((entry: any) =>
        entry.id === playerId ? { ...entry, library: shuffledLibrary } : entry
      ),
    } as GameState;
    log.push(`${playerId} shuffled their library`);
    if (shuffledLibraryIds.length > 0) {
      replayMutations.push({
        kind: 'shuffleLibrary',
        playerId,
        shuffledLibraryIds,
      });
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  };
}

export function applyShuffleZonesIntoLibraryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'shuffle_zones_into_library' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped shuffle zones into library (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const zones = new Set((step.zones || []).map((zone) => String(zone || '').trim().toLowerCase()));
  let nextState = state;
  const log: string[] = [];
  let ledgerRecordedViaBridge = false;
  const stepIndex = Number(ctx.currentStepIndex);

  for (const playerId of players) {
    const player = nextState.players.find(p => p.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped shuffle zones into library (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const stampOwner = (card: any) => ({ ...card, ownerId: playerId, owner: playerId, zone: 'library' });
    const movingFromHand = zones.has('hand')
      ? readPlayerZoneCards(nextState, playerId, player, 'hand')
      : [];
    const movingFromGraveyard = zones.has('graveyard')
      ? readPlayerZoneCards(nextState, playerId, player, 'graveyard')
      : [];

    if (zones.has('hand') && movingFromHand.length > 0) {
      const commitResult = commitCardZoneChanges({
        state: nextState,
        playerId,
        cards: movingFromHand.map(stampOwner),
        sourceZone: 'hand',
        intendedDestination: 'library',
        stepIndex,
        stepKind: step.kind,
        cause: 'oracle_ir:shuffle_zones_into_library',
        ctx,
        libraryPlacement: 'bottom',
      });
      if (commitResult.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
        }, ledgerRecordedViaBridge);
      }
      nextState = commitResult.state;
      if (commitResult.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    }

    if (zones.has('graveyard') && movingFromGraveyard.length > 0) {
      const gyPlayer = nextState.players.find(p => p.id === playerId) as any;
      const gyCards = gyPlayer
        ? readPlayerZoneCards(nextState, playerId, gyPlayer, 'graveyard')
        : movingFromGraveyard;
      const commitResult = commitCardZoneChanges({
        state: nextState,
        playerId,
        cards: gyCards.map(stampOwner),
        sourceZone: 'graveyard',
        intendedDestination: 'library',
        stepIndex,
        stepKind: step.kind,
        cause: 'oracle_ir:shuffle_zones_into_library',
        ctx,
        libraryPlacement: 'bottom',
      });
      if (commitResult.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
        }, ledgerRecordedViaBridge);
      }
      nextState = commitResult.state;
      if (commitResult.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    }

    const livePlayer = nextState.players.find(p => p.id === playerId) as any;
    if (!livePlayer) {
      return {
        applied: false,
        message: `Skipped shuffle zones into library (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }
    if (zones.has('hand')) {
      writePlayerZoneCards(nextState, playerId, livePlayer, 'hand', []);
    }
    if (zones.has('graveyard')) {
      writePlayerZoneCards(nextState, playerId, livePlayer, 'graveyard', []);
    }
    const nextLibrary = shuffleArray(readPlayerZoneCards(nextState, playerId, livePlayer, 'library'));
    writePlayerZoneCards(nextState, playerId, livePlayer, 'library', nextLibrary);
    log.push(`${playerId} shuffled ${movingFromHand.length + movingFromGraveyard.length} card(s) from hand/graveyard into their library`);
  }

  return withDiscardLedgerFlags({ applied: true, state: nextState, log }, ledgerRecordedViaBridge);
}

export function applyChoosePileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'choose_pile' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const choosers = resolvePlayers(state, step.chooser, ctx);
  if (choosers.length !== 1) {
    if (
      step.chooser.kind === 'target_opponent'
      && choosers.length === 0
      && String(step.source || '') === 'top_library'
    ) {
      const controllerId = ctx.controllerId;
      const opponents = (state.players || [])
        .map((player) => player.id)
        .filter((playerId) => playerId !== controllerId);
      if (opponents.length > 1) {
        return {
          applied: false,
          message: `Skipped choose pile (requires opponent choice): ${step.raw}`,
          reason: 'player_choice_required',
          options: {
            classification: 'player_choice',
            metadata: {
              chooser: controllerId,
              source: step.source,
              chosenDestination: step.chosenDestination || '',
              otherDestination: step.otherDestination || '',
            },
          },
        };
      }
    }

    return {
      applied: false,
      message: `Skipped choose pile (requires deterministic chooser): ${step.raw}`,
      reason: choosers.length === 0 ? 'unsupported_player_selector' : 'player_choice_required',
      options: choosers.length > 1 ? { classification: 'player_choice' } : undefined,
    };
  }

  const selectorContext: any = ctx.selectorContext || {};
  const chosenPile = String(selectorContext.chosenPile || selectorContext.pileChoice || '').trim();
  if (!chosenPile) {
    return {
      applied: false,
      message: `Skipped choose pile (requires pile choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          chooser: choosers[0],
          source: step.source,
          chosenDestination: step.chosenDestination || '',
          otherDestination: step.otherDestination || '',
        },
      },
    };
  }

  return {
    applied: true,
    state,
    log: [`${choosers[0]} chose pile ${chosenPile}`],
  };
}

export function applyChangeTargetStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'change_target' }>,
  ctx: OracleIRExecutionContext,
): PlayerStepHandlerResult {
  if (isRandomChangeTargetStep(step)) {
    const spellIds = resolveChangeTargetSpellIds(state, step, ctx);
    if (spellIds.length === 0) {
      return {
        applied: false,
        message: `Skipped change target (no spell to reselect): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const result = applyRandomRetargetToStackSpells(
      state,
      spellIds,
      ctx,
      step.exclude,
      resolveChangeTargetExcludeText(step),
    );
    return {
      applied: true,
      state: result.state,
      log: result.log.length > 0 ? [...result.log] : [`Reselected targets at random: ${step.raw}`],
    };
  }

  const stack = Array.isArray((state as any).stack) ? [...((state as any).stack as any[])] : [];
  const targetedSpells = stack.filter(
    (item) =>
      String((item as any)?.type || '').trim() === 'spell'
      && Array.isArray((item as any)?.targets)
      && (item as any).targets.length > 0,
  );

  if (targetedSpells.length === 0) {
    return {
      applied: true,
      state,
      log: [`No targeted spells on the stack for change target: ${step.raw}`],
    };
  }

  const chosenIds = getNormalizedChosenIds(ctx);
  let chosenSpellId = String(
    ctx.selectorContext?.chosenSpellId || ctx.targetSpellId || chosenIds[0] || '',
  ).trim();

  if (!chosenSpellId) {
    if (targetedSpells.length === 1) {
      chosenSpellId = String((targetedSpells[0] as any)?.id || '').trim();
    } else {
      return {
        applied: false,
        message: `Skipped change target (requires spell choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            changeTargetPhase: 'choose_spell',
            candidateSpellIds: targetedSpells
              .map((item) => String((item as any)?.id || '').trim())
              .filter(Boolean),
          },
        },
      };
    }
  }

  const spellIndex = stack.findIndex((item) => String((item as any)?.id || '').trim() === chosenSpellId);
  if (spellIndex < 0) {
    return {
      applied: false,
      message: `Skipped change target (spell not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const spell = { ...(stack[spellIndex] as any) };
  const existingTargets = Array.isArray(spell.targets) ? [...spell.targets] : [];
  const newTargetIds = chosenIds
    .filter((id) => id !== chosenSpellId)
    .concat(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter((id) => id && id !== chosenSpellId),
    )
    .filter((id, index, array) => array.indexOf(id) === index);

  if (step.newTarget && newTargetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped change target (requires new target choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          changeTargetPhase: 'choose_new_target',
          chosenSpellId,
          candidateTargetIds: (state.battlefield || [])
            .map((perm: any) => String(perm?.id || '').trim())
            .filter(Boolean),
        },
      },
    };
  }

  if (newTargetIds.length > 0) {
    spell.targets = newTargetIds.map((id) => {
      const existing = existingTargets.find(
        (target: any) => String(target?.id || target || '').trim() === id,
      );
      if (existing && typeof existing === 'object') {
        return { ...existing, id };
      }
      return { id, type: 'permanent' };
    });
  }

  const nextStack = [...stack];
  nextStack[spellIndex] = spell;
  return {
    applied: true,
    state: { ...(state as any), stack: nextStack } as GameState,
    log: [`Changed targets of ${chosenSpellId}${newTargetIds.length > 0 ? ` to ${newTargetIds.join(', ')}` : ''}`],
  };
}
