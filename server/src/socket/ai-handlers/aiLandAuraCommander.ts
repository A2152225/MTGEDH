/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: land-face/playable-land helpers, failed-cast memory, aura
 * targeting, findCastableCommander.
 *
 * Public entry symbols: applyAISelectedLandFace, findPlayableLand,
 * rememberAIFailedSpellCast, isAIFailedSpellCastCard, findCastableCommander,
 * checkAuraHasValidTarget, findAuraTarget.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { getCastableCommanderCandidates, getPlayableLandCandidates } from "../../state/modules/can-respond.js";
import { getAvailableMana } from "../../state/modules/mana-check.js";
import { getEffectiveAdditionalCost } from "../game-actions.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import type { AICastableCommanderCandidate, AIPlayableLandCandidate } from "./aiActionCandidateTypes.js";
import { canAIPayAdditionalCost } from "./aiManaCostHelpers.js";
import { canAIAssembleSpellPaymentPlan } from "./aiSpellPaymentPlanHelpers.js";

function getAIActionContext(game: any): any {
  return getAIHandlerDeps().getAIActionContext(game);
}

export function applyAISelectedLandFace(card: any, selectedFaceIndex?: number): void {
  if (!card || typeof selectedFaceIndex !== 'number') {
    return;
  }

  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const selectedCardFace = cardFaces[selectedFaceIndex];
  if (!selectedCardFace) {
    return;
  }

  card.name = selectedCardFace.name;
  card.type_line = selectedCardFace.type_line;
  card.oracle_text = selectedCardFace.oracle_text;
  card.mana_cost = selectedCardFace.mana_cost;
  if (selectedCardFace.image_uris) {
    card.image_uris = selectedCardFace.image_uris;
  }
  card.selectedMDFCFace = selectedFaceIndex;
}

/**
 * Find a playable land in the AI's supported zones.
 * Prefer the top of the library when the same player-side permission model allows it,
 * then fall back to lands in hand.
 */
export function isCardAlreadyOnBattlefield(game: any, playerId: PlayerID, cardId: string): boolean {
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  return battlefield.some((permanent: any) => permanent?.controller === playerId && permanent?.card?.id === cardId);
}

export function findPlayableLand(game: any, playerId: PlayerID): AIPlayableLandCandidate | null {
  const candidates = getPlayableLandCandidates(getAIActionContext(game), playerId, {
    skipBattlefieldDuplicates: true,
  });

  const firstCandidate = candidates[0] || null;
  if (!firstCandidate) {
    return null;
  }

  if (firstCandidate.card?.id && isCardAlreadyOnBattlefield(game, playerId, String(firstCandidate.card.id))) {
    debugWarn(1, '[AI] Skipping stale duplicate land already on battlefield:', {
      playerId,
      cardId: firstCandidate.card.id,
      cardName: firstCandidate.card.name,
      sourceZone: firstCandidate.sourceZone,
    });
    return null;
  }

  return firstCandidate;
}


function rememberAIFailedSpellCast(game: any, playerId: string, cardId: string): void {
  const normalizedCardId = String(cardId || '').trim();
  const normalizedPlayerId = String(playerId || '').trim();
  if (!game?.state || !normalizedCardId || !normalizedPlayerId) return;

  const stateAny = game.state as any;
  const turnKey = `${String(stateAny.turnCount ?? stateAny.turn ?? 0)}:${String(stateAny.activePlayer || stateAny.turnPlayer || '')}`;
  if (String(stateAny._aiFailedSpellCastTurnKey || '') !== turnKey) {
    stateAny._aiFailedSpellCastByPlayer = {};
    stateAny._aiFailedSpellCastTurnKey = turnKey;
  }

  const byPlayer = (stateAny._aiFailedSpellCastByPlayer ||= {}) as Record<string, string[]>;
  const existing = Array.isArray(byPlayer[normalizedPlayerId]) ? byPlayer[normalizedPlayerId] : [];
  if (!existing.includes(normalizedCardId)) {
    byPlayer[normalizedPlayerId] = [...existing, normalizedCardId];
    debugWarn(1, `[AI] Remembering failed spell cast for remainder of turn`, {
      playerId: normalizedPlayerId,
      cardId: normalizedCardId,
    });
  }
}

export function isAIFailedSpellCastCard(game: any, playerId: string, cardId: string): boolean {
  const normalizedCardId = String(cardId || '').trim();
  const normalizedPlayerId = String(playerId || '').trim();
  if (!game?.state || !normalizedCardId || !normalizedPlayerId) return false;

  const stateAny = game.state as any;
  const turnKey = `${String(stateAny.turnCount ?? stateAny.turn ?? 0)}:${String(stateAny.activePlayer || stateAny.turnPlayer || '')}`;
  if (String(stateAny._aiFailedSpellCastTurnKey || '') !== turnKey) {
    return false;
  }

  const failed = stateAny._aiFailedSpellCastByPlayer?.[normalizedPlayerId];
  return Array.isArray(failed) && failed.includes(normalizedCardId);
}

export { rememberAIFailedSpellCast };


/**
 * Check if an Aura card has a valid target on the battlefield
 * Parses "Enchant X" patterns to determine what can be targeted
 */
function checkAuraHasValidTarget(state: any, playerId: PlayerID, auraCard: any): boolean {
  const oracleText = (auraCard?.oracle_text || '').toLowerCase();
  const battlefield = state?.battlefield || [];
  
  // Parse "Enchant X" pattern to determine valid targets
  // Common patterns:
  // - "Enchant creature"
  // - "Enchant land"
  // - "Enchant creature you control"
  // - "Enchant creature an opponent controls"
  // - "Enchant artifact"
  // - "Enchant permanent"
  
  const enchantMatch = oracleText.match(/enchant\s+(\w+(?:\s+\w+)*?)(?:\s+you\s+control|\s+an\s+opponent\s+controls)?/i);
  if (!enchantMatch) {
    // No enchant pattern found - assume it can target anything
    return battlefield.length > 0;
  }
  
  const enchantTarget = enchantMatch[1].toLowerCase();
  const youControlOnly = /enchant\s+\w+(?:\s+\w+)*\s+you\s+control/i.test(oracleText);
  const opponentControlOnly = /enchant\s+\w+(?:\s+\w+)*\s+an?\s+opponent\s+controls/i.test(oracleText);
  
  // Find valid targets on the battlefield
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    const controller = perm.controller;
    
    // Check controller restrictions
    if (youControlOnly && controller !== playerId) continue;
    if (opponentControlOnly && controller === playerId) continue;
    
    // Check type restrictions
    if (enchantTarget.includes('creature') && !typeLine.includes('creature')) continue;
    if (enchantTarget.includes('land') && !typeLine.includes('land')) continue;
    if (enchantTarget.includes('artifact') && !typeLine.includes('artifact')) continue;
    if (enchantTarget.includes('enchantment') && !typeLine.includes('enchantment')) continue;
    if (enchantTarget.includes('planeswalker') && !typeLine.includes('planeswalker')) continue;
    
    // This permanent matches the enchant restriction
    return true;
  }
  
  return false;
}

/**
 * Find the best target for an Aura spell
 * Uses similar logic to checkAuraHasValidTarget but returns the actual target
 */
function findAuraTarget(state: any, playerId: PlayerID, auraCard: any): any | null {
  const oracleText = (auraCard?.oracle_text || '').toLowerCase();
  const battlefield = state?.battlefield || [];
  
  // Parse "Enchant X" pattern
  const enchantMatch = oracleText.match(/enchant\s+(\w+(?:\s+\w+)*?)(?:\s+you\s+control|\s+an\s+opponent\s+controls)?/i);
  if (!enchantMatch) {
    // No enchant pattern - can target any permanent, prefer own permanents
    const ownPermanents = battlefield.filter((p: any) => p.controller === playerId);
    return ownPermanents[0] || battlefield[0] || null;
  }
  
  const enchantTarget = enchantMatch[1].toLowerCase();
  const youControlOnly = /enchant\s+\w+(?:\s+\w+)*\s+you\s+control/i.test(oracleText);
  const opponentControlOnly = /enchant\s+\w+(?:\s+\w+)*\s+an?\s+opponent\s+controls/i.test(oracleText);
  
  // Determine if this is a beneficial or detrimental aura
  // Beneficial auras should go on own permanents, detrimental on opponents
  const isBeneficial = detectBeneficialAura(oracleText);
  
  const validTargets: any[] = [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    const controller = perm.controller;
    
    // Check controller restrictions
    if (youControlOnly && controller !== playerId) continue;
    if (opponentControlOnly && controller === playerId) continue;
    
    // Check type restrictions
    if (enchantTarget.includes('creature') && !typeLine.includes('creature')) continue;
    if (enchantTarget.includes('land') && !typeLine.includes('land')) continue;
    if (enchantTarget.includes('artifact') && !typeLine.includes('artifact')) continue;
    if (enchantTarget.includes('enchantment') && !typeLine.includes('enchantment')) continue;
    if (enchantTarget.includes('planeswalker') && !typeLine.includes('planeswalker')) continue;
    
    // Add to valid targets with preference marker
    validTargets.push({ perm, isOwn: controller === playerId });
  }
  
  if (validTargets.length === 0) return null;
  
  // Sort by preference: beneficial auras prefer own, detrimental prefer opponent
  validTargets.sort((a, b) => {
    if (isBeneficial) {
      // Prefer own permanents for beneficial auras
      if (a.isOwn && !b.isOwn) return -1;
      if (!a.isOwn && b.isOwn) return 1;
    } else {
      // Prefer opponent permanents for detrimental auras
      if (!a.isOwn && b.isOwn) return -1;
      if (a.isOwn && !b.isOwn) return 1;
    }
    return 0;
  });
  
  return validTargets[0]?.perm || null;
}

/**
 * Detect if an aura is beneficial (buffs) or detrimental (debuffs/control)
 */
function detectBeneficialAura(oracleText: string): boolean {
  const text = oracleText.toLowerCase();
  
  // Detrimental indicators (pacifism, control, debuffs)
  if (text.includes("can't attack") || text.includes("can't block")) return false;
  if (text.includes("doesn't untap")) return false;
  if (text.includes("gains control")) return false;
  if (text.includes("-1/-1") || text.includes("-2/-2") || text.includes("-3/-3")) return false;
  if (text.includes("exile") && text.includes("when")) return false;
  if (text.includes("destroy") && text.includes("when")) return false;
  if (text.includes("goaded") || text.includes("is goaded")) return false;
  
  // Beneficial indicators (buffs, abilities)
  if (text.includes("+1/+1") || text.includes("+2/+2") || text.includes("+3/+3")) return true;
  if (text.includes("flying") || text.includes("trample") || text.includes("lifelink")) return true;
  if (text.includes("first strike") || text.includes("double strike") || text.includes("vigilance")) return true;
  if (text.includes("hexproof") || text.includes("indestructible") || text.includes("protection")) return true;
  if (text.includes("create a") && text.includes("token")) return true; // Squirrel Nest, etc.
  if (text.includes("whenever") && text.includes("draw")) return true;
  
  // Default to beneficial for enchantments on your own stuff
  return true;
}

/**
 * Find castable commander from command zone
 * Returns the commander card and cost if castable, null otherwise
 * Uses shared mana calculation for consistency
 * 
 * Partner commanders and backgrounds are tracked independently - each can be cast
 * while the other remains in the command zone.
 */
export function findCastableCommander(
  game: any,
  playerId: PlayerID,
  options?: { responseOnly?: boolean },
): AICastableCommanderCandidate | null {
  const manaPool = getAvailableMana(game.state, playerId);
  const responseOnly = options?.responseOnly === true;
  const candidate = getCastableCommanderCandidates(getAIActionContext(game), playerId)
    .filter((entry) => !responseOnly || entry.grantsFlash === true)
    .filter((entry) => {
      const card = entry.card;
      if (card) {
        const addCost = getEffectiveAdditionalCost(card, card.oracle_text || '');
        if (addCost && !canAIPayAdditionalCost(game, playerId, entry, addCost)) {
          debug(1, `[AI] findCastableCommander: Skipping Commander ${card.name} because additional cost cannot be paid:`, addCost);
          return false;
        }
      }
      return true;
    })
    .find((entry) => entry.cost && canAIAssembleSpellPaymentPlan(game, playerId, entry.payableCost || entry.cost)) || null;

  if (!candidate) {
    debug(2, '[AI] No castable commanders found', {
      playerId,
      availableMana: manaPool,
    });
    return null;
  }

  debug(1, '[AI] Found castable commander:', candidate.card?.name, 'total CMC:', candidate.cost?.cmc);
  debug(2, '[AI] Mana available:', JSON.stringify(manaPool));
  debug(2, '[AI] Cost required:', JSON.stringify(candidate.cost));
  return candidate;
}

