// server/src/state/modules/can-respond-handlers/canRespondActivatableAbilities.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: hasActivatableAbility, hasGraveyardActivatedAbility,
// canActivateAnyAbility, plus loyalty/sacrifice/station/exile/hand helpers.
// Public entry symbols: canActivateAnyAbility, hasSacrificePrefixActivatedAbility,
// hasActivatableLoyaltyAbility.

import type { GameContext } from '../../context.js';
import type { PlayerID } from '../../../../../shared/src/index.js';
import { parseManaCost, canPayManaCostWithAvailableSources, getAvailableMana } from '../mana-check.js';
import { isActivatedAbilityTimingLegal } from '../activation-timing.js';
import { creatureHasHaste } from '../../../socket/game-actions.js';
import { getGrantedEmbalmInfo, getGrantedUnearthInfo, getPrintedUnearthInfo } from '../graveyard-permissions.js';
import { debug, debugWarn } from '../../../utils/debug.js';
import { parseWordNumber } from '../../utils.js';
import { canPlayerPayLife } from '../game-state-effects-handlers/gameStateEffectsLifeModifierOraclePatterns.js';
import { findPermanentsWithCreatureType } from '../../../../../shared/src/creatureTypes.js';
import { isAbilityActivationProhibitedByChosenName } from '../chosen-name-restrictions.js';
import { canActivateLoyaltyAtInstantSpeed } from '../triggered-abilities.js';
import { isSplitSecondLockActive } from './canRespondSplitSecondLandPredicates.js';
import { parseWordNumberForGraveyardCost } from './canRespondParseWordNumber.js';
import { isActivatedAbilityConditionMet } from './canRespondActivatedAbilityCondition.js';
import { canCastAnySpell } from './canRespondCanCastAnySpell.js';
import { isInMainPhase } from './canRespondMainPhase.js';

/**
 * Check if an ability is a mana ability (doesn't use the stack, doesn't require priority)
 * Per MTG Rule 605.1a: A mana ability is an activated ability that:
 * - Could add mana to a player's mana pool when it resolves
 * - Isn't a loyalty ability
 * - Doesn't target
 * 
 * Mana abilities can be activated at any time without priority, so they should NOT
 * prevent auto-passing priority.
 */
function isManaAbility(oracleText: string, effectPart: string): boolean {
  if (!effectPart) return false;
  
  const effectLower = effectPart.toLowerCase();
  
  // Check if it adds mana to a player's mana pool
  // Patterns: "Add {G}", "Add {C}{C}", "Add one mana of any color", etc.
  const addsMana = /add\s+(?:\{[wubrgc]\}|\{[^}]+\}\{[^}]+\}|one mana|mana|[x\d]+\s+mana)/i.test(effectLower);
  
  if (!addsMana) return false;
  
  // Check if it targets (mana abilities can't target per Rule 605.1a)
  const hasTarget = /target/i.test(effectPart);
  if (hasTarget) return false;
  
  // Check if it's a loyalty ability (planeswalker abilities use +/- counters)
  // Loyalty abilities are not mana abilities even if they add mana
  const isLoyaltyAbility = /[+-]\d+:/i.test(oracleText);
  if (isLoyaltyAbility) return false;
  
  return true;
}


function hasStationActivationWindow(ctx: GameContext, playerId: PlayerID, permanent: any): boolean {
  if (!permanent?.card) return false;

  const state = ctx.state as any;
  const oracleText = String(permanent.card.oracle_text || '');
  const typeLine = String(permanent.card.type_line || '').toLowerCase();
  const keywords = Array.isArray(permanent.card.keywords) ? permanent.card.keywords : [];
  const hasStationKeyword = keywords.some((keyword: any) => String(keyword || '').toLowerCase() === 'station');
  const hasStationText = /station\s*\(/i.test(oracleText) || oracleText.toLowerCase().includes('station (');

  if (!hasStationKeyword && !hasStationText && !typeLine.includes('spacecraft') && !typeLine.includes('planet')) {
    return false;
  }

  const isTurnPlayer = String(state?.turnPlayer || state?.activePlayer || '') === String(playerId);
  const stackEmpty = !Array.isArray(state?.stack) || state.stack.length === 0;
  const phase = String(state?.phase || '').toUpperCase();
  const inMainPhase = isInMainPhase(ctx) || phase.includes('MAIN');

  if (!isTurnPlayer || !stackEmpty || !inMainPhase) {
    return false;
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((candidate: any) => {
    if (!candidate || String(candidate.id || '') === String(permanent.id || '')) return false;
    if (String(candidate.controller || '') !== String(playerId)) return false;
    return candidate.tapped !== true;
  });
}

export function hasActivatableLoyaltyAbility(
  state: any,
  battlefield: any[],
  playerId: PlayerID,
  permanent: any,
): boolean {
  if (!permanent?.card) return false;
  if (String(permanent.controller || '') !== String(playerId)) return false;

  const typeLine = String(permanent.card.type_line || '').toLowerCase();
  if (!typeLine.includes('planeswalker')) return false;

  const activationsThisTurn = (permanent as any).loyaltyActivationsThisTurn || 0;
  let maxActivations = 1;

  for (const otherPerm of battlefield) {
    if (String(otherPerm?.controller || '') !== String(playerId)) continue;

    const otherName = String(otherPerm?.card?.name || '').toLowerCase();
    const otherOracle = String(otherPerm?.card?.oracle_text || '').toLowerCase();

    if (
      otherName.includes('chain veil') ||
      (otherOracle.includes('activate') &&
        otherOracle.includes('loyalty abilities') &&
        otherOracle.includes('additional'))
    ) {
      maxActivations = 2;
      break;
    }
  }

  if (activationsThisTurn >= maxActivations) return false;

  const loyaltyString = (permanent.card as any)?.loyalty;
  const currentLoyalty =
    (permanent as any).loyaltyCounters ??
    (permanent as any).loyalty ??
    (loyaltyString ? parseInt(String(loyaltyString), 10) : 0);
  const oracleText = String(permanent.card.oracle_text || '');

  // Scryfall loyalty abilities use +N:, -N:, or 0: prefixes without brackets.
  const loyaltyPattern = /^([+−–—-]?)(\d+|X):\s*/gim;
  let match;

  while ((match = loyaltyPattern.exec(oracleText)) !== null) {
    const rawSign = match[1];
    const sign = rawSign.replace(/[−–—]/g, '-');
    const cost = match[2];

    if (sign === '+' || sign === '' || cost === '0') {
      return true;
    }

    if (sign === '-') {
      const numericCost = cost === 'X' ? 0 : parseInt(cost, 10);
      if (currentLoyalty >= numericCost) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Sacrifice-prefixed activated abilities have no tap cost, so summoning sickness
 * does not apply (Rule 302.6). Examples: Sakura-Tribe Elder, Viscera Seer.
 */
export function hasSacrificePrefixActivatedAbility(
  ctx: GameContext,
  playerId: PlayerID,
  permanent: any,
): boolean {
  if (!permanent?.card || permanent.controller !== playerId) return false;

  const { state } = ctx;
  const oracleText = String(permanent.card.oracle_text || '');
  const cardName = String(permanent.card.name || '').trim();
  const pattern = /(?:^|[\n.;]\s*)(sacrifice\s+(?:~|this\s+(?:creature|artifact|enchantment|permanent|land)|the\s+source|[^:]{1,80}?))\s*:\s*([^\n.;]+)/gi;

  for (const match of oracleText.matchAll(pattern)) {
    const costPart = String(match[1] || '').trim();
    const effectPart = String(match[2] || '').trim();
    if (!costPart || !effectPart) continue;
    if (/^(when|whenever|at\s+the\s+beginning)/i.test(costPart)) continue;

    const fullAbilityText = `${costPart}: ${effectPart}`;
    if (!isActivatedAbilityConditionMet(ctx, playerId, fullAbilityText, oracleText, match.index)) {
      continue;
    }

    if (isManaAbility(oracleText, effectPart)) continue;

    const abilityRestrictionText = `${effectPart} ${oracleText}`;
    if (/(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(abilityRestrictionText)) {
      continue;
    }

    if (!isActivatedAbilityTimingLegal(state as any, playerId, fullAbilityText, oracleText, match.index)) {
      continue;
    }

    const costLower = costPart.toLowerCase();
    const battlefield = state?.battlefield || [];

    if (/sacrifice\s+(?:~|this\s+(?:creature|artifact|enchantment|permanent|land)|the\s+source)/i.test(costLower)) {
      return true;
    }

    const primaryName = cardName.split('//')[0].trim().toLowerCase();
    if (primaryName && costLower.includes(primaryName)) {
      return true;
    }

    const genericTypeMatch = costPart.match(/sacrifice\s+(?:a|an)\s+([\w-]+)/i);
    if (genericTypeMatch) {
      const sacrificeType = String(genericTypeMatch[1] || '').toLowerCase();
      const hasTarget = battlefield.some((perm: any) => {
        if (!perm || perm.controller !== playerId) return false;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        return typeLine.includes(sacrificeType);
      });
      if (hasTarget) return true;
      continue;
    }
  }

  return false;
}

/**
 * Check if a permanent has an activated ability that can be activated
 * and requires priority (excludes mana abilities per Rule 605)
 */
function hasActivatableAbility(
  ctx: GameContext,
  playerId: PlayerID,
  permanent: any,
): boolean {
  if (!permanent || !permanent.card) return false;
  
  const { state } = ctx;
  const controller = permanent.controller;
  if (controller !== playerId) return false;
  
  const oracleText = permanent.card.oracle_text || "";
  const typeLine = (permanent.card.type_line || "").toLowerCase();

  // Chosen-name activation restrictions (e.g., Pithing Needle / Phyrexian Revoker)
  // This function only considers abilities that require priority, so treating the activation as non-mana is fine.
  if (isAbilityActivationProhibitedByChosenName(state, playerId, permanent.card?.name || '', false).prohibited) {
    return false;
  }

  if (hasStationActivationWindow(ctx, playerId, permanent)) {
    return true;
  }
  
  // Check for tap abilities: "{T}: Effect" or "{Cost}, {T}: Effect" or "{T}, Cost: Effect"
  // Common patterns: 
  // - "{T}: Add {G}" (simple tap)
  // - "{T}, Sacrifice ~: Effect" (tap + additional cost after, like fetchlands)
  // - "{2}{R}, {T}: This creature fights..." (mana + tap, like Brash Taunter)
  // Pattern allows for optional comma and text between {T} and colon
  // Using [^:]* to match any costs between {T} and : (e.g., ", Pay 1 life, Sacrifice ~")
  // This is safe because ability patterns always end with a colon before the effect
  const hasTapAbility = /\{T\}(?:\s*,?\s*[^:]*)?:/i.test(oracleText);
  
  if (hasTapAbility) {
    // Can only activate if not tapped
    if (permanent.tapped) return false;
    
    // Rule 302.6 / 702.10: Check summoning sickness for creatures with tap abilities
    // A creature can't use tap/untap abilities unless it has been continuously controlled
    // since the turn began OR it has haste (from any source).
    // Lands and non-creature permanents are NOT affected by summoning sickness.
    const isCreature = /\bcreature\b/.test(typeLine);
    const isLand = typeLine.includes("land");
    
    if (isCreature && !isLand) {
      // Check if creature has summoning sickness
      if ((permanent as any).summoningSickness) {
        // Check if creature has haste from any source
        const battlefield = state.battlefield || [];
        const hasHaste = creatureHasHaste(permanent, battlefield, playerId);
        
        if (!hasHaste) {
          return false; // Has summoning sickness and no haste - can't activate
        }
      }
    }
    
    // Match tap abilities with various cost patterns:
    // Pattern 1: "{T}, <additional>: <effect>" - tap first, then additional costs
    // Pattern 2: "<costs>, {T}: <effect>" - costs before tap (e.g., {2}{R}, {T})
    // Pattern 3: "{T}: <effect>" - simple tap only
    const abilityMatch = oracleText.match(/(?:(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*,\s*)?\{T\}(?:\s*,\s*([^:]+))?:\s*(.+)/i);
    if (!abilityMatch) {
      // Couldn't parse the tap ability pattern - be conservative and return false
      // This prevents false positives in auto-pass system
      return false;
    }
    
    const costsBeforeTap = abilityMatch[1] || ""; // Mana costs before {T}
    const additionalCostAfterTap = abilityMatch[2] || ""; // Other costs after {T}
    const effect = abilityMatch[3] || "";
    const fullAbilityText = `${[String(costsBeforeTap || '').trim(), '{T}', String(additionalCostAfterTap || '').trim()].filter(Boolean).join(', ')}: ${String(effect || '').trim()}`;

    if (!isActivatedAbilityConditionMet(ctx, playerId, fullAbilityText, oracleText, abilityMatch.index)) {
      return false;
    }
    
    // CRITICAL: Skip mana abilities - they don't use the stack and don't require priority
    // Per MTG Rule 605.3a, mana abilities can be activated whenever needed for payment
    if (isManaAbility(oracleText, effect)) {
      return false; // Mana abilities don't prevent auto-pass
    }
    
    // Timing restrictions from oracle (e.g. "only during your upkeep/turn")
    if (!isActivatedAbilityTimingLegal(state as any, playerId, fullAbilityText, oracleText, abilityMatch.index)) {
      return false;
    }
    
    // Check for mana costs BEFORE tap symbol (e.g., "{2}{R}, {T}:")
    if (costsBeforeTap) {
      const manaCostMatch = costsBeforeTap.match(/\{[^}]+\}/g);
      if (manaCostMatch) {
        const costString = manaCostMatch.join("");
        const parsedCost = parseManaCost(costString);
        if (!canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          return false; // Can't pay mana cost
        }
      }
    }
    
    // Check for mana costs AFTER tap symbol (e.g., "{T}, {2}:")
    if (additionalCostAfterTap) {
      const manaCostMatch = additionalCostAfterTap.match(/\{[^}]+\}/g);
      if (manaCostMatch) {
        const costString = manaCostMatch.join("");
        const parsedCost = parseManaCost(costString);
        if (!canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          return false; // Can't pay mana cost
        }
      }
      
      // Check for sacrifice costs - only return true if we can verify player has something to sacrifice
      if (additionalCostAfterTap.toLowerCase().includes("sacrifice")) {
        // Parse what needs to be sacrificed
        const sacrificeMatch = additionalCostAfterTap.match(/sacrifice\s+(?:a|an|this)\s*(\w+)?/i);
        if (sacrificeMatch) {
          const sacrificeType = sacrificeMatch[1] ? sacrificeMatch[1].toLowerCase() : "";
          // Check if player has appropriate permanents to sacrifice
          const battlefield = state.battlefield || [];
          const hasSacrificeable = battlefield.some((perm: any) => {
            if (perm.controller !== playerId) return false;
            if (perm.id === permanent.id && additionalCostAfterTap.toLowerCase().includes("sacrifice this")) {
              return true; // Can sacrifice itself
            }
            if (!sacrificeType) return true; // Generic sacrifice
            const permTypeLine = (perm.card?.type_line || '').toLowerCase();
            return permTypeLine.includes(sacrificeType);
          });
          if (!hasSacrificeable) {
            return false; // Can't pay sacrifice cost
          }
        }
      }
      
      // Check for life payment costs
      if (additionalCostAfterTap.toLowerCase().includes("pay") && additionalCostAfterTap.toLowerCase().includes("life")) {
        const lifeMatch = additionalCostAfterTap.match(/pay (\d+) life/i);
        if (lifeMatch) {
          const lifeCost = parseInt(lifeMatch[1], 10);
          const currentLife = state.life?.[playerId] ?? 40;
          if (currentLife < lifeCost || !canPlayerPayLife(ctx, playerId)) {
            return false; // Can't pay life cost
          }
        }
      }
    }
    
    return true;
  }
  
  // Check for "Tap N untapped [type] you control" style activation costs
  // (e.g., Lullmage Mentor: "Tap seven untapped Merfolk you control: Counter target spell.")
  // These abilities have NO {symbol} cost prefix, so they are invisible to the generic
  // activatedAbilityPattern below.  We detect them with a separate regex and verify that
  // enough matching untapped permanents exist on the battlefield.
  {
    const tapNOtherRegex = /(?:^|\n)(?:\{[^}]+\}\s*[,]?\s*)*[Tt]ap\s+(?:another\s+|other\s+)?(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?untapped\s+([a-zA-Z][\w\s]*?)\s+you\s+control\s*[,:]/gm;
    for (const tapNMatch of oracleText.matchAll(tapNOtherRegex)) {
      const rawCount = String(tapNMatch[1] || 'a').toLowerCase().trim();
      const rawType = String(tapNMatch[2] || '').toLowerCase().trim();
      const requiredCount = parseWordNumberForGraveyardCost(rawCount || 'a') || 1;
      // Normalize type: strip trailing 's' for subtype matching (e.g., "merfolks" → "merfolk")
      const normalizedType = rawType.replace(/s$/i, '').trim();
      if (!normalizedType) continue;
      const battlefield = state.battlefield || [];
      const matchingCount = battlefield.filter((p: any) => {
        if (!p || String(p.controller) !== String(playerId)) return false;
        if (p.tapped) return false;
        if (p.id === permanent.id) return false; // can't tap self as part of another cost
        const tl = String(p.card?.type_line || '').toLowerCase();
        return tl.includes(normalizedType);
      }).length;
      if (matchingCount >= requiredCount) {
        return true;
      }
    }
  }

  // Check for other activated abilities: "{Cost}: Effect"
  // Pattern: Mana symbols or other costs followed by colon
  const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,\s*\{[^}]+\})*)\s*:\s*(.+)/gi;
  const matches = [...oracleText.matchAll(activatedAbilityPattern)];
  
  for (const match of matches) {
    const costPart = match[1];
    const effectPart = match[2];
    const fullAbilityText = `${String(costPart || '').trim()}: ${String(effectPart || '').trim()}`;
    
    // Skip if this is just a mana ability we already checked
    if (costPart.includes("{T}") && hasTapAbility) continue;

    if (!isActivatedAbilityConditionMet(ctx, playerId, fullAbilityText, oracleText, match.index)) {
      continue;
    }
    
    // Skip mana abilities - they don't require priority
    if (isManaAbility(oracleText, effectPart)) {
      continue;
    }
    
    // Skip sorcery-speed abilities (Equip, Reconfigure, etc.)
    // These can only be activated during main phase when stack is empty
    const effectLower = effectPart.toLowerCase();
    
    // Equip is sorcery-speed by default (Rule 702.6a)
    // Only a few exceptions exist (Cranial Plating, Lightning Greaves in some contexts)
    // For safety, we'll consider ALL equip abilities as sorcery-speed unless explicitly stated otherwise
    if (effectLower.includes("equip") || effectLower.includes("reconfigure")) {
      continue; // Skip all equip/reconfigure abilities
    }
    
    // Skip other sorcery-speed only abilities
    // Pattern: "Activate only as a sorcery" or "Activate only any time you could cast a sorcery"
    if (/(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(oracleText)) {
      continue; // Skip sorcery-speed ability
    }
    
    // Timing restrictions from oracle (upkeep / your turn / etc.)
    if (!isActivatedAbilityTimingLegal(state as any, playerId, fullAbilityText, oracleText, match.index)) {
      continue;
    }

    // {Q} untap cost (e.g. Gilder Bairn "{2}{G/U}, {Q}: ..."): the permanent must currently
    // be TAPPED to pay the untap symbol. parseManaCost ignores {Q}, so without this gate an
    // untapped permanent would be treated as activatable based on the mana portion alone.
    if (/\{Q\}/i.test(costPart)) {
      if (!permanent.tapped) return false; // can't pay the untap cost while untapped
      // Rule 302.6: a creature's {Q}/{T} ability can't be activated under summoning sickness
      // unless it has haste. Lands and other non-creatures are exempt.
      const isCreature = /\bcreature\b/.test(typeLine);
      const isLand = typeLine.includes("land");
      if (isCreature && !isLand && (permanent as any).summoningSickness) {
        if (!creatureHasHaste(permanent, state.battlefield || [], playerId)) return false;
      }
      // Fall through to the mana-payability check below; parseManaCost(costPart) ignores {Q}.
    }

    // Parse the cost
    const parsedCost = parseManaCost(costPart);

    // Check if we can pay it
    if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
      return true;
    }
  }

  if (hasSacrificePrefixActivatedAbility(ctx, playerId, permanent)) {
    return true;
  }

  return false;
}

/**
 * Check if a card in graveyard has an activated ability that can be activated
 * Examples: Magma Phoenix, Squee, Goblin Nabob, etc.
 * 
 * IMPORTANT: This should ONLY be called for cards actually in the graveyard.
 * When a card is on the battlefield, its graveyard-only abilities should not be activatable.
 */
function hasGraveyardActivatedAbility(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
): boolean {
  if (!card || typeof card === "string") return false;

  const { state } = ctx;
  const printedUnearthInfo = getPrintedUnearthInfo(card);
  const grantedUnearthInfo = printedUnearthInfo.hasIt ? { hasIt: false } : getGrantedUnearthInfo(ctx, playerId, card);
  if (printedUnearthInfo.hasIt || grantedUnearthInfo.hasIt) {
    const currentStep = String((state as any)?.step || '').toUpperCase();
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !state.stack || state.stack.length === 0;
    const isTurnPlayer = String((state as any)?.turnPlayer || '') === String(playerId || '');
    if (!isMainPhase || !stackIsEmpty || !isTurnPlayer) {
      return false;
    }

    const unearthCost = String(printedUnearthInfo.cost || grantedUnearthInfo.cost || '').trim();
    if (!unearthCost) {
      return true;
    }

    const parsedCost = parseManaCost(unearthCost);
    return canPayManaCostWithAvailableSources(state, playerId, parsedCost);
  }

  const grantedEmbalmInfo = getGrantedEmbalmInfo(ctx, playerId, card);
  if (grantedEmbalmInfo.hasIt) {
    const currentStep = String((state as any)?.step || '').toUpperCase();
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !state.stack || state.stack.length === 0;
    const isTurnPlayer = String((state as any)?.turnPlayer || '') === String(playerId || '');
    if (!isMainPhase || !stackIsEmpty || !isTurnPlayer) {
      return false;
    }

    const embalmCost = String(grantedEmbalmInfo.cost || '').trim();
    if (!embalmCost) {
      return true;
    }

    const parsedCost = parseManaCost(embalmCost);
    return canPayManaCostWithAvailableSources(state, playerId, parsedCost);
  }
  
  const oracleText = card.oracle_text || "";
  const cardName = card.name || "this card";
  
  // Check for activated abilities that can be used from graveyard
  // Pattern: "{Cost}: [Effect]. Activate only from your graveyard"
  // OR: "{Cost}: [Effect] from your graveyard"
  // Examples:
  // - "{3}{R}{R}: Return Magma Phoenix from your graveyard to your hand."
  // - "{1}{R}: Return Squee, Goblin Nabob from your graveyard to your hand."
  
  // Look for cost patterns followed by effects that mention graveyard
  const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,?\s*\{[^}]+\})*)\s*:\s*(.+?)(?:\.|$)/gi;
  const matches = [...oracleText.matchAll(activatedAbilityPattern)];
  
  for (const match of matches) {
    const costPart = match[1];
    const effectPart = match[2];
    
    // Check if the effect mentions "from your graveyard" or "from a graveyard"
    if (!effectPart.toLowerCase().includes("graveyard")) {
      continue;
    }
    
    // Check if it's explicitly restricted to "only from your graveyard" or similar
    // or if the effect naturally works from graveyard (returns card from graveyard, etc.)
    const isGraveyardAbility = 
      /from (?:your |a )?graveyard/i.test(effectPart) ||
      /activate (?:this ability |only )?(?:only )?from (?:your |a )?graveyard/i.test(oracleText);
    
    if (!isGraveyardAbility) {
      continue;
    }
    
    // Parse the cost
    const parsedCost = parseManaCost(costPart);
    
    // Check if we can pay it
    if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
      return true;
    }
  }

  // Non-mana tap-creature costs from graveyard (Summon the School, etc.):
  // "Tap four untapped Merfolk you control: Return this card from your graveyard to your hand."
  const tapCreatureReturnMatch = String(oracleText).match(
    /tap\s+(\w+|\d+)\s+untapped\s+(\w+)s?\s+you\s+control\s*:\s*return\s+(?:this\s+card|~|it|[^.]+?)\s+from\s+(?:your\s+)?graveyard/i,
  );
  if (tapCreatureReturnMatch) {
    const tapCount = Math.max(1, parseWordNumber(tapCreatureReturnMatch[1], 1));
    const creatureType = String(tapCreatureReturnMatch[2] || '').toLowerCase();
    if (creatureType) {
      const untapped = findPermanentsWithCreatureType(
        Array.isArray(state.battlefield) ? state.battlefield : [],
        String(playerId),
        creatureType,
        true,
      );
      if (untapped.length >= tapCount) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if player can activate any abilities
 */
export function canActivateAnyAbility(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;

    // Split Second: players can't activate non-mana abilities while a split-second spell is on the stack.
    // (Mana abilities are excluded from this function already.)
    if (isSplitSecondLockActive(state)) return false;
    
    const battlefield = state.battlefield || [];
    const loyaltyAtInstantSpeed = canActivateLoyaltyAtInstantSpeed(state, playerId);
    
    // Get mana pool (floating + potential from untapped sources)
    const pool = getAvailableMana(state, playerId);
    
    // Get ignored cards for this player (for auto-pass)
    const ignoredCards = (state as any).ignoredCardsForAutoPass?.[playerId] || {};
    
    // Check each permanent on battlefield
    for (const permanent of battlefield) {
      // Skip ignored permanents - they shouldn't trigger auto-pass prompts.
      // The ignore map is keyed by `cardId || permanentId` (see socket/priority.ts), and the
      // two client affordances send different keys (table panel -> permanentId, card menu ->
      // cardId), so match BOTH the permanent id and the underlying card id.
      if (ignoredCards[permanent.id] || (permanent.card?.id && ignoredCards[permanent.card.id])) {
        debug(2, `[canActivateAnyAbility] Skipping ignored card: ${permanent.card?.name || permanent.id}`);
        continue;
      }

      if (loyaltyAtInstantSpeed && hasActivatableLoyaltyAbility(state, battlefield, playerId, permanent)) {
        return true;
      }
      
      if (hasActivatableAbility(ctx, playerId, permanent)) {
        return true;
      }
    }
    
    // Check graveyard for cards with activated abilities that can be used from there
    // IMPORTANT: Only check cards that are ACTUALLY in the graveyard, not on battlefield
    const zones = state.zones?.[playerId];
    if (zones && Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
        // Skip ignored cards in graveyard
        if (ignoredCards[card.id]) {
          debug(2, `[canActivateAnyAbility] Skipping ignored graveyard card: ${card.name || card.id}`);
          continue;
        }
        
        // Skip this card if the same object id is also on the battlefield (defensive).
        // Match by id only — name matching incorrectly suppresses singleton GY abilities.
        const cardId = String(card?.id || '').trim();
        const isOnBattlefield = Boolean(cardId) && battlefield.some((perm: any) =>
          String(perm?.card?.id || '') === cardId || String(perm?.id || '') === cardId
        );
        
        if (isOnBattlefield) {
          continue; // Card is on battlefield, don't allow graveyard abilities
        }
        
        if (hasGraveyardActivatedAbility(ctx, playerId, card)) {
          return true;
        }
      }
    }
    
    // Check exile zone for playable cards (foretold, suspended, plotted, etc.)
    if (zones && Array.isArray(zones.exile)) {
      for (const card of zones.exile as any[]) {
        // Skip ignored cards in exile
        if (ignoredCards[card.id]) {
          debug(2, `[canActivateAnyAbility] Skipping ignored exile card: ${card.name || card.id}`);
          continue;
        }
        
        if (hasExileActivatedAbility(ctx, playerId, card, pool)) {
          return true;
        }
      }
    }
    
    // Check hand for special abilities (foretell cost from hand, etc.)
    if (zones && Array.isArray(zones.hand)) {
      for (const card of zones.hand as any[]) {
        // Skip ignored cards in hand
        if (ignoredCards[card.id]) {
          debug(2, `[canActivateAnyAbility] Skipping ignored hand card: ${card.name || card.id}`);
          continue;
        }
        
        // Note: Regular casting from hand is handled in canCastAnySpell
        // This is for special hand abilities like foretelling
        if (hasHandActivatedAbility(ctx, playerId, card, pool)) {
          return true;
        }
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canActivateAnyAbility] Error:", err);
    return false;
  }
}

/**
 * Check if a card in exile has an activated ability that can be used
 */
function hasExileActivatedAbility(ctx: GameContext, playerId: PlayerID, card: any, pool: any): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Foretell - can be cast from exile for the foretell cost
  if (oracleText.includes('foretell') && card.isForetold) {
    return true;
  }
  
  // Plot - can be cast from exile without paying mana cost
  if (oracleText.includes('plot') && card.isPlotted) {
    return true;
  }
  
  // Suspend - will cast when last time counter is removed
  if (oracleText.includes('suspend') && card.isSuspended) {
    // Check if it's ready to cast (no time counters)
    if (card.timeCounters === 0) {
      return true;
    }
  }
  
  // Adventure - can cast creature from exile after adventure
  if (
    (card.layout === 'adventure' || oracleText.includes('adventure'))
    && (card.onAdventure === true || card.adventureUsed === true)
  ) {
    return true;
  }
  
  // Generic "play from exile" effects
  if (card.canPlayFromExile) {
    return true;
  }
  
  return false;
}

/**
 * Check if a card in hand has a special activated ability (not regular casting)
 */
function hasHandActivatedAbility(ctx: GameContext, playerId: PlayerID, card: any, pool: any): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Foretell - pay {2} to exile face-down
  if (oracleText.includes('foretell')) {
    // Check if player can pay {2}
    const hasTwoMana = (pool.colorless || 0) + (pool.white || 0) + (pool.blue || 0) + 
                       (pool.black || 0) + (pool.red || 0) + (pool.green || 0) >= 2;
    if (hasTwoMana) {
      return true;
    }
  }
  
  return false;
}
