/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectETBTriggers mid pattern run
 * Public: appendEtbDetectionMid
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { parseChosenTypeCreatureEtbTrigger } from "../chosen-creature-type.js";
import { parseMillFromOracleText } from "../../../../../rules-engine/src/keywordActions/mill.js";
import { isModalChooseModesEffectText } from "../inferTriggeredAbilityTargetMetadata.js";
import { isLandfallEtbSubjectPhrase } from "./landfall.js";
import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import { detectHideawayAbility } from "./hideaway-ability.js";
import { detectTargetType } from "./detect-target-type.js";
import {
  ENTERS_OR_EVENT_SUFFIX,
  isHideawayLookEffectText,
  isOracleIndexInsideParenthetical,
  isSwallowedCompoundEnterEffect,
} from "./etb-detection-helpers.js";
import type { EtbDetectionState } from "./etb-detection-state.js";

export function appendEtbDetectionMid(state: EtbDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    etbAlternatives,
    card,
    permanent,
  } = state;

  const etbPattern = new RegExp(
    `when(?:ever)?\\s+(?:${etbAlternatives.join('|')})\\s+(?:enters(?: the battlefield)?|comes into play)(?:\\s+or\\s+${ENTERS_OR_EVENT_SUFFIX})?[,]?\\s*([^.]+)`,
    'i',
  );
  // Keyword reminders can contain a parenthetical "when this creature enters"
  // before the card's actual ETB ability (notably offspring and squad).
  // Do not stop at that reminder; it is intentionally skipped below and cannot
  // be the only candidate considered.
  const etbMatches = Array.from(
    oracleText.matchAll(new RegExp(etbPattern.source, 'gi')),
  );
  const etbMatch =
    etbMatches.find(
      (match) => !isOracleIndexInsideParenthetical(oracleText, Number(match.index ?? -1)),
    )
    ?? etbMatches[0]
    ?? null;
  if (etbMatch && !triggers.some(t => t.triggerType === 'etb' || t.triggerType === 'self_enters_or_attacks' || t.triggerType === 'self_enters_or_leaves' || t.triggerType === 'etb_sacrifice_unless_pay' || t.triggerType === 'this_equipment_etb' || t.triggerType === 'job_select' || t.triggerType === 'living_weapon')) {
    let effectText = timingTriggerEffect(oracleText, etbMatch);
    const fullMatchText = String(etbMatch[0] || '');
    const isSelfEntersOrAttacks = /\bor\s+attacks\b/i.test(fullMatchText);
    const matchIndex = typeof etbMatch.index === 'number' ? etbMatch.index : oracleText.indexOf(fullMatchText);
    const remainder = matchIndex >= 0 ? oracleText.slice(matchIndex + fullMatchText.length).trim() : '';

    // Necromancy-style ETB abilities can span multiple sentences:
    // the first sentence turns the source into an Aura, and the next sentence
    // contains the actual graveyard target clause. Preserve that continuation so
    // target metadata inference can see the graveyard target.
    if (!/\btarget\b/i.test(effectText) && /\bbecomes an aura\b/i.test(effectText)) {
      const continuationMatch = remainder.match(/^[.?!]\s*((?:put|return)\s+target\s+[^.?!]+(?:[.?!]|$))/i);
      if (continuationMatch) {
        effectText = `${effectText}. ${String(continuationMatch[1] || '').trim().replace(/[.?!]\s*$/, '')}`;
      }
    }

    const exileReplacementContinuationMatch = remainder.match(/^[.?!]\s*(if\s+(?:a|that|this)\s+(?:card|spell)(?:\s+cast\s+this\s+way)?\s+would\s+be\s+put\s+into\s+your\s+graveyard\s*,?\s*exile\s+it\s+instead(?:[.?!]|$))/i);
    if (exileReplacementContinuationMatch) {
      const continuation = String(exileReplacementContinuationMatch[1] || '').trim().replace(/[.?!]\s*$/, '');
      if (continuation && !new RegExp(`${continuation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(effectText)) {
        effectText = `${effectText}. ${continuation}`;
      }
    }

    const ifYouDoContinuationMatch = remainder.match(/^[.?!]\s*(if\s+you\s+do,\s+[^.?!]+(?:[.?!]|$))/i);
    if (ifYouDoContinuationMatch) {
      const continuation = String(ifYouDoContinuationMatch[1] || '').trim().replace(/[.?!]\s*$/, '');
      if (continuation && !new RegExp(`${continuation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(effectText)) {
        effectText = `${effectText}. ${continuation}`;
      }
    }

    const isEscapedSelfSacrificeTrigger = /sacrifice\s+(?:~|it|this\s+\w+)\s+unless\s+it\s+escaped/i.test(effectText);
    if (isEscapedSelfSacrificeTrigger && permanent?.escapedFrom) {
      effectText = '';
    }
    if (isSwallowedCompoundEnterEffect(effectText)) {
      effectText = '';
    }

    if (!effectText) {
      // Skip ETB self-sacrifice lines that no longer apply because the permanent already escaped.
    }
    
    // Keyword reminders such as Hideaway 4 (When this land enters, ...) must not
    // also register as a generic self-ETB — hideaway_etb is queued separately.
    else if (
      isOracleIndexInsideParenthetical(oracleText, matchIndex)
      || (detectHideawayAbility(card) && isHideawayLookEffectText(effectText))
    ) {
      // skip reminder / keyword-covered hideaway ETB
    }
    // Check for "sacrifice ~ unless you pay" pattern (Transguild Promenade, Gateway Plaza, Rupture Spire)
    else {
      const sacrificeUnlessPayMatch = effectText.match(/sacrifice\s+(?:~|it|this\s+\w+)\s+unless\s+you\s+pay\s+(\{[^}]+\})/i);
      if (sacrificeUnlessPayMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'etb_sacrifice_unless_pay',
        description: effectText,
        effect: effectText,
        manaCost: sacrificeUnlessPayMatch[1],
        mandatory: true,
        requiresChoice: true,
      });
      } 
    // Check for bounce land pattern - "return a land you control to its owner's hand"
      else if (/return\s+a\s+land\s+you\s+control\s+to\s+its\s+owner's\s+hand/i.test(effectText)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'etb_bounce_land',
        description: effectText,
        effect: effectText,
        mandatory: true,
        requiresChoice: true,
      });
      }
      else {
      // Detect if this trigger requires targeting. Modal choose-one effects pick
      // a mode first; only some modes have targets, so do not require a stack target.
      const modalChooseModes = isModalChooseModesEffectText(effectText);
      const targetType = modalChooseModes ? undefined : detectTargetType(effectText);
      const requiresTarget = !modalChooseModes && (/\btarget\b/i.test(effectText) || !!targetType);
      
      // Detect targeting constraint (e.g., "opponent controls" or "you control")
      let targetConstraint: 'opponent' | 'you' | undefined = undefined;
      if (requiresTarget) {
        const lowerEffect = effectText.toLowerCase();
        if (lowerEffect.includes('an opponent controls') || lowerEffect.includes('opponent controls')) {
          targetConstraint = 'opponent';
        } else if (lowerEffect.includes('you control')) {
          targetConstraint = 'you';
        }
      }
      
      triggers.push({
        permanentId,
        cardName,
        triggerType: isSelfEntersOrAttacks ? 'self_enters_or_attacks' : 'etb',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresTarget,
        targetType,
        targetConstraint,
      });
      }
    }
  }

  const etbOrAttackPattern = new RegExp(`whenever\\s+(?:${etbAlternatives.join('|')})\\s+enters(?: the battlefield)?\\s+or\\s+attacks[,]?\\s*([^.]+)`, 'i');
  const faceUpPattern = new RegExp(
    `when(?:ever)?\\s+(?:${etbAlternatives.join('|')})\\s+(?:enters(?: the battlefield)?\\s+or\\s+(?:when it(?:'s| is)\\s+)?)?(?:is\\s+)?turned face up,?\\s*([^.]+)`,
    'i',
  );
  const regenerateMatch = oracleText.match(/when it regenerates this way,?\s*([^.]+)/i);
  if (regenerateMatch && !triggers.some((trigger) => trigger.triggerType === 'regenerated')) {
    const effectText = timingTriggerEffect(oracleText, regenerateMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'regenerated',
      description: effectText,
      effect: effectText,
      mandatory: true,
    });
  }

  const commanderEtbMatch = oracleText.match(
    new RegExp(
      `when(?:ever)? your commander enters(?: the battlefield)?(?:\\s+or\\s+${ENTERS_OR_EVENT_SUFFIX})?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (commanderEtbMatch && !triggers.some((trigger) => trigger.triggerType === 'commander_etb')) {
    const effectText = timingTriggerEffect(oracleText, commanderEtbMatch);
    if (effectText && !isSwallowedCompoundEnterEffect(effectText)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'commander_etb',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const phasesInMatch = oracleText.match(/when(?:ever)? (?:~|this creature) phases in,?\s*([^.]+)/i);
  if (phasesInMatch && !triggers.some((trigger) => trigger.triggerType === 'phases_in')) {
    const effectText = timingTriggerEffect(oracleText, phasesInMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'phases_in',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherPermanentFaceUpMatch = oracleText.match(
    /whenever another permanent you control is turned face up,?\s*([^.]+)/i,
  );
  if (
    anotherPermanentFaceUpMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'another_permanent_face_up')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherPermanentFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_permanent_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantmentOrPermanentFaceUpMatch = oracleText.match(
    /whenever this enchantment or another permanent you control is turned face up,?\s*([^.]+)/i,
  );
  if (
    enchantmentOrPermanentFaceUpMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'enchantment_or_permanent_turned_face_up')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantmentOrPermanentFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchantment_or_permanent_turned_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const faceDownControlledFaceUpMatch = oracleText.match(
    /whenever a face-down permanent you control is turned face up,?\s*([^.]+)/i,
  );
  if (
    faceDownControlledFaceUpMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'face_down_controlled_turned_face_up')
  ) {
    const effectText = timingTriggerEffect(oracleText, faceDownControlledFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_down_controlled_turned_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherPermanentFaceUpMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbAlternatives.join('|')}) or another permanent you control is turned face up,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrAnotherPermanentFaceUpMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'named_or_another_permanent_face_up')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherPermanentFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_permanent_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfOrAnotherPermanentFaceUpMatch = oracleText.match(
    /whenever this creature or another permanent is turned face up,?\s*([^.]+)/i,
  );
  if (
    selfOrAnotherPermanentFaceUpMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'self_or_another_permanent_face_up')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfOrAnotherPermanentFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_or_another_permanent_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledFaceUpMatch = oracleText.match(
    /whenever (?:this creature or another creature you control|a permanent you control) is turned face up,?\s*([^.]+)/i,
  );
  if (controlledFaceUpMatch && !triggers.some((trigger) => trigger.triggerType === 'controlled_permanent_face_up')) {
    const effectText = timingTriggerEffect(oracleText, controlledFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_permanent_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyPermanentFaceUpMatch = oracleText.match(/whenever a permanent is turned face up,?\s*([^.]+)/i);
  if (anyPermanentFaceUpMatch && !triggers.some((trigger) => trigger.triggerType === 'any_permanent_face_up')) {
    const effectText = timingTriggerEffect(oracleText, anyPermanentFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_permanent_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedFaceUpMatch = oracleText.match(/when(?:ever)? enchanted creature is turned face up,?\s*([^.]+)/i);
  if (enchantedFaceUpMatch && !triggers.some((trigger) => trigger.triggerType === 'face_up')) {
    const effectText = timingTriggerEffect(oracleText, enchantedFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const faceUpMatch = oracleText.match(faceUpPattern);
  if (faceUpMatch && !triggers.some((trigger) => trigger.triggerType === 'face_up')) {
    const effectText = timingTriggerEffect(oracleText, faceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const etbOrAttackMatch = oracleText.match(etbOrAttackPattern);
  if (etbOrAttackMatch) {
    const effectText = timingTriggerEffect(oracleText, etbOrAttackMatch);
    const hasMatchingEtbEffect = triggers.some((trigger) =>
      (trigger.triggerType === 'etb' || trigger.triggerType === 'self_enters_or_attacks') &&
      String(trigger.effect || trigger.description || '').trim().toLowerCase() === effectText.toLowerCase()
    );

    if (effectText && !hasMatchingEtbEffect && !triggers.some((t) => t.triggerType === 'self_enters_or_attacks')) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'self_enters_or_attacks',
        description: effectText,
        effect: effectText,
        mandatory: true,
      });
    }
  }
  
  // "Whenever a creature enters the battlefield under your control" or "Whenever a nontoken creature enters..."
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Also handles "creature you control enters" (new template with "you control" before "enters")
  // Also handles plural forms: "creatures enter" / "creatures you control enter" (e.g., Satoru)
  // Handles: "a creature", "another creature", "one or more creatures", "other creatures"
  // IMPORTANT: Exclude opponent-controlled ETB templates (handled separately as opponent_creature_etb).
  // Without this guard, patterns like "Whenever a creature enters under an opponent's control, ..." can be
  // misclassified as generic creature_etb and then miss intervening-if context like "that player".
  const hasOpponentCreatureRestriction =
    /whenever (?:a|another) creature an opponent controls enters/i.test(oracleText) ||
    /\benters?(?: the battlefield)?\b[^.]{0,120}\bunder an opponent's control\b/i.test(oracleText) ||
    /\benters?(?: the battlefield)?\b[^.]{0,120}\bunder their control\b/i.test(oracleText);
  // Capture the required type phrase between the determiner (a/another/other/one or more) and "enters".
  // Examples captured: "creature", "nontoken creature", "token creature", "artifact creature", "Bear", "Assembly-Worker".
  const creatureETBMatch = oracleText.match(
    new RegExp(
      `when(?:ever)? (?:a|an(?:other)?|one or more(?: other)?|other) ([^,]+?) (?:you control )?(?:that [^,]+? )?(?:you control )?enters?(?: the battlefield)?(?: under your control)?(?:\\s+or\\s+[^,]+?)?(?:\\s+or\\s+${ENTERS_OR_EVENT_SUFFIX})?,?\\s*([^.]+)`,
      'i',
    ),
  );
  const thatPermanentEtbMatch = oracleText.match(
    /when that permanent enters(?: the battlefield)?,?\s*([^.]+)/i
  );
  if (thatPermanentEtbMatch && !triggers.some((t) => t.triggerType === 'another_permanent_etb' || t.triggerType === 'delayed_etb')) {
    const effectText = timingTriggerEffect(oracleText, thatPermanentEtbMatch);
    if (effectText) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'delayed_etb' as any,
        description: effectText,
        effect: effectText,
        mandatory: !lowerOracle.includes('you may'),
      });
    }
  }
  const chosenTypeEtbOrAttackMatch = oracleText.match(
    /whenever a creature you control of the chosen type enters or attacks,?\s*([^.]+)/i
  );
  const chosenTypeCreatureEtb = parseChosenTypeCreatureEtbTrigger(oracleText);
  if (
    chosenTypeCreatureEtb
    && !isSwallowedCompoundEnterEffect(chosenTypeCreatureEtb.effect)
    && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb')
    && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb_or_attack')
  ) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_type_creature_etb',
      description: chosenTypeCreatureEtb.effect,
      effect: chosenTypeCreatureEtb.effect,
      mandatory: chosenTypeCreatureEtb.mandatory,
      nontokenOnly: chosenTypeCreatureEtb.nontokenOnly,
      anotherOnly: chosenTypeCreatureEtb.anotherOnly,
      subjectKind: chosenTypeCreatureEtb.subjectKind,
    } as any);
  }

  if (chosenTypeEtbOrAttackMatch && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb_or_attack')) {
    const effectText = timingTriggerEffect(oracleText, chosenTypeEtbOrAttackMatch);
    if (effectText) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'chosen_type_creature_etb_or_attack',
        description: effectText,
        effect: effectText,
        mandatory: true,
      });
    }
  }

  const commanderYouControlEtbOrAttackMatch = oracleText.match(
    /whenever a commander you control enters or attacks,?\s*([^.]+)/i,
  );
  if (
    commanderYouControlEtbOrAttackMatch &&
    !triggers.some((t) => t.triggerType === 'commander_you_control_etb_or_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, commanderYouControlEtbOrAttackMatch);
    if (effectText) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'commander_you_control_etb_or_attack',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  if (creatureETBMatch && !hasOpponentCreatureRestriction && !triggers.some(t => t.triggerType === 'creature_etb')) {
    const requiredTypePhrase = creatureETBMatch[1].trim();
    const effectText = timingTriggerEffect(oracleText, creatureETBMatch, 2);
    // Land / land-subtype subjects belong to landfall detection, not creature_etb.
    // Otherwise Scute Swarm / Titania dual-classify and can double-fire on land-creatures.
    // Chosen-type "enters or attacks" is owned by chosen_type_creature_etb_or_attack.
    // Commander "enters or attacks" is owned by commander_you_control_etb_or_attack.
    if (
      !isLandfallEtbSubjectPhrase(requiredTypePhrase)
      && !isSwallowedCompoundEnterEffect(effectText)
      && !/\bchosen type\b/i.test(requiredTypePhrase)
      && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb_or_attack')
      && !triggers.some((t) => t.triggerType === 'commander_you_control_etb_or_attack')
      && !(/^\s*(?:nontoken\s+)?(?:artifact|enchantment|land|planeswalker|equipment|battle)s?\s*$/i.test(requiredTypePhrase))
    ) {
      const isNontokenOnly = /\b(?:nontoken|non-token)\b/i.test(requiredTypePhrase);
      const isTokenOnly = !isNontokenOnly && /\btoken\b/i.test(requiredTypePhrase);
      // Check if this trigger requires the creature to be controlled by the trigger's controller
      // Pattern: "you control" or "under your control" in the trigger text
      // The subject itself ("tokens you control enter", "a Bear you control enters") counts too.
      const triggerHeader = String(creatureETBMatch[0] || '').split(/\benters?\b/i)[0] || '';
      const hasControlRestriction = /creature(?:s)?\s+you\s+control|under your control/i.test(oracleText)
        || /\byou control\b/i.test(triggerHeader);
      const optionalTrigger = /\byou may\b/i.test(effectText);
      const t: TriggeredAbility = {
        permanentId,
        cardName,
        triggerType: 'creature_etb',
        description: effectText,
        effect: effectText,
        mandatory: !optionalTrigger,
        requiresChoice: optionalTrigger,
        nontokenOnly: isNontokenOnly,
        controlledOnly: hasControlRestriction,  // Flag for creatures that must be yours (e.g., Aura Shards)
      };
      (t as any).requiredTypePhrase = requiredTypePhrase;
      (t as any).tokenOnly = isTokenOnly;
      triggers.push(t);
    }
  }
  
  // "Whenever a nontoken Equipment you control enters" (Firion, Wild Rose Warrior)
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Also handles "equipment you control enters" (new template)
  // Also handles plural forms and "another"/"other" variants
  const equipmentETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?equipments? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (equipmentETBMatch && !triggers.some(t => t.triggerType === 'equipment_etb')) {
    const effectText = timingTriggerEffect(oracleText, equipmentETBMatch);
    const matchText = String(equipmentETBMatch[0] || '');
    const targetType = detectTargetType(effectText);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: /equipments?\s+you\s+control|under your control/i.test(matchText),
      nontokenOnly: /\b(?:nontoken|non-token)\b/i.test(matchText),
      requiresTarget: /\btarget\b/i.test(effectText) || !!targetType,
      targetType,
    });
  }
  
  // "Whenever an Artifact enters the battlefield under your control"
  // Also handles plural forms and "another"/"other" variants
  const artifactETBMatch = oracleText.match(
    new RegExp(
      `whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?artifacts? (?:you control )?enters?(?: the battlefield)?(?: under your control)?(?:\\s+or\\s+${ENTERS_OR_EVENT_SUFFIX})?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (artifactETBMatch && !triggers.some(t => t.triggerType === 'artifact_etb')) {
    const effectText = timingTriggerEffect(oracleText, artifactETBMatch);
    if (effectText && !isSwallowedCompoundEnterEffect(effectText)) {
      const matchText = String(artifactETBMatch[0] || '');
      const targetType = detectTargetType(effectText);
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'artifact_etb',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        controlledOnly: /artifacts?\s+you\s+control|under your control/i.test(matchText),
        nontokenOnly: /\b(?:nontoken|non-token)\b/i.test(matchText),
        requiresTarget: /\btarget\b/i.test(effectText) || !!targetType,
        targetType,
      });
    }
  }
  
  // "Whenever an Enchantment enters the battlefield under your control"
  // Also handles plural forms and "another"/"other" variants
  const enchantmentETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?enchantments? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (enchantmentETBMatch && !triggers.some(t => t.triggerType === 'enchantment_etb')) {
    const effectText = timingTriggerEffect(oracleText, enchantmentETBMatch);
    const matchText = String(enchantmentETBMatch[0] || '');
    const targetType = detectTargetType(effectText);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchantment_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: /enchantments?\s+you\s+control|under your control/i.test(matchText),
      nontokenOnly: /\b(?:nontoken|non-token)\b/i.test(matchText),
      requiresTarget: /\btarget\b/i.test(effectText) || !!targetType,
      targetType,
    });
  }

  // "Whenever a planeswalker you control enters" (Gatewatch Beacon, etc.)
  const planeswalkerETBMatch = oracleText.match(
    /whenever (?:a|an(?:other)?|one or more(?: other)?|other) planeswalkers? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i,
  );
  if (planeswalkerETBMatch && !triggers.some((t) => t.triggerType === 'planeswalker_etb')) {
    const effectText = timingTriggerEffect(oracleText, planeswalkerETBMatch);
    const matchText = String(planeswalkerETBMatch[0] || '');
    const targetType = detectTargetType(effectText);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'planeswalker_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: /planeswalkers?\s+you\s+control|under your control/i.test(matchText),
      nontokenOnly: /\b(?:nontoken|non-token)\b/i.test(matchText),
      requiresTarget: /\btarget\b/i.test(effectText) || !!targetType,
      targetType,
    });
  }
  
  // "Whenever you cast an Equipment spell" (for cast triggers vs ETB)
  const equipmentCastMatch = oracleText.match(/whenever you (?:cast|play) (?:a|an) equipment(?: spell)?,?\s*([^.]+)/i);
  if (equipmentCastMatch && !triggers.some(t => t.triggerType === 'equipment_cast')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_cast',
      description: timingTriggerEffect(oracleText, equipmentCastMatch),
      effect: timingTriggerEffect(oracleText, equipmentCastMatch),
      mandatory: !lowerOracle.includes('you may'),
    });
  }
  
  // "Whenever a legendary creature enters the battlefield under your control" (Hero's Blade, etc.)
  // This triggers when any legendary creature you control ETBs - used for auto-attach equipment
  const legendaryCreatureETBMatch = oracleText.match(/whenever (?:a|an(?:other)?) legendary creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (legendaryCreatureETBMatch && !triggers.some(t => (t as any).triggerType === 'legendary_creature_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'legendary_creature_etb' as any,
      description: timingTriggerEffect(oracleText, legendaryCreatureETBMatch),
      effect: timingTriggerEffect(oracleText, legendaryCreatureETBMatch),
      mandatory: !lowerOracle.includes('you may'),
      requiresChoice: lowerOracle.includes('you may'),
    });
  }
  
  // "Whenever another creature enters the battlefield" (Soul Warden, Auriok Champion, etc.)
  // This is CREATURE-ONLY - does NOT trigger on non-creature permanents like artifacts
  // NOTE: Soul Warden: "Whenever another creature enters the battlefield, you gain 1 life."
  // Auriok Champion: same trigger but optional ("you may gain 1 life"); protection from black/red is unrelated.
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  // Also handles plural forms: "creatures enter" and "one or more other creatures enter"
  const anotherCreatureAnyETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?creatures? enters?(?: the battlefield)?(?!.*under your control),?\s*([^.]+)/i);
  if (anotherCreatureAnyETBMatch && !triggers.some(t => t.triggerType === 'creature_etb')) {
    // Extract color qualifiers in the trigger clause only (e.g. "white creature"), not protection/reminder text.
    const colorRestrictionMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) ([\w\s]+?) creatures? enters?/i);
    const rawColorRestriction = colorRestrictionMatch ? colorRestrictionMatch[1].trim().toLowerCase() : null;
    const colorRestriction = rawColorRestriction
      && rawColorRestriction !== 'another'
      && rawColorRestriction !== 'one or more'
      && rawColorRestriction !== 'creature'
      && /\b(white|blue|black|red|green|colorless)\b/.test(rawColorRestriction)
      ? rawColorRestriction
      : undefined;

    const effectClause = timingTriggerEffect(oracleText, anotherCreatureAnyETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_etb', // Use creature_etb so it only fires on creatures
      description: effectClause,
      effect: effectClause,
      mandatory: !/\byou may\b/i.test(effectClause),
      colorRestriction,
    } as any);
  }
  
  // "Whenever another permanent you control enters" - Altar of the Brood, etc.
  // This triggers on ANY permanent type (creature, artifact, enchantment, land, planeswalker) under YOUR control
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  // Also handles plural forms
  // First check if there's a control restriction, then match the pattern
  const hasPermanentControlRestriction = /whenever (?:another|one or more(?: other)?) [\w\s]*permanents? (?:you control|under your control)/i.test(oracleText) ||
                                         /whenever (?:another|one or more(?: other)?) [\w\s]*permanents? (?:you control )?enters?(?: the battlefield)? under your control/i.test(oracleText);
  if (hasPermanentControlRestriction) {
    const anotherPermanentControlledETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?permanents? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
    if (anotherPermanentControlledETBMatch && !triggers.some(t => t.triggerType === 'another_permanent_etb')) {
      const effectClause = timingTriggerEffect(oracleText, anotherPermanentControlledETBMatch);
      const parsedMill = parseMillFromOracleText(effectClause);
      const millAmount = parsedMill && parsedMill.count > 0 ? parsedMill.count : undefined;
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'another_permanent_etb', // Triggers only on permanents you control
        description: effectClause,
        effect: effectClause,
        ...(millAmount != null ? { millAmount } : {}),
        mandatory: true,
      } as any);
    }
  }
  
  // "Whenever another permanent enters the battlefield" - ANY permanent from ANY player
  // This would be for cards that trigger on ANY permanent entering, regardless of controller
  // (Currently no known cards have this pattern, but included for completeness)
  // Explicitly check that it does NOT have "you control" or "under your control"
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  // Also handles plural forms
  const anotherPermanentAnyETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?permanents? enters?(?: the battlefield)?,?\s*([^.]+)/i);
  const hasNoControlRestriction = !/you control|under your control|an opponent controls|under an opponent's control/.test(oracleText);
  if (anotherPermanentAnyETBMatch && hasNoControlRestriction && !triggers.some(t => t.triggerType === 'permanent_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_etb',
      description: timingTriggerEffect(oracleText, anotherPermanentAnyETBMatch),
      effect: timingTriggerEffect(oracleText, anotherPermanentAnyETBMatch),
      mandatory: true,
    } as any);
  }
  
  // "Whenever another creature enters the battlefield under your control" (Guide of Souls, etc.)
  // Also handles new Bloomburrow template: "another creature you control enters"
  // This is CREATURE-ONLY, triggers only on creatures YOU control
  // Also handles plural forms
  const anotherCreatureControlledETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  // Ensure the pattern requires "under your control" or "you control" (oracleText is already lowercased)
  // oracleText is already lowercased - check for control restriction
  // Also handles plural forms
  const hasControlRestriction = /whenever (?:another|one or more(?: other)?) [\w\s]*creatures? (?:you control|under your control)/.test(oracleText) ||
                                 /whenever (?:another|one or more(?: other)?) [\w\s]*creatures? (?:you control )?enters?(?: the battlefield)? under your control/.test(oracleText);
  if (anotherCreatureControlledETBMatch && hasControlRestriction && !triggers.some(t => t.triggerType === 'another_permanent_etb' || t.triggerType === 'creature_etb')) {
    // Extract color qualifiers in the trigger clause only (e.g. "white creature").
    const colorRestrictionMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) ([\w\s]+?) creatures?/i);
    const rawColorRestriction = colorRestrictionMatch ? colorRestrictionMatch[1].trim().toLowerCase() : null;
    const colorRestriction = rawColorRestriction
      && rawColorRestriction !== 'another'
      && rawColorRestriction !== 'one or more'
      && rawColorRestriction !== 'creature'
      && /\b(white|blue|black|red|green|colorless)\b/.test(rawColorRestriction)
      ? rawColorRestriction
      : undefined;

    const effectText = timingTriggerEffect(oracleText, anotherCreatureControlledETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_permanent_etb', // This is controlled creature, so another_permanent_etb is appropriate
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
      colorRestriction,
      creatureOnly: true, // Flag to indicate this only triggers on creatures
    } as any);
  }
}
