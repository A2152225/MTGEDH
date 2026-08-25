/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectSpellCastTriggers late watcher patterns
 * Public: appendSpellCastDetectionLate
 */

import { aOrAnSpellType } from "../../../../../rules-engine/src/indefiniteArticle.js";
import { extractSpellCastEffect } from "./spell-cast-effect-text.js";
import type { SpellCastDetectionState } from "./spell-cast-detection-state.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { escapeCardNameForRegex } from "./types.js";

export function appendSpellCastDetectionLate(detectionState: SpellCastDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    controllerId,
    permanent,
    getSpellCastConditionData,
  } = detectionState;
  const castFromHandPattern = /whenever you cast (?:a |an )?spell from your hand,?\s*([^.]+)/gi;
  let castFromHandMatch: RegExpExecArray | null;
  castFromHandPattern.lastIndex = 0;
  while ((castFromHandMatch = castFromHandPattern.exec(oracleText)) !== null) {
    const effectText = extractSpellCastEffect(oracleText, castFromHandMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText && trigger.sourceZoneRequirement === 'hand')) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castFromHandMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        sourceZoneRequirement: 'hand',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const playLandOrCastPatterns = [
    /whenever you play a land or cast a spell,?\s*([^.]+)/gi,
    /whenever you play a land from exile or cast a spell from exile,?\s*([^.]+)/gi,
  ];
  for (const pattern of playLandOrCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = extractSpellCastEffect(oracleText, match, 1);
      const isFromExile = /from exile/i.test(match[0]);
      if (!triggers.some((trigger) => trigger.effect === effectText)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition: 'any',
          sourceZoneRequirement: isFromExile ? 'exile' : undefined,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const playtestCastMatch = oracleText.match(/whenever you cast a playtest card,?\s*([^.]+)/i);
  if (playtestCastMatch) {
    const effectText = extractSpellCastEffect(oracleText, playtestCastMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, playtestCastMatch, 0),
        effect: effectText,
        spellCondition: 'tribal_type',
        tribalType: 'playtest',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const entersAndCastMatch = oracleText.match(
    /when (?:~|this (?:creature|permanent)|[\w ,']+?) enters(?: the battlefield)? and whenever you cast (?:a |an )?([\w\s]+?) spell,?\s*([^.]+)/i,
  );
  if (entersAndCastMatch) {
    const rawType = String(entersAndCastMatch[1] || '').trim().toLowerCase();
    const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
    const effectText = extractSpellCastEffect(oracleText, entersAndCastMatch, 2);
    if (!triggers.some((trigger) => trigger.effect === effectText && trigger.spellCondition === spellCondition)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever you cast ${aOrAnSpellType(tribalType || rawType || 'spell')}, ${effectText}`,
        effect: effectText,
        spellCondition,
        tribalType,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const typedNoncreatureSelfCastPatterns = [
    /whenever you cast an? artifact, instant, or sorcery spell,?\s*([^.]+)/gi,
  ];
  for (const pattern of typedNoncreatureSelfCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = extractSpellCastEffect(oracleText, match, 1);
      const copiesSpell = effectText.toLowerCase().includes('copy that spell') || effectText.toLowerCase().includes('copy it');
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.spellCondition === 'instant_sorcery')) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition: 'instant_sorcery',
          copiesSpell,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const spellOfThatTypePattern = /whenever you cast a spell of that type this turn,?\s*([^.]+)/gi;
  let spellOfThatTypeMatch: RegExpExecArray | null;
  spellOfThatTypePattern.lastIndex = 0;
  while ((spellOfThatTypeMatch = spellOfThatTypePattern.exec(oracleText)) !== null) {
    const effectText = extractSpellCastEffect(oracleText, spellOfThatTypeMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, spellOfThatTypeMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castFromThisPatterns = [
    /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|[\w]+(?:\s+[\w]+)*?) spell from this(?: spell)?,?\s*([^.]+)/gi,
    /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|[\w]+(?:\s+[\w]+)*?) spell from this (?:creature|permanent),?\s*([^.]+)/gi,
    /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|[\w]+(?:\s+[\w]+)*?) spell from the (?:battlefield|stack),?\s*([^.]+)/gi,
  ];
  for (const pattern of castFromThisPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const rawType = String(match[1] || 'spell').trim().toLowerCase();
      const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
      const effectText = extractSpellCastEffect(oracleText, match, 2);
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.description === match[0].trim())) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition,
          tribalType,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const commanderCastMatch = oracleText.match(/(?:when|whenever) you cast your commander,?\s*([^.]+)/i);
  if (commanderCastMatch) {
    const effectText = extractSpellCastEffect(oracleText, commanderCastMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever you cast your commander, ${effectText}`,
        effect: effectText,
        spellCondition: 'any',
        tribalType: 'commander',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castShortTypePatterns = [
    /whenever you cast a (blue|green|red|white|black|cat|dog|kraken|pegasus|lesson)(?:\s+spell)?,?\s*([^.]+)/gi,
    /whenever you cast an (aura|artifact|enchantment|instant(?!\s+or\s+sorcery)|sorcery)(?:\s+spell)?,?\s*([^.]+)/gi,
  ];
  for (const pattern of castShortTypePatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const lowerMatchText = String(match[0] || '').toLowerCase();
      if (/\binstant or sorcery\b/.test(lowerMatchText)) {
        continue;
      }
      const rawType = String(match[1] || '').trim().toLowerCase();
      const effectText = extractSpellCastEffect(oracleText, match, 2);
      const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
      if (!triggers.some((trigger) =>
        trigger.effect === effectText &&
        trigger.spellCondition === spellCondition &&
        String(trigger.tribalType || '').toLowerCase() === String(tribalType || '').toLowerCase()
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition,
          tribalType,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const firstTribalSpellPattern =
    /whenever you cast your first (?:a |an )?([\w]+) spell each turn,?\s*([^.]+)/gi;
  let firstTribalMatch: RegExpExecArray | null;
  firstTribalSpellPattern.lastIndex = 0;
  while ((firstTribalMatch = firstTribalSpellPattern.exec(oracleText)) !== null) {
    const rawType = String(firstTribalMatch[1] || '').trim().toLowerCase();
    const effectText = extractSpellCastEffect(oracleText, firstTribalMatch, 2);
    const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
    if (!triggers.some((trigger) =>
      trigger.effect === effectText &&
      trigger.firstSpellThisTurn === true &&
      String(trigger.tribalType || '').toLowerCase() === String(tribalType || '').toLowerCase()
    )) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, firstTribalMatch, 0),
        effect: effectText,
        spellCondition,
        tribalType,
        firstSpellThisTurn: true,
        oncePerTurn: true,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castDuringYourTurnsPattern =
    /whenever you cast (?:a |an )?([\w\s]*?)spell during each of your turns,?\s*([^.]+)/gi;
  let castDuringTurnsMatch: RegExpExecArray | null;
  castDuringYourTurnsPattern.lastIndex = 0;
  while ((castDuringTurnsMatch = castDuringYourTurnsPattern.exec(oracleText)) !== null) {
    const rawType = String(castDuringTurnsMatch[1] || 'spell').trim().toLowerCase() || 'spell';
    const effectText = extractSpellCastEffect(oracleText, castDuringTurnsMatch, 2);
    const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
    if (!triggers.some((trigger) => trigger.effect === effectText && trigger.description === castDuringTurnsMatch[0].trim())) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castDuringTurnsMatch, 0),
        effect: effectText,
        spellCondition,
        tribalType,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castOrCyclePattern = /when(?:ever)? you cast or cycle ([^,]+),?\s*([^.]+)/gi;
  let castOrCycleMatch: RegExpExecArray | null;
  castOrCyclePattern.lastIndex = 0;
  while ((castOrCycleMatch = castOrCyclePattern.exec(oracleText)) !== null) {
    const effectText = extractSpellCastEffect(oracleText, castOrCycleMatch, 2);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castOrCycleMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castItThisTurnMatch = oracleText.match(/when(?:ever)? you cast it this turn,?\s*([^.]+)/i);
  if (castItThisTurnMatch) {
    const effectText = extractSpellCastEffect(oracleText, castItThisTurnMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castItThisTurnMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castEnchantedCardMatch = oracleText.match(/when(?:ever)? you cast enchanted card,?\s*([^.]+)/i);
  if (castEnchantedCardMatch) {
    const effectText = extractSpellCastEffect(oracleText, castEnchantedCardMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castEnchantedCardMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castFromExileAmongPattern =
    /whenever you cast (?:a |an )?spell from among (?:the )?cards (?:they don't own )?exiled with [^,]+,?\s*([^.]+)/gi;
  let castFromExileAmongMatch: RegExpExecArray | null;
  castFromExileAmongPattern.lastIndex = 0;
  while ((castFromExileAmongMatch = castFromExileAmongPattern.exec(oracleText)) !== null) {
    const effectText = extractSpellCastEffect(oracleText, castFromExileAmongMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText && trigger.sourceZoneRequirement === 'exile')) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castFromExileAmongMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        sourceZoneRequirement: 'exile',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castSpellFromThatMatch = oracleText.match(/whenever you cast (?:a |an )?spell from that,?\s*([^.]+)/i);
  if (castSpellFromThatMatch) {
    const effectText = extractSpellCastEffect(oracleText, castSpellFromThatMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castSpellFromThatMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const landOrCastPatterns = [
    /whenever a player plays a land or casts a spell(?:,?\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
    /whenever an opponent plays a land or casts a spell(?:,?\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
  ];
  for (const pattern of landOrCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = extractSpellCastEffect(oracleText, match, 1);
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.description === match[0].trim())) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition: 'any',
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const namedCardCastPattern = new RegExp(
    `when you cast ${escapeCardNameForRegex(cardName)},?\\s*([^.]+)`,
    'i',
  );
  const namedCardCastMatch = oracleText.match(namedCardCastPattern);
  if (namedCardCastMatch) {
    const effectText = extractSpellCastEffect(oracleText, namedCardCastMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, namedCardCastMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        tribalType: cardName.toLowerCase(),
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const chosenType = String((permanent as any)?.chosenCreatureType || '').trim();
  if (chosenType && lowerOracle.includes('whenever you cast a spell of the chosen type')) {
    const effectMatch = /whenever you cast a spell of the chosen type,?\s*([^.]+)/i.exec(oracleText);
    if (effectMatch) {
      let effect = String(effectMatch[1] || '').trim();
      const lowerEffect = effect.toLowerCase();
      if (
        (lowerEffect.includes('copy that spell') || lowerEffect.includes('copy it'))
        && !lowerEffect.includes('choose new targets for the copy')
        && /you may choose new targets? for the copy\.?/i.test(oracleText)
      ) {
        effect = `${effect} You may choose new targets for the copy.`.trim();
      }
      const copiesSpell = effect.toLowerCase().includes('copy that spell') || effect.toLowerCase().includes('copy it');
      const chosenTypeLower = chosenType.toLowerCase();

      if (!triggers.some((trigger) =>
        trigger.effect === effect &&
        trigger.spellCondition === 'tribal_type' &&
        String(trigger.tribalType || '').toLowerCase() === chosenTypeLower
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast ${aOrAnSpellType(chosenType)}, ${effect}`,
          effect,
          spellCondition: 'tribal_type',
          tribalType: chosenType,
          copiesSpell,
          mandatory: !effect.toLowerCase().includes('you may'),
        });
      }
    }
  }
  
}
