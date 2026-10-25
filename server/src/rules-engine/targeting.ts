import type { GameState, PlayerID, TargetRef, BattlefieldPermanent } from '../../../shared/src';
import { isCreatureTypeWord, permanentHasAttachmentGrantedKeyword, permanentHasCreatureType } from '../../../shared/src';
import { maybeSuppressRetiredCategorizeSpellSpec } from '../state/modules/oracleIrSpellLegacyRouting.js';
import type {
  PermanentFilter,
  SpellSpec,
  StatRequirement,
  TargetRestriction,
} from './targeting-handlers/targetingSpellSpecTypes.js';
import { tryCategorizeStackCounterSimpleTemplates } from './targeting-handlers/targetingCategorizeStackCounterSimpleTemplates.js';
import { tryCategorizeScryMillMassRemoval } from './targeting-handlers/targetingCategorizeScryMillMassRemoval.js';
import { tryCategorizeDamageFlickerRestrictions } from './targeting-handlers/targetingCategorizeDamageFlickerRestrictions.js';
import { tryCategorizeTapBounceGenericTargets } from './targeting-handlers/targetingCategorizeTapBounceGenericTargets.js';
import { protectionKeywordIgnoredForTargeting } from './targeting-handlers/targetingProtectionKeywordStaticOverride.js';
import { canPlayerBeTargetedByPlayer } from './targeting-handlers/targetingPlayerProtectionKeyword.js';
import { isBlockedByColorSourceTargetingRestriction } from './targeting-handlers/colorSourceTargetingRestriction.js';

export { canPlayerBeTargetedByPlayer };

// Re-export TargetRef for consumers of this module
export type { TargetRef };

export type {
  SpellOp,
  PermanentFilter,
  SpellTypeFilter,
  StatRequirement,
  TargetRestrictionType,
  TargetRestriction,
  SpellSpec,
} from './targeting-handlers/targetingSpellSpecTypes.js';


const CARD_TYPE_WORDS = [
  'artifact',
  'battle',
  'conspiracy',
  'creature',
  'enchantment',
  'instant',
  'kindred',
  'land',
  'phenomenon',
  'plane',
  'planeswalker',
  'scheme',
  'sorcery',
  'tribal',
  'vanguard',
] as const;

function extractCardTypesFromTypeLine(typeLine: unknown): string[] {
  const normalized = String(typeLine || '').toLowerCase();
  if (!normalized) return [];

  const cardTypeSegment = normalized.split(/[—-]/)[0] || normalized;
  return CARD_TYPE_WORDS.filter((cardType) => new RegExp(`\\b${cardType}\\b`, 'i').test(cardTypeSegment));
}

export function selectionRequiresSharedCardType(...texts: unknown[]): boolean {
  return texts.some((text) => /\bshare\s+a\s+(?:card|permanent)\s+type\b/i.test(String(text || '')));
}

export function permanentsShareCardType(permanents: any[]): boolean {
  const candidates = Array.isArray(permanents) ? permanents.filter(Boolean) : [];
  if (candidates.length < 2) return false;

  let sharedTypes: Set<string> | null = null;
  for (const permanent of candidates) {
    const typeSet = new Set(
      extractCardTypesFromTypeLine(
        permanent?.card?.type_line || permanent?.type_line || permanent?.typeLine || ''
      )
    );
    if (typeSet.size === 0) return false;

    if (!sharedTypes) {
      sharedTypes = typeSet;
      continue;
    }

    sharedTypes = new Set([...sharedTypes].filter((cardType) => typeSet.has(cardType)));
    if (sharedTypes.size === 0) {
      return false;
    }
  }

  return Boolean(sharedTypes && sharedTypes.size > 0);
}

export function normalizeRequirementTargetType(rawTargetType: string | undefined): string {
  return String(rawTargetType || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\bthat share a card type\b/g, ' ')
    .replace(/\bthat player controls\b/g, ' ')
    .replace(/\byou control\b/g, ' ')
    .replace(/\ban opponent controls\b/g, ' ')
    .replace(/\bwith different controllers\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^nonland permanents?$/g, 'nonland permanent')
    .replace(/^noncreature permanents?$/g, 'noncreature permanent')
    .replace(/^creatures?$/g, 'creature')
    .replace(/^permanents?$/g, 'permanent')
    .replace(/^artifacts?$/g, 'artifact')
    .replace(/^enchantments?$/g, 'enchantment')
    .replace(/^lands?$/g, 'land')
    .replace(/^planeswalkers?$/g, 'planeswalker');
}

export {
  matchesGraveyardCardTargetType,
  requiresTargeting,
  parseTargetRequirements,
} from './targeting-handlers/targetingParseTargetRequirements.js';
export type { GroupedTargetRequirement } from './targeting-handlers/targetingParseTargetRequirements.js';


export function categorizeSpellWithoutPrimaryRetirement(_name: string, oracleText?: string): SpellSpec | null {
  const normalizedOracleText = String(oracleText || '').replace(/\u2019/g, "'");
  const t = normalizedOracleText
    .split(/\r?\n/)
    .filter((line) => {
      const trimmedLine = String(line || '').trim();
      return !/^\s*(?:flashback|jump-start|retrace|escape|disturb)\b/i.test(trimmedLine)
        && !/^\s*as an additional cost to cast this spell\b/i.test(trimmedLine);
    })
    .join('\n')
    .toLowerCase();

  // IMPORTANT: Check for stack-targeting spells FIRST before battlefield patterns
  // Spells like Summary Dismissal ("Exile all other spells and counter all abilities")
  // target the stack, not permanents on the battlefield
  // These patterns should NOT be treated as EXILE_ALL/DESTROY_ALL on battlefield
  if (/exile all\s+(?:other\s+)?spells\b/.test(t)) {
    // This targets the stack (spells), not battlefield - return null to handle specially
    return null;
  }
  if (/counter all\s+(?:other\s+)?spells\b/.test(t)) {
    // This counters all spells on stack, not battlefield - return null to handle specially
    return null;
  }

  return tryCategorizeStackCounterSimpleTemplates(t)
    ?? tryCategorizeScryMillMassRemoval(t)
    ?? tryCategorizeDamageFlickerRestrictions(t)
    ?? tryCategorizeTapBounceGenericTargets(t);
}

export function categorizeSpell(_name: string, oracleText?: string): SpellSpec | null {
  return maybeSuppressRetiredCategorizeSpellSpec(
    categorizeSpellWithoutPrimaryRetirement(_name, oracleText),
  );
}

function isCreature(p: BattlefieldPermanent) {
  const permAny = p as any;
  if (permAny?.crewed === true) return true;
  if (Array.isArray(permAny?.grantedTypes)
    && permAny.grantedTypes.some((t: any) => String(t || '').toLowerCase() === 'creature')) {
    return true;
  }
  if (permAny?.animated === true || permAny?.isCreature === true) return true;
  const typeLine = (((p.card as any)?.type_line) || '').toLowerCase();
  if (/\bvehicle\b/.test(typeLine) && !/\bcreature\b/.test(typeLine)) return false;
  return typeLine.includes('creature');
}
function isPlaneswalker(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('planeswalker');
}
function isArtifact(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('artifact');
}
function isEnchantment(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('enchantment');
}
function isLand(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('land');
}
function isBattle(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('battle');
}

/**
 * Check if a permanent matches the given filter.
 * Handles single filters and ignores multiFilter (which is handled separately).
 */
function matchesFilter(p: BattlefieldPermanent, filter: PermanentFilter): boolean {
  switch (filter) {
    case 'CREATURE': return isCreature(p);
    case 'PLANESWALKER': return isPlaneswalker(p);
    case 'BATTLE': return isBattle(p);
    case 'ARTIFACT': return isArtifact(p);
    case 'ENCHANTMENT': return isEnchantment(p);
    case 'LAND': return isLand(p);
    case 'PERMANENT': return true; // All permanents match (including battles, artifacts, creatures, etc.)
    case 'ANY': return isCreature(p) || isPlaneswalker(p); // "Any target" only includes creatures/planeswalkers/players
    default: return false;
  }
}

/**
 * Check if a permanent matches any of the filters in a multiFilter array (OR logic).
 * For example, "artifact or enchantment" matches if the permanent is an artifact OR an enchantment.
 */
function matchesMultiFilter(p: BattlefieldPermanent, filters: PermanentFilter[]): boolean {
  for (const filter of filters) {
    if (matchesFilter(p, filter)) return true;
  }
  return false;
}

function abilityListIncludesKeyword(values: unknown, keyword: string): boolean {
  if (!Array.isArray(values)) return false;
  const needle = keyword.toLowerCase();
  return values.some((value: unknown) => {
    const text = String(value || '').toLowerCase().trim();
    return text === needle || text.includes(needle);
  });
}

function permanentOracleGrantsSelfKeyword(oracleText: string, keyword: string): boolean {
  const text = String(oracleText || '').toLowerCase();
  if (!text) return false;
  const keywordRe = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
  if (!keywordRe.test(text)) return false;

  // "Equipped/Enchanted creature has shroud" applies to the host, not this permanent.
  const withoutHostGrants = text.replace(
    /(?:equipped|enchanted)\s+(?:creature|permanent|land)\s+(?:has|gains?|gets?)\s+[^.]+/gi,
    ' ',
  );
  return keywordRe.test(withoutHostGrants);
}

function permanentHasKeywordFromRuntimeGrants(
  permanent: BattlefieldPermanent,
  keyword: 'hexproof' | 'shroud',
): boolean {
  if (abilityListIncludesKeyword((permanent as any)?.grantedAbilities, keyword)) return true;
  if (abilityListIncludesKeyword((permanent as any)?.grantedKeywords, keyword)) return true;
  if (abilityListIncludesKeyword((permanent as any)?.temporaryAbilities, keyword)) return true;

  const temporaryEffects = Array.isArray((permanent as any)?.temporaryEffects)
    ? (permanent as any).temporaryEffects
    : [];
  for (const effect of temporaryEffects) {
    if (abilityListIncludesKeyword(effect?.grantedAbilities, keyword)) return true;
    const description = String(effect?.description || '').toLowerCase();
    if (description.includes(keyword)) return true;
  }

  return false;
}

function permanentHasKeywordFromDerivedContinuousEffects(
  permanent: BattlefieldPermanent,
  state: Readonly<GameState>,
  keyword: 'hexproof' | 'shroud',
): boolean {
  const derived = (state as any)?._derivedContinuousEffects;
  const permanentId = String(permanent?.id || '');
  if (!derived || !permanentId) return false;

  const creatureAbilities = derived?.perPermanent?.get?.(permanentId)?.abilities;
  if (creatureAbilities instanceof Set && creatureAbilities.has(keyword)) return true;

  const permanentAbilities = derived?.permanentAbilities?.get?.(permanentId);
  if (permanentAbilities instanceof Set && permanentAbilities.has(keyword)) return true;

  return false;
}

function hasGrantedProtectionKeyword(
  p: BattlefieldPermanent,
  s: Readonly<GameState>,
  keyword: 'hexproof' | 'shroud'
): boolean {
  const self = (((p.card as any)?.oracle_text) || '').toLowerCase();
  if (permanentOracleGrantsSelfKeyword(self, keyword)) return true;

  if (abilityListIncludesKeyword((p.card as any)?.keywords, keyword)) return true;

  if (permanentHasKeywordFromRuntimeGrants(p, keyword)) return true;

  if (permanentHasKeywordFromDerivedContinuousEffects(p, s, keyword)) return true;

  // Equipment/Aura grants: use both attachedTo and attachedEquipment pointers.
  if (permanentHasAttachmentGrantedKeyword(p, Array.isArray(s.battlefield) ? s.battlefield : [], keyword)) {
    return true;
  }

  // Check static effects from other permanents on the battlefield.
  const typeLine = (((p.card as any)?.type_line) || '').toLowerCase();
  const isCreaturePerm = typeLine.includes('creature');

  for (const source of s.battlefield) {
    if (source.id === p.id) continue; // Skip self
    if (source.controller !== p.controller) continue; // Only check permanents controlled by same player

    const sourceOracle = (((source.card as any)?.oracle_text) || '').toLowerCase();

    if (new RegExp(`other creatures you control have ${keyword}`).test(sourceOracle) && isCreaturePerm) {
      return true;
    }

    if (new RegExp(`you and other creatures you control have ${keyword}`).test(sourceOracle) && isCreaturePerm) {
      return true;
    }

    if (new RegExp(`other permanents you control have ${keyword}`).test(sourceOracle)) {
      return true;
    }

    if (!sourceOracle.includes('other permanents') &&
        new RegExp(`permanents you control have ${keyword}`).test(sourceOracle)) {
      return true;
    }

    if (!sourceOracle.includes('other creatures') &&
        new RegExp(`(?<![a-z] )creatures you control have ${keyword}`).test(sourceOracle) && isCreaturePerm) {
      return true;
    }

    const typedHave = sourceOracle.match(
      new RegExp(`(?:^|[.\\n;])\\s*(?!other\\s)([a-z]+)\\s+creatures you control have ${keyword}`),
    );
    if (typedHave && isCreaturePerm) {
      const qualifier = String(typedHave[1] || '').toLowerCase();
      if (isCreatureTypeWord(qualifier) && permanentHasCreatureType(p, qualifier)) {
        return true;
      }
    }
  }

  return false;
}

export function canPermanentBeTargetedByPlayer(
  permanent: BattlefieldPermanent,
  state: Readonly<GameState>,
  targetingPlayerId: PlayerID
): boolean {
  if (
    hasGrantedProtectionKeyword(permanent, state, 'shroud')
    && !protectionKeywordIgnoredForTargeting(permanent, state, targetingPlayerId, 'shroud')
  ) {
    return false;
  }

  if (
    hasGrantedProtectionKeyword(permanent, state, 'hexproof')
    && permanent.controller !== targetingPlayerId
    && !protectionKeywordIgnoredForTargeting(permanent, state, targetingPlayerId, 'hexproof')
  ) {
    return false;
  }

  return true;
}

export function evaluateTargeting(state: Readonly<GameState>, caster: PlayerID, spec: SpellSpec, sourceId?: string): TargetRef[] {
  const out: TargetRef[] = [];

  // Player targeting (for draw/discard templates and similar single-target effects).
  if (
    spec.op === 'DRAW_TARGET_PLAYER' ||
    spec.op === 'DISCARD_TARGET_PLAYER' ||
    spec.op === 'MILL_TARGET_PLAYER' ||
    spec.op === 'SURVEIL_TARGET_PLAYER' ||
    spec.op === 'GAIN_LIFE_TARGET_PLAYER' ||
    spec.op === 'LOSE_LIFE_TARGET_PLAYER' ||
    spec.op === 'DAMAGE_TARGET_PLAYER' ||
    spec.op === 'DESTROY_ALL_TARGET_PLAYER' ||
    spec.op === 'EXILE_ALL_TARGET_PLAYER' ||
    spec.op === 'TAP_ALL_TARGET_PLAYER' ||
    spec.op === 'UNTAP_ALL_TARGET_PLAYER' ||
    spec.op === 'TARGET_PLAYER' ||
    spec.op === 'BLIGHT_TARGET_OPPONENT' ||
    spec.op === 'BLIGHT_TARGET_PLAYER'
  ) {
    for (const pr of state.players) {
      if (spec.opponentOnly && pr.id === caster) continue;
      if (!canPlayerBeTargetedByPlayer(pr.id, state, caster)) continue;
      out.push({ kind: 'player', id: pr.id });
    }
    return out;
  }
  
  // Handle counterspells - they target spells on the stack
  if (spec.op === 'COUNTER_TARGET_SPELL') {
    const stack = (state as any).stack || [];
    for (const stackItem of stack) {
      // Skip items that can't be countered unless this effect exiles instead
      if (stackItem.canBeCountered === false && spec.ignoreCantBeCountered !== true) continue;
      
      // Skip abilities (they're not spells)
      if (stackItem.type === 'ability' || stackItem.type === 'triggered_ability' || stackItem.type === 'activated_ability') continue;
      
      // Check spell type filter
      const card = stackItem.card;
      const typeLine = (card?.type_line || '').toLowerCase();
      
      if (spec.spellTypeFilter === 'NONCREATURE' && typeLine.includes('creature')) continue;
      if (spec.spellTypeFilter === 'CREATURE_SPELL' && !typeLine.includes('creature')) continue;
      if (spec.spellTypeFilter === 'INSTANT_SORCERY' && !typeLine.includes('instant') && !typeLine.includes('sorcery')) continue;

      // A spell can target any legal spell on the stack, including the caster's.
      out.push({ kind: 'stack', id: stackItem.id });
    }
    return out;
  }
  
  // Handle ability counters (Stifle, etc.)
  if (spec.op === 'COUNTER_TARGET_ABILITY') {
    const stack = (state as any).stack || [];
    for (const stackItem of stack) {
      // Only target abilities
      if (stackItem.type !== 'ability' && stackItem.type !== 'triggered_ability' && stackItem.type !== 'activated_ability') continue;
      
      // Skip mana abilities (can't be countered)
      if (stackItem.isManaAbility) continue;
      
      out.push({ kind: 'stack', id: stackItem.id });
    }
    return out;
  }
  
  // Handle battlefield targeting
  for (const p of state.battlefield) {
    // Check if permanent matches the filter requirements
    // If multiFilter is defined, use OR logic (match any of the filters)
    // Otherwise, use the single filter
    let matchesFilterRequirement = false;
    
    if (spec.multiFilter) {
      // Multi-filter with OR logic (e.g., "artifact or enchantment")
      matchesFilterRequirement = matchesMultiFilter(p, spec.multiFilter);
    } else {
      // Single filter
      matchesFilterRequirement = matchesFilter(p, spec.filter);
    }
    
    if (!matchesFilterRequirement) continue;

    // Optional nonland restriction (e.g., "target nonland permanent")
    if (spec.nonlandOnly && isLand(p)) continue;
    
    // Shroud blocks all targeting; hexproof only blocks opponents.
    if (!canPermanentBeTargetedByPlayer(p, state, caster)) continue;
    // Census #23: "can't be the target of COLOR spells or abilities from COLOR sources".
    if (isBlockedByColorSourceTargetingRestriction(p, state, sourceId)) continue;
    
    // Check controller restriction ("creature you control")
    if (spec.controllerOnly && p.controller !== caster) continue;

    // Check opponent-only restriction ("an opponent controls")
    if (spec.opponentOnly && p.controller === caster) continue;
    
    // Check excludeSource restriction ("another target" patterns - cannot target self)
    // This is used for abilities like Skrelv, Defector Mite that can only target "another" creature
    if (spec.excludeSource && sourceId && p.id === sourceId) continue;
    
    // Check stat requirement (power/toughness restrictions)
    if (spec.statRequirement && isCreature(p)) {
      const { stat, comparison, value } = spec.statRequirement;
      // Get effective power/toughness
      const card = p.card as any;
      let statValue: number;
      if (stat === 'power') {
        statValue = p.effectivePower ?? (typeof card?.power === 'string' ? parseInt(card.power, 10) : card?.power) ?? 0;
      } else {
        statValue = p.effectiveToughness ?? (typeof card?.toughness === 'string' ? parseInt(card.toughness, 10) : card?.toughness) ?? 0;
      }
      
      // Check comparison
      let passes = false;
      switch (comparison) {
        case '>=': passes = statValue >= value; break;
        case '<=': passes = statValue <= value; break;
        case '>': passes = statValue > value; break;
        case '<': passes = statValue < value; break;
        case '=': passes = statValue === value; break;
      }
      if (!passes) continue;
    }
    
    // Check target restriction ("target X that..." clauses)
    // These are defining criteria like "that dealt damage to you this turn" (Reciprocate)
    if (spec.targetRestriction) {
      const restriction = spec.targetRestriction;
      let meetsRestriction = false;
      
      switch (restriction.type) {
        case 'dealt_damage_to_you_this_turn':
        case 'dealt_combat_damage_to_you_this_turn': {
          // Check if this creature dealt damage to the caster this turn
          // The damage tracking is stored in state.creaturesThatDealtDamageToPlayer
          const damageTracker = (state as any).creaturesThatDealtDamageToPlayer?.[caster];
          if (damageTracker && damageTracker[p.id]) {
            meetsRestriction = true;
          }
          break;
        }
        
        case 'attacked_this_turn': {
          // Check if the creature is currently attacking or attacked this turn
          // During combat, 'attacking' is set on the permanent
          const isAttacking = !!(p as any).attacking || !!(p as any).attackedThisTurn;
          meetsRestriction = isAttacking;
          break;
        }
        
        case 'attacked_or_blocked_this_turn': {
          // Check if the creature is currently attacking OR blocking (Repel Calamity)
          const isAttacking = !!(p as any).attacking || !!(p as any).attackedThisTurn;
          const isBlocking = !!(p as any).blocking || !!(p as any).blockedThisTurn;
          meetsRestriction = isAttacking || isBlocking;
          break;
        }
        
        case 'blocked_this_turn': {
          // Check if the creature is currently blocking or blocked this turn
          meetsRestriction = !!(p as any).blocking || !!(p as any).blockedThisTurn;
          break;
        }
        
        case 'entered_this_turn': {
          // Check if the creature entered the battlefield this turn
          meetsRestriction = !!(p as any).enteredThisTurn;
          break;
        }
        
        case 'tapped': {
          // Check if the creature is tapped
          meetsRestriction = !!(p as any).tapped;
          break;
        }
        
        case 'untapped': {
          // Check if the creature is untapped
          meetsRestriction = !(p as any).tapped;
          break;
        }
        
        case 'controlled_by_active_player': {
          // Delirium: "target creature that player controls" where "that player" = opponent whose turn it is
          // The creature must be controlled by the active player (turnPlayer)
          const activePlayerId = (state as any).turnPlayer || 
                                state.players[(state as any).activePlayerIndex || 0]?.id;
          meetsRestriction = p.controller === activePlayerId;
          break;
        }
        
        case 'has_keyword': {
          // Check if the creature has the required keyword ability (flying, reach, etc.)
          // Check both the keywords array and oracle text
          const oracleText = (p.card as any)?.oracle_text || '';
          const cardKeywords = (p.card as any)?.keywords || [];
          const keyword = restriction.keyword?.toLowerCase() || '';
          
          // First check the keywords array (more reliable for most cards)
          const hasKeywordInArray = Array.isArray(cardKeywords) && 
            cardKeywords.some((k: string) => typeof k === 'string' && k.toLowerCase() === keyword);
          
          if (hasKeywordInArray) {
            meetsRestriction = true;
          } else {
            // Fallback: Check if the card's oracle text contains the keyword
            // We check at word boundary to avoid matching partial words
            const keywordPattern = new RegExp(`\\b${keyword}\\b`, 'i');
            meetsRestriction = keywordPattern.test(oracleText);
          }
          
          // Also check for keywords granted by auras and equipment attached to this creature
          if (!meetsRestriction) {
            const attachments = state.battlefield.filter((att: any) => att.attachedTo === p.id);
            for (const attachment of attachments) {
              const attOracle = ((attachment.card as any)?.oracle_text || '').toLowerCase();
              // Pattern: "Enchanted creature has flying" or "Equipped creature has flying"
              // Escape regex metacharacters in keyword to prevent ReDoS
              const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const grantsKeywordPattern = new RegExp(`(enchanted|equipped)\\s+creature\\s+has\\s+${escapedKeyword}`, 'i');
              if (grantsKeywordPattern.test(attOracle)) {
                meetsRestriction = true;
                break;
              }
            }
          }
          
          break;
        }
        
        default:
          // Unknown restriction type - allow targeting (fail open)
          meetsRestriction = true;
          break;
      }
      
      if (!meetsRestriction) continue;
    }
    
    // Check creatureRestriction (for multi-type spells where only creatures have restrictions)
    // Example: Atraxa's Fall targets "artifact, battle, enchantment, or creature with flying"
    // Artifacts/battles/enchantments can be targeted normally, but creatures need flying
    if (spec.creatureRestriction && isCreature(p)) {
      const restriction = spec.creatureRestriction;
      let meetsRestriction = false;
      
      // For now, only handle has_keyword restriction (the main use case)
      if (restriction.type === 'has_keyword') {
        const oracleText = (p.card as any)?.oracle_text || '';
        const cardKeywords = (p.card as any)?.keywords || [];
        const keyword = restriction.keyword?.toLowerCase() || '';
        
        // First check the keywords array (more reliable for most cards)
        const hasKeywordInArray = Array.isArray(cardKeywords) && 
          cardKeywords.some((k: string) => typeof k === 'string' && k.toLowerCase() === keyword);
        
        if (hasKeywordInArray) {
          meetsRestriction = true;
        } else {
          // Fallback: Check if the card's oracle text contains the keyword
          const keywordPattern = new RegExp(`\\b${keyword}\\b`, 'i');
          meetsRestriction = keywordPattern.test(oracleText);
        }
        
        // Also check for keywords granted by auras and equipment attached to this creature
        if (!meetsRestriction) {
          const attachments = state.battlefield.filter((att: any) => att.attachedTo === p.id);
          // Pre-compile the regex pattern once before the loop
          const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const grantsKeywordPattern = new RegExp(`(enchanted|equipped)\\s+creature\\s+has\\s+${escapedKeyword}`, 'i');
          
          for (const attachment of attachments) {
            const attOracle = ((attachment.card as any)?.oracle_text || '').toLowerCase();
            if (grantsKeywordPattern.test(attOracle)) {
              meetsRestriction = true;
              break;
            }
          }
        }
      } else {
        // For other restriction types, fail open (allow targeting)
        meetsRestriction = true;
      }
      
      if (!meetsRestriction) continue;
    }
    
    out.push({ kind: 'permanent', id: p.id });
  }
  if (spec.op === 'ANY_TARGET_DAMAGE') {
    for (const pr of state.players) {
      if (!canPlayerBeTargetedByPlayer(pr.id, state, caster)) continue;
      out.push({ kind: 'player', id: pr.id });
    }
  }
  return out;
}

export type EngineEffect =
  | { kind: 'DestroyPermanent'; id: string }
  | { kind: 'MoveToExile'; id: string }
  | { kind: 'BouncePermanent'; id: string }
  | { kind: 'TapPermanent'; id: string }
  | { kind: 'UntapPermanent'; id: string }
  | { kind: 'AddExtraCombat'; untapAttackers?: boolean }
  | { kind: 'GainLife'; playerId: PlayerID; amount: number }
  | { kind: 'LoseLife'; playerId: PlayerID; amount: number }
  | { kind: 'DamagePermanent'; id: string; amount: number }
  | { kind: 'DamagePlayer'; playerId: PlayerID; amount: number }
  | { kind: 'DrawCards'; playerId: PlayerID; count: number }
  | { kind: 'RequestDiscard'; playerId: PlayerID; count: number }
  | { kind: 'AddCountersPermanent'; id: string; counterType: string; amount: number }
  | {
    kind: 'CreateToken';
    controller: PlayerID;
    name: string;
    count: number;
    basePower?: number;
    baseToughness?: number;
    options?: { colors?: string[]; typeLine?: string; isArtifact?: boolean };
  }
  | { kind: 'QueueScry'; playerId: PlayerID; count: number }
  | { kind: 'QueueSurveil'; playerId: PlayerID; count: number }
  | { kind: 'QueueBlight'; playerId: PlayerID; count: number }
  | { kind: 'QueueBlightEachOpponent'; count: number }
  | { kind: 'QueueBlightEachPlayer'; count: number }
  | { kind: 'MillCards'; playerId: PlayerID; count: number }
  | { kind: 'GoadPermanent'; id: string; goaderId: PlayerID }
  | { kind: 'CounterSpell'; stackItemId: string }
  | { kind: 'CounterAbility'; stackItemId: string }
  | { kind: 'Broadcast'; message: string }
  | { kind: 'FlickerPermanent'; id: string; returnDelay: 'immediate' | 'end_of_turn' | 'end_of_combat' };

/**
 * Check if a permanent meets a stat requirement at resolution time.
 * This is used to validate targets when a spell resolves, as stats may have
 * changed since the spell was cast (e.g., -1/-1 effects reducing toughness).
 * 
 * MTG Rule 608.2b: "If the spell or ability specifies targets, it checks 
 * whether the targets are still legal."
 */
export function meetsStatRequirement(p: BattlefieldPermanent, req: StatRequirement): boolean {
  const card = p.card as any;
  let statValue: number;
  
  if (req.stat === 'power') {
    // Use effective power if calculated, otherwise use base power
    statValue = p.effectivePower ?? (typeof card?.power === 'string' ? parseInt(card.power, 10) : card?.power) ?? 0;
  } else {
    // Use effective toughness if calculated, otherwise use base toughness
    statValue = p.effectiveToughness ?? (typeof card?.toughness === 'string' ? parseInt(card.toughness, 10) : card?.toughness) ?? 0;
  }
  
  // Handle NaN values (e.g., '*' power/toughness)
  if (isNaN(statValue)) statValue = 0;
  
  switch (req.comparison) {
    case '>=': return statValue >= req.value;
    case '<=': return statValue <= req.value;
    case '>': return statValue > req.value;
    case '<': return statValue < req.value;
    case '=': return statValue === req.value;
    default: return true;
  }
}

function meetsTargetRestrictionAtResolution(
  p: BattlefieldPermanent,
  restriction: TargetRestriction,
  state: Readonly<GameState>,
  caster: PlayerID
): boolean {
  switch (restriction.type) {
    case 'dealt_damage_to_you_this_turn':
    case 'dealt_combat_damage_to_you_this_turn': {
      const damageTracker = (state as any).creaturesThatDealtDamageToPlayer?.[caster];
      return !!(damageTracker && damageTracker[p.id]);
    }
    case 'attacked_this_turn':
      return !!(p as any).attacking || !!(p as any).attackedThisTurn;
    case 'attacked_or_blocked_this_turn':
      return (
        !!(p as any).attacking ||
        !!(p as any).attackedThisTurn ||
        !!(p as any).blocking ||
        !!(p as any).blockedThisTurn
      );
    case 'blocked_this_turn':
      return !!(p as any).blocking || !!(p as any).blockedThisTurn;
    case 'entered_this_turn':
      return !!(p as any).enteredThisTurn;
    case 'tapped':
      return !!(p as any).tapped;
    case 'untapped':
      return !(p as any).tapped;
    case 'controlled_by_active_player': {
      const activePlayerId = (state as any).turnPlayer || state.players[(state as any).activePlayerIndex || 0]?.id;
      return p.controller === activePlayerId;
    }
    case 'has_keyword': {
      const oracleText = (p.card as any)?.oracle_text || '';
      const cardKeywords = (p.card as any)?.keywords || [];
      const keyword = restriction.keyword?.toLowerCase() || '';

      const hasKeywordInArray =
        Array.isArray(cardKeywords) &&
        cardKeywords.some((k: string) => typeof k === 'string' && k.toLowerCase() === keyword);
      if (hasKeywordInArray) return true;

      const keywordPattern = new RegExp(`\\b${keyword}\\b`, 'i');
      if (keywordPattern.test(oracleText)) return true;

      const attachments = state.battlefield.filter((att: any) => att.attachedTo === p.id);
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\[\]\\\\]]/g, '\\$&');
      const grantsKeywordPattern = new RegExp(`(enchanted|equipped)\\s+creature\\s+has\\s+${escapedKeyword}`, 'i');
      for (const attachment of attachments) {
        const attOracle = ((attachment.card as any)?.oracle_text || '').toLowerCase();
        if (grantsKeywordPattern.test(attOracle)) return true;
      }
      return false;
    }
    default:
      return true;
  }
}

export function resolveSpell(spec: SpellSpec, chosen: readonly TargetRef[], state: Readonly<GameState>, caster: PlayerID): readonly EngineEffect[] {
  // All categorize resolve opcodes deleted (P1a) — categorize patterns kept for cast targeting.
  // Live resolution uses Oracle IR; CounterSpell/CounterAbility (and Tap/Bounce/…) remain on
  // executeSpellEffect / applyEvent effect switches for IR and non-categorize callers.
  void spec;
  void chosen;
  void state;
  void caster;
  return [];
}

/**
 * Detect if an ability requires "another target" (cannot target the source).
 * This is used for abilities like Skrelv, Defector Mite:
 * "Another target creature you control gains hexproof..."
 * 
 * @param oracleText - The ability text to check
 * @returns true if the ability says "another target"
 */
export function detectAnotherTargetRestriction(oracleText: string): boolean {
  if (!oracleText) return false;
  const text = oracleText.toLowerCase();
  
  // Pattern: "another target creature", "another target permanent", etc.
  return /another target\s+(?:creature|permanent|artifact|enchantment|player|planeswalker)/i.test(text);
}

/**
 * Parse targeting restrictions from an activated ability's oracle text.
 * This extracts information about what can be targeted and any restrictions.
 * 
 * @param oracleText - The ability text to parse
 * @returns Targeting info or null if no targeting detected
 */
export function parseAbilityTargeting(oracleText: string): {
  targetType: 'creature' | 'permanent' | 'player' | 'any';
  controllerOnly: boolean;
  opponentOnly: boolean;
  excludeSource: boolean;
  description: string;
} | null {
  if (!oracleText) return null;
  const text = oracleText.toLowerCase();
  
  // Check for "another target creature you control" pattern (Skrelv, etc.)
  if (/another target creature you control/.test(text)) {
    return {
      targetType: 'creature',
      controllerOnly: true,
      opponentOnly: false,
      excludeSource: true,
      description: 'another target creature you control',
    };
  }
  
  // Check for "another target permanent you control"
  if (/another target permanent you control/.test(text)) {
    return {
      targetType: 'permanent',
      controllerOnly: true,
      opponentOnly: false,
      excludeSource: true,
      description: 'another target permanent you control',
    };
  }

  // Check for "another target creature an opponent controls"
  if (/another target creature an opponent controls/.test(text)) {
    return {
      targetType: 'creature',
      controllerOnly: false,
      opponentOnly: true,
      excludeSource: true,
      description: 'another target creature an opponent controls',
    };
  }
  
  // Check for "another target creature"
  if (/another target creature/.test(text)) {
    return {
      targetType: 'creature',
      controllerOnly: false,
      opponentOnly: false,
      excludeSource: true,
      description: 'another target creature',
    };
  }

  // Check for "target creature an opponent controls" (without "another")
  if (/target creature an opponent controls/.test(text) && !/another/.test(text)) {
    return {
      targetType: 'creature',
      controllerOnly: false,
      opponentOnly: true,
      excludeSource: false,
      description: 'target creature an opponent controls',
    };
  }
  
  // Check for "target creature you control" (without "another")
  if (/target creature you control/.test(text) && !/another/.test(text)) {
    return {
      targetType: 'creature',
      controllerOnly: true,
      opponentOnly: false,
      excludeSource: false,
      description: 'target creature you control',
    };
  }
  
  // Check for "target creature" (without controller restriction)
  if (/target creature/.test(text)) {
    return {
      targetType: 'creature',
      controllerOnly: false,
      opponentOnly: false,
      excludeSource: false,
      description: 'target creature',
    };
  }
  
  return null;
}