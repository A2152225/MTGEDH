/**
 * socket/resolution-handlers/targetSelectionImmediateBattlefieldActions.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the battlefield half of the `step.action` immediate-action chain that runs once
 * targets are chosen - soulbond_pair, sacrifice_selected_permanents, pw_lukka_exile_upgrade,
 * destroy_artifact_enchantment, tap_or_untap_target (which queues the tap/untap OPTION_CHOICE),
 * begin_combat_target_buff, and destroy_target_creature_or_planeswalker.
 * Public entry symbols: tryHandleTargetSelectionImmediateBattlefieldAction.
 *
 * Every branch in the original chain returned, so the dispatcher returns true when it matched an
 * action and the caller must stop.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import { persistBattlefieldPermanentPatchAfterMutation } from "../../state/effects/battlefieldPermanentReplayPersistence.js";
import { destroyPermanent, movePermanentToExile } from "../../state/modules/counters_tokens.js";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import {
  createResolutionStep,
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { parsePT, uid } from "../../state/utils.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { broadcastGame, getPlayerName } from "../util.js";
import { stampPermanentEntryTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

/** Immediate battlefield actions for a TARGET_SELECTION step; true when the action was handled. */
export async function tryHandleTargetSelectionImmediateBattlefieldAction(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const action = (step as any).action;

  if (action === 'soulbond_pair') {
    const sourceId = String((step as any).soulbondSourceId || step.sourceId || '').trim();
    const targetId = String(selections?.[0] || '').trim();
    if (sourceId && targetId) {
      try {
        const { pairPermanents } = await import('../../state/modules/soulbond.js');
        pairPermanents(game.state, sourceId, targetId);
      } catch (err) {
        debugWarn(1, `[Resolution] soulbond_pair failed:`, err);
      }
    }
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (action === 'sacrifice_selected_permanents') {
    const sourceName = String(step.sourceName || 'Effect');
    const controllerId = String(pid);
    const ctx = {
      state: game.state,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      zones: game.state?.zones,
      gameId,
    } as unknown as GameContext;

    const sacrificedNames: string[] = [];
    for (const permanentIdToSac of selections) {
      const sacrificedName = sacrificePermanent(ctx, permanentIdToSac, controllerId);
      if (sacrificedName) sacrificedNames.push(sacrificedName);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message:
        sacrificedNames.length > 0
          ? `${sourceName}: ${getPlayerName(game, controllerId)} sacrificed ${sacrificedNames.length} permanent(s).`
          : `${sourceName}: ${getPlayerName(game, controllerId)} sacrificed permanent(s).`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (action === 'pw_lukka_exile_upgrade') {
    const controllerId = String(pid);
    const sourceName = String(step.sourceName || 'Planeswalker');
    const targetId = selections[0];
    if (!targetId) {
      debugWarn(1, `[Resolution] pw_lukka_exile_upgrade: missing selection`);
      return true;
    }

    const state = game.state || {};
    const battlefield = (state.battlefield = state.battlefield || []);
    const idx = battlefield.findIndex((p: any) => p?.id === targetId);
    if (idx === -1) {
      debugWarn(1, `[Resolution] pw_lukka_exile_upgrade: target not found on battlefield: ${targetId}`);
      return true;
    }

    const perm = battlefield[idx];
    const tlPerm = String(perm?.card?.type_line || '').toLowerCase();
    if (String(perm?.controller || '') !== controllerId || !tlPerm.includes('creature')) {
      debugWarn(1, `[Resolution] pw_lukka_exile_upgrade: invalid target`);
      return true;
    }

    const exiledMv = Number(perm?.card?.cmc ?? 0);
    const exiledName = String(perm?.card?.name || 'a creature');

    // Exile the target creature you control.
    movePermanentToExile(game as any, targetId);
    const zones = (state.zones = state.zones || {});

    // Reveal until a creature card with greater MV.
    const lib: any[] = (game as any).libraries?.get?.(controllerId) || [];
    const revealed: any[] = [];
    let found: any = null;
    while (Array.isArray(lib) && lib.length > 0) {
      const c = lib.shift();
      if (!c) break;
      revealed.push(c);
      const tl = String(c?.type_line || '').toLowerCase();
      const isCreature = tl.includes('creature');
      const mv = Number(c?.cmc ?? 0);
      if (isCreature && mv > exiledMv) {
        found = c;
        break;
      }
    }

    if (found) {
      const tl = String(found?.type_line || '').toLowerCase();
      const isCreature = tl.includes('creature');
      const hasHaste =
        String(found?.oracle_text || '').toLowerCase().includes('haste') ||
        (Array.isArray(found?.keywords) && found.keywords.some((k: any) => String(k || '').toLowerCase() === 'haste'));

      const newPermanent: any = {
        id: uid('perm'),
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        counters: {},
        basePower: isCreature ? parsePT(found?.power) : undefined,
        baseToughness: isCreature ? parsePT(found?.toughness) : undefined,
        summoningSickness: isCreature && !hasHaste,
        card: { ...found, zone: 'battlefield' },
      };
      battlefield.push(newPermanent);
      stampPermanentEntryTimestamp(state, battlefield[battlefield.length - 1]);
    }

    const rest = revealed.filter((c: any) => c && c !== found);
    const restBottom = [...rest].sort(() => Math.random() - 0.5);
    for (const c of restBottom) {
      lib.push({ ...c, zone: 'library' });
    }

    // Update counts + persist library.
    const controllerZones = (zones[controllerId] = zones[controllerId] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
    controllerZones.libraryCount = Array.isArray(lib) ? lib.length : controllerZones.libraryCount;
    if ((game as any).libraries?.set && Array.isArray(lib)) {
      (game as any).libraries.set(controllerId, lib);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} exiled ${exiledName} and revealed cards until a creature with greater mana value was found.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (action === 'destroy_artifact_enchantment') {
    const state = game.state || {};
    const battlefield = state.battlefield || [];
    for (const tid of selections) {
      const perm = battlefield.find((p: any) => p.id === tid);
      if (!perm) continue;
      destroyPermanent(game as any, String(tid), true);
      debug(2, `[Resolution] Destroyed ${perm.card?.name || perm.id} (Aura Shards effect)`);
    }
    broadcastGame(io, game, gameId);
    return true;
  }

  if (action === 'tap_or_untap_target') {
    const targetId = selections[0];
    const battlefield = game.state?.battlefield || [];
    const targetPerm = battlefield.find((p: any) => p.id === targetId);
    const targetName = targetPerm?.card?.name || 'Permanent';
    // Enqueue follow-up option choice for tap/untap decision
    const queuedTapUntapDecisionStep = createResolutionStep({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: pid as any,
      description: `${step.sourceName || 'Ability'}: Tap or untap ${targetName}`,
      mandatory: true,
      sourceId: step.sourceId,
      sourceName: step.sourceName,
      options: [
        { id: 'tap', label: 'Tap it' },
        { id: 'untap', label: 'Untap it' },
      ],
      minSelections: 1,
      maxSelections: 1,
      action: 'tap_or_untap_decision',
      targetId,
    } as any);

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'targetSelectionTapUntapPrompt', {
        playerId: pid,
        sourceId: String(step.sourceId || '').trim() || undefined,
        queuedResolutionStep: {
          ...(queuedTapUntapDecisionStep as any),
        },
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(targetSelectionTapUntapPrompt) failed:', err);
    }

    ResolutionQueueManager.addStep(gameId, queuedTapUntapDecisionStep as any);
    return true;
  }

  // Handle begin_combat_target_buff for triggers like Heidegger
  if (action === 'begin_combat_target_buff') {
    const targetId = selections[0];
    const battlefield = game.state?.battlefield || [];
    const targetPerm = battlefield.find((p: any) => p.id === targetId);

    if (targetPerm) {
      const effectDescription = (step as any).effectDescription || '';
      const targetName = targetPerm.card?.name || 'Creature';
      const sourceName = step.sourceName || 'Trigger';

      // Parse the effect - look for +X/+0 or +X/+X patterns
      // Common patterns: "gets +X/+0 until end of turn" where X is based on something
      const lowerEffect = effectDescription.toLowerCase();

      // Check for "where X is the number of Soldiers/creatures/etc." pattern
      const xCountMatch = lowerEffect.match(/gets \+x\/\+(\d+).*where x is (?:the number of )?(\w+)/i);

      if (xCountMatch) {
        const toughnessBonus = parseInt(xCountMatch[1], 10) || 0;
        const countType = xCountMatch[2].toLowerCase();

        // Count the relevant permanents using word boundary regex for accurate matching
        let xValue = 0;
        const typePattern = new RegExp(`\\b${countType}s?\\b`, 'i'); // Match singular and plural
        for (const perm of battlefield) {
          if (perm.controller !== pid) continue;
          const typeLine = (perm.card?.type_line || '').toLowerCase();

          if (countType === 'soldiers' || countType === 'soldier') {
            if (typePattern.test(typeLine)) xValue++;
          } else if (countType === 'creatures' || countType === 'creature') {
            if (typeLine.includes('creature')) xValue++;
          } else {
            // Generic type check with word boundary
            if (typePattern.test(typeLine)) xValue++;
          }
        }

        // Apply the buff as a temporary effect
        targetPerm.grantedAbilities = targetPerm.grantedAbilities || [];
        targetPerm.grantedAbilities.push(`+${xValue}/+${toughnessBonus} until end of turn`);

        // Store temporary P/T modification
        targetPerm.temporaryPTMods = targetPerm.temporaryPTMods || [];
        targetPerm.temporaryPTMods.push({ power: xValue, toughness: toughnessBonus, until: 'end_of_turn' });
        persistBattlefieldPermanentPatchAfterMutation({
          gameId,
          seq: (game as any).seq,
          isReplaying: (game as any).isReplaying,
          bumpSeq: typeof (game as any).bumpSeq === 'function' ? () => (game as any).bumpSeq() : undefined,
        }, targetPerm, {
          sourceName: String(sourceName || 'begin combat'),
          fields: ['temporaryPTMods', 'grantedAbilities'],
        });

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${sourceName}: ${targetName} gets +${xValue}/+${toughnessBonus} until end of turn.`,
          ts: Date.now(),
        });

        debug(2, `[Resolution] Begin combat target buff: ${targetName} gets +${xValue}/+${toughnessBonus} (X=${xValue} ${countType})`);
      } else {
        // Try to parse a simple +X/+Y pattern
        const simpleBuffMatch = lowerEffect.match(/gets \+(\d+)\/\+(\d+)/i);
        if (simpleBuffMatch) {
          const powerBonus = parseInt(simpleBuffMatch[1], 10);
          const toughnessBonus = parseInt(simpleBuffMatch[2], 10);

          targetPerm.grantedAbilities = targetPerm.grantedAbilities || [];
          targetPerm.grantedAbilities.push(`+${powerBonus}/+${toughnessBonus} until end of turn`);

          targetPerm.temporaryPTMods = targetPerm.temporaryPTMods || [];
          targetPerm.temporaryPTMods.push({ power: powerBonus, toughness: toughnessBonus, until: 'end_of_turn' });
          persistBattlefieldPermanentPatchAfterMutation({
            gameId,
            seq: (game as any).seq,
            isReplaying: (game as any).isReplaying,
            bumpSeq: typeof (game as any).bumpSeq === 'function' ? () => (game as any).bumpSeq() : undefined,
          }, targetPerm, {
            sourceName: String(sourceName || 'begin combat'),
            fields: ['temporaryPTMods', 'grantedAbilities'],
          });

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${sourceName}: ${targetName} gets +${powerBonus}/+${toughnessBonus} until end of turn.`,
            ts: Date.now(),
          });

          debug(2, `[Resolution] Begin combat target buff: ${targetName} gets +${powerBonus}/+${toughnessBonus}`);
        }
      }
    }

    // This begin-combat workflow uses a Resolution Queue prompt mid-resolution.
    // Remove the original triggered ability from the stack so it doesn't re-prompt.
    const stack = game.state?.stack || [];
    const stackItemId = step.sourceId;
    if (stackItemId) {
      const idx = stack.findIndex((it: any) => it?.id === stackItemId);
      if (idx !== -1) {
        const it = stack[idx];
        if (it?.type === 'triggered_ability' && it?.triggerType === 'begin_combat') {
          stack.splice(idx, 1);
          debug(2, `[Resolution] Removed begin_combat trigger from stack (id: ${stackItemId})`);
        }
      }
    }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (action === 'destroy_target_creature_or_planeswalker') {
    const targetId = selections[0];
    if (!targetId) {
      debugWarn(1, `[Resolution] destroy_target_creature_or_planeswalker: missing selection`);
      return true;
    }

    const state = game.state || {};
    const battlefield = state.battlefield || [];
    const idx = battlefield.findIndex((p: any) => p?.id === targetId);
    if (idx === -1) {
      debugWarn(1, `[Resolution] destroy_target_creature_or_planeswalker: target not on battlefield: ${targetId}`);
      return true;
    }

    const perm = battlefield[idx];
    const tl = String(perm?.card?.type_line || '').toLowerCase();
    if (!(tl.includes('creature') || tl.includes('planeswalker'))) {
      debugWarn(1, `[Resolution] destroy_target_creature_or_planeswalker: invalid target type: ${perm?.card?.type_line}`);
      return true;
    }
    destroyPermanent(game as any, targetId, true);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${step.sourceName || 'Effect'}: ${perm.card?.name || 'Permanent'} was destroyed.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  return false;
}
