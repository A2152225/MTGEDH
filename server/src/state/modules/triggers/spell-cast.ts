import type { GameContext } from "../../context.js";
import { timingTriggerEffect } from './timing-effect-extraction.js';
import { aOrAnSpellType } from '../../../../../rules-engine/src/indefiniteArticle.js';
import type { SpellCastUntapEffect } from "./types.js";
import { detectSpellCastTriggers } from "./spell-cast-detection.js";
import { getSpellCastTriggers } from "./spell-cast-get-triggers.js";
import type { SpellCastTrigger } from "./spell-cast-trigger-type.js";

export type { SpellCastUntapEffect } from "./types.js";
export type { SpellCastTrigger } from "./spell-cast-trigger-type.js";
export { detectSpellCastTriggers, getSpellCastTriggers };

// ============================================================================
// Spell-Cast Untap Triggers (Jeskai Ascendancy, Paradox Engine)
// ============================================================================

/**
 * Detect spell-cast untap triggers
 */
export function detectSpellCastUntapEffects(card: any, permanent: any): SpellCastUntapEffect[] {
  const effects: SpellCastUntapEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever you cast a spell, untap all nonland permanents you control" (Paradox Engine)
  if (oracleText.includes('whenever you cast a spell') && 
      oracleText.includes('untap all nonland permanents')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a spell, untap all nonland permanents you control",
      effectType: 'untap_all_nonland',
      spellCondition: 'any',
    });
  }
  
  // "Whenever you cast a noncreature spell" + "untap" (Jeskai Ascendancy pattern)
  if (oracleText.includes('whenever you cast a noncreature spell') && 
      oracleText.includes('untap')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a noncreature spell, untap creatures you control",
      effectType: 'untap_all_creatures',
      spellCondition: 'noncreature',
    });
  }
  
  // Generic "whenever you cast" + "untap" pattern
  const castUntapMatch = oracleText.match(/whenever you cast (?:a |an )?(\w+)?\s*spell[^.]*untap/i);
  if (castUntapMatch && !effects.length) {
    const spellType = castUntapMatch[1]?.toLowerCase() || 'any';
    let spellCondition: SpellCastUntapEffect['spellCondition'] = 'any';
    if (spellType === 'noncreature') spellCondition = 'noncreature';
    else if (spellType === 'instant' || spellType === 'sorcery') spellCondition = 'instant_sorcery';
    
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast ${aOrAnSpellType(spellType)}, untap`,
      effectType: 'untap_all_nonland',
      spellCondition,
    });
  }
  
  return effects;
}

/**
 * Get spell-cast untap effects for a player casting a spell
 */
export function getSpellCastUntapEffects(
  ctx: GameContext,
  casterId: string,
  spellCard: any
): SpellCastUntapEffect[] {
  const effects: SpellCastUntapEffect[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.controller !== casterId) continue;
    
    const permEffects = detectSpellCastUntapEffects(permanent.card, permanent);
    
    for (const effect of permEffects) {
      let shouldTrigger = false;
      
      switch (effect.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'noncreature':
          shouldTrigger = !isCreatureSpell;
          break;
        case 'instant_sorcery':
          shouldTrigger = isInstantOrSorcery;
          break;
      }
      
      if (shouldTrigger) {
        effects.push(effect);
      }
    }
  }
  
  return effects;
}

/**
 * Apply a spell-cast untap effect
 */
export function applySpellCastUntapEffect(ctx: GameContext, effect: SpellCastUntapEffect): number {
  const battlefield = ctx.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.tapped) continue;
    if (permanent.controller !== effect.controllerId) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    let shouldUntap = false;
    
    switch (effect.effectType) {
      case 'untap_all_nonland':
        shouldUntap = !typeLine.includes('land');
        break;
      case 'untap_all_creatures':
        shouldUntap = typeLine.includes('creature');
        break;
      case 'untap_equipped':
        shouldUntap = false;
        break;
    }
    
    if (shouldUntap) {
      permanent.tapped = false;
      untappedCount++;
    }
  }
  
  if (untappedCount > 0) {
    ctx.bumpSeq();
  }
  
  return untappedCount;
}

// ============================================================================
// General Spell-Cast Triggered Abilities
// ============================================================================

// detectSpellCastTriggers lives in spell-cast-detection.ts (leftover-merged).

// getSpellCastTriggers lives in spell-cast-get-triggers.ts (leftover-merged).

// ============================================================================
// Opponent Spell Cast Triggers (Esper Sentinel, Rhystic Study, Mystic Remora)
// ============================================================================

/**
 * Opponent spell cast trigger type - cards that trigger when opponents cast spells
 */
export interface OpponentSpellCastTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;  // Who controls the permanent (gets the benefit)
  casterId: string;      // Who cast the spell (the opponent)
  description: string;
  effect: string;
  triggerType: OpponentCastTriggerType;
  paymentCost?: string;  // What the caster can pay to prevent the effect
  paymentAmount?: number; // X value for variable payments (Esper Sentinel)
  benefitIfNotPaid: string; // Effect if opponent doesn't pay
  mandatory: boolean;
  sourceZoneRequirement?: OpponentCastSourceZone;
}

/**
 * Detect opponent spell cast triggers from a permanent's abilities
 * These are permanents that trigger when an OPPONENT casts a spell
 * 
 * Examples:
 * - Esper Sentinel: "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}."
 * - Rhystic Study: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}."
 * - Mystic Remora: "Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}."
 */
export type OpponentCastTriggerType =
  | 'esper_sentinel'
  | 'rhystic_study'
  | 'mystic_remora'
  | 'opponent_casts_any'
  | 'opponent_casts_first_noncreature'
  | 'opponent_casts_noncreature'
  | 'opponent_casts_creature'
  | 'any_player_casts_any'
  | 'any_player_casts_creature'
  | 'any_player_casts_noncreature';

export type OpponentCastSpellCondition =
  | 'any'
  | 'noncreature'
  | 'creature'
  | 'instant_sorcery'
  | 'first_noncreature'
  | 'first_any';

export type OpponentCastCasterScope = 'opponent' | 'any_player';

export type OpponentCastSourceZone = 'hand' | 'library' | 'exile' | 'graveyard' | 'not_hand';

export type DetectedOpponentSpellCastTrigger = {
  triggerType: OpponentCastTriggerType;
  spellCondition: OpponentCastSpellCondition;
  casterScope: OpponentCastCasterScope;
  paymentCost?: string;
  paymentIsVariable?: boolean;
  benefitIfNotPaid: string;
  description: string;
  sourceZoneRequirement?: OpponentCastSourceZone;
};

function parseOpponentCastSourceZone(raw: string): OpponentCastSourceZone | undefined {
  const zone = String(raw || '').trim().toLowerCase();
  if (zone === 'hand' || zone === 'exile' || zone === 'graveyard' || zone === 'library') {
    return zone;
  }
  return undefined;
}

export function opponentCastSourceZoneMatches(
  requirement: OpponentCastSourceZone | undefined,
  castSourceZone?: string,
): boolean {
  if (!requirement) return true;
  const zone = String(castSourceZone || '').trim().toLowerCase();
  if (requirement === 'not_hand') return zone !== 'hand';
  if (!zone) return true;
  return zone === requirement;
}

function parseOpponentCastSpellType(rawType: string): Pick<DetectedOpponentSpellCastTrigger, 'spellCondition' | 'triggerType'> {
  const typeToken = String(rawType || '').trim().toLowerCase();
  if (!typeToken || typeToken === 'spell') {
    return { spellCondition: 'any', triggerType: 'opponent_casts_any' };
  }
  if (typeToken.includes('first') && typeToken.includes('noncreature')) {
    return { spellCondition: 'first_noncreature', triggerType: 'opponent_casts_first_noncreature' };
  }
  if (typeToken === 'noncreature' || typeToken.includes('noncreature')) {
    return { spellCondition: 'noncreature', triggerType: 'opponent_casts_noncreature' };
  }
  if (typeToken === 'creature' || (typeToken.includes('creature') && !typeToken.includes('noncreature'))) {
    return { spellCondition: 'creature', triggerType: 'opponent_casts_creature' };
  }
  if (
    typeToken === 'instant'
    || typeToken === 'sorcery'
    || (typeToken.includes('instant') && typeToken.includes('sorcery') && !typeToken.includes('artifact'))
  ) {
    return { spellCondition: 'instant_sorcery', triggerType: 'opponent_casts_noncreature' };
  }
  if (
    typeToken.includes('instant') ||
    typeToken.includes('sorcery') ||
    typeToken.includes('artifact')
  ) {
    return { spellCondition: 'noncreature', triggerType: 'opponent_casts_noncreature' };
  }
  return { spellCondition: 'any', triggerType: 'opponent_casts_any' };
}

function normalizeOpponentCastTriggerDescription(description: string): string {
  return String(description || '')
    .trim()
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function opponentCastTriggerSpecificityScore(trigger: DetectedOpponentSpellCastTrigger): number {
  let score = 0;
  // Prefer known pay-or types over generic cast detection.
  if (trigger.triggerType === 'esper_sentinel' || trigger.triggerType === 'rhystic_study' || trigger.triggerType === 'mystic_remora') {
    score += 100;
  }
  if (String(trigger.paymentCost || '').trim()) score += 20;
  if (String(trigger.benefitIfNotPaid || '').trim() && trigger.benefitIfNotPaid !== 'trigger effect') score += 10;
  if (trigger.paymentIsVariable) score += 5;
  return score;
}

function pushUniqueOpponentCastTrigger(
  triggers: DetectedOpponentSpellCastTrigger[],
  candidate: DetectedOpponentSpellCastTrigger,
): void {
  const candidateDescription = normalizeOpponentCastTriggerDescription(candidate.description);
  const candidatePayment = String(candidate.paymentCost || '').trim().toLowerCase();
  const existingIndex = triggers.findIndex((existing) => {
    if (existing.spellCondition !== candidate.spellCondition) return false;
    if (existing.casterScope !== candidate.casterScope) return false;

    const existingDescription = normalizeOpponentCastTriggerDescription(existing.description);
    if (existingDescription && candidateDescription && existingDescription === candidateDescription) {
      return true;
    }

    // Same cast scope/condition with the same unless-pay tax is one trigger even when
    // description punctuation differs (Rhystic Study known row vs unlessPayPatterns).
    const existingPayment = String(existing.paymentCost || '').trim().toLowerCase();
    if (existingPayment && candidatePayment && existingPayment === candidatePayment) {
      return true;
    }

    return false;
  });

  if (existingIndex < 0) {
    triggers.push(candidate);
    return;
  }

  // Keep the richer / more specific detection (known type + real benefit text).
  if (opponentCastTriggerSpecificityScore(candidate) > opponentCastTriggerSpecificityScore(triggers[existingIndex]!)) {
    triggers[existingIndex] = candidate;
  }
}

export function detectOpponentSpellCastTriggers(card: any, permanent: any): DetectedOpponentSpellCastTrigger[] {
  const triggers: DetectedOpponentSpellCastTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const lowerOracle = oracleText.toLowerCase();
  const cardName = String(card?.name || '').toLowerCase();

  const playerCyclesACardMatch = oracleText.match(/whenever a player cycles a card,?\s*([^.]+)/i);
  if (playerCyclesACardMatch) {
    const effectText = timingTriggerEffect(oracleText, playerCyclesACardMatch);
    if (effectText) {
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'any_player_casts_any',
        spellCondition: 'any',
        casterScope: 'any_player',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, playerCyclesACardMatch, 0),
      });
    }
  }

  const mentionsCastTrigger =
    /\b(?:when|whenever)\b/i.test(oracleText) &&
    /\bcast(?:s)?\b/i.test(lowerOracle) &&
    (
      /\b(?:an opponent|opponent|a player|each opponent|enchanted player|the chosen player|another player|another opponent)\b/i.test(lowerOracle) ||
      /\bplayer casts\b/i.test(lowerOracle) ||
      /\benchanted (?:player|creature) casts\b/i.test(lowerOracle) ||
      /\b(?:the )?first\b.*\bspell\b.*\bis cast\b/i.test(lowerOracle)
    );

  if (!mentionsCastTrigger) {
    return triggers;
  }

  const enchantedPlayerCastPatterns = [
    /whenever enchanted player casts(?: (?:a |an )?([\w\s]*?)spell)?(?: with the chosen name)?(?:,?\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
    /whenever enchanted player casts (?:a |an )?other spell(?:s)? they cast each turn,?\s*([^.]+)/gi,
    /whenever enchanted (?:player |creature )?casts (?:a |an )?([\w\s]*?)spell,?\s*([^.]+)/gi,
  ];
  for (const pattern of enchantedPlayerCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = String(match[match.length - 1] || '').trim();
      if (!effectText) continue;
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'opponent_casts_any',
        spellCondition: 'any',
        casterScope: 'opponent',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const chosenPlayerCastPatterns = [
    /whenever the chosen (?:player )?casts (?:a |an )?([\w\s]*?)spell,?\s*([^.]+)/gi,
    /whenever (?:a player|opponent) casts (?:a |an )?spell with the chosen name,?\s*([^.]+)/gi,
  ];
  for (const pattern of chosenPlayerCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = String(match[match.length - 1] || '').trim();
      if (!effectText) continue;
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'any_player_casts_any',
        spellCondition: 'any',
        casterScope: 'any_player',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const castFromNonHandPatterns = [
    /whenever another (?:player|opponent) casts (?:a |an )?spell from anywhere other than (?:their|that player's) hand,?\s*([^.]+)/gi,
    /whenever an opponent casts (?:a |an )?spell from anywhere other than (?:their|that player's) hand,?\s*([^.]+)/gi,
  ];
  for (const pattern of castFromNonHandPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText) continue;
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'opponent_casts_any',
        spellCondition: 'any',
        casterScope: 'opponent',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const firstSpellOfTurnPatterns = [
    /whenever the first noncreature spell of a turn is cast,?\s*([^.]+)/gi,
    /whenever the first spell of a turn is cast,?\s*([^.]+)/gi,
  ];
  for (const pattern of firstSpellOfTurnPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText) continue;
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'any_player_casts_any',
        spellCondition: 'first_any',
        casterScope: 'any_player',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const opponentCastDuringYourTurnPattern =
    /whenever an opponent casts (?:a |an )?([\w\s]*?)spell during your turn,?\s*([^.]+)/gi;
  let opponentDuringTurnMatch: RegExpExecArray | null;
  opponentCastDuringYourTurnPattern.lastIndex = 0;
  while ((opponentDuringTurnMatch = opponentCastDuringYourTurnPattern.exec(oracleText)) !== null) {
    const effectText = timingTriggerEffect(oracleText, opponentDuringTurnMatch, 2);
    if (!effectText) continue;
    pushUniqueOpponentCastTrigger(triggers, {
      triggerType: 'opponent_casts_any',
      spellCondition: 'any',
      casterScope: 'opponent',
      benefitIfNotPaid: effectText,
      description: timingTriggerEffect(oracleText, opponentDuringTurnMatch, 0),
    });
  }

  if (cardName.includes('esper sentinel') ||
      (lowerOracle.includes('first noncreature spell each turn') &&
       lowerOracle.includes('unless') &&
       lowerOracle.includes('pays'))) {
    pushUniqueOpponentCastTrigger(triggers, {
      triggerType: 'esper_sentinel',
      spellCondition: 'first_noncreature',
      casterScope: 'opponent',
      paymentCost: '{X}',
      paymentIsVariable: true,
      benefitIfNotPaid: 'draw a card',
      description: 'Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}',
    });
  }

  if (cardName.includes('rhystic study') ||
      (lowerOracle.includes('opponent casts a spell') &&
       lowerOracle.includes('draw') &&
       lowerOracle.includes('unless') &&
       lowerOracle.match(/pays\s*\{1\}/))) {
    pushUniqueOpponentCastTrigger(triggers, {
      triggerType: 'rhystic_study',
      spellCondition: 'any',
      casterScope: 'opponent',
      paymentCost: '{1}',
      benefitIfNotPaid: 'draw a card',
      description: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}',
    });
  }

  if (cardName.includes('mystic remora') ||
      (lowerOracle.includes('opponent casts a noncreature spell') &&
       lowerOracle.includes('draw') &&
       lowerOracle.includes('unless') &&
       lowerOracle.includes('pays'))) {
    const paymentMatch = lowerOracle.match(/pays\s*(\{[^}]+\})/);
    const paymentCost = paymentMatch ? paymentMatch[1] : '{4}';
    pushUniqueOpponentCastTrigger(triggers, {
      triggerType: 'mystic_remora',
      spellCondition: 'noncreature',
      casterScope: 'opponent',
      paymentCost,
      benefitIfNotPaid: 'draw a card',
      description: `Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays ${paymentCost}`,
    });
  }

  const unlessPayPatterns = [
    /whenever an opponent casts (?:a |an )?(noncreature\s+)?spell[^.]*unless[^.]*pays\s*(\{[^}]+\})/gi,
    /whenever a player casts (?:a |an )?(noncreature\s+)?spell[^.]*unless[^.]*pays\s*(\{[^}]+\})/gi,
  ];
  for (const pattern of unlessPayPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const isNoncreature = Boolean(match[1]);
      const paymentCost = match[2] || '';
      const casterScope: OpponentCastCasterScope = /player casts/i.test(match[0]) ? 'any_player' : 'opponent';
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: isNoncreature
          ? (casterScope === 'any_player' ? 'any_player_casts_noncreature' : 'opponent_casts_noncreature')
          : (casterScope === 'any_player' ? 'any_player_casts_any' : 'opponent_casts_any'),
        spellCondition: isNoncreature ? 'noncreature' : 'any',
        casterScope,
        paymentCost,
        benefitIfNotPaid: 'trigger effect',
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const typedNoncreatureCastPatterns = [
    /when(?:ever)? an opponent casts an? artifact, instant, or sorcery spell(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
    /when(?:ever)? a player casts an? artifact, instant, or sorcery spell(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
    /when(?:ever)? an opponent casts an? instant or sorcery card(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
    /when(?:ever)? a player casts an? instant or sorcery card(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
  ];
  for (const pattern of typedNoncreatureCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText) continue;
      const casterScope: OpponentCastCasterScope = /a player casts/i.test(match[0]) ? 'any_player' : 'opponent';
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: casterScope === 'any_player' ? 'any_player_casts_noncreature' : 'opponent_casts_noncreature',
        spellCondition: 'noncreature',
        casterScope,
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const genericCastPatterns: Array<{
    pattern: RegExp;
    casterScope: OpponentCastCasterScope;
  }> = [
    {
      pattern: /when(?:ever)? an opponent casts (?:a |an )?((?:[\w]+(?:\s+[\w]+)*?))?\s*spell(?: from (?:(?:their|your|his or her) )?(?:a |the )?(?:hand|exile|graveyard|library))?(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
      casterScope: 'opponent',
    },
    {
      pattern: /when(?:ever)? a player casts (?:a |an )?((?:[\w]+(?:\s+[\w]+)*?))?\s*spell(?: from (?:(?:their|your|his or her) )?(?:a |the )?(?:hand|exile|graveyard|library))?(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
      casterScope: 'any_player',
    },
    {
      pattern: /when(?:ever)? each opponent casts (?:a |an )?((?:[\w]+(?:\s+[\w]+)*?))?\s*spell(?: from (?:(?:their|your|his or her) )?(?:a |the )?(?:hand|exile|graveyard|library))?(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
      casterScope: 'opponent',
    },
  ];

  const playerCastsCardMatch = oracleText.match(/whenever a player casts a card(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/i);
  if (playerCastsCardMatch) {
    const effectText = timingTriggerEffect(oracleText, playerCastsCardMatch);
    if (effectText) {
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'any_player_casts_any',
        spellCondition: 'any',
        casterScope: 'any_player',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, playerCastsCardMatch, 0),
      });
    }
  }

  for (const { pattern, casterScope } of genericCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const rawType = String(match[1] || '').trim();
      const sourceZoneRequirement = parseOpponentCastSourceZone(
        String(match[0] || '').match(/\bfrom (?:(?:their|your|his or her) )?(?:a |the )?(hand|exile|graveyard|library)\b/i)?.[1] || '',
      );
      const effectText = timingTriggerEffect(oracleText, match, 2);
      if (!effectText) continue;
      const parsed = parseOpponentCastSpellType(rawType);
      const triggerType: OpponentCastTriggerType = casterScope === 'any_player'
        ? parsed.spellCondition === 'creature'
          ? 'any_player_casts_creature'
          : parsed.spellCondition === 'noncreature' || parsed.spellCondition === 'instant_sorcery'
            ? 'any_player_casts_noncreature'
            : 'any_player_casts_any'
        : parsed.triggerType;
      const unlessPayment = effectText.match(/unless.*?pays\s*(\{[^}]+\})/i);
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType,
        spellCondition: parsed.spellCondition,
        casterScope,
        paymentCost: unlessPayment?.[1] || '',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
        ...(sourceZoneRequirement ? { sourceZoneRequirement } : {}),
      });
    }
  }

  return triggers;
}

/**
 * Get opponent spell cast triggers that should fire when a spell is cast
 * 
 * @param battlefield - All permanents on the battlefield
 * @param casterId - The player who cast the spell
 * @param spellCard - The spell being cast
 * @param allPlayerIds - All player IDs in the game
 * @param isFirstNoncreatureThisTurnByCaster - Whether this is the first noncreature spell the caster has cast this turn
 * @returns Array of triggers that should fire
 */
export function getOpponentSpellCastTriggers(
  battlefield: any[],
  casterId: string,
  spellCard: any,
  allPlayerIds: string[],
  isFirstNoncreatureThisTurnByCaster: boolean = false,
  castSourceZone?: string,
): OpponentSpellCastTrigger[] {
  const triggers: OpponentSpellCastTrigger[] = [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isNoncreatureSpell = !isCreatureSpell;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const controller = permanent.controller;
    const permTriggers = detectOpponentSpellCastTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      if (trigger.casterScope === 'opponent' && casterId === controller) continue;
      if (!opponentCastSourceZoneMatches(trigger.sourceZoneRequirement, castSourceZone)) continue;
      let shouldTrigger = false;
      
      switch (trigger.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'noncreature':
          shouldTrigger = isNoncreatureSpell;
          break;
        case 'instant_sorcery':
          shouldTrigger = /\binstant\b/.test(spellTypeLine) || /\bsorcery\b/.test(spellTypeLine);
          break;
        case 'creature':
          shouldTrigger = isCreatureSpell;
          break;
        case 'first_noncreature':
          shouldTrigger = isNoncreatureSpell && isFirstNoncreatureThisTurnByCaster;
          break;
        case 'first_any':
          shouldTrigger = isFirstNoncreatureThisTurnByCaster;
          break;
      }
      
      if (shouldTrigger) {
        // Calculate payment for variable costs (Esper Sentinel)
        let paymentAmount = 1;
        if (trigger.paymentIsVariable) {
          // X = creature's power for Esper Sentinel
          const power = parseInt(permanent.card?.power || '1', 10);
          paymentAmount = isNaN(power) ? 1 : Math.max(0, power);
        } else {
          // Extract numeric value from cost string like "{1}" or "{4}"
          const costMatch = String(trigger.paymentCost || '').match(/\{(\d+)\}/);
          paymentAmount = costMatch ? parseInt(costMatch[1], 10) : 1;
        }
        
        triggers.push({
          permanentId: permanent.id,
          cardName: permanent.card?.name || 'Unknown',
          controllerId: controller,
          casterId,
          description: trigger.description,
          effect: trigger.benefitIfNotPaid,
          triggerType: trigger.triggerType,
          paymentCost: trigger.paymentIsVariable ? `{${paymentAmount}}` : trigger.paymentCost,
          paymentAmount,
          benefitIfNotPaid: trigger.benefitIfNotPaid,
          // Tax abilities (Rhystic Study) are optional "you may". Possibility Storm
          // and similar "that player exiles it" replacements are mandatory.
          mandatory: !/\byou may\b/i.test(String(trigger.benefitIfNotPaid || trigger.description || '')),
          ...(trigger.sourceZoneRequirement ? { sourceZoneRequirement: trigger.sourceZoneRequirement } : {}),
        });
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// Storm Mechanic
// ============================================================================

/**
 * Detect if a card has the storm ability
 */
export function detectStormAbility(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  if (keywords.some((k: string) => k.toLowerCase() === 'storm')) {
    return true;
  }
  
  if (oracleText.includes('storm') && 
      oracleText.includes('copy it for each spell cast before it')) {
    return true;
  }
  
  return false;
}

/**
 * Get the storm count (number of spells cast before this one)
 */
export function getStormCount(gameState: any): number {
  const spellsCastThisTurn = gameState?.spellsCastThisTurn || [];
  return Math.max(0, spellsCastThisTurn.length - 1);
}
