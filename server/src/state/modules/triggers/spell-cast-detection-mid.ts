/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectSpellCastTriggers mid watcher patterns
 * Public: appendSpellCastDetectionMid
 */

import { controllerGrantsKeywordToCreatures, permanentHasAttachmentGrantedKeyword } from "../../../../../shared/src/attachmentKeywordGrants.js";
import { aOrAnSpellType } from "../../../../../rules-engine/src/indefiniteArticle.js";
import { extractSpellCastEffect, normalizeSpellCastEffectText } from "./spell-cast-effect-text.js";
import type { SpellCastDetectionState } from "./spell-cast-detection-state.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";

export function appendSpellCastDetectionMid(detectionState: SpellCastDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    controllerId,
    card,
    permanent,
    state,
    getSpellCastConditionData,
    getSpellCastEffectMetadata,
  } = detectionState;
  // Pattern: "When/Whenever you cast a [TYPE] spell, [EFFECT]"
  const spellCastPatterns = [
    // Multi-word spell types: "nonlegendary creature", "instant or sorcery", tribal names
    /(?:when|whenever) you cast (?:a |an )?(?!this |that )([\w]+(?:\s+[\w]+)*?)\s+spell(?!\s+that\b),?\s*([^.]+)/gi,
    // "Whenever you cast an instant, sorcery, or Wizard spell"
    /(?:when|whenever) you cast an? instant, sorcery, or (\w+) spell,?\s*([^.]+)/gi,
  ];
  
  const untypedSpellCastPatterns = [
    /whenever you cast a spell(?:\s+that\s+targets\s+(?:~|this\s+(?:creature|permanent)))?,?\s*([^.]+)/gi,
    /when you cast a spell,?\s*([^.]+)/gi,
    /whenever you cast two or more spells[^,]*,?\s*([^.]+)/gi,
  ];
  for (const pattern of untypedSpellCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const lowerMatchText = String(match[0] || '').toLowerCase();
      if (
        lowerMatchText.includes('spell of the chosen type') ||
        lowerMatchText.includes('spell of that type') ||
        lowerMatchText.includes('spell with the chosen name') ||
        lowerMatchText.includes('spell from your library') ||
        lowerMatchText.includes('spell from your graveyard') ||
        lowerMatchText.includes('spell from exile') ||
        lowerMatchText.includes('spell from anywhere other than your hand') ||
        lowerMatchText.includes('shares a creature type')
      ) {
        continue;
      }
      const effectText = extractSpellCastEffect(oracleText, match, 1);
      // Name-specific "that targets ~" clauses are heroic / dedicated detectors.
      // Untyped "whenever you cast a spell, …" must not swallow them as the effect.
      if (/^that (?:targets|shares a creature type)\b/i.test(String(effectText || '').trim())) {
        continue;
      }
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.spellCondition === 'any')) {
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

  for (const pattern of spellCastPatterns) {
    let match;
    pattern.lastIndex = 0; // Reset regex
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = match[1].toLowerCase();
      const lowerMatchText = String(match[0] || '').toLowerCase();
      if (
        /\byour first\b/.test(spellType) ||
        /\bduring each\b/.test(spellType) ||
        lowerMatchText.includes('your first spell during each opponent') ||
        lowerMatchText.includes('your first spell each turn') ||
        /\bcreature spell with power \d+ or greater\b/.test(lowerMatchText)
      ) {
        continue;
      }
      const normalizedEffect = normalizeSpellCastEffectText(oracleText, match[0], timingTriggerEffect(oracleText, match, 2), match.index);
      const effectText = normalizedEffect.effectText;

      if (
        lowerMatchText.includes('spell of the chosen type') ||
        lowerMatchText.includes('spell from your library') ||
        lowerMatchText.includes('spell from your graveyard') ||
        lowerMatchText.includes('spell from exile') ||
        lowerMatchText.includes('spell from anywhere other than your hand')
      ) {
        continue;
      }
      const { spellCondition, tribalType } = getSpellCastConditionData(spellType);
      const { copiesSpell, isTapUntap, createsToken, tokenDetails } = getSpellCastEffectMetadata(effectText, tribalType);
      
      // Avoid duplicates
      if (!triggers.some((t) =>
        t.effect === effectText &&
        t.spellCondition === spellCondition &&
        t.sourceZoneRequirement === undefined
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast ${aOrAnSpellType(tribalType || spellType)}, ${normalizedEffect.optionalPaymentCost ? `you may pay ${normalizedEffect.optionalPaymentCost}. If you do, ${effectText}` : effectText}`,
          effect: effectText,
          spellCondition,
          tribalType,
          requiresTarget: isTapUntap,
          targetType: isTapUntap ? 'permanent' : undefined,
          createsToken,
          tokenDetails,
          copiesSpell,
          optionalPaymentCost: normalizedEffect.optionalPaymentCost,
          mandatory: normalizedEffect.mandatory,
        });
      }
    }
  }

  const sourceQualifiedSpellCastPatterns = [
    {
      pattern: /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery|colorless|\w+) spell from your library,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'library' as const,
    },
    {
      pattern: /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery|colorless|[\w]+(?:\s+[\w]+)*?) spell from (?:your )?graveyard,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'graveyard' as const,
    },
    {
      pattern: /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery|colorless|[\w]+(?:\s+[\w]+)*?) spell from (?:the )?exile,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'exile' as const,
    },
    {
      pattern: /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery|colorless|\w+) spell from exile,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'exile' as const,
    },
    {
      pattern: /whenever you cast (?:a |an )?spell from exile,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'exile' as const,
      untypedSpell: true,
    },
    {
      pattern: /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery|colorless|\w+) spell from anywhere other than your hand,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'not_hand' as const,
    },
    {
      pattern: /whenever you cast (?:a |an )?spell from anywhere other than your hand,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'not_hand' as const,
      untypedSpell: true,
    },
    {
      pattern: /\bor you cast (?:a |an )?spell from anywhere other than your hand,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'not_hand' as const,
      untypedSpell: true,
    },
  ];

  for (const entry of sourceQualifiedSpellCastPatterns) {
    const { pattern, sourceZoneRequirement } = entry;
    const untypedSpell = Boolean((entry as { untypedSpell?: boolean }).untypedSpell);
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = untypedSpell ? 'any' : match[1].toLowerCase();
      const effectCapture = timingTriggerEffect(oracleText, match, untypedSpell ? 1 : 2);
      const normalizedEffect = normalizeSpellCastEffectText(oracleText, match[0], effectCapture, match.index);
      const effectText = normalizedEffect.effectText;
      const { spellCondition, tribalType } = getSpellCastConditionData(spellType);
      const { copiesSpell, isTapUntap, createsToken, tokenDetails } = getSpellCastEffectMetadata(effectText, tribalType);

      if (!triggers.some((trigger) =>
        trigger.effect === effectText &&
        trigger.spellCondition === spellCondition &&
        trigger.sourceZoneRequirement === sourceZoneRequirement &&
        String(trigger.tribalType || '').toLowerCase() === String(tribalType || '').toLowerCase()
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: sourceZoneRequirement === 'library'
            ? `Whenever you cast ${aOrAnSpellType(tribalType || spellType)} from your library, ${normalizedEffect.optionalPaymentCost ? `you may pay ${normalizedEffect.optionalPaymentCost}. If you do, ${effectText}` : effectText}`
            : sourceZoneRequirement === 'graveyard'
              ? `Whenever you cast ${aOrAnSpellType(tribalType || spellType)} from your graveyard, ${normalizedEffect.optionalPaymentCost ? `you may pay ${normalizedEffect.optionalPaymentCost}. If you do, ${effectText}` : effectText}`
            : sourceZoneRequirement === 'exile'
              ? `Whenever you cast ${aOrAnSpellType(tribalType || spellType)} from exile, ${normalizedEffect.optionalPaymentCost ? `you may pay ${normalizedEffect.optionalPaymentCost}. If you do, ${effectText}` : effectText}`
            : `Whenever you cast ${aOrAnSpellType(tribalType || spellType)} from anywhere other than your hand, ${normalizedEffect.optionalPaymentCost ? `you may pay ${normalizedEffect.optionalPaymentCost}. If you do, ${effectText}` : effectText}`,
          effect: effectText,
          spellCondition,
          tribalType,
          copiesSpell,
          sourceZoneRequirement,
          requiresTarget: isTapUntap,
          targetType: isTapUntap ? 'permanent' : undefined,
          createsToken,
          tokenDetails,
          optionalPaymentCost: normalizedEffect.optionalPaymentCost,
          mandatory: normalizedEffect.mandatory,
        });
      }
    }
  }

  const firstSpellEachTurnPatterns = [
    /whenever you cast your first (creature|noncreature|instant|sorcery|instant or sorcery) spell each turn,?\s*([^.]+)/gi,
    /whenever you cast your first (?:a |an )?([\w]+(?:\s+[\w]+)*?) spell each turn,?\s*([^.]+)/gi,
    /whenever you cast your first ([^.]+?) spell each turn,?\s*([^.]+)/gi,
  ];

  for (const pattern of firstSpellEachTurnPatterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = match[1].toLowerCase();
      const effectText = extractSpellCastEffect(oracleText, match, 2);
      const { spellCondition, tribalType } = getSpellCastConditionData(spellType);
      const { copiesSpell, isOptional } = getSpellCastEffectMetadata(effectText, tribalType);

      if (!triggers.some((trigger) =>
        trigger.effect === effectText &&
        trigger.spellCondition === spellCondition &&
        trigger.firstSpellThisTurn === true &&
        String(trigger.tribalType || '').toLowerCase() === String(tribalType || '').toLowerCase()
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast your first ${tribalType || spellType} spell each turn, ${effectText}`,
          effect: effectText,
          spellCondition,
          tribalType,
          copiesSpell,
          firstSpellThisTurn: true,
          oncePerTurn: true,
          mandatory: !isOptional,
        });
      }
    }
  }

  const firstSourceQualifiedSpellEachTurnPatterns = [
    {
      pattern: /whenever you cast your first (creature|noncreature|instant|sorcery|instant or sorcery|colorless|\w+) spell from your graveyard each turn,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'graveyard' as const,
    },
  ];

  for (const { pattern, sourceZoneRequirement } of firstSourceQualifiedSpellEachTurnPatterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = match[1].toLowerCase();
      const effectText = extractSpellCastEffect(oracleText, match, 2);
      const { spellCondition, tribalType } = getSpellCastConditionData(spellType);
      const { copiesSpell, isTapUntap, createsToken, tokenDetails, isOptional } = getSpellCastEffectMetadata(effectText, tribalType);

      if (!triggers.some((trigger) =>
        trigger.effect === effectText &&
        trigger.spellCondition === spellCondition &&
        trigger.firstSpellThisTurn === true &&
        trigger.sourceZoneRequirement === sourceZoneRequirement &&
        String(trigger.tribalType || '').toLowerCase() === String(tribalType || '').toLowerCase()
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast your first ${tribalType || spellType} spell from your graveyard each turn, ${effectText}`,
          effect: effectText,
          spellCondition,
          tribalType,
          copiesSpell,
          firstSpellThisTurn: true,
          oncePerTurn: true,
          sourceZoneRequirement,
          requiresTarget: isTapUntap,
          targetType: isTapUntap ? 'permanent' : undefined,
          createsToken,
          tokenDetails,
          mandatory: !isOptional,
        });
      }
    }
  }

  const mayCastRevealedWithoutPaying =
    /you may cast (?:it|that card) without paying its mana cost/i.test(lowerOracle);
  const bottomRevealedRemainder =
    /put the rest on the bottom of your library in a random order/i.test(lowerOracle)
    || /put all revealed cards not cast this way on the bottom of your library in a random order/i.test(lowerOracle);

  const hasBottomRevealNonlandPattern =
    lowerOracle.includes('whenever you cast a spell') &&
    lowerOracle.includes('you may put it on the bottom of its owner') &&
    lowerOracle.includes('reveal cards from the top of your library until you reveal a nonland card') &&
    mayCastRevealedWithoutPaying &&
    bottomRevealedRemainder;

  if (hasBottomRevealNonlandPattern) {
    const oncePerTurn = lowerOracle.includes('this ability triggers only once each turn');
    for (let i = triggers.length - 1; i >= 0; i--) {
      if (triggers[i]?.effect?.toLowerCase().includes('you may put it on the bottom of its owner')) {
        triggers.splice(i, 1);
      }
    }

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description:
        'Whenever you cast a spell, you may put it on the bottom of its owner\'s library. If you do, reveal cards from the top of your library until you reveal a nonland card. You may cast that card without paying its mana cost. Then put all revealed cards not cast this way on the bottom of your library in a random order.',
      effect:
        'you may put it on the bottom of its owner\'s library. If you do, reveal cards from the top of your library until you reveal a nonland card. You may cast that card without paying its mana cost. Then put all revealed cards not cast this way on the bottom of your library in a random order.',
      spellCondition: 'any',
      oncePerTurn,
      replacementEffect: {
        kind: 'bottom_spell_reveal_until_nonland',
        revealFromLibraryOf: 'controller',
        castWithoutPayingManaCost: true,
        randomizeBottomRemainder: true,
      },
      mandatory: false,
    });
  }
  
  // Beast Whisperer pattern: "Whenever you cast a creature spell, draw a card"
  if (lowerOracle.includes('whenever you cast a creature spell') && 
      lowerOracle.includes('draw a card') &&
      !triggers.some(t => t.spellCondition === 'creature' && t.effect.includes('draw'))) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a creature spell, draw a card",
      effect: "draw a card",
      spellCondition: 'creature',
      mandatory: true,
    });
  }
  
  // Prowess is a creature keyword. Do not treat Equipment/Aura grant text
  // ("Equipped creature has prowess") as prowess on the attachment itself.
  const typeLineLower = String(card?.type_line || permanent?.card?.type_line || '').toLowerCase();
  const isDefinitelyNonCreature = Boolean(typeLineLower) && !typeLineLower.includes('creature');
  const canHaveProwess = !isDefinitelyNonCreature;
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const hasPrintedProwess = canHaveProwess && (
    /(^|\n)\s*prowess\b/i.test(oracleText)
    || /\bprowess\s*\(/i.test(oracleText)
  );
  // Explicit keyword line / keyword ability — not lord/attachment grant sentences.
  const hasNativeProwessKeyword = canHaveProwess && (
    hasPrintedProwess
    || (
      /\bprowess\b/i.test(oracleText)
      && !/\bcreatures you control have\b[^.]*\bprowess\b/i.test(oracleText)
      && !/\bequipped creature has\b[^.]*\bprowess\b/i.test(oracleText)
      && !/\benchanted creature has\b[^.]*\bprowess\b/i.test(oracleText)
    )
  );
  const hasGrantedProwess = canHaveProwess && (
    permanentHasAttachmentGrantedKeyword(permanent, battlefield, 'prowess')
    || controllerGrantsKeywordToCreatures(battlefield, controllerId, 'prowess')
    || (Array.isArray(permanent?.grantedAbilities)
      && permanent.grantedAbilities.some((a: unknown) => String(a || '').toLowerCase().includes('prowess')))
    || (Array.isArray(permanent?.grantedKeywords)
      && permanent.grantedKeywords.some((a: unknown) => String(a || '').toLowerCase() === 'prowess'))
  );

  if (hasNativeProwessKeyword || hasGrantedProwess) {
    const prowessEffect = 'This creature gets +1/+1 until end of turn.';
    if (!triggers.some((t) => t.spellCondition === 'noncreature' && t.effect === prowessEffect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: 'Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.',
        effect: prowessEffect,
        spellCondition: 'noncreature',
        mandatory: true,
      });
    }
  }

  const anotherSpellWithKeywordMatch = oracleText.match(
    /whenever you cast another spell that has (\w+),?\s*([^.]+)/i,
  );
  if (anotherSpellWithKeywordMatch) {
    const keyword = String(anotherSpellWithKeywordMatch[1] || '').trim().toLowerCase();
    const effectText = timingTriggerEffect(oracleText, anotherSpellWithKeywordMatch, 2);
    if (
      effectText &&
      !triggers.some((t) => t.effect === effectText && t.spellCondition === 'any' && t.tribalType === keyword)
    ) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever you cast another spell that has ${keyword}, ${effectText}`,
        effect: effectText,
        spellCondition: 'any',
        tribalType: keyword,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  // Magecraft pattern (Archmage Emeritus)
  if (lowerOracle.includes('magecraft') || 
      (lowerOracle.includes('whenever you cast or copy') && lowerOracle.includes('instant or sorcery'))) {
    const effectMatch = oracleText.match(/(?:magecraft\s*[—-]\s*)?whenever you cast or copy an instant or sorcery spell,?\s*([^.]+)/i);
    if (effectMatch && !triggers.some((t) => t.effect === timingTriggerEffect(oracleText, effectMatch))) {
      const magecraftEffect = timingTriggerEffect(oracleText, effectMatch);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Magecraft — Whenever you cast or copy an instant or sorcery spell, ${magecraftEffect}`,
        effect: magecraftEffect,
        spellCondition: 'instant_sorcery',
        mandatory: true,
      });
    }
  }

  // "Whenever you cast a spell of the chosen color, ..."
  {
    const chosenColorSpellPattern = /whenever you cast a spell of the chosen colou?r,?\s*([^.]+)/gi;
    let chosenMatch: RegExpExecArray | null;
    chosenColorSpellPattern.lastIndex = 0;
    while ((chosenMatch = chosenColorSpellPattern.exec(oracleText)) !== null) {
      const effectText = String(chosenMatch[1] || '').trim();
      if (!effectText) continue;
      if (!triggers.some((trigger) => trigger.spellCondition === 'chosen_color' && trigger.effect === effectText)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast a spell of the chosen color, ${effectText}`,
          effect: effectText,
          spellCondition: 'chosen_color',
          mandatory: true,
        });
      }
    }
  }

  const coloredSpellOrLandfallPatterns = [
    /whenever you cast a (green|blue|red|white|black) spell(?:\s+or\b)/gi,
  ];
  for (const pattern of coloredSpellOrLandfallPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const color = String(match[1] || '').toLowerCase();
      const afterMatch = oracleText.slice(match.index + match[0].length);
      const orLandfall = afterMatch.match(/^\s*or\s+([^.]+)/i);
      const spellOnlyEffect = 'you gain 1 life';
      const effectText = orLandfall
        ? `${match[0].trim()} or ${orLandfall[1].trim()}`
        : spellOnlyEffect;
      if (!triggers.some((trigger) => trigger.spellCondition === 'color' && trigger.tribalType === color)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast ${aOrAnSpellType(color)}${orLandfall ? ` or ${orLandfall[1].trim()}` : ''}`,
          effect: effectText,
          spellCondition: 'color',
          tribalType: color,
          mandatory: true,
        });
      }
    }
  }

  const firstSpellDuringOpponentTurnMatch = oracleText.match(
    /whenever you cast your first spell during each opponent's turn,?\s*([^.]+)/gi,
  );
  if (firstSpellDuringOpponentTurnMatch) {
    for (const rawMatch of firstSpellDuringOpponentTurnMatch) {
      const effectMatch = /whenever you cast your first spell during each opponent's turn,?\s*([^.]+)/i.exec(rawMatch);
      if (!effectMatch) continue;
      const effectText = extractSpellCastEffect(oracleText, effectMatch, 1);
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.firstSpellDuringOpponentTurn)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast your first spell during each opponent's turn, ${effectText}`,
          effect: effectText,
          spellCondition: 'any',
          firstSpellDuringOpponentTurn: true,
          oncePerTurn: true,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const firstSpellEachTurnUntypedMatch = oracleText.match(/whenever you cast your first spell each turn,?\s*([^.]+)/gi);
  if (firstSpellEachTurnUntypedMatch) {
    for (const rawMatch of firstSpellEachTurnUntypedMatch) {
      const effectMatch = /whenever you cast your first spell each turn,?\s*([^.]+)/i.exec(rawMatch);
      if (!effectMatch) continue;
      const effectText = extractSpellCastEffect(oracleText, effectMatch, 1);
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.firstSpellThisTurn && trigger.spellCondition === 'any')) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast your first spell each turn, ${effectText}`,
          effect: effectText,
          spellCondition: 'any',
          firstSpellThisTurn: true,
          oncePerTurn: true,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const castInstantOrSorceryWithoutSpellWord = oracleText.match(
    /whenever you cast an? (instant|sorcery)(?! or )\b,?\s*([^.]+)/gi,
  );
  if (castInstantOrSorceryWithoutSpellWord) {
    for (const rawMatch of castInstantOrSorceryWithoutSpellWord) {
      const lowerRaw = String(rawMatch || '').toLowerCase();
      if (/\bspell\b/.test(lowerRaw) || /\binstant or sorcery\b/.test(lowerRaw)) {
        continue;
      }
      const effectMatch = /whenever you cast an? (instant|sorcery)(?! or )\b,?\s*([^.]+)/i.exec(rawMatch);
      if (!effectMatch) continue;
      const effectText = extractSpellCastEffect(oracleText, effectMatch, 2);
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.spellCondition === 'instant_sorcery')) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast an ${effectMatch[1]}, ${effectText}`,
          effect: effectText,
          spellCondition: 'instant_sorcery',
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const nextCastPatterns = [
    /you next cast an? ([\w\s]+?) spell this turn/gi,
    /you next cast an? ([\w\s]+?) spell with mana value (\d+) or less this turn/gi,
  ];
  for (const pattern of nextCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const rawType = String(match[1] || 'spell').trim().toLowerCase();
      const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
      const effectText = timingTriggerEffect(oracleText, match, 0);
      if (!triggers.some((trigger) => trigger.effect === effectText)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: effectText,
          effect: effectText,
          spellCondition,
          tribalType,
          mandatory: true,
        });
      }
    }
  }

  const manaCostQualifierPattern = /whenever you cast (?:your first )?(?:a |an )?([\w\s]*?) spell with (\{[^}]+\}) in its mana cost each turn,?\s*([^.]+)/gi;
  let manaCostMatch: RegExpExecArray | null;
  manaCostQualifierPattern.lastIndex = 0;
  while ((manaCostMatch = manaCostQualifierPattern.exec(oracleText)) !== null) {
    const rawType = String(manaCostMatch[1] || 'spell').trim().toLowerCase() || 'spell';
    const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
    const effectText = extractSpellCastEffect(oracleText, manaCostMatch, 3);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, manaCostMatch, 0),
        effect: effectText,
        spellCondition,
        tribalType,
        oncePerTurn: true,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }
}
