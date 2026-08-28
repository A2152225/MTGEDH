/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectAttackTriggers (merged into triggers/; leftover re-exports)
 * Public: detectAttackTriggers
 */

import { hasTrainingKeyword } from "../../../../../rules-engine/src/keywordAbilities/training.js";
import { stripReminderParentheticals } from "../../../../../rules-engine/src/oracleReminderText.js";
import { getEffectivePower } from "../../../socket/util-handlers/getEffectivePowerToughness.js";
import { getContinuousGrantedAbilitiesForPermanent } from "../staticEffectSpec.js";
import { KNOWN_ATTACK_TRIGGERS } from "./card-data-tables.js";
import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import { appendAttackDetectionGeneric } from "./attack-detection-generic.js";
import { appendAttackDetectionReflexive } from "./attack-detection-reflexive.js";
import type { AttackDetectionState } from "./attack-detection-state.js";
import { appendAttackDetectionWatchers } from "./attack-detection-watchers.js";
import { findFirstRegexMatchAcrossOracleLines, timingTriggerEffect } from "./timing-effect-extraction.js";
import { escapeCardNameForRegex } from "./types.js";

/** Firebending N, or Firebending X with a following "where X is …" clause. */
const FIREBENDING_INSTANCE_PATTERN = /firebending\s+(\d+|x)(?:,\s*where\s+x\s+is\s+([^.(]+))?/gi;

function collectFirebendingMatches(text: string): RegExpMatchArray[] {
  return [...String(text || '').matchAll(new RegExp(FIREBENDING_INSTANCE_PATTERN.source, 'gi'))];
}

function resolveFirebendingAmount(
  token: string,
  whereClause: string | undefined,
  card: any,
  permanent: any,
  gameState?: any,
): number {
  const amountToken = String(token || '').trim();
  if (/^\d+$/.test(amountToken)) {
    return parseInt(amountToken, 10) || 0;
  }

  const where = String(whereClause || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const sourcePermanent = {
    ...(permanent && typeof permanent === 'object' ? permanent : {}),
    card: permanent?.card || card,
  };
  const controllerId = String(permanent?.controller || sourcePermanent.controller || '');

  if (!where || /(?:this (?:creature|permanent|card)|it)'s power$/.test(where) || /'s power$/.test(where)) {
    return Math.max(0, Number(getEffectivePower(sourcePermanent, gameState)) || 0);
  }

  if (/number of creatures you control/.test(where)) {
    const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
    return battlefield.filter((candidate: any) => {
      if (String(candidate?.controller || '') !== controllerId) return false;
      return /\bcreature\b/i.test(String(candidate?.card?.type_line || candidate?.type_line || ''));
    }).length;
  }

  if (/experience counters you have/.test(where)) {
    const experience = gameState?.experienceCounters?.[controllerId] ?? gameState?.experience?.[controllerId] ?? 0;
    return Math.max(0, Number(experience) || 0);
  }

  return 0;
}

function pushFirebendingTrigger(
  triggers: TriggeredAbility[],
  args: { permanentId: string; cardName: string; amount: number },
): void {
  const n = args.amount;
  if (!(n > 0)) return;
  const effectText = `Add ${'{R}'.repeat(n)}. This mana lasts until end of combat.`;
  triggers.push({
    permanentId: args.permanentId,
    cardName: args.cardName,
    triggerType: 'firebending',
    description: effectText,
    effect: effectText,
    value: { amount: n },
    mandatory: true,
    requiresTarget: false,
  });
}

/**
 * Detect attack triggers from a permanent's abilities
 */
export function detectAttackTriggers(card: any, permanent: any, gameState?: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const printedOracle = stripReminderParentheticals(String(card?.oracle_text || ""));
  const continuousGranted = gameState
    ? getContinuousGrantedAbilitiesForPermanent(permanent, gameState)
    : [];
  const abilityLikeGranted = continuousGranted.filter((entry) => (
    /when(?:ever)?\b|at the |:/.test(String(entry || ''))
  ));
  const oracleText = abilityLikeGranted.length > 0
    ? `${printedOracle}\n${abilityLikeGranted.join('\n')}`
    : printedOracle;
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  const grantedAbilities = [
    ...(Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : []),
    ...continuousGranted,
  ];
  const temporaryAbilities = Array.isArray(permanent?.temporaryAbilities)
    ? permanent.temporaryAbilities
        .map((entry: any) => (typeof entry === 'string' ? entry : entry?.ability))
        .filter((ability: any) => typeof ability === 'string' && ability.trim().length > 0)
    : [];
  const supplementalAbilityText = [...grantedAbilities, ...temporaryAbilities].map((ability) => String(ability || '')).join('\n').toLowerCase();

  const optionalManaPaymentPattern = /you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*(?:if|when) you do,?\s*(.+)/i;

  const attackKeywordReminderLinePattern = /^(?:annihilator\s+\d+|firebending\s+(?:\d+|x(?:,\s*where x is [^.]+)?)|melee|myriad|exalted|battle cry|dethrone|mentor|training)\b/i;

  const attackNameVariants = buildCardNameRegexAlternatives(cardName);
  const attackSubjectPattern = `(?:~|this creature(?:\\s+or\\s+equipped creature)?|this vehicle|this artifact|this land|this permanent|(?:${attackNameVariants.join('|')})|equipped creature|enchanted creature)`;

  const findGenericAttackTriggerLine = (): RegExpMatchArray | null =>
    findFirstRegexMatchAcrossOracleLines(
      oracleText,
      (line) => attackKeywordReminderLinePattern.test(line),
      [
        new RegExp(`whenever\\s+${attackSubjectPattern}\\s+attacks?,?\\s*(.+)$`, 'i'),
        new RegExp(`when\\s+${attackSubjectPattern}\\s+attacks?,?\\s*(.+)$`, 'i'),
        /whenever\s+equipped\s+creature\s+attacks,?\s*(.+)$/i,
        /whenever\s+enchanted\s+creature\s+attacks,?\s*(.+)$/i,
        /whenever\s+this\s+land\s+attacks,?\s*(.+)$/i,
      ],
    );
  
  // Known-card table is attack-trigger lookup only. Activated put-from-hand
  // (Elvish Piper) is IR `move_zone`, not a fake `attacks` trigger.
  for (const [knownName, info] of Object.entries(KNOWN_ATTACK_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      // Supported "you may exert as it attacks" rewards are queued as an exert
      // OPTION_CHOICE, not as a mandatory attack trigger from the known-card table.
      if (/^exert\b/i.test(String(info.effect || '')) && /you may exert/i.test(oracleText)) {
        continue;
      }

      const trigger: TriggeredAbility = {
        permanentId,
        cardName,
        controllerId,
        triggerType: 'attacks',
        description: info.effect,
        effect: info.effect,
        value: info.value,
        mandatory: true,
      };

      // Some known-card entries encode optional mana payments (e.g. Casal):
      // "You may pay {1}{G}. If you do, transform her."
      // Treat these as optional prompts rather than mandatory auto-effects.
      const maybeOptionalPayment = String(info.effect || '').match(optionalManaPaymentPattern);
      if (maybeOptionalPayment) {
        (trigger as any).manaCost = maybeOptionalPayment[1];
        trigger.effect = String(maybeOptionalPayment[2] || '').trim();
        trigger.mandatory = false;
      }
      
      // Add create tokens based on count data (for Myrel, Shield of Argive, etc.)
      if (info.createTokensBasedOnCount) {
        trigger.createTokensBasedOnCount = info.createTokensBasedOnCount;
      }
      
      // Add put from hand data (for Preeminent Captain, etc.)
      if (info.putFromHand) {
        trigger.putFromHand = info.putFromHand;
        trigger.tappedAndAttacking = info.tappedAndAttacking;
        trigger.putCreatureType = info.putCreatureType;
      }
      
      // Add create tokens data (for fixed count token creation)
      if (info.createTokens) {
        trigger.createTokens = info.createTokens;
      }
      
      triggers.push(trigger);
    }
  }
  
  // Annihilator N
  const annihilatorMatch = oracleText.match(/annihilator\s+(\d+)/i);
  if (annihilatorMatch) {
    const n = parseInt(annihilatorMatch[1], 10);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'annihilator',
      description: `Defending player sacrifices ${n} permanent${n > 1 ? 's' : ''}`,
      value: n,
      mandatory: true,
      requiresTarget: false,
    });
  }

  // Firebending N / Firebending X — Avatar mechanic. Native text plus granted
  // or temporary instances stack. X is resolved from the "where X is …" clause
  // (this creature's power, creatures you control, experience counters).
  const firebendingMatches = [
    ...collectFirebendingMatches(oracleText),
    ...collectFirebendingMatches(supplementalAbilityText),
  ];
  for (const firebendingMatch of firebendingMatches) {
    pushFirebendingTrigger(triggers, {
      permanentId,
      cardName,
      amount: resolveFirebendingAmount(
        String(firebendingMatch[1] || ''),
        firebendingMatch[2],
        card,
        permanent,
        gameState,
      ),
    });
  }
  
  // Melee
  if (lowerOracle.includes("melee")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'melee',
      description: "+1/+1 for each opponent you attacked this combat",
      mandatory: true,
    });
  }
  
  // Myriad
  if (lowerOracle.includes("myriad")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'myriad',
      description: "Create token copies attacking each other opponent",
      mandatory: true,
    });
  }
  
  // Exalted (triggers when a creature attacks alone)
  if (lowerOracle.includes("exalted")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exalted',
      description: "+1/+1 to attacking creature (when attacking alone)",
      mandatory: true,
    });
  }

  // Dethrone
  if (lowerOracle.includes("dethrone")) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'dethrone',
      description: 'Put a +1/+1 counter on this creature if attacking the player with the most life',
      mandatory: true,
    });
  }

  // Battle Cry
  if (lowerOracle.includes("battle cry")) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'battle_cry',
      description: 'Each other attacking creature gets +1/+0 until end of turn',
      mandatory: true,
    });
  }

  // Mentor
  if (lowerOracle.includes("mentor")) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'mentor',
      description: 'Put a +1/+1 counter on target attacking creature with lesser power',
      mandatory: true,
    });
  }

  // Training
  if (hasTrainingKeyword(card)) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'training',
      description: 'Put a +1/+1 counter on this creature if attacking with another creature with greater power',
      mandatory: true,
    });
  }

  const attacksWithGreaterPowerMatch = oracleText.match(
    /whenever this creature attacks with another creature with greater power,?\s*([^.]+)/i,
  );
  if (
    attacksWithGreaterPowerMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'attacks_with_greater_power_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, attacksWithGreaterPowerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attacks_with_greater_power_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  
  const battalionSubject = `(?:~|this(?: creature)?|${escapeCardNameForRegex(cardName)})`;
  const battalionPattern = new RegExp(
    `whenever\\s+${battalionSubject}\\s+(?:and at least two other creatures attack|attacks and at least two other creatures attack),?\\s*([^.]+)`,
    'i',
  );
  const battalionMatch = oracleText.match(battalionPattern);
  if (battalionMatch && !triggers.some((trigger) => trigger.triggerType === 'battalion')) {
    const effectText = timingTriggerEffect(oracleText, battalionMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'battalion',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const state: AttackDetectionState = {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    lowerName,
    permanentId,
    controllerId,
    optionalManaPaymentPattern,
    attackNameVariants,
    findGenericAttackTriggerLine,
    card,
    permanent,
  };
  appendAttackDetectionGeneric(state);
  appendAttackDetectionWatchers(state);
  appendAttackDetectionReflexive(state);

  return triggers;
}
