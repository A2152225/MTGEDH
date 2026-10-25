/**
 * combat-mechanics.ts
 * 
 * Comprehensive combat system for Magic: The Gathering
 * 
 * COMBAT PHASES:
 * 1. Beginning of Combat
 * 2. Declare Attackers
 * 3. Declare Blockers
 * 4. First Strike Damage (if applicable)
 * 5. Combat Damage
 * 6. End of Combat
 * 
 * EVASION ABILITIES:
 * - Flying: Can only be blocked by creatures with flying or reach
 * - Shadow: Can only be blocked by creatures with shadow
 * - Horsemanship: Can only be blocked by creatures with horsemanship
 * - Fear: Can only be blocked by artifact or black creatures
 * - Intimidate: Can only be blocked by artifact or same color creatures
 * - Menace: Must be blocked by 2+ creatures
 * - Skulk: Can't be blocked by creatures with greater power
 * - Unblockable: Can't be blocked
 * 
 * COMBAT KEYWORDS:
 * - First Strike: Deals damage before regular combat damage
 * - Double Strike: Deals both first strike and regular damage
 * - Lifelink: Controller gains life equal to damage dealt
 * - Deathtouch: Any damage is lethal
 * - Trample: Excess damage goes to defending player/planeswalker
 * - Vigilance: Doesn't tap when attacking
 * - Indestructible: Can't be destroyed by damage
 * 
 * PROTECTION:
 * - Protection from X: Can't be blocked, targeted, dealt damage, or enchanted by X
 * - Teferi's Protection: Phase out, life total can't change, protection from everything
 * - Hexproof: Can't be targeted by opponents
 * - Shroud: Can't be targeted by anyone
 * 
 * PHASING:
 * - Phased out permanents are treated as though they don't exist
 * - Phase in at beginning of owner's untap step
 */

import type { GameContext } from "../context.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { getContinuousGrantedAbilitiesForPermanent } from "./staticEffectSpec.js";
import { getEffectiveColors } from "./effectiveColors.js";
import { iterAttachments, parseAttachmentGrantedKeywordsFromOracle } from '../../../../shared/src/attachmentKeywordGrants.js';
import { isCreatureTypeWord, permanentHasCreatureType } from '../../../../shared/src/creatureTypes.js';
import { hasBlanketCantAttack } from '../../../../rules-engine/src/attackRestrictionText.js';
import { permanentHasKeywordAbility, permanentLosesKeyword } from "../../../../rules-engine/src/permanentKeywordAbilities.js";
import { grantedAbilityIsOwnKeyword } from "../../../../rules-engine/src/oracleOwnKeywordText.js";
import { canBlockShadowAsThough } from "./blockAsThoughShadow.js";

const COLOR_WORDS = ['white', 'blue', 'black', 'red', 'green'];

function permanentMatchesColorWord(permanent: any, colorWord: string): boolean {
  const code = ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' } as Record<string, string>)[colorWord];
  if (!code) return false;
  const colors = (permanent?.card?.colors || permanent?.colors || []) as unknown[];
  return colors.some((entry) => {
    const value = String(entry || '');
    return value.toUpperCase() === code || value.toLowerCase() === colorWord;
  });
}

export interface CombatCreature {
  permanentId: string;
  cardName: string;
  controller: string;
  power: number;
  toughness: number;
  damage: number;
  keywords: CreatureKeywords;
  protections: string[];
  colors: string[];
  types: string[];
  isToken: boolean;
  phasedOut: boolean;
}

export interface CreatureKeywords {
  flying: boolean;
  reach: boolean;
  shadow: boolean;
  /** "can block creatures with shadow as though it had shadow" */
  blockShadowAsThough?: boolean;
  horsemanship: boolean;
  fear: boolean;
  intimidate: boolean;
  menace: boolean;
  skulk: boolean;
  unblockable: boolean;
  firstStrike: boolean;
  doubleStrike: boolean;
  lifelink: boolean;
  deathtouch: boolean;
  trample: boolean;
  vigilance: boolean;
  indestructible: boolean;
  hexproof: boolean;
  shroud: boolean;
  haste: boolean;
  defender: boolean;
  cantAttack: boolean;
  cantBlock: boolean;
}

export interface BlockAssignment {
  attackerId: string;
  blockerIds: string[];
  damageAssignment: Record<string, number>; // blockerId -> damage assigned
}

export interface CombatState {
  attackers: string[]; // permanent IDs
  attackerTargets: Record<string, string>; // attackerId -> defender (player ID or planeswalker ID)
  blockers: Record<string, string[]>; // attackerId -> blockerIds
  damageAssignments: Record<string, Record<string, number>>; // attackerId -> { blockerId: damage }
  firstStrikeDamageDealt: boolean;
  combatDamageDealt: boolean;
}

/**
 * True when oracle text grants the keyword to THIS permanent (keyword line or
 * "this creature has X"). False for anthem text like "Other creatures have trample".
 */
export function oracleTextGrantsOwnKeyword(oracleText: string, keyword: string): boolean {
  const text = String(oracleText || '').toLowerCase();
  const kw = String(keyword || '').toLowerCase().trim();
  if (!text || !kw) return false;

  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

  // Explicit self grant anywhere
  if (new RegExp(`\\bthis\\s+(?:creature|permanent)\\b[^\\n.]*\\b(?:has|gains?)\\b[^\\n.]*\\b${escaped}\\b`, 'i').test(text)) {
    return true;
  }

  // Keyword ability lines / lists on this card (not triggered/activated prose, not anthems).
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(when|whenever|at\s+the\b|as\s+|if\s+)/.test(line)) continue;
    if (/[{][^}]*[}].*:/.test(line) || /^[^:\n]+:/.test(line)) continue; // activated
    if (/^(?:other\s+)?(?:[a-z]+\s+)?creatures?\s+you\s+control/.test(line)) continue;
    if (/^(?:enchanted|equipped)\s+/.test(line)) continue;
    if (/^all\s+creatures?/.test(line)) continue;
    // "Trample" / "Flying, trample" / "Trample (reminder)"
    if (new RegExp(`(?:^|,)\\s*${escaped}\\b`).test(line)) {
      return true;
    }
  }

  return false;
}

/**
 * Parse creature keywords from card data
 */
export function parseCreatureKeywords(card: any, permanent?: any, gameState?: any): CreatureKeywords {
  try {
    const cardName = card?.name || 'Unknown';
    const oracleText = (card?.oracle_text || "").toLowerCase();
    // Defensive handling: ensure keywords is an array of strings
    const rawKeywords = card?.keywords;
    
    // Always log keyword parsing for combat debugging
    debug(2, `[KEYWORDS] ========== Parsing keywords for: ${cardName} ==========`);
    debug(2, `[KEYWORDS] Raw keywords: type=${typeof rawKeywords}, isArray=${Array.isArray(rawKeywords)}`);
    debug(2, `[KEYWORDS] Raw value: ${rawKeywords ? JSON.stringify(rawKeywords) : 'undefined'}`);
    
    if (rawKeywords && !Array.isArray(rawKeywords)) {
      debugWarn(1, `[KEYWORDS] WARNING: keywords is not an array for ${cardName}: type=${typeof rawKeywords}`);
    }
    
    const keywords = Array.isArray(rawKeywords) 
      ? rawKeywords.filter((k: any) => typeof k === 'string').map((k: string) => k.toLowerCase())
      : [];
    
    debug(1, `[KEYWORDS] Normalized keywords array: [${keywords.join(', ')}]`);
    
    const hasKeyword = (kw: string) => {
      const needle = kw.toLowerCase();
      if (keywords.includes(needle)) return true;
      // Prefer keyword ability lines on THIS permanent. Do not treat
      // "Other creatures you control have trample" as granting trample to the source.
      return oracleTextGrantsOwnKeyword(oracleText, needle);
    };

    // Keywords can also be applied dynamically at runtime.
    // Common fields used across the server:
    // - permanent.tempAbilities: string[] (cleared at cleanup step)
    // - permanent.grantedAbilities: (string | any)[] (often persistent)
    // - permanent.temporaryAbilities: { ability: string }[] (often until EOT)
    const getPermanentAbilityStrings = (): string[] => {
      const collected: string[] = [];
      if (!permanent) return collected;

      const temp = Array.isArray((permanent as any).tempAbilities) ? (permanent as any).tempAbilities : [];
      for (const a of temp) {
        if (typeof a === 'string' && a.trim()) collected.push(a);
      }

      const granted = Array.isArray((permanent as any).grantedAbilities) ? (permanent as any).grantedAbilities : [];
      for (const a of granted) {
        if (typeof a === 'string' && a.trim()) collected.push(a);
      }

      const temporary = Array.isArray((permanent as any).temporaryAbilities) ? (permanent as any).temporaryAbilities : [];
      for (const a of temporary) {
        if (typeof a === 'string' && a.trim()) {
          collected.push(a);
        } else if (a && typeof a === 'object' && typeof (a as any).ability === 'string') {
          collected.push((a as any).ability);
        }
      }

      return collected;
    };

    const permanentAbilityStringsLower = getPermanentAbilityStrings().map(s => s.toLowerCase());
    const hasPermanentAbility = (kw: string) => {
      const needle = kw.toLowerCase();
      return permanentAbilityStringsLower.some(s => s === needle || s.includes(needle));
    };
    
    // Check for equipment/aura granted keywords
    let grantedKeywords: string[] = [];
    if (permanent && gameState) {
      const battlefield = gameState.battlefield || [];
      // Find equipment/auras attached to this creature
      for (const attachment of battlefield) {
        if (!attachment || !attachment.card) continue;
        const attachedTo = attachment.attachedTo;
        if (attachedTo !== permanent.id) continue;
        
        const attachmentOracle = (attachment.card.oracle_text || '').toLowerCase();
        const attachmentName = (attachment.card.name || '').toLowerCase();
        
        // Tenza, Godo's Maul: "As long as it's red, it has trample."
        if ((attachmentName.includes('tenza') || attachmentName.includes("godo's maul"))) {
          const creatureColors = card?.colors || [];
          if (creatureColors.some((c: string) => c === 'R' || c.toLowerCase() === 'red')) {
            grantedKeywords.push('trample');
          }
        }
        
        // Generic parsing for "equipped/enchanted creature has [keywords]"
        for (const kw of parseAttachmentGrantedKeywordsFromOracle(attachmentOracle)) {
          if (kw && !grantedKeywords.includes(kw)) {
            grantedKeywords.push(kw);
          }
        }
      }
    }
    
    // Check for lord effects granting keywords
    // "Other [type] creatures you control have [keyword]" or "Creatures you control have [keyword]"
    if (permanent && gameState) {
      const battlefield = gameState.battlefield || [];
      const permanentController = permanent.controller || permanent.owner;
      const creatureTypeLine = (card?.type_line || '').toLowerCase();
      
      for (const lord of battlefield) {
        if (!lord || !lord.card) continue;
        // Can't grant keywords to itself
        if (lord.id === permanent.id) continue;
        // Must be controlled by same player
        if (lord.controller !== permanentController) continue;
        
        const lordOracle = (lord.card.oracle_text || '').toLowerCase();
        const lordName = (lord.card.name || '').toLowerCase();
        
        // Pattern: "Other [type] creatures you control have [keyword]"
        // Example: "Other Soldier creatures get +1/+1 and have first strike"
        const lordTypePattern = /other\s+(\w+)\s+creatures\s+(?:you control\s+)?(?:get\s+[+\-]\d+\/[+\-]\d+\s+and\s+)?have\s+([a-z\s,]+)/gi;
        let match;
        while ((match = lordTypePattern.exec(lordOracle)) !== null) {
          const targetType = match[1].toLowerCase();
          const keywordsText = match[2];
          
          // Check if this creature has the target type
          if (creatureTypeLine.includes(targetType) || permanentHasCreatureType(permanent, targetType)) {
            // Parse keywords from the text (could be comma-separated)
            const keywordList = keywordsText.split(/\s*(?:and|,)\s*/).map(k => k.trim());
            for (const kw of keywordList) {
              if (kw && kw.length > 0) {
                grantedKeywords.push(kw);
                debug(2, `[KEYWORDS] ${cardName} granted ${kw} by ${lord.card.name} (lord effect)`);
              }
            }
          }
        }

        // Pattern: "[Type]/[color] creatures you control have [keyword]" (includes self)
        // Example: "Pegasus creatures you control have lifelink"
        const typedHavePattern = /(?:^|[.\n;])\s*(?!other\s)([a-z]+)\s+creatures\s+(?:you control\s+)?(?:get\s+[+\-]\d+\/[+\-]\d+\s+and\s+)?have\s+([a-z\s,]+)/gi;
        while ((match = typedHavePattern.exec(lordOracle)) !== null) {
          const qualifier = match[1].toLowerCase();
          const keywordsText = match[2];
          const applies = COLOR_WORDS.includes(qualifier)
            ? permanentMatchesColorWord(permanent, qualifier)
            : (isCreatureTypeWord(qualifier)
              && (permanentHasCreatureType(permanent, qualifier) || creatureTypeLine.includes(qualifier)));
          if (!applies) continue;
          const keywordList = keywordsText.split(/\s*(?:and|,)\s*/).map(k => k.trim());
          for (const kw of keywordList) {
            if (kw && kw.length > 0) {
              grantedKeywords.push(kw);
              debug(2, `[KEYWORDS] ${cardName} granted ${kw} by ${lord.card.name} (typed lord effect)`);
            }
          }
        }
        
        // Pattern: "Creatures you control have [keyword]" (no type restriction)
        // Example: "Creatures you control have flying and indestructible"
        const lordGenericPattern = /(?<![a-z] )(?:all\s+)?creatures\s+you\s+control\s+(?:get\s+[+\-]\d+\/[+\-]\d+\s+and\s+)?have\s+([a-z\s,]+)/gi;
        while ((match = lordGenericPattern.exec(lordOracle)) !== null) {
          const keywordsText = match[1];
          
          // Don't double-count if this is actually an "other [type]" pattern
          if (lordOracle.includes('other ') && lordOracle.indexOf('other ') < match.index) {
            continue;
          }
          
          // Parse keywords from the text
          const keywordList = keywordsText.split(/\s*(?:and|,)\s*/).map(k => k.trim());
          for (const kw of keywordList) {
            if (kw && kw.length > 0) {
              grantedKeywords.push(kw);
              debug(2, `[KEYWORDS] ${cardName} granted ${kw} by ${lord.card.name} (anthem effect)`);
            }
          }
        }
        
        // Special case: "Creature tokens you control have [keyword]" during your turn
        // Example: Mite Overseer
        const lordTokenPattern = /(?:during your turn,?\s+)?creature\s+tokens\s+you\s+control\s+(?:get\s+[+\-]\d+\/[+\-]\d+\s+and\s+)?have\s+([a-z\s,]+)/gi;
        while ((match = lordTokenPattern.exec(lordOracle)) !== null) {
          const keywordsText = match[1];
          const isToken = (permanent as any).isToken === true;
          
          if (isToken) {
            // Check if "during your turn" restriction applies
            const hasTurnRestriction = lordOracle.includes('during your turn');
            const isLordTurn = gameState.turnPlayer === lord.controller;
            
            if (!hasTurnRestriction || isLordTurn) {
              const keywordList = keywordsText.split(/\s*(?:and|,)\s*/).map(k => k.trim());
              for (const kw of keywordList) {
                if (kw && kw.length > 0) {
                  grantedKeywords.push(kw);
                  debug(2, `[KEYWORDS] Token ${cardName} granted ${kw} by ${lord.card.name}`);
                }
              }
            }
          }
        }
      }
    }

    if (permanent && gameState) {
      for (const kw of getContinuousGrantedAbilitiesForPermanent(permanent, gameState)) {
        if (kw && !grantedKeywords.includes(kw)) {
          grantedKeywords.push(kw);
        }
      }
    }
    
    // Own keywords via the shared accurate helper (keyword lines, guarded Scryfall keywords,
    // granted/temporary abilities, counters, attachments, lords); "loses X" removes it.
    const keywordBattlefield: any[] = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
    const keywordSubject = permanent ? { ...permanent, card: permanent.card || card } : { card };
    const hasKeywordOrGranted = (kw: string) => {
      const needle = kw.toLowerCase();
      if (permanentLosesKeyword(keywordSubject, needle, keywordBattlefield)) return false;
      if (permanentHasKeywordAbility(keywordSubject, needle, keywordBattlefield)) return true;
      if (oracleTextGrantsOwnKeyword(oracleText, needle)) return true;
      return grantedKeywords.includes(needle) || permanentAbilityStringsLower.some((entry) => grantedAbilityIsOwnKeyword(entry, needle));
    };
    void hasKeyword; void hasPermanentAbility;
    
    const result = {
      flying: hasKeywordOrGranted("flying"),
      reach: hasKeywordOrGranted("reach"),
      shadow: hasKeywordOrGranted("shadow"),
      blockShadowAsThough: canBlockShadowAsThough(permanent ?? { card }, gameState?.battlefield),
      horsemanship: hasKeywordOrGranted("horsemanship"),
      fear: hasKeywordOrGranted("fear"),
      intimidate: hasKeywordOrGranted("intimidate"),
      menace: hasKeywordOrGranted("menace"),
      skulk: hasKeywordOrGranted("skulk"),
      unblockable: oracleText.includes("can't be blocked") || 
                    oracleText.includes("is unblockable") ||
                    hasPermanentAbility("can't be blocked") ||
                    hasPermanentAbility("unblockable"),
      firstStrike: hasKeywordOrGranted("first strike") && !hasKeywordOrGranted("double strike"),
      doubleStrike: hasKeywordOrGranted("double strike"),
      lifelink: hasKeywordOrGranted("lifelink"),
      deathtouch: hasKeywordOrGranted("deathtouch"),
      trample: hasKeywordOrGranted("trample"),
      vigilance: hasKeywordOrGranted("vigilance"),
      indestructible: hasKeywordOrGranted("indestructible"),
      hexproof: hasKeywordOrGranted("hexproof"),
      shroud: hasKeywordOrGranted("shroud"),
      haste: hasKeywordOrGranted("haste"),
      defender: hasKeywordOrGranted("defender"),
      cantAttack: hasBlanketCantAttack(oracleText)
        || hasKeywordOrGranted("defender")
        || hasKeywordOrGranted("can't attack"),
      cantBlock: oracleText.includes("can't block") || hasKeywordOrGranted("can't block"),
    };
    
    // Always log the parsed result with active keywords
    const activeKeywords = Object.entries(result).filter(([_, v]) => v === true).map(([k]) => k);
    debug(1, `[KEYWORDS] ${cardName} ACTIVE ABILITIES: [${activeKeywords.length > 0 ? activeKeywords.join(', ') : 'none'}]`);
    debug(2, `[KEYWORDS] First Strike: ${result.firstStrike}, Double Strike: ${result.doubleStrike}`);
    debug(2, `[KEYWORDS] ========== End parsing for: ${cardName} ==========`);
    
    return result;
  } catch (err) {
    debugError(1, `[KEYWORDS] CRASH parsing ${card?.name}:`, err);
    debugError(1, `[KEYWORDS] rawKeywords was:`, card?.keywords);
    debugError(1, `[KEYWORDS] Card data:`, JSON.stringify(card, null, 2).slice(0, 1000));
    debugError(1, `[KEYWORDS] Permanent data:`, permanent ? JSON.stringify(permanent, null, 2).slice(0, 500) : 'undefined');
    throw err; // Re-throw to let caller handle
  }
}

/**
 * Collect protection qualities ("green", "creatures", "everything", …) from oracle-like text.
 */
export function collectProtectionQualitiesFromText(oracleText: string, chosenColor?: string): string[] {
  const protections: string[] = [];
  const text = String(oracleText || "");
  
  // Protection from [color] - handles "protection from black", "protection from black and from red", etc.
  // First try the standard pattern
  const colorProtections = text.match(/protection from (white|blue|black|red|green)/gi);
  if (colorProtections) {
    for (const match of colorProtections) {
      protections.push(match.toLowerCase().replace("protection from ", ""));
    }
  }

  // Resolve "protection from the chosen color" using stored ETB choice.
  if (/protection from the chosen colou?r/i.test(text)) {
    const chosen = String(chosenColor || '').trim().toLowerCase();
    if (chosen && ['white', 'blue', 'black', 'red', 'green'].includes(chosen) && !protections.includes(chosen)) {
      protections.push(chosen);
    }
  }
  
  // Handle "and from [color]" pattern (e.g., "protection from black and from red")
  // This catches the second+ colors in compound protection text
  const additionalColors = text.match(/and from (white|blue|black|red|green)/gi);
  if (additionalColors) {
    for (const match of additionalColors) {
      const color = match.toLowerCase().replace("and from ", "");
      if (!protections.includes(color)) {
        protections.push(color);
      }
    }
  }
  
  // Protection from [type]
  const typeProtections = text.match(/protection from (creatures|artifacts|enchantments|instants|sorceries|planeswalkers)/gi);
  if (typeProtections) {
    for (const match of typeProtections) {
      protections.push(match.toLowerCase().replace("protection from ", ""));
    }
  }
  
  // Protection from everything (Teferi's Protection, Progenitus)
  if (text.toLowerCase().includes("protection from everything") ||
      text.toLowerCase().includes("protection from all")) {
    protections.push("everything");
  }
  
  // Protection from colored spells
  if (text.toLowerCase().includes("protection from colored")) {
    protections.push("colored");
  }
  
  // Protection from monocolored
  if (text.toLowerCase().includes("protection from monocolored")) {
    protections.push("monocolored");
  }
  
  // Protection from multicolored
  if (text.toLowerCase().includes("protection from multicolored")) {
    protections.push("multicolored");
  }
  
  return protections;
}

/**
 * Parse protection abilities from card
 */
function oracleTextForSelfProtection(oracleText: string): string {
  // "Enchanted creature has protection from …" is a host grant, not a self ability.
  return String(oracleText || '').replace(
    /(?:enchanted (?:creature|permanent|land)|equipped creature) has protection from [^.]+/gi,
    ' ',
  );
}

export function parseProtections(card: any, permanent?: any): string[] {
  return collectProtectionQualitiesFromText(
    oracleTextForSelfProtection(card?.oracle_text || ""),
    String(permanent?.chosenColor || permanent?.card?.chosenColor || card?.chosenColor || ''),
  );
}

function abilityTextFromGrantEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof (entry as any).ability === 'string') {
    return String((entry as any).ability);
  }
  return '';
}

function typeWordsFromPermanent(permanent: any): string[] {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  return typeLine.split(/[\s—\-]+/).map((part) => part.trim()).filter(Boolean);
}

/**
 * Protection qualities on a permanent, including Aura/Equipment grants and continuous effects.
 * Flickering Ward: "Enchanted creature has protection from the chosen color."
 */
export function getPermanentProtections(permanent: any, gameState?: any): string[] {
  const seen = new Set<string>();
  const addAll = (qualities: readonly string[]) => {
    for (const quality of qualities) {
      const normalized = String(quality || '').trim().toLowerCase();
      if (normalized) seen.add(normalized);
    }
  };

  addAll(parseProtections(permanent?.card, permanent));

  const grantTexts: string[] = [];
  for (const entry of [
    ...(Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : []),
    ...(Array.isArray(permanent?.tempAbilities) ? permanent.tempAbilities : []),
    ...(Array.isArray(permanent?.temporaryAbilities) ? permanent.temporaryAbilities : []),
    ...(Array.isArray(permanent?.grantedKeywords) ? permanent.grantedKeywords : []),
  ]) {
    const text = abilityTextFromGrantEntry(entry);
    if (text) grantTexts.push(text);
  }
  if (gameState) {
    grantTexts.push(...getContinuousGrantedAbilitiesForPermanent(permanent, gameState));
  }
  for (const text of grantTexts) {
    addAll(collectProtectionQualitiesFromText(text, String(permanent?.chosenColor || permanent?.card?.chosenColor || '')));
  }

  if (gameState) {
    const battlefield = Array.isArray(gameState.battlefield) ? gameState.battlefield : [];
    for (const attachment of iterAttachments(permanent, battlefield)) {
      const oracle = String(attachment?.card?.oracle_text || '');
      if (!/(?:enchanted (?:creature|permanent|land)|equipped creature) has protection/i.test(oracle)) {
        continue;
      }
      addAll(collectProtectionQualitiesFromText(
        oracle,
        String(attachment?.chosenColor || attachment?.card?.chosenColor || ''),
      ));
    }
  }

  return [...seen];
}

/**
 * True when protection on `protectedPermanent` prevents damage/blocking/targeting from `sourcePermanent`.
 */
export function protectionPreventsSource(
  protectedPermanent: any,
  sourcePermanent: any,
  gameState?: any,
): boolean {
  const protections = getPermanentProtections(protectedPermanent, gameState);
  if (protections.length === 0 || !sourcePermanent) return false;
  const colors = getEffectiveColors(sourcePermanent, gameState);
  return wouldDamageBePreventedByProtection(
    { colors, types: typeWordsFromPermanent(sourcePermanent) },
    { protections },
  );
}

/**
 * Check if a blocker can legally block an attacker
 */
export function canBlock(
  attacker: CombatCreature,
  blocker: CombatCreature,
  existingBlockers: CombatCreature[] = []
): { legal: boolean; reason?: string } {
  // Phased out creatures can't block
  if (blocker.phasedOut) {
    return { legal: false, reason: "Phased out creatures can't block" };
  }
  
  // Can't block if has defender or "can't block"
  if (blocker.keywords.cantBlock) {
    return { legal: false, reason: "This creature can't block" };
  }
  
  // Unblockable creatures can't be blocked
  if (attacker.keywords.unblockable) {
    return { legal: false, reason: "This creature can't be blocked" };
  }
  
  // Flying - must have flying or reach
  if (attacker.keywords.flying && !blocker.keywords.flying && !blocker.keywords.reach) {
    return { legal: false, reason: "Can only block with flying or reach" };
  }
  
  // Shadow - can only be blocked by shadow
  if (attacker.keywords.shadow && !blocker.keywords.shadow && !blocker.keywords.blockShadowAsThough) {
    return { legal: false, reason: "Can only be blocked by creatures with shadow" };
  }
  // Non-shadow can't be blocked by shadow
  if (!attacker.keywords.shadow && blocker.keywords.shadow) {
    return { legal: false, reason: "Shadow creatures can only block shadow creatures" };
  }
  
  // Horsemanship - can only be blocked by horsemanship
  if (attacker.keywords.horsemanship && !blocker.keywords.horsemanship) {
    return { legal: false, reason: "Can only be blocked by creatures with horsemanship" };
  }
  
  // Fear - can only be blocked by artifact or black creatures
  if (attacker.keywords.fear) {
    const isArtifact = blocker.types.includes("artifact");
    const isBlack = blocker.colors.includes("B") || blocker.colors.includes("black");
    if (!isArtifact && !isBlack) {
      return { legal: false, reason: "Can only be blocked by artifact or black creatures" };
    }
  }
  
  // Intimidate - can only be blocked by artifact or same color
  if (attacker.keywords.intimidate) {
    const isArtifact = blocker.types.includes("artifact");
    const sharesColor = attacker.colors.some(c => blocker.colors.includes(c));
    if (!isArtifact && !sharesColor) {
      return { legal: false, reason: "Can only be blocked by artifact or same color creatures" };
    }
  }
  
  // Skulk - can't be blocked by greater power
  if (attacker.keywords.skulk && blocker.power > attacker.power) {
    return { legal: false, reason: "Skulk: Can't be blocked by creatures with greater power" };
  }
  
  // Protection from [quality]
  for (const protection of attacker.protections) {
    if (protection === "everything") {
      return { legal: false, reason: "Protection from everything" };
    }
    if (protection === "creatures") {
      return { legal: false, reason: "Protection from creatures" };
    }
    // Color protection
    const colorMap: Record<string, string> = {
      white: "W", blue: "U", black: "B", red: "R", green: "G"
    };
    const blockerColors = (blocker.colors || []).map((c) => String(c || '').toUpperCase());
    if (colorMap[protection] && (blockerColors.includes(colorMap[protection]) || blocker.colors.includes(protection))) {
      return { legal: false, reason: `Protection from ${protection}` };
    }
  }
  
  // Menace - must be blocked by 2+ creatures
  if (attacker.keywords.menace) {
    const totalBlockers = existingBlockers.length + 1;
    if (totalBlockers < 2) {
      return { legal: true, reason: "Menace: Need 2+ blockers (current: " + totalBlockers + ")" };
    }
  }
  
  return { legal: true };
}

/**
 * Check if a creature can attack
 */
export function canAttack(
  creature: CombatCreature,
  hasHaste: boolean = false,
  summoned: boolean = false
): { legal: boolean; reason?: string } {
  // Phased out creatures can't attack
  if (creature.phasedOut) {
    return { legal: false, reason: "Phased out creatures can't attack" };
  }
  
  // Defender can't attack
  if (creature.keywords.defender || creature.keywords.cantAttack) {
    return { legal: false, reason: "This creature can't attack" };
  }
  
  // Summoning sickness (unless haste)
  if (summoned && !creature.keywords.haste && !hasHaste) {
    return { legal: false, reason: "Summoning sickness" };
  }
  
  return { legal: true };
}

/**
 * Calculate combat damage for first strike / double strike phase
 */
export function calculateFirstStrikeDamage(
  attackers: CombatCreature[],
  blockers: Record<string, CombatCreature[]>,
  damageAssignments: Record<string, Record<string, number>>
): { 
  damageToDefender: Record<string, number>;
  damageToCreatures: Record<string, number>;
  lifeGain: Record<string, number>;
  deaths: string[];
} {
  const result = {
    damageToDefender: {} as Record<string, number>,
    damageToCreatures: {} as Record<string, number>,
    lifeGain: {} as Record<string, number>,
    deaths: [] as string[],
  };
  
  for (const attacker of attackers) {
    // Only first strike and double strike creatures deal damage in this phase
    if (!attacker.keywords.firstStrike && !attacker.keywords.doubleStrike) continue;
    
    const attackerBlockers = blockers[attacker.permanentId] || [];
    
    if (attackerBlockers.length === 0) {
      // Unblocked - damage goes to defender
      // (handled separately based on attack target)
    } else {
      // Blocked - assign damage to blockers
      const assignments = damageAssignments[attacker.permanentId] || {};
      let remainingPower = attacker.power;
      
      for (const blocker of attackerBlockers) {
        const assigned = assignments[blocker.permanentId] || 0;
        result.damageToCreatures[blocker.permanentId] = 
          (result.damageToCreatures[blocker.permanentId] || 0) + assigned;
        remainingPower -= assigned;
        
        // Deathtouch kills with any damage (unless blocker is indestructible)
        if (attacker.keywords.deathtouch && assigned > 0) {
          if (!blocker.keywords.indestructible) {
            result.deaths.push(blocker.permanentId);
          }
        }
        // Normal lethal damage
        else if (assigned >= blocker.toughness - blocker.damage) {
          if (!blocker.keywords.indestructible) {
            result.deaths.push(blocker.permanentId);
          }
        }
        
        // Lifelink
        if (attacker.keywords.lifelink) {
          result.lifeGain[attacker.controller] = 
            (result.lifeGain[attacker.controller] || 0) + assigned;
        }
      }
      
      // Trample - excess goes to defender
      if (attacker.keywords.trample && remainingPower > 0) {
        result.damageToDefender[attacker.controller] = 
          (result.damageToDefender[attacker.controller] || 0) + remainingPower;
      }
    }
    
    // Blockers deal damage back to attacker (if they have first/double strike)
    for (const blocker of attackerBlockers) {
      if (blocker.keywords.firstStrike || blocker.keywords.doubleStrike) {
        result.damageToCreatures[attacker.permanentId] = 
          (result.damageToCreatures[attacker.permanentId] || 0) + blocker.power;
        
        if (blocker.keywords.deathtouch) {
          if (!attacker.keywords.indestructible) {
            result.deaths.push(attacker.permanentId);
          }
        }
        
        if (blocker.keywords.lifelink) {
          result.lifeGain[blocker.controller] = 
            (result.lifeGain[blocker.controller] || 0) + blocker.power;
        }
      }
    }
  }
  
  return result;
}

// Phasing and player-protection helpers live in combatMechanicsPhasing.ts (B23 extraction).
export { phaseOut, phaseIn, phaseInAllForPlayer, applyTeferisProtection, playerLifeCanChange, playerHasProtectionFromEverything, clearExpiredProtections } from "./combatMechanicsPhasing.js";

/**
 * Check if damage would be prevented by protection
 */
export function wouldDamageBePreventedByProtection(
  source: { colors: string[]; types: string[]; isSpell?: boolean },
  target: { protections: string[] }
): boolean {
  const sourceColors = (source.colors || []).map((color) => String(color || '').trim().toLowerCase());
  const sourceColorSymbols = sourceColors.map((color) => {
    if (color === 'white' || color === 'w') return 'w';
    if (color === 'blue' || color === 'u') return 'u';
    if (color === 'black' || color === 'b') return 'b';
    if (color === 'red' || color === 'r') return 'r';
    if (color === 'green' || color === 'g') return 'g';
    return color;
  });
  const sourceTypes = (source.types || []).map((entry) => String(entry || '').toLowerCase());

  for (const protection of target.protections) {
    if (protection === "everything") return true;
    
    // Color protection
    const colorMap: Record<string, string> = {
      white: "w", blue: "u", black: "b", red: "r", green: "g"
    };
    const wanted = colorMap[protection];
    if (wanted && sourceColorSymbols.includes(wanted)) {
      return true;
    }
    
    // Type protection
    if (sourceTypes.some(t => t === protection)) {
      return true;
    }
    
    // Colored spells
    if (protection === "colored" && sourceColorSymbols.some((c) => ['w', 'u', 'b', 'r', 'g'].includes(c))) {
      return true;
    }
  }
  
  return false;
}

