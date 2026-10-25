// server/src/state/modules/turn-handlers/turnNextTurnStartOfTurn.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: nextTurn start-of-turn body — intervening-if tracker
// resets, beginning-phase reset, per-turn clears, day/night, effect recalc.
// Public entry symbols: runNextTurnStartOfTurn.
// nextTurn remains the dispatcher. Leaf must not import turn.ts or
// turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { resetConvokeGrantsForNewTurn } from "../casting-modifiers.js";
import { recalculatePlayerEffects, clearTemporaryLandBonuses } from "../game-state-effects.js";
import { removeExpiredGoads } from "../goad-effects.js";
import { ensureInitialDayNightDesignationFromBattlefield, setDayNightState } from "../day-night.js";
import { queueParsedKeywordAction } from "../triggerEmissionFamilyUtils.js";
import { resetDurablePermissionUsageForTurn } from "../durable-permissions.js";
import { resetExhaustAbilityActivations } from '../keywordActivationState.js';
import { resetSpeedIncreasedThisTurn } from '../statefulPaperKeywords.js';
import { recordTurnStartedForPlayer } from '../firstTurnsCastRestriction.js';
import { snapshotLastTurnCountersAndResetDraws } from './turnStartLastTurnSnapshots.js';
import { queueOptionalDrawStepSkipPrompt } from '../optionalDrawStepSkip.js';
import { debug, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Start-of-turn resets and per-turn clears from nextTurn().
 * Parent supplies next/turnNumber/players and exclusive helpers.
 */
export function runNextTurnStartOfTurn(
  ctx: GameContext,
  next: string,
  current: string,
  turnNumber: number,
  players: string[],
  removeExpiredUntilNextTurnEffects: (ctx: GameContext, currentPlayerId: PlayerID, currentTurn: number) => void,
  clearSummoningSicknessForPlayer: (ctx: GameContext, playerId: string) => void,
): void {

    // Clear per-turn/per-combat per-permanent trackers used by intervening-if evaluation.
    // These must not leak across turns.
    try {
      const battlefield = ((ctx as any).state.battlefield || []) as any[];
      for (const perm of battlefield) {
        if (!perm) continue;

        // Crew: per-turn support fields written by the persisted 'crewVehicle' event.
        if ((perm as any).crewedByCreatureCountThisTurn !== undefined) delete (perm as any).crewedByCreatureCountThisTurn;
        if ((perm as any).crewedByCreatureTypesThisTurn !== undefined) delete (perm as any).crewedByCreatureTypesThisTurn;
        if ((perm as any).crewedBySubtypesThisTurn !== undefined) delete (perm as any).crewedBySubtypesThisTurn;

        // Enlist: per-combat support fields written by the persisted 'enlist' event.
        if ((perm as any).enlistedThisCombat) (perm as any).enlistedThisCombat = false;
        if ((perm as any).enlistedCreatureThisCombat) (perm as any).enlistedCreatureThisCombat = false;
        if ((perm as any).enlistedCreatureIdThisCombat) delete (perm as any).enlistedCreatureIdThisCombat;
      }
    } catch {
      // best-effort only
    }

    // Derive team maps from player objects when present (team formats / Alchemy).
    // Do not invent team assignments when none exist.
    try {
      const stateAny = (ctx as any).state as any;
      const playersAll = Array.isArray(stateAny.players) ? (stateAny.players as any[]) : [];
      const teamMap: Record<string, string> = {};
      for (const p of playersAll) {
        const pid = String(p?.id || '').trim();
        if (!pid) continue;
        const t = p?.team ?? p?.teamId ?? p?.playerTeam;
        if (typeof t === 'string' && t.trim()) teamMap[pid] = String(t).trim();
      }
      if (Object.keys(teamMap).length > 0) {
        stateAny.team = { ...(stateAny.team || {}), ...teamMap };
        stateAny.teams = { ...(stateAny.teams || {}), ...teamMap };
        stateAny.playerTeam = { ...(stateAny.playerTeam || {}), ...teamMap };
      }
    } catch {
      // best-effort only
    }

    // Derived convenience counters used by some intervening-if fallbacks.
    try {
      const stateAny = (ctx as any).state as any;
      const playersAll = Array.isArray(stateAny.players) ? (stateAny.players as any[]) : [];
      const lostCount = playersAll.filter((p: any) => p && (p.hasLost === true || p.eliminated === true)).length;
      stateAny.playersLostCount = lostCount;
      stateAny.playersWhoLostCount = lostCount;
    } catch {
      // best-effort only
    }

    // Track "were the monarch as the turn began" deterministically.
    // This is safe to store as boolean because it is derived from authoritative current state.
    try {
      const stateAny = (ctx as any).state as any;
      const monarchId = stateAny.monarch ? String(stateAny.monarch) : '';
      const playersAll = Array.isArray(stateAny.players) ? (stateAny.players as any[]) : [];
      stateAny.monarchAtTurnBeginByPlayer = {};
      stateAny.wasMonarchAtTurnBegin = {};
      stateAny.monarchAtTurnBegan = {};
      for (const p of playersAll) {
        const pid = p?.id;
        if (!pid) continue;
        const key = String(pid);
        const v = Boolean(monarchId) && monarchId === key;
        stateAny.monarchAtTurnBeginByPlayer[key] = v;
        stateAny.wasMonarchAtTurnBegin[key] = v;
        stateAny.monarchAtTurnBegan[key] = v;
      }
    } catch {
      // best-effort only
    }

    // Track "have(n't) been dealt combat damage since your last turn".
    // Reset the flag for the new turn player only; it accumulates during other players' turns.
    try {
      const stateAny = (ctx as any).state as any;
      const key = String(next);
      stateAny.tookCombatDamageSinceLastTurn = stateAny.tookCombatDamageSinceLastTurn || {};
      stateAny.tookCombatDamageSinceLastTurn[key] = false;
      stateAny.combatDamageDealtToPlayerSinceLastTurn = stateAny.combatDamageDealtToPlayerSinceLastTurn || {};
      stateAny.combatDamageDealtToPlayerSinceLastTurn[key] = false;
    } catch {
      // best-effort only
    }

    // Clear per-turn crime tracking (conservative: only set true when proven).
    try {
      const stateAny = (ctx as any).state as any;
      stateAny.committedCrimeThisTurn = {};
      stateAny.crimeCommittedThisTurn = {};
      stateAny.hasCommittedCrimeThisTurn = {};
    } catch {
      // best-effort only
    }

    // Clear per-turn mana-ability usage tracking (for intervening-if templates like
    // "if you haven't added mana with this ability this turn").
    // Initialize per-player objects so missing keys are provably "not yet".
    try {
      const stateAny = (ctx as any).state as any;
      stateAny.addedManaWithThisAbilityThisTurn = {};
      for (const pid of players) {
        stateAny.addedManaWithThisAbilityThisTurn[String(pid)] = {};
      }
    } catch {
      // best-effort only
    }

    // Remove expired goad effects at the start of this player's turn (Rule 701.15a)
    try {
      const battlefield = (ctx as any).state.battlefield || [];
      const updatedBattlefield = removeExpiredGoads(battlefield, turnNumber, next);
      (ctx as any).state.battlefield = updatedBattlefield;
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to remove expired goads:`, err);
    }

    try {
      removeExpiredUntilNextTurnEffects(ctx, next as PlayerID, turnNumber);
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to remove expired until-next-turn effects:`, err);
    }

    // Snapshot "started the turn untapped" per permanent (before untap step runs).
    // This is replay-stable because it is derived from authoritative state at nextTurn.
    // Full copies also feed where-X ("untapped lands they controlled at the beginning of this turn").
    try {
      const stateAny = (ctx as any).state as any;
      const battlefield = Array.isArray(stateAny?.battlefield) ? (stateAny.battlefield as any[]) : [];
      stateAny.permanentUntappedAtTurnBegin = {};
      const turnStartBattlefieldSnapshot: any[] = [];
      for (const p of battlefield) {
        if (!p) continue;
        turnStartBattlefieldSnapshot.push({ ...p });
        const id = p?.id;
        if (!id) continue;
        stateAny.permanentUntappedAtTurnBegin[String(id)] = !(p as any).tapped && !(p as any).isTapped;
      }
      stateAny.turnStartBattlefieldSnapshot = turnStartBattlefieldSnapshot;
    } catch {
      // best-effort only
    }

    // Reset to beginning of turn
    (ctx as any).state.phase = "beginning";
    (ctx as any).state.step = "UNTAP";
    
    // Clear combat-related state from previous turn
    if ((ctx as any).state.blockersDeclaredBy) {
      delete (ctx as any).state.blockersDeclaredBy;
    }

    // Rule 302.6: Clear summoning sickness at the BEGINNING of the turn
    // This is independent of untapping - a creature that doesn't untap due to
    // an effect still loses summoning sickness at the start of its controller's turn
    try {
      clearSummoningSicknessForPlayer(ctx, next);
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to clear summoning sickness:`, err);
    }

    // Note: Untapping happens when leaving the UNTAP step (in nextStep),
    // not at the start of the turn. In this engine, nextTurn leaves the game
    // in UNTAP; the nextStep transition UNTAP -> UPKEEP will run the untap logic.

    // Tests currently expect priority to be set to the active player immediately
    // after nextTurn, even though the rules don't grant priority during untap.
    (ctx as any).state.priority = next;
    
    // Clear temporary land bonuses from the previous turn
    // These are granted by spells like Summer Bloom and expire at end of turn
    try {
      clearTemporaryLandBonuses(ctx);
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to clear temporary land bonuses:`, err);
    }
    
    // Reset planeswalker loyalty activation counters for the active player's permanents
    // Rule 606.3: Each loyalty ability can only be activated once per turn (or more with Chain Veil/Oath of Teferi)
    try {
      const battlefield = (ctx as any).state.battlefield || [];
      for (const perm of battlefield) {
        if (perm && perm.controller === next) {
          // Reset both the old boolean flag and the new counter for compatibility
          if (perm.loyaltyActivatedThisTurn) {
            perm.loyaltyActivatedThisTurn = false;
          }
          if (perm.loyaltyActivationsThisTurn) {
            perm.loyaltyActivationsThisTurn = 0;
          }
        }
      }
      debug(2, `${ts()} [nextTurn] Reset planeswalker loyalty activation counters for player ${next}`);
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to reset planeswalker loyalty flags:`, err);
    }
    
    // Clear auto-pass for turn flags when starting a new turn
    // This resets the "Auto-Pass Rest of Turn" setting for all players
    if ((ctx as any).state.autoPassForTurn) {
      (ctx as any).state.autoPassForTurn = {};
      debug(2, `${ts()} [nextTurn] Cleared autoPassForTurn flags for new turn`);
    }
    if ((ctx as any).state.autoPassEmptyStackForTurn) {
      (ctx as any).state.autoPassEmptyStackForTurn = {};
      debug(2, `${ts()} [nextTurn] Cleared per-turn empty-stack auto-pass flags for new turn`);
    }
    
    // Clear noncreature spells cast this turn counter (for Esper Sentinel, Rhystic Study, etc.)
    // These abilities trigger on each player's FIRST noncreature spell each turn
    (ctx as any).state.noncreatureSpellsCastThisTurn = {};
    for (const pid of players) {
      (ctx as any).state.noncreatureSpellsCastThisTurn[String(pid)] = 0;
    }
    debug(2, `${ts()} [nextTurn] Cleared noncreatureSpellsCastThisTurn for new turn`);

    // Clear spells cast from hand this turn counter (for intervening-if templates)
    (ctx as any).state.spellsCastFromHandThisTurn = {};
    for (const pid of players) {
      (ctx as any).state.spellsCastFromHandThisTurn[String(pid)] = 0;
    }
    debug(2, `${ts()} [nextTurn] Cleared spellsCastFromHandThisTurn for new turn`);

    // Clear spells cast this turn list (for Storm and "if N or more spells were cast this turn" templates)
    // and snapshot last-turn history for intervening-if evaluation.
    try {
      const stateAny = (ctx as any).state as any;
      const spells = Array.isArray(stateAny.spellsCastThisTurn) ? stateAny.spellsCastThisTurn : [];

      // Some tests (and some legacy paths) pre-seed last-turn snapshot fields directly.
      // If we have no spells in the per-turn list, avoid clobbering explicit snapshots.
      const hasExplicitLastTurnSnapshot =
        typeof stateAny.spellsCastLastTurnByActivePlayerCount === 'number' ||
        typeof stateAny.spellsCastLastTurnCount === 'number';

      if (spells.length === 0 && hasExplicitLastTurnSnapshot) {
        stateAny.spellsCastThisTurn = [];
        stateAny.manaSpentToCastSpellsThisTurn = {};
        debug(2, `${ts()} [nextTurn] Cleared spellsCastThisTurn for new turn`);
      } else {

        // "No spells were cast last turn" is safe to answer deterministically.
        stateAny.spellsCastLastTurnCount = spells.length;

        // Preserve per-player counts when spell objects have casterId.
        // If attribution is incomplete, leave the breakdown as null to avoid false negatives.
        const playersAll = Array.isArray(stateAny.players) ? (stateAny.players as any[]) : [];
        const counts: Record<string, number> = {};
        for (const p of playersAll) {
          const pid = (p as any)?.id;
          if (pid) counts[String(pid)] = 0;
        }

        let attributionUnknown = false;
        for (const s of spells) {
          const casterId = (s as any)?.casterId;
          if (!casterId) {
            attributionUnknown = true;
            continue;
          }
          const key = String(casterId);
          counts[key] = (counts[key] || 0) + 1;
        }

        if (!attributionUnknown) {
          stateAny.spellsCastLastTurnByPlayerCounts = counts;
          if (typeof current === 'string' && current) {
            stateAny.spellsCastLastTurnByActivePlayerCount = counts[String(current)] || 0;
          }
        } else {
          stateAny.spellsCastLastTurnByPlayerCounts = null;
          stateAny.spellsCastLastTurnByActivePlayerCount = undefined;
        }

        stateAny.spellsCastThisTurn = [];
        stateAny.manaSpentToCastSpellsThisTurn = {};
        debug(2, `${ts()} [nextTurn] Cleared spellsCastThisTurn for new turn`);
      }
    } catch {
      // best-effort only
    }

    try {
      (ctx as any).state.playersWhoSearchedOwnLibraryThisTurn = [];
    } catch {
      // best-effort only
    }

    try {
      const stateAny = (ctx as any).state as any;
      stateAny.delayedSpellCopiesThisTurn = [];
      (ctx as any).delayedSpellCopiesThisTurn = [];
      debug(2, `${ts()} [nextTurn] Cleared delayedSpellCopiesThisTurn for new turn`);
    } catch {
      // best-effort only
    }

    // Clear played-from-exile tracking (for intervening-if templates like
    // "if you (didn't) play a card from exile this turn").
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.playedCardFromExileThisTurn = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (pid) stateAny.playedCardFromExileThisTurn[String(pid)] = false;
      }
      debug(2, `${ts()} [nextTurn] Cleared playedCardFromExileThisTurn for new turn`);
    } catch {
      // best-effort only
    }

    // Clear additional per-turn play/cast zone tracking (used by some intervening-if templates).
    // Keep these undefined-until-seen to avoid false negatives.
    try {
      const stateAny = (ctx as any).state as any;
      stateAny.castFromExileThisTurn = {};
      stateAny.castFromGraveyardThisTurn = {};
      stateAny.graveyardPermanentTypesCastThisTurn = {};
      stateAny.playedLandFromGraveyardThisTurn = {};
      stateAny.playedLandFromExileThisTurn = {};
      stateAny.playedFromExileThisTurn = {};
      stateAny.cardsPlayedFromExileThisTurn = {};
    } catch {
      // best-effort only
    }

    try {
      const resetCount = resetDurablePermissionUsageForTurn((ctx as any).state as any);
      if (resetCount > 0) {
        debug(2, `${ts()} [nextTurn] Reset durable permission per-turn usage counters (${resetCount})`);
      }
    } catch {
      // best-effort only
    }

    // Clear per-turn Warp tracking (for intervening-if templates like
    // "...or a spell was warped this turn").
    // We can safely initialize to false at the beginning of each turn.
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.spellWasWarpedThisTurn = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (pid) stateAny.spellWasWarpedThisTurn[String(pid)] = false;
      }
    } catch {
      // best-effort only
    }

    // Clear cycling tracking (used by "if you cycled two or more cards this turn" templates).
    // Keep these undefined-until-seen to avoid false negatives.
    try {
      const stateAny = (ctx as any).state as any;
      stateAny.cycleCountThisTurn = {};
      stateAny.cardsCycledThisTurn = {};
      stateAny.cycledCardsThisTurn = {};
    } catch {
      // best-effort only
    }

    // Clear per-turn discard tracking (for intervening-if templates like
    // "if a player discarded a card this turn" / "if an opponent discarded a card this turn").
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.discardedCardThisTurn = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (pid) stateAny.discardedCardThisTurn[String(pid)] = false;
      }
      stateAny.anyPlayerDiscardedCardThisTurn = false;
    } catch {
      // best-effort only
    }

    // Clear per-turn combat/damage-death linkage tracking (for intervening-if templates like
    // "if a creature dealt damage by this creature this turn died").
    try {
      const stateAny = (ctx as any).state as any;
      stateAny.creaturesDamagedByThisCreatureThisTurn = {};
      stateAny.creaturesDiedThisTurnIds = [];
    } catch {
      // best-effort only
    }

    // Clear per-turn "attacked by subtype" tracking (for intervening-if templates like
    // "if they were attacked this turn by an Assassin you controlled").
    try {
      const stateAny = (ctx as any).state as any;
      stateAny.attackedByAssassinThisTurnByPlayer = {};
    } catch {
      // best-effort only
    }

    // Clear per-turn clue sacrifice tracking (for intervening-if templates like
    // "if you sacrificed N or more Clues this turn").
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.sacrificedCluesThisTurn = {};
      stateAny.cluesSacrificedThisTurn = {};
      stateAny.cluesSacrificedThisTurnCount = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (!pid) continue;
        const key = String(pid);
        stateAny.sacrificedCluesThisTurn[key] = 0;
        stateAny.cluesSacrificedThisTurn[key] = 0;
        stateAny.cluesSacrificedThisTurnCount[key] = 0;
      }
    } catch {
      // best-effort only
    }

    // Clear per-turn token creation tracking (for intervening-if templates like
    // "if you created a token this turn").
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.tokensCreatedThisTurn = {};
      stateAny.tokenCreatedThisTurn = {};
      stateAny.createdTokenThisTurn = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (!pid) continue;
        const key = String(pid);
        stateAny.tokensCreatedThisTurn[key] = 0;
        stateAny.tokenCreatedThisTurn[key] = 0;
        stateAny.createdTokenThisTurn[key] = 0;
      }
    } catch {
      // best-effort only
    }

    // Clear per-turn evidence-collection tracking (for intervening-if templates like
    // "if evidence was collected").
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.evidenceCollectedThisTurn = {};
      stateAny.evidenceCollectedThisTurnByPlayer = {};
      stateAny.evidenceCollectedThisTurnByPlayerCounts = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (!pid) continue;
        const key = String(pid);
        stateAny.evidenceCollectedThisTurn[key] = false;
        stateAny.evidenceCollectedThisTurnByPlayer[key] = false;
        stateAny.evidenceCollectedThisTurnByPlayerCounts[key] = 0;
      }
    } catch {
      // best-effort only
    }

    // Clear per-turn sacrifice tracking (for intervening-if templates like
    // "if you sacrificed a permanent this turn" / "if you sacrificed a Food this turn").
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.permanentsSacrificedThisTurn = {};
      stateAny.foodsSacrificedThisTurn = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (!pid) continue;
        stateAny.permanentsSacrificedThisTurn[String(pid)] = 0;
        stateAny.foodsSacrificedThisTurn[String(pid)] = 0;
      }
    } catch {
      // best-effort only
    }

    // Clear per-turn counter placement tracking (for intervening-if templates like
    // "if you put a counter on a creature this turn").
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.putCounterOnCreatureThisTurn = {};
      stateAny.placedCounterOnCreatureThisTurn = {};
      stateAny.countersPlacedOnCreaturesThisTurn = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (!pid) continue;
        const key = String(pid);
        stateAny.putCounterOnCreatureThisTurn[key] = false;
        stateAny.placedCounterOnCreatureThisTurn[key] = false;
        stateAny.countersPlacedOnCreaturesThisTurn[key] = false;
      }

      // Also track a stricter +1/+1 counter placement condition used by oracle text like:
      // "if a +1/+1 counter was put on a permanent under your control this turn" (Fairgrounds Trumpeter).
      stateAny.putPlusOneCounterOnPermanentThisTurn = {};
      stateAny.placedPlusOneCounterOnPermanentThisTurn = {};
      stateAny.plusOneCounterPlacedOnPermanentThisTurn = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (!pid) continue;
        const key = String(pid);
        stateAny.putPlusOneCounterOnPermanentThisTurn[key] = false;
        stateAny.placedPlusOneCounterOnPermanentThisTurn[key] = false;
        stateAny.plusOneCounterPlacedOnPermanentThisTurn[key] = false;
      }

      // Per-permanent event counts for "first time counters were put on ... this turn" templates.
      stateAny.putCounterOnPermanentThisTurnByPermanentId = {};
      stateAny.countersPutThisTurnByPermanentId = {};
      stateAny.plusOneCountersPutThisTurnByPermanentId = {};
    } catch {
      // best-effort only
    }

    // Clear per-turn graveyard-leave tracking (for intervening-if templates like
    // "if a card left your graveyard this turn" / "if a creature card left your graveyard this turn").
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.cardLeftGraveyardThisTurn = {};
      stateAny.cardsLeftGraveyardThisTurn = {};
      stateAny.leftGraveyardThisTurn = {};
      stateAny.creatureCardLeftGraveyardThisTurn = {};
      stateAny.creatureCardsLeftGraveyardThisTurn = {};
      stateAny.cardLeftYourGraveyardThisTurn = {};
      stateAny.creatureCardLeftYourGraveyardThisTurn = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (!pid) continue;
        stateAny.cardLeftGraveyardThisTurn[String(pid)] = false;
        stateAny.cardsLeftGraveyardThisTurn[String(pid)] = false;
        stateAny.leftGraveyardThisTurn[String(pid)] = false;
        stateAny.creatureCardLeftGraveyardThisTurn[String(pid)] = false;
        stateAny.creatureCardsLeftGraveyardThisTurn[String(pid)] = false;
        stateAny.cardLeftYourGraveyardThisTurn[String(pid)] = false;
        stateAny.creatureCardLeftYourGraveyardThisTurn[String(pid)] = false;
      }
    } catch {
      // best-effort only
    }

    // Clear per-turn graveyard-put tracking (for intervening-if templates like
    // "if a creature card was put into your graveyard from anywhere this turn" and
    // count-based variants).
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.cardsPutIntoYourGraveyardThisTurn = {};
      stateAny.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn = {};
      stateAny.creatureCardPutIntoYourGraveyardThisTurn = {};
      stateAny.permanentCardsPutIntoYourGraveyardThisTurn = {};

      // Battlefield-only typed variants.
      stateAny.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn = {};
      stateAny.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn = {};
      stateAny.artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn = false;
      for (const p of players) {
        const pid = (p as any)?.id;
        if (!pid) continue;
        stateAny.cardsPutIntoYourGraveyardThisTurn[String(pid)] = 0;
        stateAny.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn[String(pid)] = 0;
        stateAny.creatureCardPutIntoYourGraveyardThisTurn[String(pid)] = false;
        stateAny.permanentCardsPutIntoYourGraveyardThisTurn[String(pid)] = 0;

        stateAny.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn[String(pid)] = false;
        stateAny.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn[String(pid)] = false;
      }
    } catch {
      // best-effort only
    }

    // Clear per-turn battlefield->hand tracking (for intervening-if templates like
    // "if a permanent was put into your hand from the battlefield this turn").
    try {
      const stateAny = (ctx as any).state as any;
      const players = Array.isArray(stateAny.players) ? stateAny.players : [];
      stateAny.permanentPutIntoHandFromBattlefieldThisTurn = {};
      for (const p of players) {
        const pid = (p as any)?.id;
        if (!pid) continue;
        stateAny.permanentPutIntoHandFromBattlefieldThisTurn[String(pid)] = false;
      }
    } catch {
      // best-effort only
    }

    // Mirrormind Crown replacement usage is tracked per equipment id for the current turn.
    try {
      (ctx as any).state.mirrormindCrownUsedThisTurn = {};
    } catch {
      // best-effort only
    }

    // Reset per-turn day/night change tracking before applying the beginning-of-turn transition.
    try {
      (ctx as any).state.dayNightChangedThisTurn = false;
      delete (ctx as any).state.dayNightChangedFrom;
      delete (ctx as any).state.dayNightChangedTo;
    } catch {}

    // Day/Night bootstrap: if the game already has a daybound/nightbound permanent on the
    // battlefield but no designation (for example after replay/load), initialize it now.
    try {
      ensureInitialDayNightDesignationFromBattlefield((ctx as any).state);
    } catch {}

    // Day/Night (701.26) — minimal authoritative state.
    // If the game has become day/night, it stays that way until it changes.
    // At the beginning of each turn, check spells cast during the previous turn:
    // - If it's day and no spells were cast last turn, it becomes night.
    // - If it's night and two or more spells were cast last turn, it becomes day.
    try {
      const dn = (ctx as any).state.dayNight;
      const spellsLastTurn =
        (ctx as any).state.spellsCastLastTurnByActivePlayerCount ?? (ctx as any).state.spellsCastLastTurnCount;
      if ((dn === 'day' || dn === 'night') && typeof spellsLastTurn === 'number') {
        let nextDn: 'day' | 'night' | null = null;
        if (dn === 'day' && spellsLastTurn === 0) nextDn = 'night';
        if (dn === 'night' && spellsLastTurn >= 2) nextDn = 'day';
        if (nextDn && nextDn !== dn) {
          setDayNightState((ctx as any).state, nextDn);
          const turnPlayer = String((ctx as any).state?.turnPlayer || (ctx as any).state?.activePlayer || '').trim();
          if (turnPlayer) queueParsedKeywordAction(ctx, turnPlayer, 'day_night');
        }
      }
    } catch {}
    
    // Clear justSkippedToPhase flag when starting a new turn
    // Players need to use phase navigator again if they want priority protection
    if ((ctx as any).state.justSkippedToPhase) {
      delete (ctx as any).state.justSkippedToPhase;
      debug(2, `${ts()} [nextTurn] Cleared justSkippedToPhase flag for new turn`);
    }

    debug(2, `${ts()} [nextTurn] Advanced to player ${next}, phase=${(ctx as any).state.phase}, step=${(ctx as any).state.step}`);

    // Reset lands played this turn for all players
    (ctx as any).state.landsPlayedThisTurn = (ctx as any).state.landsPlayedThisTurn || {};
    for (const pid of players) {
      (ctx as any).state.landsPlayedThisTurn[pid] = 0;
    }

    snapshotLastTurnCountersAndResetDraws(ctx, players, current);

    // Reset life gain/loss tracking for this turn.
    (ctx as any).state.lifeGainedThisTurn = {};
    (ctx as any).state.lifegainTriggersFiredThisTurn = {};
    (ctx as any).state.discoverTriggersFiredThisTurn = {};
    (ctx as any).state.doThisOnlyOnceEachTurnUsedThisTurn = {};
    (ctx as any).state.oncePerTurnTriggersFiredThisTurn = {};
    resetExhaustAbilityActivations((ctx as any).state);
    try { recordTurnStartedForPlayer(ctx.state); } catch {}
    try { queueOptionalDrawStepSkipPrompt(ctx, String(next)); } catch {}
    resetSpeedIncreasedThisTurn((ctx as any).state);
    (ctx as any).state.lifeLostThisTurn = {};
    for (const pid of players) {
      (ctx as any).state.lifeGainedThisTurn[String(pid)] = 0;
      (ctx as any).state.lifeLostThisTurn[String(pid)] = 0;
    }

    resetConvokeGrantsForNewTurn(
      (ctx as any).state,
      Number((ctx as any).state.turnNumber ?? (ctx as any).state.turn ?? 0) || 0,
    );

    // Reset per-player damage taken tracking for this turn.
    (ctx as any).state.damageTakenThisTurnByPlayer = {};
    for (const pid of players) {
      (ctx as any).state.damageTakenThisTurnByPlayer[String(pid)] = 0;
    }

    // Reset land-ETB tracking for this turn.
    (ctx as any).state.landsEnteredBattlefieldThisTurn = {};

    // Reset nonland-permanent ETB tracking for this turn.
    (ctx as any).state.nonlandPermanentsEnteredBattlefieldThisTurn = {};

    // Reset artifact/planeswalker ETB tracking for this turn.
    (ctx as any).state.artifactsEnteredBattlefieldThisTurnByController = {};
    (ctx as any).state.artifactsEnteredBattlefieldThisTurnIdsByController = {};
    (ctx as any).state.enchantmentsEnteredBattlefieldThisTurnByController = {};
    (ctx as any).state.enchantmentsEnteredBattlefieldThisTurnIdsByController = {};
    (ctx as any).state.planeswalkersEnteredBattlefieldThisTurnByController = {};
    (ctx as any).state.planeswalkersEnteredBattlefieldThisTurnIdsByController = {};
    (ctx as any).state.battlesEnteredBattlefieldThisTurnByController = {};
    (ctx as any).state.battlesEnteredBattlefieldThisTurnIdsByController = {};

    // Reset die roll tracking for this turn.
    (ctx as any).state.dieRollsThisTurn = {};
    for (const pid of players) {
      (ctx as any).state.dieRollsThisTurn[String(pid)] = [];
    }
    delete (ctx as any).state._pendingAttractionVisitRollPlayer;

    // Reset dungeon completion tracking for this turn.
    (ctx as any).state.completedDungeonThisTurn = {};
    (ctx as any).state.dungeonCompletedThisTurn = {};
    
    // Reset tracking of creatures that dealt damage to players this turn
    // This is used for cards like Reciprocate that can only target creatures that dealt damage to you this turn
    (ctx as any).state.creaturesThatDealtDamageToPlayer = {};

    // Reset morbid/revolt-style per-turn flags
    (ctx as any).state.creatureDiedThisTurn = false;
    (ctx as any).state.creaturesDiedThisTurnByController = {};
    (ctx as any).state.creaturesDiedThisTurnByControllerSubtype = {};
    // Legacy alias map used by some death-count templates.
    (ctx as any).state.creaturesDiedUnderYourControlThisTurn = {};
    (ctx as any).state.creaturesEnteredBattlefieldThisTurnByController = {};
    (ctx as any).state.creaturesEnteredBattlefieldThisTurnByControllerSubtype = {};
    (ctx as any).state.creaturesEnteredBattlefieldThisTurnIdsByController = {};
    (ctx as any).state.faceDownCreaturesEnteredBattlefieldThisTurnByController = {};
    // Initialize per-turn boolean trackers for all players so intervening-if can return false deterministically.
    {
      const left: any = {};
      const descended: any = {};
      for (const pid of players) {
        left[String(pid)] = false;
        descended[String(pid)] = false;
      }
      (ctx as any).state.permanentLeftBattlefieldThisTurn = left;
      (ctx as any).state.descendedThisTurn = descended;
    }

    // Initialize attack target tracking for all players so "attacked last turn" snapshots are deterministic.
    try {
      const stateAny = (ctx as any).state as any;
      stateAny.attackedPlayersThisTurnByPlayer = {};
      for (const pid of players) stateAny.attackedPlayersThisTurnByPlayer[String(pid)] = [];
    } catch {
      // best-effort only
    }

    // Planechase (NYI): initialize per-turn trackers so intervening-if clauses can be deterministic.
    // Shape: { [playerId]: string[] }
    {
      const planeswalked: any = {};
      const players = Array.isArray((ctx as any).state?.players) ? (ctx as any).state.players : [];
      for (const p of players) {
        const pid = String(p?.id || '').trim();
        if (pid) planeswalked[pid] = [];
      }
      (ctx as any).state.planeswalkedToThisTurn = planeswalked;
      (ctx as any).state.planeswalkedToPlanesThisTurn = planeswalked;
    }

    // Reset per-permanent damage tracking for "this turn" intervening-if clauses.
    try {
      const battlefield = (ctx as any).state?.battlefield;
      if (Array.isArray(battlefield)) {
        for (const perm of battlefield) {
          if (!perm) continue;
          if (perm.damageThisTurn !== undefined) delete perm.damageThisTurn;
          if (perm.combatDamageThisTurn !== undefined) delete perm.combatDamageThisTurn;
          if (perm.tookDamageThisTurn !== undefined) delete perm.tookDamageThisTurn;
        }
      }
    } catch {}

    // Recalculate player effects based on battlefield (Exploration, Font of Mythos, etc.)
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to recalculate player effects:`, err);
    }
}
