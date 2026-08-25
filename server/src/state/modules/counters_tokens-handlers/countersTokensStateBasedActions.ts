// server/src/state/modules/counters_tokens-handlers/countersTokensStateBasedActions.ts
// Origin parent: server/src/state/modules/counters_tokens.ts
// Cluster moved: resolveLegendRuleChoice + runSBA.
// Public entry symbols: resolveLegendRuleChoice, runSBA.

import type { PlayerID } from "../../../../../shared/src/index.js";
import type { GameContext } from "../../context.js";
import { parsePT, uid } from "../../utils.js";
import { applyStateBasedActions } from "../../../rules-engine/index.js";
import {
  findOracleScannerImmediateWin,
  stampOracleScannerWinOnState,
} from "../../../../../rules-engine/src/actions/stateBasedActionsOracleScannerWins.js";
import { appendEvent } from "../../../db/index.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";
import {
  applyAscendCitysBlessing,
  processPendingEmptyLibraryDrawAttempts,
} from "../game-state-effects.js";
import { ensureInitialDayNightDesignationFromBattlefield } from "../day-night.js";
import { cleanupCardLeavingExile } from "../playable-from-exile.js";
import { syncDerivedContinuousEffects } from "../staticEffectSpec.js";
import { applyStatefulPaperKeywordSBAs } from "../statefulPaperKeywords.js";
import { hydrateGameStateOracleText } from "../cardOracleHydration.js";
import { movePermanentToGraveyard } from "./countersTokensMoveToGraveyard.js";
import { getCountersTokensHandlerDeps } from "./countersTokensHandlerDeps.js";

function updateGodCreatureStatus(ctx: GameContext): void {
  getCountersTokensHandlerDeps().updateGodCreatureStatus(ctx);
}

/**
 * Run state-based actions (SBA) per MTG rules.
 * 
 * This handles creatures dying due to:
 * - 0 or less toughness (from -1/-1 counters, effects, etc.)
 * - Lethal damage marked
 * - Deathtouch damage
 * 
 * Note: This does NOT double-trigger with movePermanentToGraveyard() because:
 * - applyStateBasedActions() only checks creatures CURRENTLY on the battlefield
 * - If a creature was already removed by sacrifice/destroy spell, it won't be found here
 * - Each creature dies exactly once through exactly one code path
 */
export function resolveLegendRuleChoice(
  ctx: GameContext,
  args: {
    batchId: string;
    groupKey: string;
    playerId: string;
    selectedPermanentId: string;
  },
): { accepted: boolean; complete: boolean; removedIds: string[]; error?: string } {
  const stateAny = ctx.state as any;
  const batch = stateAny._legendRuleChoiceBatch;
  if (!batch || String(batch.batchId || '') !== String(args.batchId || '')) {
    return { accepted: false, complete: false, removedIds: [], error: 'Legend-rule choice is no longer pending.' };
  }

  const groups = Array.isArray(batch.groups) ? batch.groups : [];
  const group = groups.find((entry: any) => String(entry?.key || '') === String(args.groupKey || ''));
  if (!group || String(group.controller || '') !== String(args.playerId || '')) {
    return { accepted: false, complete: false, removedIds: [], error: 'This legend-rule choice does not belong to that player.' };
  }

  const candidateIds = Array.isArray(group.candidateIds)
    ? group.candidateIds.map((id: any) => String(id || '')).filter(Boolean)
    : [];
  const selectedId = String(args.selectedPermanentId || '');
  if (!candidateIds.includes(selectedId)) {
    return { accepted: false, complete: false, removedIds: [], error: 'The selected permanent is not a valid legend-rule choice.' };
  }
  const selectedStillExists = (ctx.state.battlefield || []).some((permanent: any) => String(permanent?.id || '') === selectedId);
  if (!selectedStillExists) {
    return { accepted: false, complete: false, removedIds: [], error: 'The selected permanent is no longer on the battlefield.' };
  }

  group.chosenId = selectedId;
  const complete = groups.length > 0 && groups.every((entry: any) => Boolean(String(entry?.chosenId || '')));
  if (!complete) {
    return { accepted: true, complete: false, removedIds: [] };
  }

  const removedIds: string[] = [];
  const idsToRemove = groups.flatMap((entry: any) => {
    const chosenId = String(entry?.chosenId || '');
    return (Array.isArray(entry?.candidateIds) ? entry.candidateIds : [])
      .map((id: any) => String(id || ''))
      .filter((id: string) => id && id !== chosenId);
  });

  // Clear first so the follow-up SBA pass cannot mistake this completed batch for
  // an unresolved one.
  delete stateAny._legendRuleChoiceBatch;
  for (const permanentId of idsToRemove) {
    if (movePermanentToGraveyard(ctx, permanentId, true)) {
      removedIds.push(permanentId);
    }
  }
  runSBA(ctx);
  return { accepted: true, complete: true, removedIds };
}

export function runSBA(ctx: GameContext) {
  const { state, bumpSeq } = ctx;

  // A legend-rule choice is itself part of performing state-based actions. Do not
  // enqueue duplicate prompts while the affected controllers are still choosing.
  if ((state as any)._legendRuleChoiceBatch) {
    return;
  }

  try {
    hydrateGameStateOracleText(state, ctx.libraries);
  } catch {}

  try {
    syncDerivedContinuousEffects(state);
  } catch {}

  // Stateful paper keywords grant player designations as state-based actions:
  // Start Your Engines! gives initial speed and Storied grants enduring story.
  try {
    if (applyStatefulPaperKeywordSBAs(state)) {
      bumpSeq();
    }
  } catch {}

  // Ascend (702.131b): grant City's Blessing when a player with Ascend controls 10+ permanents.
  try {
    const ascended = applyAscendCitysBlessing(ctx);
    if (ascended.length > 0) {
      for (const playerId of ascended) {
        debug(1, `[runSBA] Player ${playerId} got the City's Blessing (Ascend)`);
      }
    }
  } catch {}

  // Day/Night: if a daybound/nightbound permanent exists while the game is neither day nor night, it gains the appropriate designation.
  try {
    ensureInitialDayNightDesignationFromBattlefield(state as any);
  } catch {}
  
  // FIRST: Handle bestow/reconfigure creatures that need to unattach and restore stats
  // This must happen BEFORE applyStateBasedActions so the restored stats prevent 0-toughness destruction
  let unattachChanged = false;
  for (const perm of state.battlefield) {
    const typeLine = ((perm as any).card?.type_line || '').toLowerCase();
    const oracleText = ((perm as any).card?.oracle_text || '').toLowerCase();
    const isEnchantmentCreature = typeLine.includes('enchantment') && typeLine.includes('creature');
    const hasBestowOrReconfigure = oracleText.includes('bestow') || oracleText.includes('reconfigure');
    
    if (isEnchantmentCreature && hasBestowOrReconfigure && (perm as any).attachedTo) {
      // Check if the attached target still exists
      const previousAttachedTo = String((perm as any).attachedTo || '').trim();
      const targetExists = state.battlefield.some(p => p.id === (perm as any).attachedTo);
      if (!targetExists) {
        // Target is gone - unattach and restore creature stats
        debug(2, `[runSBA] ${(perm as any).card?.name} unattaching (bestow/reconfigure target gone), restoring creature stats`);
        const restoredBasePower: number | undefined = (() => {
          if ((perm as any).basePower !== undefined) return undefined;
          const parsed = parsePT((perm as any).card?.power);
          return parsed;
        })();
        const restoredBaseToughness: number | undefined = (() => {
          if ((perm as any).baseToughness !== undefined) return undefined;
          const parsed = parsePT((perm as any).card?.toughness);
          return parsed;
        })();

        delete (perm as any).attachedTo;

        // Restore creature stats from the card if they're missing
        if (restoredBasePower !== undefined) {
          (perm as any).basePower = restoredBasePower;
          debug(2, `[runSBA] Restored basePower to ${restoredBasePower}`);
        }
        if (restoredBaseToughness !== undefined) {
          (perm as any).baseToughness = restoredBaseToughness;
          debug(2, `[runSBA] Restored baseToughness to ${restoredBaseToughness}`);
        }

        // Persist so undo/reload restores attach state (reuse reconfigureUnattachPermanent apply handler).
        if (!(ctx as any).isReplaying) {
          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId && gameId !== 'unknown') {
            try {
              appendEvent(gameId, (state as any).seq ?? 0, 'reconfigureUnattachPermanent', {
                playerId: String((perm as any).controller || (perm as any).owner || ''),
                reconfigureId: String((perm as any).id || ''),
                reconfigureName: String((perm as any).card?.name || 'Bestow/reconfigure permanent'),
                targetCreatureId: previousAttachedTo || undefined,
                ...(restoredBasePower !== undefined ? { restoredBasePower } : {}),
                ...(restoredBaseToughness !== undefined ? { restoredBaseToughness } : {}),
                reason: 'sba_target_gone',
              });
            } catch (err) {
              debugWarn(1, '[runSBA] appendEvent(reconfigureUnattachPermanent) failed:', err);
            }
          }
        }
        unattachChanged = true;
      }
    }
  }
  
  // NOW run the standard SBA checks
  const res = applyStateBasedActions(state);
  let changed = unattachChanged;

  // Darksteel-style `immediate` oracle-scanner wins. applyStateBasedActions is
  // toughness/counters/aura only; stamp winner/gameOver here as a Felidar-style
  // SBA (not a CR 603.8 stack trigger). Upkeep scanner stays on turnActions.
  if (!(state as any).winner && !(state as any).gameOver) {
    const immediateWin = findOracleScannerImmediateWin(state);
    if (immediateWin) {
      stampOracleScannerWinOnState(state, immediateWin);
      debug(1, `[runSBA] Player ${immediateWin.winner} WINS (${immediateWin.reason})`);
      changed = true;
    }
  }
  
  // Handle players who have lost due to life <= 0 (Rule 704.5a)
  if (res.playersLost && res.playersLost.length > 0) {
    for (const playerId of res.playersLost) {
      const player = state.players?.find((p: any) => p && p.id === playerId);
      if (player && !player.hasLost) {
        player.hasLost = true;
        player.lostReason = 'Life total reached 0 or less';
        debug(1, `[runSBA] Player ${playerId} has lost the game (life <= 0)`);
        changed = true;
      }
    }
  }

  // Rule 704.5b: pending empty-library draw attempts (also applied immediately in drawCards).
  {
    const outcome = processPendingEmptyLibraryDrawAttempts(ctx);
    for (const playerId of outcome.wins) {
      debug(1, `[runSBA] Player ${playerId} WINS from empty-library draw replacement`);
      changed = true;
    }
    for (const playerId of outcome.applied) {
      debug(1, `[runSBA] Player ${playerId} has lost the game (empty library draw)`);
      changed = true;
    }
  }
  
  for (const upd of res.counterUpdates) {
    const perm = state.battlefield.find(b => b.id === upd.permanentId);
    if (!perm) continue;
    const before = perm.counters ?? {};
    const after = upd.counters;
    const same = Object.keys(before).length === Object.keys(after).length &&
      Object.keys(after).every(k => (before as any)[k] === (after as any)[k]);
    if (!same) { perm.counters = Object.keys(after).length ? { ...after } : undefined; changed = true; }
    if ((upd as any).clearDamage) {
      (perm as any).damage = 0;
      (perm as any).markedDamage = 0;
      (perm as any).damageMarked = 0;
      (perm as any).deathtouchDamageMarked = false;
      if (perm.counters && typeof perm.counters === 'object' && !Array.isArray(perm.counters) && 'damage' in perm.counters) {
        delete (perm.counters as any).damage;
      }
      changed = true;
    }
  }
  if (res.destroys.length) {
    for (const id of res.destroys) {
      if (movePermanentToGraveyard(ctx, String(id), true)) {
        changed = true;
      }
    }
  }
  
  // CR 704.5j: Legend Rule - If a player controls two or more legendary permanents
  // with the same name, that player chooses one of them, and the rest are put into
  // their owners' graveyards.
  // 
  // Handle legend rule violations by prompting the player to choose which to keep
  if (res.legendRuleViolations && res.legendRuleViolations.length > 0) {
    // Group violations by controller + name
    const violationsByKey = new Map<string, typeof state.battlefield>();
    
    for (const permId of res.legendRuleViolations) {
      const perm = state.battlefield.find(p => p.id === permId);
      if (!perm) continue;
      
      const controller = (perm as any).controller || '';
      const cardName = (perm.card as any)?.name || perm.id; // Use permanent ID as fallback if no name
      
      // Skip permanents without a name (shouldn't happen for legendaries, but be safe)
      if (!(perm.card as any)?.name) continue;
      
      const key = `${controller}:${cardName}`;
      
      const existing = violationsByKey.get(key) || [];
      existing.push(perm);
      violationsByKey.set(key, existing);
    }
    
    const groups = Array.from(violationsByKey.entries())
      .filter(([, perms]) => perms.length > 1)
      .map(([key, perms]) => {
        const controller = String((perms[0] as any)?.controller || '');
        return {
          key,
          controller,
          cardName: String((perms[0]?.card as any)?.name || 'legendary permanent'),
          candidateIds: perms.map((perm) => String(perm.id)),
          chosenId: '',
        };
      });

    if (groups.length > 0 && !(ctx as any).isReplaying) {
      const batchId = `legend-rule-${uid()}`;
      (state as any)._legendRuleChoiceBatch = { batchId, groups };

      const configs = groups.map((group) => ({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: group.controller as PlayerID,
        sourceName: 'Legend Rule',
        description: `Choose which ${group.cardName} to keep. Put the rest into their owners' graveyards.`,
        mandatory: true,
        minSelections: 1,
        maxSelections: 1,
        options: group.candidateIds.map((permanentId) => {
          const permanent = state.battlefield.find((entry: any) => String(entry?.id || '') === permanentId) as any;
          const card = permanent?.card || {};
          const isToken = Boolean(permanent?.isToken || permanent?.isCopy || card?.isToken || card?.isCopy);
          const counters = permanent?.counters && typeof permanent.counters === 'object'
            ? Object.entries(permanent.counters)
                .filter(([, amount]) => Number(amount) > 0)
                .map(([name, amount]) => `${amount} ${name}`)
                .join(', ')
            : '';
          const details = [
            String(card?.type_line || '').trim(),
            isToken ? 'Token copy' : 'Nontoken card',
            permanent?.tapped ? 'Tapped' : 'Untapped',
            counters ? `Counters: ${counters}` : '',
          ].filter(Boolean);
          return {
            id: permanentId,
            label: `${String(card?.name || group.cardName)}${isToken ? ' (Token)' : ' (Card)'}`,
            description: details.join(' • '),
            imageUrl: card?.image_uris?.small || card?.image_uris?.normal || card?.imageUrl,
            isToken,
          };
        }),
        legendRuleChoice: true,
        legendRuleBatchId: batchId,
        legendRuleGroupKey: group.key,
        legendRuleCandidateIds: group.candidateIds,
      } as any));

      const turnOrder = (state.players || []).map((player: any) => String(player?.id || '')).filter(Boolean) as PlayerID[];
      ResolutionQueueManager.addStepsWithAPNAP(
        String((ctx as any).gameId || ''),
        configs,
        turnOrder,
        state.turnPlayer as PlayerID,
      );
      debug(1, `[runSBA] Legend Rule: queued ${groups.length} controller choice(s)`);
      return;
    }

    // Replay fallback for legacy event streams that predate interactive legend choices.
    for (const group of groups) {
      for (const permanentId of group.candidateIds.slice(1)) {
        if (movePermanentToGraveyard(ctx, permanentId, true)) changed = true;
      }
    }
  }
  
  // Rule 111.7: Clean up tokens in non-battlefield zones
  // A token that's in a zone other than the battlefield ceases to exist as a state-based action
  const zones = state.zones || {};
  for (const playerId of Object.keys(zones)) {
    const playerZones = zones[playerId];
    if (!playerZones) continue;
    
    // Clean tokens from graveyard
    // Note: Tokens may be identified by:
    // - card.isToken flag (if copied from permanent)
    // - card name starting with "Token" in type_line
    // - isToken flag directly on the card object
    if (Array.isArray(playerZones.graveyard)) {
      const beforeCount = playerZones.graveyard.length;
      playerZones.graveyard = playerZones.graveyard.filter((card: any) => {
        // Check all possible token indicators
        if (card.isToken) return false;
        if (card.card?.isToken) return false; // If the graveyard entry has a nested card object
        const typeLine = (card.type_line || card.card?.type_line || '').toLowerCase();
        if (typeLine.includes('token')) return false;
        return true;
      }) as any;
      if (playerZones.graveyard.length !== beforeCount) {
        playerZones.graveyardCount = playerZones.graveyard.length;
        debug(2, `[runSBA] Removed ${beforeCount - playerZones.graveyard.length} token(s) from ${playerId}'s graveyard`);
        changed = true;
      }
    }
    
    // Clean tokens from exile
    // Note: Same token detection logic as graveyard
    if (Array.isArray(playerZones.exile)) {
      const beforeCount = playerZones.exile.length;
      const kept: any[] = [];
      const removedFromExile: any[] = [];

      for (const card of playerZones.exile as any[]) {
        const c: any = card as any;
        // We intentionally keep token entries in exile for UI/test visibility.
        // (Rules-wise they cease to exist, but the engine tracks them here.)
        if (c?.zone === 'exile' && c?.isToken === true) {
          kept.push(card);
          continue;
        }

        if (c?.isToken) {
          removedFromExile.push(card);
          continue;
        }
        if (c?.card?.isToken) {
          removedFromExile.push(card);
          continue;
        }
        const typeLine = (c?.type_line || c?.card?.type_line || '').toLowerCase();
        if (typeLine.includes('token')) {
          removedFromExile.push(card);
          continue;
        }

        kept.push(card);
      }

      playerZones.exile = kept as any;
      if (playerZones.exile.length !== beforeCount) {
        for (const removed of removedFromExile) {
          cleanupCardLeavingExile(state as any, removed);
        }
        playerZones.exileCount = playerZones.exile.length;
        debug(2, `[runSBA] Removed ${beforeCount - playerZones.exile.length} token(s) from ${playerId}'s exile`);
        changed = true;
      }
    }
    
    // Clean tokens from hand (unlikely but possible)
    // Note: Same token detection logic as graveyard
    if (Array.isArray(playerZones.hand)) {
      const beforeCount = playerZones.hand.length;
      playerZones.hand = playerZones.hand.filter((card: any) => {
        if (card.isToken) return false;
        if (card.card?.isToken) return false;
        const typeLine = (card.type_line || card.card?.type_line || '').toLowerCase();
        if (typeLine.includes('token')) return false;
        return true;
      }) as any;
      if (playerZones.hand.length !== beforeCount) {
        playerZones.handCount = playerZones.hand.length;
        debug(2, `[runSBA] Removed ${beforeCount - playerZones.hand.length} token(s) from ${playerId}'s hand`);
        changed = true;
      }
    }
    
    // Clean tokens from library (shouldn't happen but be thorough)
    // Note: Same token detection logic as graveyard
    const library = (ctx as any).libraries?.get(playerId);
    if (Array.isArray(library)) {
      const beforeCount = library.length;
      const cleanedLibrary = library.filter((card: any) => {
        if (card.isToken) return false;
        if (card.card?.isToken) return false;
        const typeLine = (card.type_line || card.card?.type_line || '').toLowerCase();
        if (typeLine.includes('token')) return false;
        return true;
      });
      if (cleanedLibrary.length !== beforeCount) {
        (ctx as any).libraries.set(playerId, cleanedLibrary);
        if (playerZones.libraryCount !== undefined) {
          playerZones.libraryCount = cleanedLibrary.length;
        }
        debug(2, `[runSBA] Removed ${beforeCount - cleanedLibrary.length} token(s) from ${playerId}'s library`);
        changed = true;
      }
    }
  }
  
  // Rule 704.5e: If a copy of a card is in any zone other than the stack or the battlefield, it ceases to exist.
  const isCopyInIllegalZone = (card: any): boolean =>
    Boolean(card?.isCopy)
    && !Boolean(card?.preparedGeneratedCopy || card?.preparedSourcePermanentId);
  for (const playerId of Object.keys(zones)) {
    const playerZones = zones[playerId];
    if (!playerZones) continue;

    if (Array.isArray(playerZones.graveyard)) {
      const beforeCount = playerZones.graveyard.length;
      playerZones.graveyard = playerZones.graveyard.filter((card: any) => !isCopyInIllegalZone(card)) as any;
      if (playerZones.graveyard.length !== beforeCount) {
        playerZones.graveyardCount = playerZones.graveyard.length;
        debug(2, `[runSBA] Removed ${beforeCount - playerZones.graveyard.length} copy card(s) from ${playerId}'s graveyard (704.5e)`);
        changed = true;
      }
    }

    if (Array.isArray(playerZones.hand)) {
      const beforeCount = playerZones.hand.length;
      playerZones.hand = playerZones.hand.filter((card: any) => !isCopyInIllegalZone(card)) as any;
      if (playerZones.hand.length !== beforeCount) {
        playerZones.handCount = playerZones.hand.length;
        debug(2, `[runSBA] Removed ${beforeCount - playerZones.hand.length} copy card(s) from ${playerId}'s hand (704.5e)`);
        changed = true;
      }
    }

    if (Array.isArray(playerZones.exile)) {
      const beforeCount = playerZones.exile.length;
      playerZones.exile = playerZones.exile.filter((card: any) => !isCopyInIllegalZone(card)) as any;
      if (playerZones.exile.length !== beforeCount) {
        playerZones.exileCount = playerZones.exile.length;
        debug(2, `[runSBA] Removed ${beforeCount - playerZones.exile.length} copy card(s) from ${playerId}'s exile (704.5e)`);
        changed = true;
      }
    }

    const library = (ctx as any).libraries?.get(playerId);
    if (Array.isArray(library)) {
      const beforeCount = library.length;
      const cleanedLibrary = library.filter((card: any) => !isCopyInIllegalZone(card));
      if (cleanedLibrary.length !== beforeCount) {
        (ctx as any).libraries.set(playerId, cleanedLibrary);
        if (playerZones.libraryCount !== undefined) {
          playerZones.libraryCount = cleanedLibrary.length;
        }
        debug(2, `[runSBA] Removed ${beforeCount - cleanedLibrary.length} copy card(s) from ${playerId}'s library (704.5e)`);
        changed = true;
      }
    }
  }

  // Update god creature status based on devotion (Rule 704.5n - gods with insufficient devotion aren't creatures)
  updateGodCreatureStatus(ctx);
  
  if (changed) {
    bumpSeq();
    const depth = Number((ctx as any)._sbaLoopDepth || 0);
    if (!(state as any)._legendRuleChoiceBatch && depth < 16) {
      (ctx as any)._sbaLoopDepth = depth + 1;
      try {
        runSBA(ctx);
      } finally {
        (ctx as any)._sbaLoopDepth = depth;
      }
    }
  }
}

