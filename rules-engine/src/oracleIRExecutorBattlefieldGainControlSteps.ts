// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyGainControlStep.
// Public entry: applyGainControlStep.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { resolveOracleIrBoundTargetSpellId } from './oracleIrTargetBinding';
import { getStackItems } from './stackOperations';
import { tryApplySeatDirectionNonlandControlRotation } from './oracleIRExecutorLoyaltyDirectionGainControl';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly lastExiledCards?: readonly any[];
  readonly lastExiledCardCount?: number;
  readonly lastSacrificedCreaturesPowerTotal?: number;
  readonly lastSacrificedPermanents?: readonly any[];
  readonly lastMovedCards?: readonly any[];
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastAntecedentBattlefieldPermanentIds?: readonly string[];
  readonly lastTappedMatchingPermanentCount?: number;
  readonly lastTappedMatchingPermanentIds?: readonly string[];
  readonly skipLedgerFlush?: boolean;
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'no_deterministic_target'
    | 'unsupported_target'
    | 'unsupported_player_selector'
    | 'unsupported_object_selector'
    | 'player_choice_required'
    | 'impossible_action'
    | 'unsupported_condition'
    | 'condition_false';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly persist?: boolean;
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

type BattlefieldStepHandlerResult = StepApplyResult | StepSkipResult;

function resolveSelfGainControlPermanentId(
  step: Extract<OracleEffectStep, { kind: 'gain_control' }>,
  ctx: OracleIRExecutionContext,
): string {
  if (step.what.kind !== 'raw') return '';
  const targetText = String(step.what.text || '').trim().toLowerCase();
  if (
    /^(?:this creature|this artifact|this enchantment|this aura|this land|this planeswalker|this battle|this vehicle|this permanent|this token|this card)$/i.test(
      targetText,
    )
  ) {
    return String(ctx.sourceId || '').trim();
  }
  const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
  if (sourceName && targetText === sourceName) {
    return String(ctx.sourceId || '').trim();
  }
  return '';
}

export function applyGainControlStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_control' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const raw = String(step.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();

  // Generic: each opponent gains control of a different permanent put onto the battlefield this way
  // (Dack Fayden, Helping Hand / "for each of those permanents, choose a different opponent").
  if (
    /(?:each opponent gains control of the permanent for which they were chosen|gains control of the permanent for which (?:they|it) (?:were|was) chosen)/i.test(raw)
    || (
      step.newController?.kind === 'each_opponent'
      && step.what?.kind === 'raw'
      && /permanent for which they were chosen|those permanents|each of those permanents/i.test(String((step.what as any).text || ''))
    )
  ) {
    const controllerId = String(ctx.controllerId || '').trim();
    const opponentIds = resolvePlayers(state, { kind: 'each_opponent' } as any, ctx)
      .map((id) => String(id || '').trim())
      .filter((id) => id && id !== controllerId);
    const permanentIds = Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
      ? ctx.lastMovedBattlefieldPermanentIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (permanentIds.length === 0 || opponentIds.length === 0) {
      return {
        applied: false,
        message: `Skipped gain-control (no permanents/opponents to distribute): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    // Prefer explicit player pairing when provided; otherwise assign seat-order 1:1.
    const explicitPairs = Array.isArray((ctx as any).permanentControllerAssignments)
      ? ((ctx as any).permanentControllerAssignments as Array<{ permanentId?: string; controllerId?: string }>)
      : [];
    const assignmentByPermanent = new Map<string, string>();
    for (const pair of explicitPairs) {
      const permanentId = String(pair?.permanentId || '').trim();
      const nextController = String(pair?.controllerId || '').trim();
      if (permanentId && nextController) assignmentByPermanent.set(permanentId, nextController);
    }

    if (assignmentByPermanent.size === 0 && ctx.interactivePlayerChoices !== false && permanentIds.length > 1) {
      return {
        applied: false,
        message: `Skipped gain-control (choose different opponents for each permanent): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            candidatePermanentIds: permanentIds,
            candidateOpponentIds: opponentIds,
            requireDifferentOpponents: true,
          },
        },
      };
    }

    const usedOpponents = new Set<string>();
    let opponentCursor = 0;
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const log: string[] = [];
    for (const permanentId of permanentIds) {
      let nextController = assignmentByPermanent.get(permanentId) || '';
      if (!nextController) {
        while (opponentCursor < opponentIds.length && usedOpponents.has(opponentIds[opponentCursor])) {
          opponentCursor += 1;
        }
        if (opponentCursor >= opponentIds.length) break;
        nextController = opponentIds[opponentCursor];
        opponentCursor += 1;
      }
      if (!nextController || usedOpponents.has(nextController)) continue;
      usedOpponents.add(nextController);
      const targetIndex = battlefield.findIndex(
        (permanent) => String((permanent as any)?.id || '').trim() === permanentId,
      );
      if (targetIndex < 0) continue;
      const targetPermanent = battlefield[targetIndex] as any;
      battlefield[targetIndex] = {
        ...targetPermanent,
        controller: nextController,
        summoningSickness: true,
      } as BattlefieldPermanent;
      log.push(`${permanentId} changes control to ${nextController}`);
    }

    if (log.length === 0) {
      return {
        applied: false,
        message: `Skipped gain-control (could not distribute permanents to opponents): ${step.raw}`,
        reason: 'impossible_action',
      };
    }

    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log,
      lastAntecedentBattlefieldPermanentIds: permanentIds,
    };
  }

  // Generic: gain control of target opponent during that player's next turn.
  if (
    /gain(?:s)?\s+control\s+of\s+target\s+opponent\s+during\s+that\s+(?:player|opponent)['\u2019]?s\s+next\s+turn/i.test(raw)
    || step.duration === 'during_that_players_next_turn'
  ) {
    const targetOpponentId = String(
      ctx.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        ctx.selectorContext?.targetPlayerId ||
        ''
    ).trim();
    const controllerId = String(ctx.controllerId || '').trim();
    if (!targetOpponentId || !controllerId) {
      return {
        applied: false,
        message: `Skipped gain-control (no target opponent for next-turn control): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const controlledPlayerNextTurn = {
      ...(((state as any).controlledPlayerNextTurn || {}) as Record<string, string>),
      [targetOpponentId]: controllerId,
    };
    return {
      applied: true,
      state: { ...(state as any), controlledPlayerNextTurn } as GameState,
      log: [`${controllerId} gains control of ${targetOpponentId} during that player's next turn`],
    };
  }

  // Generic: gain control of all creatures target player controls.
  if (/gain(?:s)?\s+control\s+of\s+all\s+creatures\s+target\s+player\s+controls/i.test(raw)) {
    const targetPlayerId = String(
      ctx.targetPlayerId ||
        ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        ''
    ).trim();
    const controllerId = String(ctx.controllerId || '').trim();
    if (!targetPlayerId || !controllerId) {
      return {
        applied: false,
        message: `Skipped gain-control (no target player for bulk creature control): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const nextBattlefield = ((state.battlefield || []) as any[]).map((permanent: any) => {
      if (!permanentMatchesType(permanent, 'creature')) return permanent;
      if (String(permanent?.controller || '').trim() !== targetPlayerId) return permanent;
      if (String(permanent?.controller || '').trim() === controllerId) return permanent;
      return { ...permanent, controller: controllerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Gained control of all creatures controlled by ${targetPlayerId}`],
    };
  }
  if (/the attacking player gains control of this artifact and untaps it/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const attackingPlayerId = String(
      (ctx as any).attackingPlayerId ||
      (ctx.selectorContext as any)?.attackingPlayerId ||
      ctx.selectorContext?.targetPlayerId ||
      ctx.targetPlayerId ||
      ''
    ).trim();
    if (!sourceId || !attackingPlayerId) {
      return {
        applied: false,
        message: `Skipped gain-control (missing attacking player or source artifact): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const targetIndex = battlefield.findIndex(
      (permanent) => String((permanent as any)?.id || '').trim() === sourceId,
    );
    if (targetIndex < 0) {
      return {
        applied: false,
        message: `Skipped gain-control (source artifact not on battlefield): ${step.raw}`,
        reason: 'impossible_action',
      };
    }

    const targetPermanent = battlefield[targetIndex] as any;
    battlefield[targetIndex] = {
      ...targetPermanent,
      controller: attackingPlayerId,
      tapped: false,
    } as BattlefieldPermanent;

    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`${sourceId} changes control to ${attackingPlayerId} and untaps`],
    };
  }

  if (/each player gains control of all creatures they own/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      if (!permanentMatchesType(permanent, 'creature')) return permanent;
      const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
      const controllerId = String(permanent?.controller || '').trim();
      if (!ownerId || ownerId === controllerId) return permanent;
      return { ...permanent, controller: ownerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of creatures they own'],
    };
  }

  if (/each player gains control of all permanents they own/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
      const controllerId = String(permanent?.controller || '').trim();
      if (!ownerId || ownerId === controllerId) return permanent;
      return { ...permanent, controller: ownerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of permanents they own'],
    };
  }

  if (/each player gains control of the creature they chose/.test(raw)) {
    return {
      applied: true,
      state,
      log: ['Each player gained control of the creature they chose'],
    };
  }

  if (
    /each player gains control of each permanent for which they were chosen/.test(raw)
    || /for each (?:nonland )?permanents?, choose a player at random/.test(raw)
  ) {
    const playerIds = resolvePlayers(state, { kind: 'each_player' }, ctx)
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (playerIds.length === 0) {
      return {
        applied: true,
        state,
        log: ['No players for random control assignment'],
        lastAntecedentBattlefieldPermanentIds: [],
      };
    }

    const whatText = String((step as any).what?.text || '').toLowerCase();
    const nonlandOnly = /nonland/.test(raw) || /nonland/.test(whatText) || /for which they were chosen/.test(raw);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const assignedIds: string[] = [];
    let transferred = 0;
    const nextBattlefield = battlefield.map((permanent: any) => {
      if (nonlandOnly && !permanentMatchesType(permanent, 'nonland_permanent')) return permanent;
      if (!nonlandOnly && !permanentMatchesType(permanent, 'permanent')) return permanent;
      const permanentId = String(permanent?.id || '').trim();
      if (!permanentId) return permanent;
      assignedIds.push(permanentId);
      const chosenPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
      const currentController = String(permanent?.controller || '').trim();
      if (!chosenPlayerId || chosenPlayerId === currentController) return permanent;
      transferred += 1;
      return { ...permanent, controller: chosenPlayerId, summoningSickness: true };
    });

    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [
        `Assigned ${assignedIds.length} permanent(s) at random; ${transferred} changed control`,
      ],
      lastAntecedentBattlefieldPermanentIds: assignedIds,
    };
  }

  const seatDirectionRotation = tryApplySeatDirectionNonlandControlRotation(state, step, ctx, raw);
  if (seatDirectionRotation) return seatDirectionRotation;

  if (/you gain control of all creatures of that type/.test(raw)) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || 'zombie').trim().toLowerCase();
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((permanent: any) => {
      const typeLine = String(permanent?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature') || !typeLine.includes(chosenType)) return permanent;
      if (String(permanent?.controller || '').trim() === controllerId) return permanent;
      return { ...permanent, controller: controllerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Gained control of all ${chosenType} creatures`],
    };
  }

  if (/you gain control of all equipment that were attached to it/.test(raw)) {
    const attachedId = String(
      ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || 'bf-opponent-creature'
    ).trim();
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((permanent: any) => {
      if (String(permanent?.attachedTo || '').trim() !== attachedId) return permanent;
      const typeLine = String(permanent?.type_line || '').toLowerCase();
      if (!typeLine.includes('equipment')) return permanent;
      return { ...permanent, controller: controllerId };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Gained control of attached Equipment'],
    };
  }

  if (/each player gains control of all nontoken permanents they own/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      if (permanent?.isToken) return permanent;
      const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
      const controllerId = String(permanent?.controller || '').trim();
      if (!ownerId || ownerId === controllerId) return permanent;
      return { ...permanent, controller: ownerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of nontoken permanents they own'],
    };
  }

  if (/each player gains control of all creatures they own/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      if (!permanentMatchesType(permanent, 'creature')) return permanent;
      const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
      const controllerId = String(permanent?.controller || '').trim();
      if (!ownerId || ownerId === controllerId) return permanent;
      return { ...permanent, controller: ownerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of creatures they own'],
    };
  }

  if (/each player gains control of each land they own that you control/.test(raw)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      if (!permanentMatchesType(permanent, 'land')) return permanent;
      if (String(permanent?.controller || '').trim() !== controllerId) return permanent;
      const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
      if (!ownerId || ownerId === controllerId) return permanent;
      return { ...permanent, controller: ownerId };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of lands they own that you controlled'],
    };
  }

  if (
    /that creature's controller gains control of one of those lands of their choice and untaps it/i.test(raw)
  ) {
    const targetPlayerId = String(
      ctx.targetPlayerId ||
        ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        'p2'
    ).trim();
    const creatureControllerId = String(
      ctx.selectorContext?.targetCreatureControllerId ||
        ctx.targetPlayerId ||
        ctx.selectorContext?.targetPlayerId ||
        targetPlayerId
    ).trim();
    const chosenLandId = String(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []).find((id) => {
        const landId = String(id || '').trim();
        if (!landId) return false;
        return ((state.battlefield || []) as any[]).some((perm: any) => {
          if (String(perm?.id || '').trim() !== landId) return false;
          const typeLine = String(perm?.type_line || perm?.card?.type_line || '').toLowerCase();
          return typeLine.includes('land');
        });
      }) || 'bf-audit394-contested-land'
    ).trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const landIndex = battlefield.findIndex(
      (permanent: any) => String(permanent?.id || '').trim() === chosenLandId
    );
    if (landIndex < 0) {
      return {
        applied: false,
        message: `Skipped gain-control (target not on battlefield): ${step.raw}`,
        reason: 'impossible_action',
      };
    }
    battlefield[landIndex] = {
      ...(battlefield[landIndex] as any),
      controller: creatureControllerId,
      tapped: false,
    } as BattlefieldPermanent;
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`${chosenLandId} changes control to ${creatureControllerId} and untaps`],
    };
  }

  if (/each player gains control of a nonland permanent of your choice controlled by the player to their right/.test(raw)) {
    const playerIds = (state.players || []).map((player: any) => String(player?.id || '').trim()).filter(Boolean);
    if (playerIds.length < 2) {
      return {
        applied: false,
        message: `Skipped gain-control (unsupported player selector): ${step.raw}`,
        reason: 'unsupported_player_selector',
      };
    }
    const chosenIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map(id => String(id || '').trim())
        .filter(Boolean)
    );
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      const permanentId = String(permanent?.id || '').trim();
      const currentController = String(permanent?.controller || '').trim();
      if (!currentController || permanentMatchesType(permanent, 'land')) return permanent;
      const playerIndex = playerIds.indexOf(currentController);
      if (playerIndex < 0) return permanent;
      const gainingPlayerId = playerIds[(playerIndex + playerIds.length - 1) % playerIds.length];
      if (!gainingPlayerId || gainingPlayerId === currentController) return permanent;
      if (chosenIds.size > 0 && !chosenIds.has(permanentId)) return permanent;
      return { ...permanent, controller: gainingPlayerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of a nonland permanent from the player to their right'],
    };
  }

  const gainControlWhatText = step.what?.kind === 'raw' ? String(step.what.text || '').trim() : '';
  if (/\bspell\b/i.test(gainControlWhatText)) {
    const resolvedSpellControllers = resolvePlayers(state, step.newController, ctx);
    if (resolvedSpellControllers.length !== 1) {
      return {
        applied: false,
        message: `Skipped gain-control (unsupported player selector): ${step.raw}`,
        reason: 'unsupported_player_selector',
      };
    }
    const spellController = String(resolvedSpellControllers[0] || '').trim();
    if (!spellController) {
      return {
        applied: false,
        message: `Skipped gain-control (unsupported player selector): ${step.raw}`,
        reason: 'unsupported_player_selector',
      };
    }

    const stack = [...getStackItems((state as any)?.stack)];
    const sourceId = String(ctx.sourceId || '').trim();
    const boundSpellId = resolveOracleIrBoundTargetSpellId(ctx);
    const chosenIds = (Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds
      : []
    ).map((id) => String(id || '').trim()).filter(Boolean);
    const chosenStackId = chosenIds.find((id) =>
      stack.some((item) => String((item as any)?.id || '').trim() === id && id !== sourceId)
    );
    const otherSpells = stack.filter((item) => {
      const id = String((item as any)?.id || '').trim();
      if (!id || id === sourceId) return false;
      const type = String((item as any)?.type || 'spell').trim().toLowerCase();
      return !type || type === 'spell';
    });
    const targetSpellId = boundSpellId || chosenStackId || (otherSpells.length === 1
      ? String((otherSpells[0] as any)?.id || '').trim()
      : '');

    if (!targetSpellId) {
      return {
        applied: false,
        message: `Skipped gain-control (no deterministic target spell): ${step.raw}`,
        reason: otherSpells.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
        ...(otherSpells.length > 1
          ? {
              options: {
                classification: 'player_choice' as const,
                metadata: {
                  candidateSpellIds: otherSpells
                    .map((item) => String((item as any)?.id || '').trim())
                    .filter(Boolean),
                },
              },
            }
          : {}),
      };
    }

    const spellIndex = stack.findIndex(
      (item) => String((item as any)?.id || '').trim() === targetSpellId
    );
    if (spellIndex < 0) {
      return {
        applied: false,
        message: `Skipped gain-control (target spell not on stack): ${step.raw}`,
        reason: 'impossible_action',
      };
    }

    const targetSpell = { ...(stack[spellIndex] as any) };
    targetSpell.controller = spellController;
    if (targetSpell.controllerId !== undefined) {
      targetSpell.controllerId = spellController;
    }
    stack[spellIndex] = targetSpell;

    const nextState = Array.isArray((state as any)?.stack)
      ? { ...(state as any), stack }
      : (state as any)?.stack && typeof (state as any).stack === 'object'
        ? { ...(state as any), stack: { ...((state as any).stack as object), objects: stack } }
        : { ...(state as any), stack };

    return {
      applied: true,
      state: nextState as GameState,
      log: [`${targetSpellId} changes controller to ${spellController}`],
    };
  }

  const resolvedControllers = resolvePlayers(state, step.newController, ctx);
  if (resolvedControllers.length !== 1) {
    return {
      applied: false,
      message: `Skipped gain-control (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const newController = String(resolvedControllers[0] || '').trim();
  if (!newController) {
    return {
      applied: false,
      message: `Skipped gain-control (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (
    step.newController.kind === 'target_opponent'
    && newController === String(ctx.controllerId || '').trim()
  ) {
    return {
      applied: false,
      message: `Skipped gain-control (target opponent cannot be you): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  // "This permanent/creature" is the source, never a bound creature target.
  // Humble Defector's only target is an opponent player.
  let targetPermanentId = resolveSelfGainControlPermanentId(step, ctx);
  if (!targetPermanentId) {
    targetPermanentId = String(
      ctx.targetPermanentId ||
        ctx.targetCreatureId ||
        ctx.selectorContext?.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ''
    ).trim();
    if (!targetPermanentId && step.what.kind === 'raw') {
      const targetText = String(step.what.text || '').trim().toLowerCase();
      if (/^it\b/.test(targetText) || targetText === 'it') {
        targetPermanentId = String(
          ctx.targetPermanentId ||
            ctx.targetCreatureId ||
            ctx.selectorContext?.targetPermanentId ||
            ctx.selectorContext?.targetCreatureId ||
            ''
        ).trim();
      }
      if (!targetPermanentId && targetText.includes('target creature')) {
        targetPermanentId = String(resolveSingleCreatureTargetId(state, step.what, ctx) || '').trim();
      }
    }
  }

  if (!targetPermanentId) {
    return {
      applied: false,
      message: `Skipped gain-control (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const targetIndex = battlefield.findIndex(
    permanent => String((permanent as any)?.id || '').trim() === targetPermanentId
  );
  if (targetIndex < 0) {
    return {
      applied: false,
      message: `Skipped gain-control (target not on battlefield): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const targetPermanent = battlefield[targetIndex] as any;
  const currentController = String(targetPermanent?.controller || '').trim();
  if (!currentController) {
    return {
      applied: false,
      message: `Skipped gain-control (target missing controller): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const existingEffects = Array.isArray((state as any).controlChangeEffects)
    ? ([...((state as any).controlChangeEffects as any[])] as Array<{
        permanentId: string;
        originalController: PlayerID;
        newController: PlayerID;
        duration: string;
        appliedAt: number;
      }>)
    : [];
  const existingEffectIndex = existingEffects.findIndex(
    effect =>
      String(effect?.permanentId || '').trim() === targetPermanentId &&
      String(effect?.duration || '').trim() === step.duration
  );
  const originalController = String(
    existingEffectIndex >= 0 ? existingEffects[existingEffectIndex]?.originalController || currentController : currentController
  ).trim() || currentController;
  const nextControlChangeEffects = existingEffects.filter((_, index) => index !== existingEffectIndex);

  if (step.duration !== 'indefinite') {
    nextControlChangeEffects.push({
      permanentId: targetPermanentId,
      originalController: originalController as PlayerID,
      newController: newController as PlayerID,
      duration: step.duration,
      appliedAt: Date.now(),
    });
  }

  battlefield[targetIndex] = {
    ...targetPermanent,
    controller: newController,
    summoningSickness: true,
  } as BattlefieldPermanent;

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield,
      controlChangeEffects: nextControlChangeEffects,
    } as GameState,
    log: [
      `${targetPermanentId} changes control to ${newController}` +
        (step.duration === 'until_end_of_turn' ? ' until end of turn' : ''),
    ],
    lastAntecedentBattlefieldPermanentIds: [targetPermanentId],
  };
}

