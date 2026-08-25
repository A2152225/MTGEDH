// server/src/socket/util-handlers/getPlayableCardIds.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: getPlayableCardIds - hand/battlefield/exile/graveyard/top-deck
//   playability used by broadcast highlighting and auto-pass idle checks.
// Public entry symbols: getPlayableCardIds.

import type { InMemoryGame } from "../../state/types.js";
import type { PlayerID } from "../../../../shared/src/index.js";
import {
  canPayManaCostWithAvailableSources,
  getAvailableMana,
  getTotalManaFromPool,
  parseManaCost as parseManaFromString,
  stripReminderTextFromOracle,
} from "../../state/modules/mana-check.js";
import {
  getCastableCommanderCandidates,
  getCastableSpellCandidates,
  getPlayableLandCandidates,
  hasSacrificePrefixActivatedAbility,
} from "../../state/modules/can-respond.js";
import {
  getGrantedEmbalmInfo,
  getGrantedUnearthInfo,
  getPrintedUnearthInfo,
} from "../../state/modules/graveyard-permissions.js";
import { creatureHasHaste } from "../game-actions.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { isInMainPhase } from "./utilMainPhaseCheck.js";

/**
 * Get IDs of cards/permanents that the player can currently play or activate
 * This is used for UI highlighting to show players their available options
 * Includes: cards in hand, battlefield abilities, foretell cards in exile, 
 * playable cards from graveyard/exile/top deck, etc.
 * 
 * NOTE: Checks both affordability AND timing to ensure automation works correctly.
 */
export function getPlayableCardIds(game: InMemoryGame, playerId: PlayerID): string[] {
  const playableIds: string[] = [];
  
  try {
    const state = game.state;
    if (!state) {
      debug(2, `[getPlayableCardIds] No state for player ${playerId}`);
      return playableIds;
    }
    
    const zones = state.zones?.[playerId];
    if (!zones) {
      debug(2, `[getPlayableCardIds] No zones for player ${playerId}`);
      return playableIds;
    }
    
    const isMainPhase = isInMainPhase(state);
    const stackIsEmpty = !state.stack || state.stack.length === 0;
    const turnPlayer = state.turnPlayer;
    const isMyTurn = turnPlayer === playerId;

    const spellCandidateMode = isMainPhase && stackIsEmpty && isMyTurn ? 'main' : 'response';
    const sharedSpellCandidates = getCastableSpellCandidates({
      state,
      libraries: (game as any).libraries,
    } as any, playerId, {
      mode: spellCandidateMode,
      allowUnknownCostFallback: false,
      conservativeTargets: false,
    });

    const highlightedSpellIds = new Set<string>();
    for (const candidate of sharedSpellCandidates) {
      const playableId = candidate.sourceZone === 'library'
        ? `library-${playerId}`
        : String(candidate.card?.id || candidate.castCard?.id || '').trim();
      if (!playableId || highlightedSpellIds.has(playableId)) continue;
      highlightedSpellIds.add(playableId);
      playableIds.push(playableId);
    }
    
    // Check for playable lands from any supported zone (during main phase with empty stack)
    if (isMainPhase && stackIsEmpty && isMyTurn) {
      const playableLandCandidates = getPlayableLandCandidates({
        state,
        libraries: (game as any).libraries,
      } as any, playerId);

      const highlightedLandIds = new Set<string>();
      for (const candidate of playableLandCandidates) {
        const playableId = candidate.sourceZone === 'library'
          ? `library-${playerId}`
          : String(candidate.card?.id || '');
        if (!playableId || highlightedLandIds.has(playableId)) continue;
        highlightedLandIds.add(playableId);
        playableIds.push(playableId);
      }
    }
    
    const commanderCandidates = getCastableCommanderCandidates({
      state,
      libraries: (game as any).libraries,
    } as any, playerId as any);
    for (const candidate of commanderCandidates) {
      const canCastNow = candidate.grantsFlash || (isMainPhase && stackIsEmpty && isMyTurn);
      if (!canCastNow) continue;

      const commanderId = String(candidate.commanderId || candidate.card?.id || '').trim();
      if (!commanderId || playableIds.includes(commanderId)) continue;
      playableIds.push(commanderId);
    }
    
    if (Array.isArray(zones.graveyard)) {
      const battlefield = state.battlefield || [];
      for (const card of zones.graveyard) {
        if (!card || typeof card === "string") continue;
        if (!isMyTurn || !isMainPhase || !stackIsEmpty) continue;

        const printedUnearthInfo = getPrintedUnearthInfo(card);
        const grantedUnearthInfo = printedUnearthInfo.hasIt ? { hasIt: false } : getGrantedUnearthInfo({ state } as any, playerId, card);
        if (!printedUnearthInfo.hasIt && !grantedUnearthInfo.hasIt) continue;

        const unearthCost = String(printedUnearthInfo.cost || grantedUnearthInfo.cost || '').trim();
        if (!unearthCost) {
          if (!playableIds.includes(card.id)) playableIds.push(card.id);
          continue;
        }

        const parsedCost = parseManaFromString(unearthCost);
        if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          if (!playableIds.includes(card.id)) playableIds.push(card.id);
        }
      }

      for (const card of zones.graveyard) {
        if (!card || typeof card === "string") continue;
        if (!isMyTurn || !isMainPhase || !stackIsEmpty) continue;

        const grantedEmbalmInfo = getGrantedEmbalmInfo({ state } as any, playerId, card);
        if (!grantedEmbalmInfo.hasIt) continue;

        const embalmCost = String(grantedEmbalmInfo.cost || '').trim();
        if (!embalmCost) {
          if (!playableIds.includes(card.id)) playableIds.push(card.id);
          continue;
        }

        const parsedCost = parseManaFromString(embalmCost);
        if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          if (!playableIds.includes(card.id)) playableIds.push(card.id);
        }
      }
      
      // Check graveyard for cards with activated abilities that can be used from there
      // Examples: Magma Phoenix "{3}{R}{R}: Return this card from your graveyard to your hand."
      // IMPORTANT: Only highlight cards that are ACTUALLY in the graveyard, not on battlefield
      for (const card of zones.graveyard) {
        if (!card || typeof card === "string") continue;
        
        // Skip this card if it's also on the battlefield
        // This prevents highlighting abilities like Magma Phoenix's graveyard return when it's on battlefield
        const isOnBattlefield = battlefield.some((perm: any) => 
          perm.card?.id === card.id || perm.card?.name === card.name
        );
        
        if (isOnBattlefield) {
          continue; // Card is on battlefield, don't allow graveyard abilities
        }
        
        const oracleText = (card.oracle_text || "").replace(/\([^)]*\)/g, "");
        
        // Look for activated abilities that mention graveyard in the effect
        // Pattern: "{Cost}: [Effect mentions graveyard]"
        const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,?\s*\{[^}]+\})*)\s*:\s*(.+?)(?:\.|$)/gi;
        const matches = [...oracleText.matchAll(activatedAbilityPattern)];
        
        let hasGraveyardAbility = false;
        for (const match of matches) {
          const costPart = match[1];
          const effectPart = match[2];
          
          // Check if the effect mentions "from your graveyard" or "from a graveyard"
          if (effectPart.toLowerCase().includes("graveyard")) {
            const parsedCost = parseManaFromString(costPart);
            if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
              hasGraveyardAbility = true;
              break;
            }
          }
        }
        
        if (hasGraveyardAbility) {
          playableIds.push(card.id);
        }
      }
    }
    
    // Check battlefield for activatable abilities
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      
      const oracleText = stripReminderTextFromOracle(perm.card?.oracle_text || "");
      let hasActivatableAbility = false;
      
      // Check for tap abilities
      if (/\{T\}:/.test(oracleText) && !perm.tapped) {
        const abilityMatch = oracleText.match(/\{T\}(?:,\s*([^:]+))?:\s*(.+)/i);
        if (abilityMatch) {
          const effect = abilityMatch[2] || "";
          const effectLower = effect.toLowerCase();
          
          // Skip pure mana abilities (they don't require priority)
          const isPureManaAbility = /add\s+(?:\{[wubrgc]\}|\{[^}]+\}\{[^}]+\}|one mana|mana)/i.test(effectLower) &&
                                    !/target/i.test(effect);
          
          if (!isPureManaAbility) {
            hasActivatableAbility = true;
          }
        }
      }
      
      // Check for other activated abilities with costs
      const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,\s*\{[^}]+\})*)\s*:\s*(.+)/gi;
      const matches = [...oracleText.matchAll(activatedAbilityPattern)];
      
      for (const match of matches) {
        const costPart = match[1];
        const effectPart = match[2];
        
        // Skip if already checked (tap ability)
        if (costPart.includes("{T}")) continue;
        
        // Skip pure mana abilities
        const effectLower = effectPart.toLowerCase();
        const isPureManaAbility = /add\s+(?:\{[wubrgc]\}|\{[^}]+\}\{[^}]+\}|one mana|mana)/i.test(effectLower) &&
                                  !/target/i.test(effectPart);
        
        if (isPureManaAbility) continue;
        
        // Check for sorcery-speed-only abilities (equip, reconfigure, etc.)
        if (effectLower.includes("equip") || effectLower.includes("reconfigure")) {
          if (isMainPhase && stackIsEmpty) {
            const parsedCost = parseManaFromString(costPart);
            if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
              hasActivatableAbility = true;
            }
          }
          continue;
        }
        
        // Check for explicit sorcery-speed restriction
        if (/(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(oracleText)) {
          if (isMainPhase && stackIsEmpty) {
            const parsedCost = parseManaFromString(costPart);
            if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
              hasActivatableAbility = true;
            }
          }
          continue;
        }
        
        // {Q} untap cost (e.g. Gilder Bairn): the permanent must be tapped to pay the untap
        // symbol. parseManaFromString ignores {Q}, so gate on tapped state here too.
        if (/\{Q\}/i.test(costPart)) {
          if (!perm.tapped) continue;
          const permTypeLine = (perm.card?.type_line || "").toLowerCase();
          const isCreature = /\bcreature\b/.test(permTypeLine);
          const isLand = permTypeLine.includes("land");
          if (isCreature && !isLand && (perm as any).summoningSickness) {
            if (!creatureHasHaste(perm, battlefield, playerId)) continue;
          }
        }

        // Instant-speed abilities - check if we can pay the cost
        const parsedCost = parseManaFromString(costPart);
        if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          hasActivatableAbility = true;
          break;
        }
      }
      
      // Add permanent once if it has any activatable abilities
      if (hasActivatableAbility) {
        playableIds.push(perm.id);
        continue;
      }

      if (hasSacrificePrefixActivatedAbility({ state, libraries: (game as any).libraries } as any, playerId, perm)) {
        playableIds.push(perm.id);
      }
    }
    
  } catch (err) {
    debugWarn(1, "[getPlayableCardIds] Error:", err);
  }
  
  debug(2, `[getPlayableCardIds] Player ${playerId}: ${playableIds.length} playable option(s); step=${game.state?.step}, priority=${game.state?.priority}, hand=${Array.isArray(game.state?.zones?.[playerId]?.hand) ? game.state.zones[playerId].hand.length : 0}, availableMana=${getTotalManaFromPool(getAvailableMana(game.state, playerId))}`);
  return playableIds;
}
