/**
 * Rule 704: State-Based Actions
 * 
 * State-based actions are game actions that happen automatically whenever
 * certain conditions are met. They don't use the stack.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 704
 */

/**
 * Rule 704.1: State-based actions happen automatically
 * 
 * State-based actions are game actions that happen automatically whenever
 * certain conditions (listed below) are met. State-based actions don't use
 * the stack.
 */

export interface StateBasedAction {
  readonly type: StateBasedActionType;
  readonly affectedObjectIds: readonly string[];
  readonly reason: string;
}

export enum StateBasedActionType {
  // Rule 704.5a
  PLAYER_ZERO_LIFE = 'player-zero-life',
  
  // Rule 704.5b
  PLAYER_LIBRARY_EMPTY = 'player-library-empty',
  
  // Rule 704.5c
  PLAYER_POISON = 'player-poison',
  
  // Rule 704.5d
  TOKEN_NOT_ON_BATTLEFIELD = 'token-not-on-battlefield',
  
  // Rule 704.5e
  COPY_NOT_IN_VALID_ZONE = 'copy-not-in-valid-zone',
  
  // Rule 704.5f
  CREATURE_ZERO_TOUGHNESS = 'creature-zero-toughness',
  
  // Rule 704.5g
  CREATURE_LETHAL_DAMAGE = 'creature-lethal-damage',
  
  // Rule 704.5h
  CREATURE_DEATHTOUCH_DAMAGE = 'creature-deathtouch-damage',
  
  // Rule 704.5i
  PLANESWALKER_ZERO_LOYALTY = 'planeswalker-zero-loyalty',
  
  // Rule 704.5j
  LEGEND_RULE = 'legend-rule',
  
  // Rule 704.5k
  WORLD_RULE = 'world-rule',
  
  // Rule 704.5m
  AURA_ILLEGAL_ATTACHMENT = 'aura-illegal-attachment',
  
  // Rule 704.5n
  EQUIPMENT_ILLEGAL_ATTACHMENT = 'equipment-illegal-attachment',
  
  // Rule 704.5p
  CREATURE_BATTLE_ATTACHED = 'creature-battle-attached',
  
  // Rule 704.5q
  COUNTER_CANCELLATION = 'counter-cancellation',
  
  // Rule 704.5r
  COUNTER_LIMIT = 'counter-limit',
  
  // Rule 704.5s
  SAGA_COMPLETE = 'saga-complete',
  
  // Rule 704.5t
  DUNGEON_COMPLETE = 'dungeon-complete',
  
  // Rule 704.5v
  BATTLE_ZERO_DEFENSE = 'battle-zero-defense',
  
  // Rule 704.5w/x
  BATTLE_NO_PROTECTOR = 'battle-no-protector',
  
  // Rule 704.5y
  ROLE_DUPLICATE = 'role-duplicate',
  
  // Commander variant (Rule 704.6c)
  COMMANDER_DAMAGE = 'commander-damage',
  
  // Commander variant (Rule 704.6d)
  COMMANDER_ZONE_CHANGE = 'commander-zone-change',
}

/**
 * Rule 704.3: State-based actions are checked before priority
 * 
 * Whenever a player would get priority, the game checks for any of the listed
 * conditions for state-based actions, then performs all applicable state-based
 * actions simultaneously as a single event.
 */
export interface StateBasedActionCheck {
  readonly actionsToPerform: readonly StateBasedAction[];
  readonly checkAgain: boolean; // True if any actions were performed
}

/**
 * Rule 704.5a: Zero or less life
 * 
 * If a player has 0 or less life, that player loses the game.
 */
export function checkPlayerLife(
  playerId: string,
  life: number
): StateBasedAction | null {
  if (life <= 0) {
    return {
      type: StateBasedActionType.PLAYER_ZERO_LIFE,
      affectedObjectIds: [playerId],
      reason: `Player has ${life} life (Rule 704.5a)`,
    };
  }
  return null;
}

/**
 * Rule 704.5b: Empty library draw
 * 
 * If a player attempted to draw a card from a library with no cards in it
 * since the last time state-based actions were checked, that player loses the game.
 */
export function checkEmptyLibraryDraw(
  playerId: string,
  attemptedDraw: boolean
): StateBasedAction | null {
  if (attemptedDraw) {
    return {
      type: StateBasedActionType.PLAYER_LIBRARY_EMPTY,
      affectedObjectIds: [playerId],
      reason: 'Player attempted to draw from empty library (Rule 704.5b)',
    };
  }
  return null;
}

/**
 * Rule 704.5c: Poison counters
 * 
 * If a player has ten or more poison counters, that player loses the game.
 */
export function checkPoisonCounters(
  playerId: string,
  poisonCounters: number
): StateBasedAction | null {
  if (poisonCounters >= 10) {
    return {
      type: StateBasedActionType.PLAYER_POISON,
      affectedObjectIds: [playerId],
      reason: `Player has ${poisonCounters} poison counters (Rule 704.5c)`,
    };
  }
  return null;
}

/**
 * Rule 704.5d: Token in wrong zone
 * 
 * If a token is in a zone other than the battlefield, it ceases to exist.
 */
export function checkTokenZone(
  tokenId: string,
  zone: string
): StateBasedAction | null {
  if (zone !== 'battlefield') {
    return {
      type: StateBasedActionType.TOKEN_NOT_ON_BATTLEFIELD,
      affectedObjectIds: [tokenId],
      reason: `Token in ${zone}, not battlefield (Rule 704.5d)`,
    };
  }
  return null;
}

/**
 * Rule 704.5e: Copy in wrong zone
 * 
 * If a copy of a spell is in a zone other than the stack, it ceases to exist.
 * If a copy of a card is in any zone other than the stack or the battlefield,
 * it ceases to exist.
 */
export function checkCopyZone(
  copyId: string,
  copyType: 'spell' | 'card',
  zone: string
): StateBasedAction | null {
  const validZones = copyType === 'spell' ? ['stack'] : ['stack', 'battlefield'];
  
  if (!validZones.includes(zone)) {
    return {
      type: StateBasedActionType.COPY_NOT_IN_VALID_ZONE,
      affectedObjectIds: [copyId],
      reason: `Copy of ${copyType} in ${zone} (Rule 704.5e)`,
    };
  }
  return null;
}

/**
 * Rule 704.5f: Zero or less toughness
 * 
 * If a creature has toughness 0 or less, it's put into its owner's graveyard.
 * Regeneration can't replace this event.
 */
export function checkCreatureToughness(
  creatureId: string,
  toughness: number
): StateBasedAction | null {
  if (toughness <= 0) {
    return {
      type: StateBasedActionType.CREATURE_ZERO_TOUGHNESS,
      affectedObjectIds: [creatureId],
      reason: `Creature has ${toughness} toughness (Rule 704.5f)`,
    };
  }
  return null;
}

/**
 * Rule 704.5g: Lethal damage
 * 
 * If a creature has toughness greater than 0, it has damage marked on it, and
 * the total damage marked on it is greater than or equal to its toughness, that
 * creature has been dealt lethal damage and is destroyed. Regeneration can
 * replace this event.
 */
export function checkLethalDamage(
  creatureId: string,
  toughness: number,
  damageMarked: number
): StateBasedAction | null {
  if (toughness > 0 && damageMarked >= toughness) {
    return {
      type: StateBasedActionType.CREATURE_LETHAL_DAMAGE,
      affectedObjectIds: [creatureId],
      reason: `Creature has ${damageMarked} damage, toughness ${toughness} (Rule 704.5g)`,
    };
  }
  return null;
}

/**
 * Rule 704.5h: Deathtouch damage
 * 
 * If a creature has toughness greater than 0, and it's been dealt damage by a
 * source with deathtouch since the last time state-based actions were checked,
 * that creature is destroyed. Regeneration can replace this event.
 */
export function checkDeathtouchDamage(
  creatureId: string,
  toughness: number,
  hasDeathtouchDamage: boolean
): StateBasedAction | null {
  if (toughness > 0 && hasDeathtouchDamage) {
    return {
      type: StateBasedActionType.CREATURE_DEATHTOUCH_DAMAGE,
      affectedObjectIds: [creatureId],
      reason: 'Creature dealt damage by deathtouch source (Rule 704.5h)',
    };
  }
  return null;
}

/**
 * Rule 704.5i: Zero loyalty
 * 
 * If a planeswalker has loyalty 0, it's put into its owner's graveyard.
 */
export function checkPlaneswalkerLoyalty(
  planeswalkerId: string,
  loyalty: number
): StateBasedAction | null {
  if (loyalty === 0) {
    return {
      type: StateBasedActionType.PLANESWALKER_ZERO_LOYALTY,
      affectedObjectIds: [planeswalkerId],
      reason: 'Planeswalker has 0 loyalty (Rule 704.5i)',
    };
  }
  return null;
}

/**
 * Rule 704.5j: Legend rule
 * 
 * If two or more legendary permanents with the same name are controlled by the
 * same player, that player chooses one of them, and the rest are put into their
 * owners' graveyards.
 */
export function checkLegendRule(
  legendaryPermanents: readonly { id: string; name: string; controllerId: string }[]
): StateBasedAction | null {
  const byControllerAndName = new Map<string, string[]>();
  
  for (const permanent of legendaryPermanents) {
    const key = `${permanent.controllerId}:${permanent.name}`;
    const list = byControllerAndName.get(key) || [];
    list.push(permanent.id);
    byControllerAndName.set(key, list);
  }
  
  // Find duplicates
  const duplicates: string[] = [];
  for (const [, ids] of byControllerAndName) {
    if (ids.length > 1) {
      // All but one (chosen by player) will be put in graveyard
      duplicates.push(...ids);
    }
  }
  
  if (duplicates.length > 0) {
    return {
      type: StateBasedActionType.LEGEND_RULE,
      affectedObjectIds: duplicates,
      reason: 'Multiple legendary permanents with same name (Rule 704.5j)',
    };
  }
  
  return null;
}

/**
 * Rule 704.5k: World rule
 * 
 * If two or more permanents have the supertype world, all except the one that
 * has had the world supertype for the shortest amount of time are put into
 * their owners' graveyards.
 */
export function checkWorldRule(
  worldPermanents: readonly { id: string; timestamp: number }[]
): StateBasedAction | null {
  if (worldPermanents.length <= 1) return null;
  
  // Find the newest world permanent
  let newestTimestamp = -Infinity;
  let newestId = '';
  
  for (const world of worldPermanents) {
    if (world.timestamp > newestTimestamp) {
      newestTimestamp = world.timestamp;
      newestId = world.id;
    }
  }
  
  const toRemove = worldPermanents
    .filter(w => w.id !== newestId)
    .map(w => w.id);
  
  if (toRemove.length > 0) {
    return {
      type: StateBasedActionType.WORLD_RULE,
      affectedObjectIds: toRemove,
      reason: 'Multiple world permanents (Rule 704.5k)',
    };
  }
  
  return null;
}

/**
 * Rule 704.5m: Aura illegal attachment
 * 
 * If an Aura is attached to an illegal object or player, or is not attached to
 * an object or player, that Aura is put into its owner's graveyard.
 */
export function checkAuraAttachment(
  auraId: string,
  attachedTo: string | null,
  isLegalAttachment: boolean
): StateBasedAction | null {
  if (!attachedTo || !isLegalAttachment) {
    return {
      type: StateBasedActionType.AURA_ILLEGAL_ATTACHMENT,
      affectedObjectIds: [auraId],
      reason: 'Aura not legally attached (Rule 704.5m)',
    };
  }
  return null;
}

/**
 * Rule 704.5n: Equipment/Fortification illegal attachment
 * 
 * If an Equipment or Fortification is attached to an illegal permanent or to a
 * player, it becomes unattached from that permanent or player. It remains on
 * the battlefield.
 */
export function checkEquipmentAttachment(
  equipmentId: string,
  attachedTo: string | null,
  isLegalAttachment: boolean
): StateBasedAction | null {
  if (attachedTo && !isLegalAttachment) {
    return {
      type: StateBasedActionType.EQUIPMENT_ILLEGAL_ATTACHMENT,
      affectedObjectIds: [equipmentId],
      reason: 'Equipment/Fortification illegally attached (Rule 704.5n)',
    };
  }
  return null;
}

/**
 * Rule 704.5q: Counter cancellation
 * 
 * If a permanent has both a +1/+1 counter and a -1/-1 counter on it, N +1/+1
 * and N -1/-1 counters are removed from it, where N is the smaller of the
 * number of +1/+1 and -1/-1 counters on it.
 */
export function checkCounterCancellation(
  permanentId: string,
  plusCounters: number,
  minusCounters: number
): StateBasedAction | null {
  if (plusCounters > 0 && minusCounters > 0) {
    return {
      type: StateBasedActionType.COUNTER_CANCELLATION,
      affectedObjectIds: [permanentId],
      reason: `Remove ${Math.min(plusCounters, minusCounters)} pairs of +1/+1 and -1/-1 counters (Rule 704.5q)`,
    };
  }
  return null;
}

/**
 * Rule 704.5v: Battle zero defense
 * 
 * If a battle has defense 0 and it isn't the source of an ability that has
 * triggered but not yet left the stack, it's put into its owner's graveyard.
 */
export function checkBattleDefense(
  battleId: string,
  defense: number,
  hasTriggeredAbilityOnStack: boolean
): StateBasedAction | null {
  if (defense === 0 && !hasTriggeredAbilityOnStack) {
    return {
      type: StateBasedActionType.BATTLE_ZERO_DEFENSE,
      affectedObjectIds: [battleId],
      reason: 'Battle has 0 defense (Rule 704.5v)',
    };
  }
  return null;
}

/**
 * Rule 704.6c: Commander damage (variant rule)
 * 
 * In a Commander game, a player who's been dealt 21 or more combat damage by
 * the same commander over the course of the game loses the game.
 */
export function checkCommanderDamage(
  playerId: string,
  commanderDamage: Map<string, number>
): StateBasedAction | null {
  for (const [commanderId, damage] of commanderDamage) {
    if (damage >= 21) {
      return {
        type: StateBasedActionType.COMMANDER_DAMAGE,
        affectedObjectIds: [playerId, commanderId],
        reason: `Player dealt ${damage} combat damage by commander (Rule 704.6c)`,
      };
    }
  }
  return null;
}

/**
 * Rule 704.4: State-based actions don't care about spell/ability resolution
 * 
 * Unlike triggered abilities, state-based actions pay no attention to what
 * happens during the resolution of a spell or ability.
 */
export const STATE_BASED_ACTIONS_DONT_USE_STACK = true;
export const STATE_BASED_ACTIONS_IGNORE_RESOLUTION = true;
