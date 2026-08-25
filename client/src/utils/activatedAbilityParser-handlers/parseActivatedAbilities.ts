/**
 * Origin parent: client/src/utils/activatedAbilityParser.ts
 *
 * Cluster moved: parseActivatedAbilities.
 *
 * Public entry symbols: parseActivatedAbilities.
 */

import type { BattlefieldPermanent, KnownCardRef } from '../../../../shared/src';
import { collectEffectiveGrantedAbilityTexts } from '../../../../shared/src/attachmentAbilityGrants';
import { parseEquipAbilitiesFromOracle } from '../../../../shared/src/equipAbilities';
import { parseNumberFromText, parseSacrificeCost } from '../../../../shared/src/textUtils';
import { appendGrantedActivatedAbilities } from './appendGrantedActivatedAbilities';
import type { ParsedActivatedAbility } from './activatedAbilityParserTypes';
import { parseCostComponents, parseMillEffect } from './parseActivatedAbilityCostAndMill';
import { parseManaProduction } from './parseManaProduction';
import {
  normalizeAbilitySentence,
  parseStationThreshold,
  parseThresholdGatedAbilityLine,
} from './parseStationAndThresholdHelpers';
import { parseTimingRestrictionFromText } from './parseTimingRestrictionFromText';

/**
 * Parse activated abilities from a card's oracle text
 */
export function parseActivatedAbilities(
  card: KnownCardRef,
  grantedAbilities?: readonly string[],
  options?: { battlefield?: readonly BattlefieldPermanent[] | null; permanent?: BattlefieldPermanent | null },
): ParsedActivatedAbility[] {
  const abilities: ParsedActivatedAbility[] = [];
  const rawOracleText = card.oracle_text || '';
  // Shock lands print the tap-mana line in parentheses: "({T}: Add {G} or {U}.)".
  // Keep those intrinsic mana lines so duals use the same color-picker UI as Botanical Sanctum
  // instead of falling through to separate "Tap for {G}" / "Tap for {U}" basic-type buttons.
  const parentheticalManaLines = Array.from(
    rawOracleText.matchAll(/\(\s*(\{T\}:\s*Add\s+[^)]+?)\.?\s*\)/gi),
  ).map((match) => String(match[1] || '').trim()).filter(Boolean);
  const oracleText = rawOracleText.replace(/\([^)]*\)/g, '');
  const typeLine = (card.type_line || '').toLowerCase();
  const name = card.name || '';
  const lowerOracle = oracleText.toLowerCase();
  const nativeOracleText = [
    oracleText
      .replace(/(?:other\s+)?(?:nontoken\s+)?creatures you control have\s+["“”][^"“”]*\{t\}:[^"“”]*["“”]/gi, '')
      .replace(/(?:other\s+)?lands you control have\s+["“”][^"“”]*\{t\}:[^"“”]*["“”]/gi, '')
      .replace(/(?:other\s+)?permanents you control have\s+["“”][^"“”]*\{t\}:[^"“”]*["“”]/gi, ''),
    ...parentheticalManaLines,
  ].filter(Boolean).join('\n');
  const lowerNativeOracle = nativeOracleText.toLowerCase();
  const hasExplicitTapManaAbility = /\{t\}\s*:\s*add\b/i.test(nativeOracleText);
  
  let abilityIndex = 0;
  
  // ======== BASIC LAND MANA ABILITIES ========
  // Lands with basic land types have intrinsic mana abilities, but prefer
  // the printed tap-mana line when the oracle text already provides one.
  // Multiple basic types without an explicit printed line still get one choice ability
  // (Sanctum-style) rather than separate single-color buttons.
  if (!hasExplicitTapManaAbility) {
    const basicTypeColors: string[] = [];
    if (typeLine.includes('plains')) basicTypeColors.push('W');
    if (typeLine.includes('island')) basicTypeColors.push('U');
    if (typeLine.includes('swamp')) basicTypeColors.push('B');
    if (typeLine.includes('mountain')) basicTypeColors.push('R');
    if (typeLine.includes('forest')) basicTypeColors.push('G');

    if (basicTypeColors.length >= 2) {
      const produced = basicTypeColors.map((color) => `{${color}}`).join(' or ');
      abilities.push({
        id: `${card.id}-ability-${abilityIndex++}`,
        label: `Add ${produced}`,
        description: `Add ${produced}`,
        cost: '{T}',
        effect: `Add ${produced}`,
        requiresTap: true,
        requiresUntap: false,
        requiresSacrifice: false,
        isManaAbility: true,
        isLoyaltyAbility: false,
        isFetchAbility: false,
      });
    } else if (basicTypeColors.length === 1) {
      const color = basicTypeColors[0];
      const colorNames: Record<string, string> = {
        W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green',
      };
      abilities.push({
        id: `${card.id}-mana-${color.toLowerCase()}-${abilityIndex++}`,
        label: `Tap for {${color}}`,
        description: `Add one ${colorNames[color] || color} mana to your mana pool`,
        cost: '{T}',
        effect: `Add {${color}}`,
        requiresTap: true,
        requiresUntap: false,
        requiresSacrifice: false,
        isManaAbility: true,
        isLoyaltyAbility: false,
        isFetchAbility: false,
      });
    }
  }
  
  // ======== PLANESWALKER LOYALTY ABILITIES ========
  if (typeLine.includes('planeswalker')) {
    // Match planeswalker ability patterns: +N:, -N:, or 0: at start of line
    // Scryfall oracle text uses plain format without brackets (e.g., "+1: Effect text")
    // The pattern matches various dash characters: regular minus (-), en dash (–), em dash (—), and Unicode minus (−)
    const pwAbilityPattern = /^([+−–—-]?\d+):\s*(.+)/gm;
    let pwMatch;
    while ((pwMatch = pwAbilityPattern.exec(oracleText)) !== null) {
      const loyaltyCostStr = pwMatch[1].replace(/[−–—]/g, '-');
      const loyaltyCost = parseInt(loyaltyCostStr, 10);
      const abilityText = pwMatch[2].trim();
      const shortText = abilityText.length > 60 ? abilityText.slice(0, 57) + '...' : abilityText;
      
      const costLabel = loyaltyCost > 0 ? `+${loyaltyCost}` : `${loyaltyCost}`;
      
      abilities.push({
        id: `pw-ability-${abilityIndex++}`,
        label: `[${costLabel}]`,
        description: shortText,
        cost: `[${costLabel}]`,
        effect: abilityText,
        requiresTap: false,
        requiresUntap: false,
        requiresSacrifice: false,
        loyaltyCost,
        isManaAbility: false,
        isLoyaltyAbility: true,
        isFetchAbility: false,
        timingRestriction: 'sorcery',
        oncePerTurn: true,
      });
    }
  }
  
  // ======== GENERAL ACTIVATED ABILITIES ========
  // Parse "{cost}, {cost}: {effect}" patterns from oracle text
  // Standard MTG activated ability format: costs separated by commas, then colon, then effect
  // Examples:
  // - "{4}, {T}: Target creature can't be blocked this turn." (Rogue's Passage)
  // - "{T}: Add {C}." (Wastes)
  // - "{2}, {T}, Sacrifice CARDNAME: Draw two cards." (common)
  // The pattern looks for text starting with { that contains : followed by effect text
  
  // Pre-compile regex patterns for performance
  const activatedAbilityPattern = /^(\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*(?:Sacrifice[^:]*|Pay[^:]*|Discard[^:]*|Exile[^:]*|Remove[^:]*|Tap[^:]*|Untap[^:]*))?)\s*:\s*(.+)$/i;
  const textOnlyActivatedAbilityPattern = /^((?:Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)[^:]*?)\s*:\s*(.+)$/i;
  const triggeredAbilityPattern = /^(when|whenever|at)\b/i;
  
  // Split oracle text by newlines and process each line/sentence
  const sentences = nativeOracleText.split(/\n/);
  for (const rawSentence of sentences) {
    const sentence = normalizeAbilitySentence(rawSentence);
    const thresholdAbility = parseThresholdGatedAbilityLine(
      sentence,
      activatedAbilityPattern,
      textOnlyActivatedAbilityPattern
    );
    if (thresholdAbility) {
      const costPart = thresholdAbility.cost;
      const effectPart = thresholdAbility.effect;
      const costComponents = parseCostComponents(costPart);
      const manaProduced = parseManaProduction(effectPart);
      const isManaAbility = !!manaProduced && !effectPart.toLowerCase().includes('target');
      const lowerEffectPart = effectPart.toLowerCase();
      const isFetchAbility =
        typeLine.includes('land') &&
        costComponents.requiresSacrifice === true &&
        lowerEffectPart.includes('search your library') &&
        (lowerEffectPart.includes('land card') ||
          /\bforest\b|\bplains\b|\bisland\b|\bswamp\b|\bmountain\b/i.test(effectPart));

      const requiresTarget = /\btarget\b/i.test(effectPart);
      let targetDescription: string | undefined;
      if (requiresTarget) {
        const targetMatch = effectPart.match(/target\s+([^.]+)/i);
        if (targetMatch) {
          targetDescription = targetMatch[1].trim();
        }
      }

      let timingRestriction: ParsedActivatedAbility['timingRestriction'] | undefined = parseTimingRestrictionFromText(sentence);

      const oncePerTurn = /activate\s+(?:this\s+ability\s+)?only\s+once\s+(?:each|per)\s+turn/i.test(nativeOracleText);
      const millEffect = parseMillEffect(effectPart);
      const isMillAbility = millEffect?.isMillAbility || false;
      const millCount = millEffect?.millCount;
      const millTargetType = millEffect?.millTargetType;

      let label: string;
      if (isManaAbility) {
        label = `Add ${manaProduced}`;
      } else if (isFetchAbility) {
        label = /up to\s+two/i.test(effectPart) ? 'Fetch Lands' : 'Fetch Land';
      } else if (isMillAbility && millCount) {
        const targetStr = millTargetType === 'self' ? '' :
          millTargetType === 'opponent' ? 'opponent ' :
          millTargetType === 'player' ? 'target player ' : '';
        label = `Mill ${millCount} (${targetStr || 'self'})`;
      } else if (costComponents.requiresSacrifice) {
        const shortEffect = effectPart.split('.')[0];
        if (shortEffect.length <= 30) {
          label = shortEffect;
        } else {
          label = 'Sacrifice: ' + shortEffect.split(' ').slice(0, 2).join(' ') + '...';
        }
      } else if (requiresTarget) {
        const shortEffect = effectPart.split('.')[0];
        if (shortEffect.length <= 30) {
          label = shortEffect;
        } else {
          label = targetDescription
            ? `Target ${targetDescription.split(' ').slice(0, 2).join(' ')}...`
            : 'Target';
        }
      } else {
        const shortEffect = effectPart.split('.')[0];
        if (shortEffect.length <= 30) {
          label = shortEffect;
        } else {
          label = effectPart.split(' ').slice(0, 4).join(' ') + '...';
        }
      }

      abilities.push({
        id: `${card.id}-ability-${abilityIndex++}`,
        label,
        description: `${effectPart.length > 100 ? effectPart.slice(0, 97) + '...' : effectPart} Available at ${thresholdAbility.threshold}+ charge counters.`,
        cost: costPart,
        effect: effectPart,
        ...costComponents,
        isManaAbility,
        isLoyaltyAbility: false,
        isFetchAbility,
        isMillAbility,
        millCount,
        millTargetType,
        timingRestriction,
        oncePerTurn,
        requiresTarget,
        targetDescription,
        stationThreshold: thresholdAbility.threshold,
      });
      continue;
    }

    // Match pattern: starts with mana/tap costs, followed by colon, then effect
    // This pattern captures: {cost}{cost}... or {cost}, {cost}, ... : effect
    const abilityMatch = sentence.match(activatedAbilityPattern);
    
    if (abilityMatch) {
      const costPart = abilityMatch[1].trim();
      const effectPart = abilityMatch[2].trim();
      
      // Skip if cost is empty or just whitespace
      if (!costPart) continue;
      
      // Skip if this looks like a triggered ability (starts with "when", "whenever", "at")
      if (triggeredAbilityPattern.test(effectPart)) continue;
      
      // Skip Channel abilities - these can only be activated from hand, not battlefield
      // Channel format: "Channel — {cost}, Discard this card: effect"
      // The ability cost will contain "Discard this card" or "Discard CARDNAME"
      const costLower = costPart.toLowerCase();
      if (costLower.includes('discard this card') || 
          costLower.includes('discard ' + name.toLowerCase()) ||
          sentence.toLowerCase().includes('channel —') ||
          sentence.toLowerCase().includes('channel -')) {
        continue;
      }
      
      // Skip if this is already captured (basic land mana, fetch, or planeswalker)
      if (abilities.some(a => a.effect.toLowerCase().includes(effectPart.toLowerCase().slice(0, 20)))) {
        continue;
      }
      
      const costComponents = parseCostComponents(costPart);
      const manaProduced = parseManaProduction(effectPart);
      const isManaAbility = !!manaProduced && !effectPart.toLowerCase().includes('target');
      const lowerEffectPart = effectPart.toLowerCase();
      const isFetchAbility =
        typeLine.includes('land') &&
        costComponents.requiresSacrifice === true &&
        lowerEffectPart.includes('search your library') &&
        (lowerEffectPart.includes('land card') ||
          /\bforest\b|\bplains\b|\bisland\b|\bswamp\b|\bmountain\b/i.test(effectPart));
      
      // Determine if this requires a target
      const requiresTarget = /\btarget\b/i.test(effectPart);
      let targetDescription: string | undefined;
      if (requiresTarget) {
        const targetMatch = effectPart.match(/target\s+([^.]+)/i);
        if (targetMatch) {
          targetDescription = targetMatch[1].trim();
        }
      }
      
      // Check for timing restrictions in the full oracle text
      let timingRestriction: ParsedActivatedAbility['timingRestriction'] | undefined = parseTimingRestrictionFromText(sentence);
      
      // Check for once per turn
      const oncePerTurn = /activate\s+(?:this\s+ability\s+)?only\s+once\s+(?:each|per)\s+turn/i.test(nativeOracleText);
      
      // Check for mill effect
      const millEffect = parseMillEffect(effectPart);
      const isMillAbility = millEffect?.isMillAbility || false;
      const millCount = millEffect?.millCount;
      const millTargetType = millEffect?.millTargetType;
      
      // Create a label - make it more descriptive
      let label: string;
      if (isManaAbility) {
        label = `Add ${manaProduced}`;
      } else if (isFetchAbility) {
        label = /up to\s+two/i.test(effectPart) ? 'Fetch Lands' : 'Fetch Land';
      } else if (isMillAbility && millCount) {
        // Mill ability label
        const targetStr = millTargetType === 'self' ? '' : 
                         millTargetType === 'opponent' ? 'opponent ' : 
                         millTargetType === 'player' ? 'target player ' : '';
        label = `Mill ${millCount} (${targetStr || 'self'})`;
      } else if (costComponents.requiresSacrifice) {
        // Try to get a better label from the effect
        const shortEffect = effectPart.split('.')[0];
        if (shortEffect.length <= 30) {
          label = shortEffect;
        } else {
          label = 'Sacrifice: ' + shortEffect.split(' ').slice(0, 2).join(' ') + '...';
        }
      } else if (requiresTarget) {
        // For targeting abilities, show what it does
        const shortEffect = effectPart.split('.')[0];
        if (shortEffect.length <= 30) {
          label = shortEffect;
        } else {
          label = targetDescription 
            ? `Target ${targetDescription.split(' ').slice(0, 2).join(' ')}...` 
            : 'Target';
        }
      } else {
        // Get first sentence or first few words
        const shortEffect = effectPart.split('.')[0];
        if (shortEffect.length <= 30) {
          label = shortEffect;
        } else {
          label = effectPart.split(' ').slice(0, 4).join(' ') + '...';
        }
      }
      
      abilities.push({
        id: `${card.id}-ability-${abilityIndex++}`,
        label,
        description: effectPart.length > 100 ? effectPart.slice(0, 97) + '...' : effectPart,
        cost: costPart,
        effect: effectPart,
        ...costComponents,
        isManaAbility,
        isLoyaltyAbility: false,
        isFetchAbility,
        isMillAbility,
        millCount,
        millTargetType,
        timingRestriction,
        oncePerTurn,
        requiresTarget,
        targetDescription,
      });
    }
  }

  // Parse activated abilities with non-braced text-only costs such as
  // "Sacrifice Commander's Sphere: Draw a card."
  for (const rawSentence of sentences) {
    const sentence = normalizeAbilitySentence(rawSentence);
    const abilityMatch = sentence.match(textOnlyActivatedAbilityPattern);
    if (!abilityMatch) continue;

    const costPart = abilityMatch[1].trim();
    const effectPart = abilityMatch[2].trim();
    if (!costPart || !effectPart) continue;
    if (triggeredAbilityPattern.test(effectPart)) continue;

    const effectPrefix = effectPart.toLowerCase().slice(0, Math.min(30, effectPart.length));
    const alreadyParsed = abilities.some(a =>
      a.cost.toLowerCase() === costPart.toLowerCase() ||
      a.effect.toLowerCase().startsWith(effectPrefix)
    );
    if (alreadyParsed) continue;

    const costComponents = parseCostComponents(costPart);
    const requiresTarget = /\btarget\b/i.test(effectPart);
    let targetDescription: string | undefined;
    if (requiresTarget) {
      const targetMatch = effectPart.match(/target\s+([^.]+)/i);
      if (targetMatch) {
        targetDescription = targetMatch[1].trim();
      }
    }
    const isParsedManaAbility = !requiresTarget && parseManaProduction(effectPart) !== null;

    let label: string;
    const shortEffect = effectPart.split('.')[0];
    if (shortEffect.length <= 30) {
      label = shortEffect;
    } else if (costComponents.requiresSacrifice) {
      label = 'Sacrifice: ' + shortEffect.split(' ').slice(0, 2).join(' ') + '...';
    } else if (requiresTarget) {
      label = targetDescription
        ? `Target ${targetDescription.split(' ').slice(0, 2).join(' ')}...`
        : 'Target';
    } else {
      label = effectPart.split(' ').slice(0, 4).join(' ') + '...';
    }

    abilities.push({
      id: `${card.id}-ability-${abilityIndex++}`,
      label,
      description: effectPart.length > 100 ? effectPart.slice(0, 97) + '...' : effectPart,
      cost: costPart,
      effect: effectPart,
      ...costComponents,
      isManaAbility: isParsedManaAbility,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      requiresTarget,
      targetDescription,
    });
  }
  
  // ======== "TAP: ADD" PATTERN (simpler mana abilities) ========
  // For artifacts and creatures with simple mana abilities not caught above
  if (!abilities.some(a => a.isManaAbility) && !typeLine.includes('land')) {
    const simpleManaMatch = nativeOracleText.match(/\{T\}:\s*Add\s+(\{[^}]+\}(?:\s*or\s*\{[^}]+\})*)/i);
    if (simpleManaMatch) {
      abilities.push({
        id: `${card.id}-mana-${abilityIndex++}`,
        label: `Tap for mana`,
        description: `Add ${simpleManaMatch[1]}`,
        cost: '{T}',
        effect: `Add ${simpleManaMatch[1]}`,
        requiresTap: true,
        requiresUntap: false,
        requiresSacrifice: false,
        isManaAbility: true,
        isLoyaltyAbility: false,
        isFetchAbility: false,
      });
    }
    
    // "Add one mana of any color" pattern
    if (lowerNativeOracle.includes('{t}') && 
      (lowerNativeOracle.includes('add one mana of any color') || 
       lowerNativeOracle.includes('add {w}{u}{b}{r}{g}') ||
       lowerNativeOracle.includes('any type of mana'))) {
      // Don't add if we already have a mana ability for this
      if (!abilities.some(a => a.isManaAbility)) {
        abilities.push({
          id: `${card.id}-mana-any-${abilityIndex++}`,
          label: 'Tap for any color',
          description: 'Add one mana of any color',
          cost: '{T}',
          effect: 'Add one mana of any color',
          requiresTap: true,
          requiresUntap: false,
          requiresSacrifice: false,
          isManaAbility: true,
          isLoyaltyAbility: false,
          isFetchAbility: false,
        });
      }
    }
  }

  const effectiveGranted = options?.permanent
    ? collectEffectiveGrantedAbilityTexts(options.permanent, options.battlefield as any[] | undefined)
    : (Array.isArray(grantedAbilities) ? [...grantedAbilities] : []);
  appendGrantedActivatedAbilities(abilities, effectiveGranted, String(card.id || 'card'));
  
  // ======== EQUIP ABILITIES ========
  // Equipment can have multiple equip abilities (shared parser):
  // - "Equip {7}", "Equip legendary creature {3}", "Equip Wizard {1}"
  // - "Equip Shaman, Warlock, or Wizard {2}", "Equip commander {2}", etc.
  if (typeLine.includes('equipment')) {
    for (const equip of parseEquipAbilitiesFromOracle(oracleText)) {
      abilities.push({
        id: `${card.id}-equip-${abilityIndex++}`,
        label: equip.label,
        description: `Attach to target ${equip.targetDescription}`,
        cost: equip.cost,
        effect: `Attach to target ${equip.targetDescription}`,
        requiresTap: false,
        requiresUntap: false,
        requiresSacrifice: false,
        manaCost: equip.cost,
        isManaAbility: false,
        isLoyaltyAbility: false,
        isFetchAbility: false,
        timingRestriction: 'sorcery',
        requiresTarget: true,
        targetDescription: equip.targetDescription,
      });
    }
  }
  
  // ======== RECONFIGURE ABILITIES ========
  // Reconfigure [cost] - Equipment with reconfigure can attach/unattach at sorcery speed
  // When attached, it's not a creature. When unattached, it's a creature.
  // Check for reconfigure keyword in oracle text and Equipment in type line
  const reconfigureMatch = oracleText.match(/reconfigure\s*(\{[^}]+\}|\d+)/i);
  if (reconfigureMatch && typeLine.includes('equipment')) {
    const reconfigureCost = reconfigureMatch[1].startsWith('{') ? reconfigureMatch[1] : `{${reconfigureMatch[1]}}`;
    
    // Two abilities: attach and unattach
    // Attach ability
    abilities.push({
      id: `${card.id}-reconfigure-attach-${abilityIndex++}`,
      label: `Reconfigure ${reconfigureCost} (Attach)`,
      description: 'Attach to target creature you control (stops being a creature)',
      cost: reconfigureCost,
      effect: 'Attach to target creature you control',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: reconfigureCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery',
      requiresTarget: true,
      targetDescription: 'creature you control',
    });
    
    // Unattach ability
    abilities.push({
      id: `${card.id}-reconfigure-unattach-${abilityIndex++}`,
      label: `Reconfigure ${reconfigureCost} (Unattach)`,
      description: 'Unattach (becomes a creature again)',
      cost: reconfigureCost,
      effect: 'Unattach this Equipment',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: reconfigureCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery',
      requiresTarget: false,
    });
  }
  
  // ======== CREW ABILITIES (Vehicles) ========
  // Crew N: Tap any number of creatures you control with total power N or more
  if (typeLine.includes('vehicle')) {
    const crewMatch = oracleText.match(/crew\s*(\d+)/i);
    if (crewMatch) {
      const crewPower = parseInt(crewMatch[1], 10);
      abilities.push({
        id: `${card.id}-crew-${abilityIndex++}`,
        label: `Crew ${crewPower}`,
        description: `Tap creatures with total power ${crewPower}+ to make this a creature`,
        cost: '',
        effect: `This Vehicle becomes an artifact creature until end of turn`,
        requiresTap: false,
        requiresUntap: false,
        requiresSacrifice: false,
        isManaAbility: false,
        isLoyaltyAbility: false,
        isFetchAbility: false,
        isCrewAbility: true,
        crewPower,
        timingRestriction: undefined, // Can crew at instant speed
      });
    }
  }
  
  // ======== STATION ABILITIES (Spacecraft) ========
  // Station N (Rule 702.184a): Tap another untapped creature you control: Put charge counters
  // equal to that creature's power on this permanent
  if (typeLine.includes('spacecraft') || typeLine.includes('planet') || lowerOracle.includes('station')) {
    const stationThreshold = parseStationThreshold(oracleText);
    if (typeof stationThreshold === 'number' && Number.isFinite(stationThreshold)) {
      abilities.push({
        id: `${card.id}-station-${abilityIndex++}`,
        label: `Station ${stationThreshold}`,
        description: `Tap a creature to add counters equal to its power. Creature at ${stationThreshold}+ counters.`,
        cost: 'Tap another creature',
        effect: `Tap another untapped creature: Put charge counters on this equal to that creature's power. Becomes a creature at ${stationThreshold}+ counters.`,
        requiresTap: false,
        requiresUntap: false,
        requiresSacrifice: false,
        isManaAbility: false,
        isLoyaltyAbility: false,
        isFetchAbility: false,
        isStationAbility: true,
        stationThreshold,
        timingRestriction: 'sorcery', // Station is sorcery speed (Rule 702.184a)
      });
    }
  }
  
  // ======== LEVEL UP ABILITIES (Rule 702.87) ========
  // "Level up [cost]" means "[Cost]: Put a level counter on this permanent. Activate only as a sorcery."
  const levelUpMatch = oracleText.match(/level\s+up\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (levelUpMatch) {
    const levelUpCost = levelUpMatch[1];
    abilities.push({
      id: `${card.id}-level-up-${abilityIndex++}`,
      label: `Level Up ${levelUpCost}`,
      description: 'Put a level counter on this permanent (sorcery speed)',
      cost: levelUpCost,
      effect: 'Put a level counter on this permanent',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: levelUpCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery', // Level up is sorcery speed only
    });
  }
  
  // ======== OUTLAST ABILITIES (Rule 702.107) ========
  // "Outlast [cost]" means "[Cost], {T}: Put a +1/+1 counter on this creature. Activate only as a sorcery."
  // Example oracle text: "Outlast {W} ({W}, {T}: Put a +1/+1 counter on this creature. Outlast only as a sorcery.)"
  const outlastMatch = oracleText.match(/outlast\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (outlastMatch) {
    const outlastCost = outlastMatch[1];
    abilities.push({
      id: `${card.id}-outlast-${abilityIndex++}`,
      label: `Outlast ${outlastCost}`,
      description: 'Put a +1/+1 counter on this creature (sorcery speed, tap)',
      cost: `${outlastCost}, {T}`,
      effect: 'Put a +1/+1 counter on this creature',
      requiresTap: true,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: outlastCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery', // Outlast is sorcery speed only (Rule 702.107a)
    });
  }
  
  // ======== BOAST ABILITIES (Rule 702.142) ========
  // "Boast — [Cost]: [Effect]" - Activate only if creature attacked this turn and only once each turn
  // Example: "Boast — {1}{R}: Create a Treasure token."
  const boastMatch = oracleText.match(/boast\s*[—-]\s*(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*([^.]+)/i);
  if (boastMatch) {
    const boastCost = boastMatch[1];
    const boastEffect = boastMatch[2].trim();
    abilities.push({
      id: `${card.id}-boast-${abilityIndex++}`,
      label: `Boast ${boastCost}`,
      description: `${boastEffect} (only if attacked this turn, once per turn)`,
      cost: boastCost,
      effect: boastEffect,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: boastCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      oncePerTurn: true,
    });
  }
  
  // ======== MONSTROSITY ABILITIES (Rule 702.94) ========
  // "{cost}: Monstrosity N" - Put N +1/+1 counters on this creature (if not monstrous)
  // Example: "Monstrosity 3" or "{5}{G}{G}: Monstrosity 3"
  const monstrosityMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*monstrosity\s+(\d+)/i);
  if (monstrosityMatch) {
    const monstrosityCost = monstrosityMatch[1];
    const monstrosityN = parseInt(monstrosityMatch[2], 10);
    abilities.push({
      id: `${card.id}-monstrosity-${abilityIndex++}`,
      label: `Monstrosity ${monstrosityN}`,
      description: `Put ${monstrosityN} +1/+1 counter${monstrosityN !== 1 ? 's' : ''} on ${name} (can only be activated if not monstrous)`,
      cost: monstrosityCost,
      effect: `Put ${monstrosityN} +1/+1 counter${monstrosityN !== 1 ? 's' : ''} on this creature. It becomes monstrous.`,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: monstrosityCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== ADAPT ABILITIES (Rule 702.140) ========
  // "{cost}: Adapt N" - Put N +1/+1 counters if no +1/+1 counters on it
  // Example: "{1}{G}{U}: Adapt 2"
  const adaptMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*adapt\s+(\d+)/i);
  if (adaptMatch) {
    const adaptCost = adaptMatch[1];
    const adaptN = parseInt(adaptMatch[2], 10);
    abilities.push({
      id: `${card.id}-adapt-${abilityIndex++}`,
      label: `Adapt ${adaptN}`,
      description: `Put ${adaptN} +1/+1 counter${adaptN !== 1 ? 's' : ''} on ${name} (only if it has no +1/+1 counters)`,
      cost: adaptCost,
      effect: `Put ${adaptN} +1/+1 counter${adaptN !== 1 ? 's' : ''} on this creature if it has no +1/+1 counters on it.`,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: adaptCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== FORTIFY ABILITIES (Rule 702.67) ========
  // "Fortify {cost}" - Attach Fortification to target land you control (sorcery speed)
  // Example: "Fortify {3}"
  const fortifyMatch = oracleText.match(/fortify\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (fortifyMatch && typeLine.toLowerCase().includes('fortification')) {
    const fortifyCost = fortifyMatch[1];
    abilities.push({
      id: `${card.id}-fortify-${abilityIndex++}`,
      label: `Fortify ${fortifyCost}`,
      description: 'Attach to target land you control (sorcery speed)',
      cost: fortifyCost,
      effect: 'Attach this Fortification to target land you control',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: fortifyCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery',
      requiresTarget: true,
      targetDescription: 'land you control',
    });
  }
  
  // ======== CYCLING ABILITIES ========
  const cyclingAbilities = oracleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const plainCyclingMatch = line.match(/^cycling\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      if (plainCyclingMatch) {
        return [{
          keywordLabel: 'Cycle',
          cost: plainCyclingMatch[1],
          description: 'Discard this card: Draw a card',
          effect: 'Discard this card, then draw a card',
        }];
      }

      const typeCyclingMatch = line.match(/^(.+?)cycling\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      if (!typeCyclingMatch) {
        return [];
      }

      const rawSelector = String(typeCyclingMatch[1] || '').trim();
      const cost = typeCyclingMatch[2];
      if (!rawSelector) {
        return [];
      }

      const normalizedSelector = rawSelector.toLowerCase();
      const prettySelector = rawSelector.replace(/\b\w/g, (char) => char.toUpperCase());
      const article = /^[aeiou]/i.test(prettySelector) ? 'an' : 'a';
      const landSelectors = new Set([
        'basic land',
        'artifact land',
        'land',
        'plains',
        'island',
        'swamp',
        'mountain',
        'forest',
        'desert',
        'gate',
        'cave',
        'locus',
        'lair',
        'sphere',
        'mine',
        'tower',
        'power-plant',
      ]);
      const isLandcycling = landSelectors.has(normalizedSelector) || normalizedSelector.endsWith(' land');
      const targetDescription = isLandcycling
        ? `${article} ${prettySelector} card`
        : `${article} ${prettySelector} creature card`;

      return [{
        keywordLabel: `${prettySelector}cycling`,
        cost,
        description: `Discard this card: Search your library for ${targetDescription}`,
        effect: `Discard this card, then search your library for ${targetDescription}`,
      }];
    });

  for (const cyclingAbility of cyclingAbilities) {
    abilities.push({
      id: `${card.id}-cycling-${abilityIndex++}`,
      label: `${cyclingAbility.keywordLabel} ${cyclingAbility.cost}`,
      description: cyclingAbility.description,
      cost: cyclingAbility.cost,
      effect: cyclingAbility.effect,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: cyclingAbility.cost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== DOMINUS INDESTRUCTIBLE COUNTER ABILITIES ========
  // Pattern: "{mana}, Sacrifice two other artifacts and/or creatures: Put an indestructible counter on [CARDNAME]."
  // This handles Mondrak, Glory Dominus and similar Phyrexian Dominus cards
  // These abilities have Phyrexian mana symbols like {W/P} which can be paid with life
  // 
  // Regex breakdown:
  //   (\{[^}]+\}(?:\{[^}]+\})*) - Capture mana cost (one or more mana symbols)
  //   ,?\s*                      - Optional comma and whitespace
  //   sacrifice\s+               - "sacrifice" keyword
  //   (two|three|\d+)            - Count word or number
  //   \s+other\s+                - "other" keyword (required for these abilities)
  //   (artifacts?...)            - Type combination (artifact and/or creature variants)
  //   :\s*put\s+an?\s+           - Colon separator and "put a/an"
  //   indestructible\s+counter   - The effect being detected
  const dominusMatch = oracleText.match(
    /(\{[^}]+\}(?:\{[^}]+\})*),?\s*sacrifice\s+(two|three|\d+)\s+other\s+(artifacts?\s+and\/or\s+creatures?|creatures?\s+and\/or\s+artifacts?):\s*put\s+an?\s+indestructible\s+counter/i
  );
  if (dominusMatch) {
    const manaCost = dominusMatch[1];
    const sacrificeCountStr = dominusMatch[2];
    const sacrificeCount = parseNumberFromText(sacrificeCountStr);
    
    abilities.push({
      id: `${card.id}-dominus-indestructible-${abilityIndex++}`,
      label: `Indestructible (${manaCost})`,
      description: `Pay ${manaCost} and sacrifice ${sacrificeCount} other artifacts and/or creatures to put an indestructible counter on ${name}`,
      cost: `${manaCost}, Sacrifice ${sacrificeCount} other artifacts and/or creatures`,
      effect: `Put an indestructible counter on ${name}`,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: true,
      sacrificeType: 'artifact_or_creature',
      sacrificeCount,
      mustBeOther: true,
      manaCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== THOUSAND-YEAR ELIXIR DETECTION ========
  // Special handling for cards that grant haste for tap abilities
  // This is handled separately in the context, but we note it here for completeness
  
  // ======== GENERIC ACTIVATED ABILITIES ========
  // Parse any remaining "cost: effect" patterns that weren't caught by specific parsers
  // This handles cards like Mite Overseer with token creation abilities
  // Pattern: {cost}{cost}...: effect text
  // Must contain at least one mana symbol or "{T}" and have an effect
  const genericAbilityPattern = /(\{[^}]+\}(?:(?:,\s*|\s*)\{[^}]+\})*)\s*:\s*([^.]+(?:\.[^.]*)?)/gi;
  let genericMatch;
  while ((genericMatch = genericAbilityPattern.exec(oracleText)) !== null) {
    const cost = genericMatch[1].trim();
    const effect = genericMatch[2].trim();

    if (/^players have no maximum hand size$/i.test(effect.trim())) {
      continue;
    }
    
    // Skip if we already have this ability parsed (by checking if same cost and effect exist)
    // We compare the first part of the effect text (up to 30 chars) to catch variations in wording
    // This threshold balances between avoiding duplicates and not missing genuinely different abilities
    const effectPrefix = effect.toLowerCase().slice(0, Math.min(30, effect.length));
    const normalizedCost = cost.toLowerCase().replace(/\s+/g, ' ').trim();
    const alreadyParsed = abilities.some((a) => {
      const existingCost = a.cost.toLowerCase().replace(/\s+/g, ' ').trim();
      return (
        a.effect.toLowerCase().startsWith(effectPrefix)
        || existingCost === normalizedCost
        || (existingCost === normalizedCost && a.isManaAbility)
      );
    });
    if (alreadyParsed) continue;
    
    // Skip mana abilities (already handled)
    const effectLower = effect.toLowerCase();
    if (/^add\s+\{[wubrgc]\}/i.test(effect) || /^add\s+(one|two|three|\d+)\s+mana/i.test(effect)) {
      continue;
    }
    
    // Skip if it's a keyword ability definition (not an activated ability)
    if (/^\([^)]+\)$/.test(effect)) continue;
    
    // Parse costs
    const requiresTap = /\{t\}/i.test(cost);
    const requiresUntap = /\{q\}/i.test(cost);
    const manaSymbolsMatch = cost.match(/\{[WUBRGC0-9X\/P]+\}/gi);
    const manaOnly = manaSymbolsMatch
      ? manaSymbolsMatch.filter(s => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}').join('')
      : '';
    
    // Parse sacrifice from cost
    const sacrificeInfo = parseSacrificeCost(cost);
    
    // Check for life payment in cost
    const lifeCostMatch = cost.match(/pay\s+(\d+)\s+life/i);
    const lifeCost = lifeCostMatch ? parseInt(lifeCostMatch[1], 10) : undefined;
    
    // Check for X in cost
    const hasXCost = /\{x\}/i.test(cost);
    const xCount = hasXCost ? (cost.match(/\{x\}/gi) || []).length : 0;
    
    // Build ability ID based on effect type
    let abilityType = 'ability';
    if (effectLower.includes('create') && effectLower.includes('token')) {
      abilityType = 'token';
    } else if (effectLower.includes('deal') && effectLower.includes('damage')) {
      abilityType = 'damage';
    } else if (effectLower.includes('draw')) {
      abilityType = 'draw';
    } else if (effectLower.includes('counter')) {
      abilityType = 'counter';
    } else if (effectLower.includes('search')) {
      abilityType = 'search';
    }
    
    // Create short label
    let label = `${cost}: ...`;
    if (effectLower.includes('create') && effectLower.includes('token')) {
      const tokenMatch = effect.match(/create\s+(?:a\s+)?(\d+\/\d+\s+)?[^.]+\s+token/i);
      if (tokenMatch) {
        label = `${cost}: Create token`;
      }
    } else if (effect.length <= 50) {
      label = `${cost}: ${effect}`;
    }
    
    abilities.push({
      id: `${card.id}-${abilityType}-${abilityIndex++}`,
      label,
      description: effect,
      cost,
      effect,
      requiresTap,
      requiresUntap,
      requiresSacrifice: sacrificeInfo.requiresSacrifice,
      sacrificeType: sacrificeInfo.sacrificeType,
      sacrificeCount: sacrificeInfo.sacrificeCount,
      mustBeOther: sacrificeInfo.mustBeOther,
      manaCost: manaOnly || undefined,
      lifeCost,
      hasXCost: hasXCost || undefined,
      xCount: xCount > 0 ? xCount : undefined,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      requiresTarget: effectLower.includes('target'),
      targetDescription: effectLower.includes('target') ? effect : undefined,
    });
  }
  
  return abilities;
}

