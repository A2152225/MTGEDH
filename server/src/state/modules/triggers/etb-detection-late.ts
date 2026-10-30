/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectETBTriggers late pattern run
 * Public: appendEtbDetectionLate
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { isEtbCreatureTypeChoiceOracle } from "../chosen-creature-type.js";
import { detectHideawayAbility } from "./hideaway-ability.js";
import { isHideawayLookEffectText } from "./etb-detection-helpers.js";
import type { EtbDetectionState } from "./etb-detection-state.js";

export function appendEtbDetectionLate(state: EtbDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    card,
  } = state;

  const flyingControlledETBMatch = oracleText.match(
    /whenever (?:~|this creature) or another creature you control with flying enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (flyingControlledETBMatch && !triggers.some((t) => t.triggerType === 'flying_controlled_etb')) {
    const effectText = timingTriggerEffect(oracleText, flyingControlledETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'flying_controlled_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  }

  const opponentLandETBMatch = oracleText.match(
    /whenever a land (?:an opponent controls enters|enters(?: the battlefield)?(?: under)? an opponent'?s control),?\s*([^.]+)/i,
  );
  if (opponentLandETBMatch && !triggers.some((t) => t.triggerType === 'opponent_land_etb')) {
    const effectText = timingTriggerEffect(oracleText, opponentLandETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_land_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  }

  // Curse of the Restless Dead: landfall.ts also owns emission; detect here so
  // live-seam etb_watcher does not treat the clause as empty.
  const enchantedPlayerLandETBMatch = oracleText.match(
    /whenever a land enchanted player controls enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    enchantedPlayerLandETBMatch
    && !triggers.some((t) => t.triggerType === 'enchanted_player_land_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerLandETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_player_land_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  }

  // Bloomburrow "Whenever a land you control enters" / older "enters under your control".
  // Landfall emission stays in landfall.ts; this is detection for watcher scans.
  const landYouControlETBMatch = oracleText.match(
    /whenever a land (?:you control enters(?: the battlefield)?|enters(?: the battlefield)? under your control),?\s*([^.]+)/i,
  );
  if (
    landYouControlETBMatch
    && !/enchanted player/i.test(String(landYouControlETBMatch[0] || ''))
    && !/an opponent/i.test(String(landYouControlETBMatch[0] || ''))
    && !triggers.some((t) =>
      t.triggerType === 'land_you_control_etb'
      || t.triggerType === 'opponent_land_etb'
      || t.triggerType === 'enchanted_player_land_etb'
    )
  ) {
    const effectText = timingTriggerEffect(oracleText, landYouControlETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'land_you_control_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    } as any);
  }

  const anyLandETBMatch = oracleText.match(
    /whenever a land enters(?: the battlefield)?(?: during your turn)?(?!\s+under),?\s*([^.]+)/i,
  );
  if (
    anyLandETBMatch
    && !/you control enters/i.test(String(anyLandETBMatch[0] || ''))
    && !/an opponent/i.test(String(anyLandETBMatch[0] || ''))
    && !/enchanted player/i.test(String(anyLandETBMatch[0] || ''))
    && !triggers.some((t) =>
      t.triggerType === 'any_land_etb'
      || t.triggerType === 'land_you_control_etb'
      || t.triggerType === 'opponent_land_etb'
    )
  ) {
    const effectText = timingTriggerEffect(oracleText, anyLandETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_land_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  }

  const thisOrAnotherLandETBMatch = oracleText.match(
    /whenever (?:this (?:land|permanent)|~) or another land you control enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherLandETBMatch
    && !triggers.some((t) =>
      t.triggerType === 'this_or_another_land_you_control_etb'
      || t.triggerType === 'land_you_control_etb'
    )
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherLandETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_land_you_control_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  }

  const multiTypedYouControlETBMatch = oracleText.match(
    /whenever another ((?:[\w]+,\s+)+[\w]+,? or [\w]+) you control enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    multiTypedYouControlETBMatch
    && !triggers.some((t) => t.triggerType === 'multi_typed_you_control_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, multiTypedYouControlETBMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'multi_typed_you_control_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiredTypePhrase: String(multiTypedYouControlETBMatch[1] || '').trim(),
    } as any);
  }

  const thisOrLegendaryETBMatch = oracleText.match(
    /whenever (?:this \w+|~) or a legendary creature you control enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrLegendaryETBMatch
    && !triggers.some((t) => t.triggerType === 'this_or_legendary_you_control_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrLegendaryETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_legendary_you_control_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  }

  const namedOrSnowPermanentETBMatch = oracleText.match(
    /whenever .+ or another snow permanent you control enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    namedOrSnowPermanentETBMatch
    && !triggers.some((t) => t.triggerType === 'named_or_snow_permanent_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrSnowPermanentETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_snow_permanent_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  }

  // "Whenever a creature an opponent controls enters" (Suture Priest second ability)
  // This triggers when OPPONENTS' creatures enter the battlefield
  // Also handles plural forms
  const opponentCreatureETBMatch = oracleText.match(/whenever (?:a|another|one or more(?: other)?) (?:[\w\s]+)?creatures? (?:an opponent controls )?enters?(?: the battlefield)?(?: under (?:an opponent's|their) control)?,?\s*([^.]+)/i);
  // oracleText is already lowercased
  const hasOpponentRestriction = /creatures? (?:an opponent controls|under an opponent's control)/.test(oracleText) ||
                                  /creatures? enters?(?: the battlefield)? under (?:an opponent's|their) control/.test(oracleText);
  if (opponentCreatureETBMatch && hasOpponentRestriction && !triggers.some(t => t.triggerType === 'opponent_creature_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creature_etb', // New type for opponent creature ETB
      description: timingTriggerEffect(oracleText, opponentCreatureETBMatch),
      effect: timingTriggerEffect(oracleText, opponentCreatureETBMatch),
      mandatory: !opponentCreatureETBMatch[1].toLowerCase().includes('you may'),
    } as any);
  }
  
  // "As [this] enters the battlefield, choose" - Modal permanents like Outpost Siege
  // Pattern: "As ~ enters the battlefield, choose Khans or Dragons."
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  const modalETBMatch = oracleText.match(/as (?:~|this (?:creature|permanent|enchantment)) enters(?: the battlefield)?,?\s*choose\s+([^.]+)/i);
  if (modalETBMatch && !isEtbCreatureTypeChoiceOracle(oracleText)) {
    const choiceText = modalETBMatch[1].trim();
    // "choose a player / a color / a creature type" has its own chooser.
    // Treating the words "a player" as a modal option queues a second prompt that does nothing.
    if (/^(?:a colou?r|a creature type|a basic land type|a (?:nonland )?card(?: name)?|an opponent|a player)\b/i.test(choiceText)) {
      // dedicated as-enters choice
    } else {
    // Parse the options (usually "X or Y" pattern)
    const options = choiceText.split(/\s+or\s+/i).map(opt => opt.trim().replace(/[.,]$/, ''));
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'etb_modal_choice',
      description: `Choose: ${options.join(' or ')}`,
      effect: choiceText,
      mandatory: true,
      requiresChoice: true,
      modalOptions: options,
    } as any);
    }
  }
  
  // Job Select (Final Fantasy set) - When this Equipment enters, create a 1/1 colorless Hero creature token, then attach this to it.
  // Pattern: "Job select" or "job select" (keyword)
  // Only Job Select keyword or explicit Hero-token living-weapon-style reminder.
  // Do NOT treat "create a … Soldier/Rebel/… token, then attach" as Job Select
  // (Midnight Angel Armor / For Mirrodin! / generic equipment ETBs).
  const hasJobSelect = lowerOracle.includes('job select') ||
    (/create a 1\/1 colorless hero creature token/i.test(oracleText) &&
      /attach this(?: equipment)? to it/i.test(oracleText));
  if (hasJobSelect && !triggers.some(t => t.triggerType === 'job_select')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'job_select',
      description: 'Create a 1/1 colorless Hero creature token, then attach this Equipment to it.',
      effect: 'create_hero_token_and_attach',
      mandatory: true,
      tokenInfo: {
        name: 'Hero',
        power: 1,
        toughness: 1,
        types: ['Creature'],
        subtypes: ['Hero'],
        colors: [], // colorless
      },
    } as any);
  }
  
  // Living Weapon (Phyrexia) - When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.
  // Pattern: "Living weapon" (keyword)
  const hasLivingWeapon = lowerOracle.includes('living weapon') ||
    (lowerOracle.includes('create') && lowerOracle.includes('germ') && lowerOracle.includes('token') && lowerOracle.includes('attach'));
  if (hasLivingWeapon && !triggers.some(t => t.triggerType === 'living_weapon')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'living_weapon',
      description: 'Create a 0/0 black Phyrexian Germ creature token, then attach this Equipment to it.',
      effect: 'create_germ_token_and_attach',
      mandatory: true,
      tokenInfo: {
        name: 'Phyrexian Germ',
        power: 0,
        toughness: 0,
        types: ['Creature'],
        subtypes: ['Phyrexian', 'Germ'],
        colors: ['B'], // black
      },
    } as any);
  }
  
  // Hideaway - When land enters, look at top N cards, exile one face-down, put rest on bottom
  // Pattern: "Hideaway N" keyword or oracle text
  const hideawayInfo = detectHideawayAbility(card);
  if (hideawayInfo && !triggers.some(t => t.triggerType === 'hideaway_etb')) {
    for (let i = triggers.length - 1; i >= 0; i--) {
      const existing = triggers[i];
      if (
        (existing.triggerType === 'etb' || existing.triggerType === 'self_enters_or_attacks')
        && isHideawayLookEffectText(String(existing.effect || existing.description || ''))
      ) {
        triggers.splice(i, 1);
      }
    }
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'hideaway_etb',
      description: `Look at the top ${hideawayInfo.hideawayCount} cards of your library, exile one face down, then put the rest on the bottom in a random order.`,
      effect: 'hideaway_exile',
      mandatory: true,
      hideawayCount: hideawayInfo.hideawayCount,
      hideawayCondition: hideawayInfo.condition,
    } as any);
  }
}
