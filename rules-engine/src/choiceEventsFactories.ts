import type { BattlefieldPermanent, KnownCardRef, PlayerID } from '../../shared/src';
import {
  ChoiceEventType,
  type AttackerDeclarationEvent,
  type BlockerDeclarationEvent,
  type BlockerOrderEvent,
  type ColorChoiceEvent,
  type CommanderZoneChoiceEvent,
  type CombatDamageAssignmentEvent,
  type CopyCeasesToExistEvent,
  type CreatureTypeChoiceEvent,
  type DiscardSelectionEvent,
  type MayAbilityEvent,
  type ModeSelectionEvent,
  type NumberChoiceEvent,
  type OptionChoiceEvent,
  type PlayerChoiceEvent,
  type ReplacementEffectChoiceEvent,
  type TargetSelectionEvent,
  type TokenCeasesToExistEvent,
  type TriggerOrderEvent,
  type WinEffectTriggeredEvent,
  type XValueSelectionEvent,
} from './choiceEventsTypes';

let eventIdCounter = 0;

function generateEventId(): string {
  return `choice-${Date.now()}-${++eventIdCounter}`;
}

export function createTargetSelectionEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  validTargets: readonly { id: string; name: string; imageUrl?: string }[],
  targetTypes: readonly string[],
  minTargets: number,
  maxTargets: number,
  mandatory: boolean = true,
  sourceImage?: string
): TargetSelectionEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.TARGET_SELECTION,
    playerId,
    sourceId,
    sourceName,
    sourceImage,
    description: `Choose target${maxTargets > 1 ? 's' : ''} for ${sourceName}`,
    mandatory,
    timestamp: Date.now(),
    validTargets: validTargets.map(t => ({
      id: t.id,
      label: t.name,
      imageUrl: t.imageUrl,
    })),
    targetTypes,
    minTargets,
    maxTargets,
    targetDescription: targetTypes.join(' or '),
  };
}

export function createModeSelectionEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  modes: readonly { id: string; text: string }[],
  minModes: number,
  maxModes: number,
  sourceImage?: string
): ModeSelectionEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.MODE_SELECTION,
    playerId,
    sourceId,
    sourceName,
    sourceImage,
    description: `Choose ${minModes === maxModes ? minModes : `${minModes}-${maxModes}`} mode${maxModes > 1 ? 's' : ''} for ${sourceName}`,
    mandatory: true,
    timestamp: Date.now(),
    modes: modes.map((m, i) => ({
      id: m.id || `mode-${i}`,
      label: m.text,
    })),
    minModes,
    maxModes,
    allowDuplicates: false,
  };
}

export function createXValueSelectionEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  minX: number,
  maxX: number,
  sourceImage?: string,
  costPerX?: string
): XValueSelectionEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.X_VALUE_SELECTION,
    playerId,
    sourceId,
    sourceName,
    sourceImage,
    description: `Choose value for X in ${sourceName}`,
    mandatory: true,
    timestamp: Date.now(),
    minX,
    maxX,
    costPerX,
  };
}

export function createAttackerDeclarationEvent(
  playerId: PlayerID,
  legalAttackers: readonly BattlefieldPermanent[],
  defendingPlayers: readonly { id: PlayerID; name: string }[],
  attackCosts?: readonly { permanentId: string; permanentName: string; costDescription: string }[]
): AttackerDeclarationEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.ATTACKER_DECLARATION,
    playerId,
    description: 'Declare attackers',
    mandatory: false,
    timestamp: Date.now(),
    legalAttackers: legalAttackers.map(p => {
      const card = p.card as KnownCardRef;
      return {
        id: p.id,
        label: card?.name || 'Creature',
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      };
    }),
    defendingPlayers,
    attackCosts,
  };
}

export function createBlockerDeclarationEvent(
  playerId: PlayerID,
  legalBlockers: readonly BattlefieldPermanent[],
  attackers: readonly { permanent: BattlefieldPermanent; keywords: readonly string[] }[]
): BlockerDeclarationEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.BLOCKER_DECLARATION,
    playerId,
    description: 'Declare blockers',
    mandatory: false,
    timestamp: Date.now(),
    legalBlockers: legalBlockers.map(p => {
      const card = p.card as KnownCardRef;
      return {
        id: p.id,
        label: card?.name || 'Creature',
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      };
    }),
    attackers: attackers.map(a => {
      const card = a.permanent.card as KnownCardRef;
      const powerValue = card?.power ? Number(card.power) : 0;
      return {
        id: a.permanent.id,
        name: card?.name || 'Creature',
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        power: isNaN(powerValue) ? 0 : powerValue,
        keywords: a.keywords,
      };
    }),
    restrictions: [],
  };
}

export function createMayAbilityEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  abilityText: string,
  cost?: string,
  sourceImage?: string
): MayAbilityEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.MAY_ABILITY,
    playerId,
    sourceId,
    sourceName,
    sourceImage,
    description: `${sourceName}: ${abilityText}`,
    mandatory: false,
    timestamp: Date.now(),
    abilityText,
    cost,
    defaultChoice: 'no',
  };
}

export function createCombatDamageAssignmentEvent(
  playerId: PlayerID,
  attackerId: string,
  attackerName: string,
  attackerPower: number,
  blockers: readonly {
    id: string;
    name: string;
    toughness: number;
    existingDamage: number;
    lethalDamage: number;
  }[],
  hasTrample: boolean,
  defendingPlayerId?: PlayerID
): CombatDamageAssignmentEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.COMBAT_DAMAGE_ASSIGNMENT,
    playerId,
    sourceId: attackerId,
    sourceName: attackerName,
    description: `Assign ${attackerPower} damage from ${attackerName}`,
    mandatory: true,
    timestamp: Date.now(),
    attackerId,
    attackerName,
    attackerPower,
    blockers,
    hasTrample,
    defendingPlayerId,
  };
}

export function createBlockerOrderEvent(
  playerId: PlayerID,
  attackerId: string,
  attackerName: string,
  blockers: readonly BattlefieldPermanent[]
): BlockerOrderEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.BLOCKER_ORDER,
    playerId,
    sourceId: attackerId,
    sourceName: attackerName,
    description: `Order blockers for ${attackerName}`,
    mandatory: true,
    timestamp: Date.now(),
    attackerId,
    attackerName,
    blockers: blockers.map(b => {
      const card = b.card as KnownCardRef;
      return {
        id: b.id,
        label: card?.name || 'Blocker',
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      };
    }),
  };
}

export function createDiscardSelectionEvent(
  playerId: PlayerID,
  hand: readonly KnownCardRef[],
  discardCount: number,
  maxHandSize: number,
  reason: 'cleanup' | 'effect',
  sourceId?: string,
  sourceName?: string
): DiscardSelectionEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.DISCARD_SELECTION,
    playerId,
    sourceId,
    sourceName,
    description: reason === 'cleanup'
      ? `Discard ${discardCount} card${discardCount > 1 ? 's' : ''} to hand size`
      : `Discard ${discardCount} card${discardCount > 1 ? 's' : ''}`,
    mandatory: true,
    timestamp: Date.now(),
    hand: hand.map(c => ({
      id: c.id,
      label: c.name,
      imageUrl: c.image_uris?.small || c.image_uris?.normal,
    })),
    discardCount,
    currentHandSize: hand.length,
    maxHandSize,
    reason,
  };
}

export function createTokenCeasesToExistEvent(
  playerId: PlayerID,
  tokens: readonly { id: string; name: string }[],
  zone: string
): TokenCeasesToExistEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.TOKEN_CEASES_TO_EXIST,
    playerId,
    description: `Token${tokens.length > 1 ? 's' : ''} ${tokens.map(t => t.name).join(', ')} ceased to exist`,
    mandatory: false,
    timestamp: Date.now(),
    tokenIds: tokens.map(t => t.id),
    tokenNames: tokens.map(t => t.name),
    zone,
    reason: `Token in ${zone}, not battlefield (Rule 704.5d)`,
  };
}

export function createCopyCeasesToExistEvent(
  playerId: PlayerID,
  copyId: string,
  copyName: string,
  copyType: 'spell' | 'card',
  zone: string,
  originalId?: string,
  originalName?: string
): CopyCeasesToExistEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.COPY_CEASES_TO_EXIST,
    playerId,
    description: `Copy of ${originalName || copyName} ceased to exist`,
    mandatory: false,
    timestamp: Date.now(),
    copyId,
    copyName,
    copyType,
    zone,
    originalId,
    originalName,
  };
}

export function createCommanderZoneChoiceEvent(
  playerId: PlayerID,
  commanderId: string,
  commanderName: string,
  fromZone: 'graveyard' | 'exile'
): CommanderZoneChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.COMMANDER_ZONE_CHOICE,
    playerId,
    sourceId: commanderId,
    sourceName: commanderName,
    description: `${commanderName} would be put into ${fromZone}. Move to command zone?`,
    mandatory: false,
    timestamp: Date.now(),
    commanderId,
    commanderName,
    fromZone,
    toZone: 'command',
  };
}

export function createTriggerOrderEvent(
  playerId: PlayerID,
  triggers: readonly { id: string; sourceName: string; description: string }[]
): TriggerOrderEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.TRIGGER_ORDER,
    playerId,
    description: 'Order your triggered abilities on the stack',
    mandatory: true,
    timestamp: Date.now(),
    triggers: triggers.map(t => ({
      id: t.id,
      label: t.sourceName,
      description: t.description,
    })),
    requireAll: true,
  };
}

export function createReplacementEffectChoiceEvent(
  playerId: PlayerID,
  affectedPlayerId: PlayerID,
  affectedEvent: string,
  replacementEffects: readonly { id: string; sourceName: string; description: string }[]
): ReplacementEffectChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.REPLACEMENT_EFFECT_CHOICE,
    playerId,
    description: `Choose which replacement effect applies to: ${affectedEvent}`,
    mandatory: true,
    timestamp: Date.now(),
    replacementEffects: replacementEffects.map(r => ({
      id: r.id,
      label: r.sourceName,
      description: r.description,
    })),
    affectedEvent,
    affectedPlayerId,
  };
}

export function createWinEffectTriggeredEvent(
  winningPlayerId: PlayerID,
  winReason: string,
  sourceId: string,
  sourceName: string
): WinEffectTriggeredEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.WIN_EFFECT_TRIGGERED,
    playerId: winningPlayerId,
    sourceId,
    sourceName,
    description: `${sourceName}: ${winReason}`,
    mandatory: false,
    timestamp: Date.now(),
    winningPlayerId,
    winReason,
  };
}

export function createColorChoiceEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  minColors: number = 1,
  maxColors: number = 1
): ColorChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.COLOR_CHOICE,
    playerId,
    sourceId,
    sourceName,
    description: `Choose ${minColors === maxColors ? minColors : `${minColors}-${maxColors}`} color${maxColors > 1 ? 's' : ''}`,
    mandatory: true,
    timestamp: Date.now(),
    colors: [
      { id: 'W', label: 'White', description: 'âšª' },
      { id: 'U', label: 'Blue', description: 'ðŸ”µ' },
      { id: 'B', label: 'Black', description: 'âš«' },
      { id: 'R', label: 'Red', description: 'ðŸ”´' },
      { id: 'G', label: 'Green', description: 'ðŸŸ¢' },
    ],
    minColors,
    maxColors,
  };
}

export function createCreatureTypeChoiceEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  suggestedTypes: readonly string[] = []
): CreatureTypeChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.CREATURE_TYPE_CHOICE,
    playerId,
    sourceId,
    sourceName,
    description: `Choose a creature type for ${sourceName}`,
    mandatory: true,
    timestamp: Date.now(),
    suggestedTypes: suggestedTypes.length > 0 ? suggestedTypes : [
      'Human', 'Elf', 'Goblin', 'Zombie', 'Soldier', 'Wizard', 'Dragon', 'Angel',
      'Demon', 'Beast', 'Elemental', 'Spirit', 'Vampire', 'Warrior', 'Knight',
    ],
    allowCustom: true,
  };
}

export function createNumberChoiceEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  minValue: number,
  maxValue: number,
  defaultValue?: number
): NumberChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.NUMBER_CHOICE,
    playerId,
    sourceId,
    sourceName,
    description: `Choose a number for ${sourceName}`,
    mandatory: true,
    timestamp: Date.now(),
    minValue,
    maxValue,
    defaultValue,
  };
}

export function createPlayerChoiceEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  validPlayers: readonly { id: PlayerID; name: string }[],
  allowSelf: boolean = true,
  allowOpponents: boolean = true
): PlayerChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.PLAYER_CHOICE,
    playerId,
    sourceId,
    sourceName,
    description: `Choose a player for ${sourceName}`,
    mandatory: true,
    timestamp: Date.now(),
    validPlayers,
    allowSelf,
    allowOpponents,
  };
}

export function createOptionChoiceEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  description: string,
  options: readonly { id: string; label: string; description?: string }[],
  minSelections: number = 1,
  maxSelections: number = 1
): OptionChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.OPTION_CHOICE,
    playerId,
    sourceId,
    sourceName,
    description,
    mandatory: minSelections > 0,
    timestamp: Date.now(),
    options,
    minSelections,
    maxSelections,
  };
}
