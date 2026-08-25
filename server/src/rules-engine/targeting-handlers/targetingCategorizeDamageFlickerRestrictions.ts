// server/src/rules-engine/targeting-handlers/targetingCategorizeDamageFlickerRestrictions.ts
// Origin parent: server/src/rules-engine/targeting.ts
// Cluster moved: categorizeSpellWithoutPrimaryRetirement damage templates,
//   up-to-N destroy/exile, flicker, stat requirements, and "target X that..."
//   restriction patterns.
// Public entry symbols: tryCategorizeDamageFlickerRestrictions.

import type {
  SpellSpec,
  StatRequirement,
  TargetRestriction,
  TargetRestrictionType,
} from './targetingSpellSpecTypes.js';
import { parseCountWord } from './targetingCategorizeCountUtils.js';
import { detectCategorizePermanentFilter } from './targetingCategorizePermanentFilter.js';

export function tryCategorizeDamageFlickerRestrictions(t: string): SpellSpec | null {
  const { filter, multiFilter, creatureRestriction } = detectCategorizePermanentFilter(t);
  // Damage-to-player templates
  {
    const m = t.match(/\bdeals?\s+(\d+|x)\s+damage\s+to\s+each\s+opponent\b/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DAMAGE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      return { op: 'DAMAGE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: parseInt(raw, 10) };
    }
  }
  {
    const m = t.match(/\bdeals?\s+(\d+|x)\s+damage\s+to\s+each\s+player\b/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DAMAGE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      return { op: 'DAMAGE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: parseInt(raw, 10) };
    }
  }
  {
    const m = t.match(/\bdeals?\s+(\d+|x)\s+damage\s+to\s+target\s+(player|opponent)\b/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      const isOpponent = String(m[2]).toLowerCase() === 'opponent';
      if (raw === 'x') {
        return { op: 'DAMAGE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amountIsX: true, ...(isOpponent ? { opponentOnly: true } : {}), targetDescription: isOpponent ? 'target opponent' : 'target player' };
      }
      return { op: 'DAMAGE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: parseInt(raw, 10), ...(isOpponent ? { opponentOnly: true } : {}), targetDescription: isOpponent ? 'target opponent' : 'target player' };
    }
  }

  // Damage-to-permanent mass templates (filter-aware)
  {
    const m = t.match(/\bdeals?\s+(\d+|x)\s+damage\s+to\s+each\s+planeswalker\b/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DAMAGE_EACH', filter: 'PLANESWALKER', minTargets: 0, maxTargets: 0, amountIsX: true };
      return { op: 'DAMAGE_EACH', filter: 'PLANESWALKER', minTargets: 0, maxTargets: 0, amount: parseInt(raw, 10) };
    }
  }
  {
    const m = t.match(/\bdeals?\s+(\d+|x)\s+damage\s+to\s+each\s+creature\s+and\s+each\s+planeswalker\b/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amountIsX: true, multiFilter: ['CREATURE', 'PLANESWALKER'] };
      return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amount: parseInt(raw, 10), multiFilter: ['CREATURE', 'PLANESWALKER'] };
    }
  }
  {
    const m = t.match(/\bdeals?\s+(\d+|x)\s+damage\s+to\s+each\s+creature\s+you\s+control\b/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amountIsX: true, controllerOnly: true };
      return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amount: parseInt(raw, 10), controllerOnly: true };
    }
  }
  {
    const m = t.match(/\bdeals?\s+(\d+|x)\s+damage\s+to\s+each\s+creature\s+your\s+opponents\s+control\b/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amountIsX: true, opponentOnly: true };
      return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amount: parseInt(raw, 10), opponentOnly: true };
    }
  }
  {
    const m = t.match(/\bdeals?\s+(\d+|x)\s+damage\s+to\s+each\s+creature\b/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amountIsX: true };
      return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amount: parseInt(raw, 10) };
    }
  }
  // Conservative fallback for older/simple pattern detection
  if (/each creature/.test(t) && /\bdamage\b/.test(t)) {
    const m = t.match(/(\d+)\s+damage/);
    if (m) return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amount: parseInt(m[1], 10) };
  }

  // Up to N target destroy/exile: nonland permanents
  {
    const m = t.match(/\bexile\s+up\s+to\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+target\s+nonland\s+permanent(?:s)?(?:\s+(you\s+control|an\s+opponent\s+controls))?\b/i);
    if (m) {
      const n = parseCountWord(m[1]) ?? 1;
      const scope = (m[2] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      return {
        op: 'EXILE_TARGET',
        filter: 'PERMANENT',
        minTargets: 0,
        maxTargets: n,
        nonlandOnly: true,
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: scope
          ? `up to ${m[1]} target nonland permanent${n === 1 ? '' : 's'} ${scope}`
          : `up to ${m[1]} target nonland permanent${n === 1 ? '' : 's'}`,
      };
    }
  }
  {
    const m = t.match(/\bdestroy\s+up\s+to\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+target\s+nonland\s+permanent(?:s)?(?:\s+(you\s+control|an\s+opponent\s+controls))?\b/i);
    if (m) {
      const n = parseCountWord(m[1]) ?? 1;
      const scope = (m[2] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      return {
        op: 'DESTROY_TARGET',
        filter: 'PERMANENT',
        minTargets: 0,
        maxTargets: n,
        nonlandOnly: true,
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: scope
          ? `up to ${m[1]} target nonland permanent${n === 1 ? '' : 's'} ${scope}`
          : `up to ${m[1]} target nonland permanent${n === 1 ? '' : 's'}`,
      };
    }
  }

  // Up to N target destroy/exile (allow word counts)
  {
    const m = t.match(/\bexile\s+up\s+to\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+target\b/i);
    if (m) {
      const n = parseCountWord(m[1]) ?? 1;
      return { op: 'EXILE_TARGET', filter, minTargets: 0, maxTargets: n, ...(multiFilter && { multiFilter }), ...(creatureRestriction && { creatureRestriction }) };
    }
  }
  {
    const m = t.match(/\bdestroy\s+up\s+to\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+target\b/i);
    if (m) {
      const n = parseCountWord(m[1]) ?? 1;
      return { op: 'DESTROY_TARGET', filter, minTargets: 0, maxTargets: n, ...(multiFilter && { multiFilter }), ...(creatureRestriction && { creatureRestriction }) };
    }
  }

  // Flicker effects - exile and return to battlefield
  // Pattern: "exile target creature ... return it/that card to the battlefield"
  // Cards: Acrobatic Maneuver, Cloudshift, Ephemerate, Flickerwisp, etc.
  if (/exile target/.test(t) && /return (?:it|that card|that creature) to the battlefield/.test(t)) {
    // Check for delayed return (end of turn, end of combat)
    let returnDelay: 'immediate' | 'end_of_turn' | 'end_of_combat' = 'immediate';
    if (/at (?:the )?(?:beginning of )?(?:the )?(?:next )?end(?:ing)? step|end of turn/.test(t)) {
      returnDelay = 'end_of_turn';
    } else if (/end of combat/.test(t)) {
      returnDelay = 'end_of_combat';
    }
    
    // Check for controller restriction ("creature you control")
    const controllerRestricted = /target creature you control/.test(t);
    const targetDesc = controllerRestricted ? 'creature you control' : 'creature';
    
    return { 
      op: 'FLICKER_TARGET', 
      filter: 'CREATURE', 
      minTargets: 1, 
      maxTargets: 1,
      returnDelay,
      targetDescription: targetDesc,
      controllerOnly: controllerRestricted,
    };
  }

  // Check for toughness/power requirements in target descriptions
  // Pattern: "target creature with toughness 4 or greater" (Repel Calamity)
  // Pattern: "target creature with power 2 or less" (Ulcerate)
  // Also handle "target attacking or blocking creature with toughness X" patterns
  const toughnessMatch = t.match(/target (?:attacking or blocking )?creature with toughness (\d+) or (greater|less)/i);
  const powerMatch = t.match(/target (?:attacking or blocking )?creature with power (\d+) or (greater|less)/i);
  
  if (toughnessMatch) {
    const value = parseInt(toughnessMatch[1], 10);
    const comparison = toughnessMatch[2] === 'greater' ? '>=' : '<=';
    const statReq: StatRequirement = { stat: 'toughness', comparison, value };
    
    // Check if there's an "attacking or blocking" restriction (Repel Calamity)
    const hasAttackingOrBlockingRestriction = /target attacking or blocking creature/i.test(t);
    const targetRestriction = hasAttackingOrBlockingRestriction ? {
      type: 'attacked_or_blocked_this_turn' as TargetRestrictionType,
      description: 'that is attacking or blocking',
    } : undefined;
    const targetDescription = hasAttackingOrBlockingRestriction 
      ? `attacking or blocking creature with toughness ${comparison} ${value}`
      : `creature with toughness ${comparison} ${value}`;
    
    // Determine the operation
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
    }
    // Default to target creature action
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
  }
  
  if (powerMatch) {
    const value = parseInt(powerMatch[1], 10);
    const comparison = powerMatch[2] === 'greater' ? '>=' : '<=';
    const statReq: StatRequirement = { stat: 'power', comparison, value };
    
    // Check if there's an "attacking or blocking" restriction
    const hasAttackingOrBlockingRestriction = /target attacking or blocking creature/i.test(t);
    const targetRestriction = hasAttackingOrBlockingRestriction ? {
      type: 'attacked_or_blocked_this_turn' as TargetRestrictionType,
      description: 'that is attacking or blocking',
    } : undefined;
    const targetDescription = hasAttackingOrBlockingRestriction 
      ? `attacking or blocking creature with power ${comparison} ${value}`
      : `creature with power ${comparison} ${value}`;
    
    // Determine the operation
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
    }
    // Default to target creature action
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
  }

  // ==========================================================================
  // TARGET RESTRICTIONS: "target X that..." patterns
  // These are defining criteria that restrict what can be targeted beyond just type.
  // Examples:
  // - Reciprocate: "Exile target creature that dealt damage to you this turn."
  // - Condemn: "Put target attacking creature on the bottom of its owner's library."
  // - Wing Snare: "Destroy target creature with flying."
  // ==========================================================================
  
  // Pattern: "target creature that dealt damage to you this turn" (Reciprocate)
  // Also handles: "target creature that dealt combat damage to you this turn"
  const dealtDamageToYouMatch = t.match(/target creature that dealt (?:combat )?damage to you this turn/i);
  if (dealtDamageToYouMatch) {
    const isCombatOnly = t.includes('combat damage to you');
    const restrictionType: TargetRestrictionType = isCombatOnly 
      ? 'dealt_combat_damage_to_you_this_turn' 
      : 'dealt_damage_to_you_this_turn';
    const restriction: TargetRestriction = {
      type: restrictionType,
      description: isCombatOnly ? 'that dealt combat damage to you this turn' : 'that dealt damage to you this turn',
    };
    
    // Determine the operation
    if (/exile target/.test(t)) {
      return { 
        op: 'EXILE_TARGET', 
        filter: 'CREATURE', 
        minTargets: 1, 
        maxTargets: 1, 
        targetRestriction: restriction,
        targetDescription: `creature ${restriction.description}`,
      };
    }
    if (/destroy target/.test(t)) {
      return { 
        op: 'DESTROY_TARGET', 
        filter: 'CREATURE', 
        minTargets: 1, 
        maxTargets: 1, 
        targetRestriction: restriction,
        targetDescription: `creature ${restriction.description}`,
      };
    }
    return { 
      op: 'TARGET_CREATURE', 
      filter: 'CREATURE', 
      minTargets: 1, 
      maxTargets: 1, 
      targetRestriction: restriction,
      targetDescription: `creature ${restriction.description}`,
    };
  }

  // Pattern: "target attacking or blocking creature"
  const attackingOrBlockingCreatureMatch = t.match(/target attacking or blocking creature/i);
  if (attackingOrBlockingCreatureMatch) {
    const restriction: TargetRestriction = {
      type: 'attacked_or_blocked_this_turn',
      description: 'that is attacking or blocking',
    };

    if (/^tap\b/i.test(t.trim())) {
      return { op: 'TAP_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking or blocking creature' };
    }
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking or blocking creature' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking or blocking creature' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking or blocking creature' };
  }

  // Pattern: "target creature that attacked this turn"
  const attackedThisTurnMatch = t.match(/target creature that attacked this turn/i);
  if (attackedThisTurnMatch) {
    const restriction: TargetRestriction = {
      type: 'attacked_this_turn',
      description: 'that attacked this turn',
    };

    if (/^tap\b/i.test(t.trim())) {
      return { op: 'TAP_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that attacked this turn' };
    }
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that attacked this turn' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that attacked this turn' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that attacked this turn' };
  }

  // Pattern: "target creature that blocked this turn"
  const blockedThisTurnMatch = t.match(/target creature that blocked this turn/i);
  if (blockedThisTurnMatch) {
    const restriction: TargetRestriction = {
      type: 'blocked_this_turn',
      description: 'that blocked this turn',
    };

    if (/^tap\b/i.test(t.trim())) {
      return { op: 'TAP_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that blocked this turn' };
    }
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that blocked this turn' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that blocked this turn' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that blocked this turn' };
  }

  // Pattern: "target creature that entered the battlefield this turn" (post-Bloomburrow may omit "the battlefield")
  const enteredThisTurnMatch = t.match(/target creature that entered(?: (?:the )?battlefield)? this turn/i);
  if (enteredThisTurnMatch) {
    const restriction: TargetRestriction = {
      type: 'entered_this_turn',
      description: 'that entered this turn',
    };

    if (/^tap\b/i.test(t.trim())) {
      return { op: 'TAP_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that entered this turn' };
    }
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that entered this turn' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that entered this turn' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'creature that entered this turn' };
  }
  
  // Pattern: "target attacking creature" (Condemn, Divine Verdict, etc.)
  const attackingCreatureMatch = t.match(/target attacking creature/i);
  if (attackingCreatureMatch) {
    const restriction: TargetRestriction = {
      type: 'attacked_this_turn',
      description: 'that is attacking',
    };

    if (/^tap\b/i.test(t.trim())) {
      return { op: 'TAP_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking creature' };
    }
    
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking creature' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking creature' };
    }
    // Some spells like Condemn put on bottom of library - treat as destroy for now
    if (/put target attacking creature/.test(t) || /on the bottom/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking creature' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking creature' };
  }
  
  // Pattern: "target blocking creature"
  const blockingCreatureMatch = t.match(/target blocking creature/i);
  if (blockingCreatureMatch) {
    const restriction: TargetRestriction = {
      type: 'blocked_this_turn',
      description: 'that is blocking',
    };

    if (/^tap\b/i.test(t.trim())) {
      return { op: 'TAP_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'blocking creature' };
    }
    
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'blocking creature' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'blocking creature' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'blocking creature' };
  }
  
  // Pattern: "target tapped creature"
  const tappedCreatureMatch = t.match(/target tapped creature/i);
  if (tappedCreatureMatch) {
    const restriction: TargetRestriction = {
      type: 'tapped',
      description: 'that is tapped',
    };
    
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'tapped creature' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'tapped creature' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'tapped creature' };
  }
  
  // Pattern: "target untapped creature"
  const untappedCreatureMatch = t.match(/target untapped creature/i);
  if (untappedCreatureMatch) {
    const restriction: TargetRestriction = {
      type: 'untapped',
      description: 'that is untapped',
    };
    
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'untapped creature' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'untapped creature' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'untapped creature' };
  }

  // Pattern: "target creature that player controls" with "cast only during an opponent's turn" (Delirium)
  // Delirium: "Cast this spell only during an opponent's turn. Tap target creature that player controls.
  //           That creature deals damage equal to its power to the player."
  // "that player" refers to the opponent whose turn it is
  if (/cast (?:this spell )?only during an opponent's turn/i.test(t) && 
      /target creature that player controls/i.test(t)) {
    const restriction: TargetRestriction = {
      type: 'controlled_by_active_player',
      description: 'controlled by the opponent whose turn it is',
    };
    
    // Delirium taps and deals damage, but we'll categorize as TARGET_CREATURE
    // The spell resolution handles the actual tap+damage effect
    return { 
      op: 'TARGET_CREATURE', 
      filter: 'CREATURE', 
      minTargets: 1, 
      maxTargets: 1, 
      targetRestriction: restriction,
      targetDescription: 'creature that player controls',
    };
  }

  // Pattern: "target creature with [keyword]" (Atraxa's Fall, Wing Snare, Aerial Predation, etc.)
  // Keywords: flying, reach, deathtouch, lifelink, trample, vigilance, haste, etc.
  const keywordAbilities = ['flying', 'reach', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'haste', 
                            'menace', 'hexproof', 'indestructible', 'first strike', 'double strike'];
  for (const keyword of keywordAbilities) {
    const keywordPattern = new RegExp(`target creature with ${keyword}`, 'i');
    if (keywordPattern.test(t)) {
      const restriction: TargetRestriction = {
        type: 'has_keyword',
        description: `with ${keyword}`,
        keyword,
      };
      
      if (/exile target/.test(t)) {
        return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: `creature with ${keyword}` };
      }
      if (/destroy target/.test(t)) {
        return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: `creature with ${keyword}` };
      }
      return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: `creature with ${keyword}` };
    }
  }
  return null;
}
