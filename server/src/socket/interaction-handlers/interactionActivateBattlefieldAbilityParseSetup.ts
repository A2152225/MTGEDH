/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility other-ability parse / setup
 * (cost, sacrifice type, power-up, exhaust, timing, boast guards).
 *
 * Public entry symbols: trySetupActivateBattlefieldAbilityParse,
 * ActivateBattlefieldAbilityParseState.
 */

import { parseSacrificeCost, type SacrificeType } from "../../../../shared/src/textUtils";
import { isSacrificeCreatureOfChosenTypeCost } from "../../state/modules/chosen-creature-type.js";
import { detectUtilityLandAbility } from "../../state/modules/triggered-abilities";
import { checkOpponentHasMoreLands } from "../../state/modules/stackLandCountUtils.js";
import { hasPendingManaColorSelectionForPermanent } from "../../state/modules/manaColorSelectionStepUtils.js";
import {
  isOnceDuringEachOfYourTurnActivatedEffect,
  hasUsedOnceDuringEachActivatedAbilityThisTurn,
  hasOncePerTurnActivatedAbilityPendingOnStack,
  isRecognizedActivatedAbilityCostText,
} from "../../../../rules-engine/src/stationPermanentUtils.js";
import { getActiveAbilityConditions } from "../../state/modules/game-state-effects.js";
import { detectActivatedAbilityConditionRequirement } from "../../state/modules/activated-ability-conditions.js";
import { detectActivationTimingRestriction, isActivatedAbilityTimingLegal } from "../../state/modules/activation-timing.js";
import {
  hasActivatedExhaustAbility,
  isExhaustAbilityText,
} from "../../state/modules/keywordActivationState.js";
import {
  applyPowerUpEnteredThisTurnDiscount,
  applyPowerUpActivationCostReductions,
  hasUsedPowerUpAbility,
  parsePowerUpActivatedAbility,
} from "../../state/modules/marvelMechanicsHelpers.js";
import { debug } from "../../utils/debug.js";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import {
  costRequiresSelfExert,
  extractActivatedAbilitiesFromText,
  getActivatedAbilityConditionErrorPayload,
  resolveThresholdRestrictedActivatedAbility,
} from "./interactionActivateBattlefieldAbilityHelpers.js";

export type ActivateBattlefieldAbilityParseState = {
  abilityText: string;
  requiresTap: boolean;
  requiresUntap: boolean;
  manaCost: string;
  requiresSelfExert: boolean;
  sacrificeType: SacrificeType | null;
  sacrificeSubtype: string | undefined;
  sacrificeCount: number;
  mustBeOther: boolean;
  isPowerUpActivation: boolean;
  powerUpAbilityIndex: number;
  selectedAbilityIndex: number;
  selectedAbilityFullText: string;
  selectedAbilityOracleLine: string;
  isExhaustActivation: boolean;
  abilityConditionText: string;
  isBoastAbility: boolean;
  oncePerTurnActivatedEffect: string;
};

export function trySetupActivateBattlefieldAbilityParse(
  ctx: ActivateBattlefieldAbilityContext,
  out: ActivateBattlefieldAbilityParseState,
): boolean {
  const {
    socket,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    permanent,
    card,
    cardName,
    oracleText,
    scopedAbilityFullText,
  } = ctx;

  // Handle other activated abilities - put them on the stack
  debug(2, `[activateBattlefieldAbility] Processing ability ${abilityId} on ${cardName}`);
  
  // Parse the ability from oracle text if possible
  // Ability ID format is: "{cardId}-{abilityType}-{index}" e.g., "card123-ability-0" or "card123-mana-r-0"
  // Extract the ability index from the end of the abilityId
  let abilityIndex = 0;
  const abilityMatch = abilityId.match(/-(\d+)$/);
  if (abilityMatch) {
    abilityIndex = parseInt(abilityMatch[1], 10);
    if (isNaN(abilityIndex)) abilityIndex = 0;
  }
  const isBoastAbility = /-boast-\d+$/i.test(String(abilityId || ''));
  
  // Extract ability text by parsing oracle text for activated abilities
  let abilityText = "";
  let requiresTap = false;
  let requiresUntap = false; // {Q} untap symbol in the activation cost
  let manaCost = "";
  let requiresSelfExert = false;
  let sacrificeType: 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent' | 'nonland_permanent' | 'self' | 'artifact_or_creature' | null = null;
  let sacrificeSubtype: string | undefined = undefined; // For creature subtypes like Soldier, Goblin, etc.
  let sacrificeCount = 1;
  let mustBeOther = false;
  let requiredChargeCounters: number | null = null;
  let isPowerUpActivation = false;
  let powerUpAbilityIndex = -1;
  const abilityOracleText = String(scopedAbilityFullText || oracleText || '').trim();
  const selectedAbilityIndex = scopedAbilityFullText && scopedAbilityFullText.trim() && scopedAbilityFullText.trim() !== String(oracleText || '').trim()
    ? 0
    : abilityIndex;
  
  // Preserve full same-line effect text for multi-sentence activated abilities such as
  // Confession Dial's granted escape clause.
  const abilities = extractActivatedAbilitiesFromText(abilityOracleText);
  
  if (selectedAbilityIndex < abilities.length) {
    const ability = abilities[selectedAbilityIndex];
    const thresholdRestrictedAbility = resolveThresholdRestrictedActivatedAbility(ability);
    const normalizedCost = thresholdRestrictedAbility?.cost || ability.cost;
    abilityText = thresholdRestrictedAbility?.effect || ability.effect;
    // Only treat the ability as requiring the SOURCE to tap when the cost includes an explicit tap symbol
    // (or the old-style "Tap:" shorthand). Do NOT match "Tap an untapped creature you control" etc.
    requiresTap = /\{t\}/i.test(normalizedCost) || /^\s*tap\s*:/i.test(normalizedCost);
    // {Q} is the untap symbol: paying this cost untaps the source. The permanent must be
    // tapped before the ability can be activated (you can only untap something that is tapped).
    requiresUntap = /\{Q\}/i.test(normalizedCost);
    manaCost = normalizedCost;
    requiresSelfExert = costRequiresSelfExert(normalizedCost);
    requiredChargeCounters = thresholdRestrictedAbility?.threshold ?? null;
    
    // Detect sacrifice type from cost using shared utility
    const sacrificeInfo = parseSacrificeCost(normalizedCost);
    if (sacrificeInfo.requiresSacrifice && sacrificeInfo.sacrificeType) {
      sacrificeType = sacrificeInfo.sacrificeType;
      sacrificeSubtype = sacrificeInfo.creatureSubtype;
      sacrificeCount = sacrificeInfo.sacrificeCount || 1;
      mustBeOther = Boolean(sacrificeInfo.mustBeOther);
    }

    if (
      /^choose a color\.?$/i.test(String(abilityText || '').trim()) &&
      /add\s+an\s+amount\s+of\s+mana\s+of\s+that\s+color/i.test(oracleText)
    ) {
      const fullChooseColorManaMatch = oracleText.match(
        /choose a color\.\s*add\s+an\s+amount\s+of\s+mana\s+of\s+that\s+color[^.]*\./i
      );
      if (fullChooseColorManaMatch) {
        abilityText = fullChooseColorManaMatch[0].trim();
      }
    }
  } else {
    // FALLBACK: If parsing failed or abilityIndex is out of range, try to extract ability text from oracle
    // For cards with a single activated ability or when the client sends an unrecognized abilityId,
    // use the full oracle text to detect if it's a mana ability
    // This fixes double-clicking lands and creatures with mana abilities
    debug(1, `[activateBattlefieldAbility] Ability parsing failed or index out of range (${selectedAbilityIndex}/${abilities.length}), using oracle text as fallback`);
    
    // If there's only one ability parsed, use it
    if (abilities.length === 1) {
      const ability = abilities[0];
      const thresholdRestrictedAbility = resolveThresholdRestrictedActivatedAbility(ability);
      const normalizedCost = thresholdRestrictedAbility?.cost || ability.cost;
      abilityText = thresholdRestrictedAbility?.effect || ability.effect;
      requiresTap = /\{t\}/i.test(normalizedCost) || /^\s*tap\s*:/i.test(normalizedCost);
      manaCost = normalizedCost;
      requiresSelfExert = costRequiresSelfExert(normalizedCost);
      requiredChargeCounters = thresholdRestrictedAbility?.threshold ?? null;
      
      const sacrificeInfo = parseSacrificeCost(normalizedCost);
      if (sacrificeInfo.requiresSacrifice && sacrificeInfo.sacrificeType) {
        sacrificeType = sacrificeInfo.sacrificeType;
        sacrificeSubtype = sacrificeInfo.creatureSubtype;
        sacrificeCount = sacrificeInfo.sacrificeCount || 1;
        mustBeOther = Boolean(sacrificeInfo.mustBeOther);
      }
    } else {
      // Use the full oracle text to check if this is a mana ability
      // This handles simple cases like basic lands: "{T}: Add {G}"
      abilityText = abilityOracleText;
      requiresTap = abilityOracleText.includes('{T}:') || abilityOracleText.toLowerCase().includes('tap:');
    }
  }

  const powerUpLineText = String(scopedAbilityFullText || selectedAbilityIndex < abilities.length
    ? abilities[selectedAbilityIndex]?.fullText
    : abilityOracleText || '').trim();
  const powerUpInfo = parsePowerUpActivatedAbility(powerUpLineText);
  if (powerUpInfo) {
    powerUpAbilityIndex = selectedAbilityIndex < abilities.length ? selectedAbilityIndex : abilityIndex;
    if (hasUsedPowerUpAbility(permanent, powerUpAbilityIndex)) {
      socket.emit('error', {
        code: 'POWER_UP_ALREADY_USED',
        message: `Each power-up ability on ${cardName} can only be activated once.`,
      });
      return true;
    }
    isPowerUpActivation = true;
    abilityText = powerUpInfo.effectText;
    manaCost = applyPowerUpEnteredThisTurnDiscount(powerUpInfo.manaCost, permanent);
    manaCost = applyPowerUpActivationCostReductions(manaCost, game.state, pid, String(permanent?.id || ''));
    requiresTap = false;
    requiresUntap = false;
    requiresSelfExert = false;
    sacrificeType = null;
    sacrificeSubtype = undefined;
    sacrificeCount = 1;
    mustBeOther = false;
    requiredChargeCounters = null;
  }

  const selectedAbilityFullText = selectedAbilityIndex < abilities.length
    ? String(abilities[selectedAbilityIndex]?.fullText || `${abilities[selectedAbilityIndex]?.cost || ''}: ${abilities[selectedAbilityIndex]?.effect || ''}`).trim()
    : String(abilityOracleText || '').trim();
  const selectedAbilityOracleLine = (() => {
    const rawLines = String(abilityOracleText || '')
      .split(/\r?\n/)
      .map((line) => String(line || '').trim())
      .filter((line) => line.length > 0);
    const activatedLines = rawLines.filter((line) => {
      if (/^\d+\+\s*\|/.test(line)) {
        return true;
      }
      const colonIndex = line.indexOf(':');
      if (colonIndex <= 0) {
        return false;
      }
      return isRecognizedActivatedAbilityCostText(line.slice(0, colonIndex));
    });
    return selectedAbilityIndex < activatedLines.length
      ? String(activatedLines[selectedAbilityIndex] || '').trim()
      : selectedAbilityFullText;
  })();
  const isExhaustActivation = isExhaustAbilityText(selectedAbilityOracleLine);
  if (isExhaustActivation && hasActivatedExhaustAbility(game.state, permanentId, selectedAbilityIndex)) {
    socket.emit('error', {
      code: 'EXHAUST_ALREADY_ACTIVATED',
      message: `That Exhaust ability on ${cardName} has already been activated this turn.`,
    });
    return true;
  }

  if (
    isSacrificeCreatureOfChosenTypeCost(selectedAbilityFullText)
    || isSacrificeCreatureOfChosenTypeCost(selectedAbilityOracleLine)
  ) {
    sacrificeType = 'creature';
    sacrificeCount = sacrificeCount || 1;
    const chosenType = String((permanent as any)?.chosenCreatureType || '').trim();
    if (!chosenType) {
      socket.emit('error', {
        code: 'NO_CHOSEN_TYPE',
        message: `${cardName} has no chosen creature type yet.`,
      });
      return true;
    }
    sacrificeSubtype = chosenType;
  }

  const selectedAbilityMatchIndex = selectedAbilityIndex < abilities.length
    ? (() => {
        const parsedFullText = String(abilities[selectedAbilityIndex]?.fullText || '').trim();
        if (!parsedFullText) {
          return undefined;
        }
        const matchIndex = oracleText.indexOf(parsedFullText);
        return matchIndex >= 0 ? matchIndex : undefined;
      })()
    : undefined;

  const selectedAbilityRequirement = detectActivatedAbilityConditionRequirement(
    selectedAbilityFullText,
    oracleText,
    selectedAbilityMatchIndex,
  );
  if (selectedAbilityRequirement) {
    const activeConditions = getActiveAbilityConditions(game as any, pid);
    if (!activeConditions[selectedAbilityRequirement.key]) {
      socket.emit('error', getActivatedAbilityConditionErrorPayload(selectedAbilityRequirement, game, pid, cardName));
      return true;
    }
  }

  if (requiredChargeCounters !== null) {
    const currentChargeCounters = Number((permanent as any)?.counters?.charge || 0);
    if (currentChargeCounters < requiredChargeCounters) {
      socket.emit('error', {
        code: 'ACTIVATION_CONDITION_NOT_MET',
        message: `${cardName}'s selected ability requires ${requiredChargeCounters}+ charge counters.`,
      });
      return true;
    }
  }

  const oncePerTurnActivatedEffect = String(
    selectedAbilityFullText || abilityText || '',
  ).trim();
  if (isOnceDuringEachOfYourTurnActivatedEffect(oncePerTurnActivatedEffect)) {
    if (hasUsedOnceDuringEachActivatedAbilityThisTurn(permanent, selectedAbilityIndex)) {
      socket.emit('error', {
        code: 'ABILITY_ALREADY_USED',
        message: `${cardName}'s selected ability can only be activated once during each of your turns.`,
      });
      return true;
    }

    const stackItems = Array.isArray(game.state?.stack) ? game.state.stack : [];
    if (hasOncePerTurnActivatedAbilityPendingOnStack(stackItems, String(permanentId), selectedAbilityIndex)) {
      socket.emit('error', {
        code: 'ABILITY_ALREADY_USED',
        message: `${cardName}'s selected ability is already on the stack.`,
      });
      return true;
    }

    const alreadyCastFromGraveyard = Boolean((game.state as any)?.castFromGraveyardThisTurn?.[pid]);
    if (
      alreadyCastFromGraveyard
      && /\bfrom your graveyard\b/i.test(oncePerTurnActivatedEffect)
    ) {
      socket.emit('error', {
        code: 'ABILITY_ALREADY_USED',
        message: `${cardName}'s selected ability can only be used once during each of your turns.`,
      });
      return true;
    }
  }
  
  // Validate: if ability requires tap ({T}), permanent must not be tapped
  if (requiresTap && (permanent as any).tapped) {
    socket.emit("error", {
      code: "ALREADY_TAPPED",
      message: `${cardName} is already tapped`,
    });
    return true;
  }

  if (hasPendingManaColorSelectionForPermanent(gameId, String(permanentId), String(pid))) {
    socket.emit("error", {
      code: "RESOLUTION_PENDING",
      message: `${cardName} already has a pending mana color choice. Finish that prompt before activating again.`,
    });
    return true;
  }

  // Validate: if ability requires untap ({Q}), permanent must currently be tapped
  // (the {Q} symbol pays the cost by untapping the source)
  if (requiresUntap && !(permanent as any).tapped) {
    socket.emit("error", {
      code: "NOT_TAPPED",
      message: `${cardName} is not tapped — the {Q} untap cost requires it to be tapped first.`,
    });
    return true;
  }
  
  // Check for activation conditions (e.g., Minas Tirith: "Activate only if you attacked with two or more creatures this turn")
  const utilityLandAbility = detectUtilityLandAbility(card, permanent);
  if (utilityLandAbility?.activationCondition) {
    if (utilityLandAbility.activationCondition === 'attacked_with_two_or_more') {
      const creaturesAttacked = (game.state as any).creaturesAttackedThisTurn?.[pid] || 0;
      if (creaturesAttacked < 2) {
        socket.emit("error", {
          code: "ACTIVATION_CONDITION_NOT_MET",
          message: `${cardName}'s ability can only be activated if you attacked with two or more creatures this turn. (You attacked with ${creaturesAttacked})`,
        });
        return true;
      }
    }
  }
  
  // Also check oracle text for "activate only if" patterns dynamically
  // IMPORTANT: Check the specific ability text (abilityText) for the condition,
  // as the card may have multiple abilities and only some have restrictions.
  // For Minas Tirith:
  // - Ability 0: "{T}: Add {W}" - no restriction
  // - Ability 1: "{1}{W}, {T}: Draw a card. Activate only if you attacked with two or more creatures this turn."
  // The condition check should match against the full oracle text for ability index, or the specific ability text
  let abilityHasCondition = false;
  let abilityConditionText = '';
  
  // First, check if we're activating a specific ability that has the condition
  if (selectedAbilityIndex >= 0 && abilities.length > selectedAbilityIndex) {
    // Get the full ability text including any conditions following it in oracle text
    // Since the parsing might not capture the full line, look for the ability cost pattern in oracle text
    const costRegex = new RegExp(`${abilities[selectedAbilityIndex].cost.replace(/[{}]/g, '\\$&').replace(/[[\]\\^$.|?*+()]/g, '\\$&')}[^\\n]+`, 'i');
    const fullAbilityMatch = oracleText.match(costRegex);
    abilityConditionText = fullAbilityMatch ? fullAbilityMatch[0] : abilityText;
  } else {
    abilityConditionText = oracleText;
  }
  
  const activateOnlyIfMatch = abilityConditionText.match(/activate only if you attacked with (\w+) or more creatures this turn/i);
  if (activateOnlyIfMatch && !utilityLandAbility?.activationCondition) {
    const requiredCount = activateOnlyIfMatch[1] === 'two' ? 2 : 
                         activateOnlyIfMatch[1] === 'three' ? 3 : 
                         parseInt(activateOnlyIfMatch[1], 10) || 2;
    const creaturesAttacked = (game.state as any).creaturesAttackedThisTurn?.[pid] || 0;
    if (creaturesAttacked < requiredCount) {
      socket.emit("error", {
        code: "ACTIVATION_CONDITION_NOT_MET",
        message: `${cardName}'s ability can only be activated if you attacked with ${requiredCount} or more creatures this turn. (You attacked with ${creaturesAttacked})`,
      });
      return true;
    }
    abilityHasCondition = true;
  }

  if (/activate only if an opponent controls more lands than you/i.test(abilityConditionText)) {
    const { anyOpponentHasMoreLands, myLandCount } = checkOpponentHasMoreLands(game.state, pid);
    if (!anyOpponentHasMoreLands) {
      socket.emit("error", {
        code: "ACTIVATION_CONDITION_NOT_MET",
        message: `${cardName}'s ability can only be activated if an opponent controls more lands than you. (You control ${myLandCount})`,
      });
      return true;
    }
    abilityHasCondition = true;
  }

  // Timing windows from oracle ("Activate only during your upkeep/turn", etc.)
  {
    const timingSource = String(abilityConditionText || abilityText || oracleText || '');
    const timingRestriction = detectActivationTimingRestriction(timingSource);
    if (timingRestriction && !isActivatedAbilityTimingLegal(game.state as any, pid, timingSource, timingSource)) {
      const timingLabel =
        timingRestriction === 'your_upkeep' ? 'during your upkeep' :
        timingRestriction === 'opponent_upkeep' ? "during an opponent's upkeep" :
        timingRestriction === 'your_turn' ? 'during your turn' :
        timingRestriction === 'sorcery' ? 'any time you could cast a sorcery' :
        'at the correct time';
      socket.emit("error", {
        code: "ACTIVATION_TIMING",
        message: `${cardName}'s ability can only be activated ${timingLabel}.`,
      });
      return true;
    }
  }
  
  // Log successful activation condition check for debugging
  if (abilityHasCondition || (utilityLandAbility?.activationCondition === 'attacked_with_two_or_more')) {
    const creaturesAttacked = (game.state as any).creaturesAttackedThisTurn?.[pid] || 0;
    debug(2, `[activateBattlefieldAbility] ${cardName} activation condition met: attacked with ${creaturesAttacked} creatures this turn`);
  }

  if (isBoastAbility) {
    const attackedThisTurn = (permanent as any)?.attackedThisTurn === true || !!(permanent as any)?.attacking || (permanent as any)?.isAttacking === true;
    if (!attackedThisTurn) {
      socket.emit('error', {
        code: 'ACTIVATION_CONDITION_NOT_MET',
        message: `${cardName}'s boast ability can only be activated if it attacked this turn.`,
      });
      return true;
    }

    if ((permanent as any)?.activatedThisTurn === true) {
      socket.emit('error', {
        code: 'ABILITY_ALREADY_USED',
        message: `${cardName}'s boast ability has already been activated this turn.`,
      });
      return true;
    }
  }
  out.abilityText = abilityText;
  out.requiresTap = requiresTap;
  out.requiresUntap = requiresUntap;
  out.manaCost = manaCost;
  out.requiresSelfExert = requiresSelfExert;
  out.sacrificeType = sacrificeType;
  out.sacrificeSubtype = sacrificeSubtype;
  out.sacrificeCount = sacrificeCount;
  out.mustBeOther = mustBeOther;
  out.isPowerUpActivation = isPowerUpActivation;
  out.powerUpAbilityIndex = powerUpAbilityIndex;
  out.selectedAbilityIndex = selectedAbilityIndex;
  out.selectedAbilityFullText = selectedAbilityFullText;
  out.selectedAbilityOracleLine = selectedAbilityOracleLine;
  out.isExhaustActivation = isExhaustActivation;
  out.abilityConditionText = abilityConditionText;
  out.isBoastAbility = isBoastAbility;
  out.oncePerTurnActivatedEffect = oncePerTurnActivatedEffect;
  return false;
}
