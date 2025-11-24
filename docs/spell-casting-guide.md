# Spell Casting and Mana System Guide

This guide explains how to use the spell casting, mana management, and ability systems in the MTGEDH rules engine.

## Table of Contents

1. [Overview](#overview)
2. [Mana System](#mana-system)
3. [Spell Casting](#spell-casting)
4. [Stack Operations](#stack-operations)
5. [Activated Abilities](#activated-abilities)
6. [Triggered Abilities](#triggered-abilities)
7. [Integration Examples](#integration-examples)

## Overview

The rules engine provides a complete implementation of Magic: The Gathering's spell casting mechanics, mana system, stack, and abilities based on the Comprehensive Rules.

### Key Components

- **Mana Pool**: Each player has a mana pool that holds unspent mana
- **Spell Casting**: Full Rule 601 implementation for casting spells
- **Stack**: LIFO (last-in-first-out) stack for spells and abilities
- **Mana Abilities**: Special abilities that produce mana (Rule 605)
- **Activated Abilities**: Abilities with costs and effects (Rule 602)
- **Triggered Abilities**: Abilities that trigger on events (Rule 603)

## Mana System

### Mana Pool Structure

```typescript
interface ManaPool {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
}
```

### Tapping for Mana

Use the `tapForMana` action to add mana to a player's pool:

```typescript
rulesEngine.executeAction(gameId, {
  type: 'tapForMana',
  playerId: 'player1',
  permanentId: 'forest-1',
  permanentName: 'Forest',
  manaToAdd: [{ type: ManaType.GREEN, amount: 1 }],
  currentlyTapped: false,
});
```

### Basic Land Mana Abilities

The system includes templates for basic lands:

```typescript
import { BASIC_LAND_ABILITIES, ManaType } from '@mtgedh/rules-engine';

// Create mana ability for a Forest
const forestAbility = BASIC_LAND_ABILITIES.forest('forest-1', 'player1');

// Or manually create for any land
const ability = createBasicLandManaAbility(
  'island-1',
  'Island',
  'player1',
  ManaType.BLUE
);
```

### Mana Pool Emptying

Mana pools empty at the end of each step and phase (Rule 106.4):

```typescript
// This happens automatically during turn progression
// Or manually:
const emptyPool = emptyManaPool();
```

## Spell Casting

### Casting a Spell

To cast a spell, use the `castSpell` action:

```typescript
rulesEngine.executeAction(gameId, {
  type: 'castSpell',
  playerId: 'player1',
  cardId: 'lightning-bolt-1',
  cardName: 'Lightning Bolt',
  cardTypes: ['instant'],
  manaCost: { red: 1 },
  targets: ['player2'],
});
```

### Spell Casting Steps (Rule 601.2)

The spell casting process follows these steps automatically:

1. **Announce** - Declare you're casting the spell
2. **Choose Modes** - Select modes for modal spells
3. **Choose Targets** - Select valid targets
4. **Determine Cost** - Calculate total cost including additional costs
5. **Activate Mana Abilities** - Generate mana if needed
6. **Pay Costs** - Pay all costs
7. **Spell Cast** - Spell goes on the stack

### Timing Restrictions

The system enforces proper timing:

**Sorcery Timing** (for sorceries and most permanents):
- Must be your turn
- Must be a main phase
- Stack must be empty
- Must have priority

**Instant Timing** (for instants):
- Only requirement is priority

```typescript
// Sorcery - requires specific timing
{
  cardTypes: ['sorcery'],
  // Will be validated for sorcery timing
}

// Instant - can be cast any time with priority
{
  cardTypes: ['instant'],
  // Only needs priority
}
```

### Mana Costs

Mana costs support all types:

```typescript
// Colored mana
manaCost: { white: 1, blue: 2 }  // {W}{U}{U}

// Generic mana
manaCost: { generic: 3 }  // {3}

// Explicit colorless
manaCost: { colorless: 2 }  // {C}{C}

// Mixed
manaCost: { white: 1, blue: 1, generic: 2 }  // {2}{W}{U}

// X spells
manaCost: { red: 1 },
xValue: 5  // X=5
```

## Stack Operations

### The Stack

The stack is a LIFO (last-in-first-out) zone where spells and abilities wait to resolve.

```typescript
import { 
  createEmptyStack, 
  pushToStack, 
  popFromStack,
  isStackEmpty 
} from '@mtgedh/rules-engine';

// Create stack
const stack = createEmptyStack();

// Add spell to stack (happens automatically when casting)
const { stack: newStack } = pushToStack(stack, stackObject);

// Check if empty
if (isStackEmpty(stack)) {
  console.log('Stack is empty');
}
```

### Resolving the Stack

Use the `resolveStack` action:

```typescript
rulesEngine.executeAction(gameId, {
  type: 'resolveStack',
});
```

This will:
1. Remove the top object from the stack
2. Check if all targets are still legal
3. Resolve the spell/ability or counter it if targets are illegal
4. Emit appropriate events

### Countering Spells

```typescript
import { counterStackObject } from '@mtgedh/rules-engine';

const { stack: newStack, countered } = counterStackObject(
  stack,
  'spell-id-to-counter'
);
```

## Activated Abilities

### Activating an Ability

Activated abilities have the format: `[Cost]: [Effect]`

```typescript
rulesEngine.executeAction(gameId, {
  type: 'activateAbility',
  playerId: 'player1',
  ability: {
    id: 'prodigal-sorcerer-tap',
    sourceId: 'prodigal-sorcerer-1',
    sourceName: 'Prodigal Sorcerer',
    controllerId: 'player1',
    manaCost: { blue: 1 },
    effect: 'Deal 1 damage to any target',
    targets: ['player2'],
  },
  activationsThisTurn: 0,
  sourceTapped: false,
});
```

### Activation Restrictions

Abilities can have restrictions (Rule 602.5):

```typescript
restrictions: [
  {
    type: 'timing',
    description: 'Activate only as a sorcery',
    requiresSorceryTiming: true,
  },
  {
    type: 'frequency',
    description: 'Activate only once each turn',
    maxPerTurn: 1,
  },
]
```

### Mana Abilities vs. Regular Abilities

**Mana Abilities** (Rule 605):
- Don't use the stack
- Can be activated while paying costs
- Resolve immediately

**Regular Activated Abilities**:
- Use the stack
- Can only be activated with priority
- Can be responded to

## Triggered Abilities

### Creating Triggered Abilities

Triggered abilities use "when," "whenever," or "at":

```typescript
import { 
  createETBTrigger,
  createDiesTrigger,
  createUpkeepTrigger 
} from '@mtgedh/rules-engine';

// "When this enters the battlefield..."
const etbTrigger = createETBTrigger(
  'llanowar-elves-1',
  'Llanowar Elves',
  'player1',
  'Add {G}',
);

// "When this dies..."
const diesTrigger = createDiesTrigger(
  'solemn-simulacrum-1',
  'Solemn Simulacrum',
  'player1',
  'Draw a card',
);

// "At the beginning of your upkeep..."
const upkeepTrigger = createUpkeepTrigger(
  'phyrexian-arena-1',
  'Phyrexian Arena',
  'player1',
  'Draw a card and lose 1 life',
);
```

### Trigger Queue and APNAP Order

Triggers are queued and put on the stack in APNAP (Active Player, Non-Active Player) order:

```typescript
import { processEvent, putTriggersOnStack } from '@mtgedh/rules-engine';

// Process an event to create triggers
const triggers = processEvent(
  TriggerEvent.ENTERS_BATTLEFIELD,
  allTriggeredAbilities,
  eventData
);

// Add to queue and then put on stack
const { stackObjects } = putTriggersOnStack(
  triggerQueue,
  'active-player-id'
);
```

## Integration Examples

### Complete Turn Example

```typescript
// 1. Start of turn - untap everything
// 2. Upkeep - triggers go on stack
// 3. Draw step - draw a card

// 4. Main phase - tap lands for mana
rulesEngine.executeAction(gameId, {
  type: 'tapForMana',
  playerId: 'player1',
  permanentId: 'mountain-1',
  permanentName: 'Mountain',
  manaToAdd: [{ type: ManaType.RED, amount: 1 }],
  currentlyTapped: false,
});

rulesEngine.executeAction(gameId, {
  type: 'tapForMana',
  playerId: 'player1',
  permanentId: 'mountain-2',
  permanentName: 'Mountain',
  manaToAdd: [{ type: ManaType.RED, amount: 1 }],
  currentlyTapped: false,
});

// 5. Cast a spell
rulesEngine.executeAction(gameId, {
  type: 'castSpell',
  playerId: 'player1',
  cardId: 'shock-1',
  cardName: 'Shock',
  cardTypes: ['instant'],
  manaCost: { red: 1, generic: 1 },
  targets: ['player2'],
});

// 6. Pass priority
rulesEngine.executeAction(gameId, {
  type: 'passPriority',
  playerId: 'player1',
});

// 7. Opponent responds or passes
rulesEngine.executeAction(gameId, {
  type: 'passPriority',
  playerId: 'player2',
});

// 8. Resolve stack
rulesEngine.executeAction(gameId, {
  type: 'resolveStack',
});
```

### Counter-spell Interaction

```typescript
// Player 1 casts Divination
rulesEngine.executeAction(gameId, {
  type: 'castSpell',
  playerId: 'player1',
  cardId: 'divination-1',
  cardName: 'Divination',
  cardTypes: ['sorcery'],
  manaCost: { blue: 2, generic: 1 },
});

// Player 1 passes priority
rulesEngine.executeAction(gameId, {
  type: 'passPriority',
  playerId: 'player1',
});

// Player 2 casts Counterspell
rulesEngine.executeAction(gameId, {
  type: 'castSpell',
  playerId: 'player2',
  cardId: 'counterspell-1',
  cardName: 'Counterspell',
  cardTypes: ['instant'],
  manaCost: { blue: 2 },
  targets: ['divination-1'],
});

// Both pass priority, stack resolves
// Counterspell resolves first (LIFO), countering Divination
rulesEngine.executeAction(gameId, { type: 'passPriority', playerId: 'player2' });
rulesEngine.executeAction(gameId, { type: 'passPriority', playerId: 'player1' });

// Resolve Counterspell
rulesEngine.executeAction(gameId, { type: 'resolveStack' });

// Divination is countered, removed from stack
```

## Events

The system emits events for all game actions:

```typescript
rulesEngine.on(RulesEngineEvent.MANA_ADDED, (event) => {
  console.log(`${event.data.playerId} added mana:`, event.data.manaAdded);
});

rulesEngine.on(RulesEngineEvent.SPELL_CAST, (event) => {
  console.log(`${event.data.caster} cast ${event.data.spell.card.name}`);
});

rulesEngine.on(RulesEngineEvent.SPELL_RESOLVED, (event) => {
  console.log(`${event.data.object.cardName} resolved`);
});

rulesEngine.on(RulesEngineEvent.MANA_SPENT, (event) => {
  console.log(`${event.data.playerId} spent mana:`, event.data.cost);
});
```

## Best Practices

1. **Always validate actions** before executing them
2. **Handle mana pool emptying** at the end of each step/phase
3. **Process triggers in APNAP order** for correct game state
4. **Check stack before sorcery-speed actions** to ensure it's empty
5. **Use events** to keep UI synchronized with game state
6. **Test mana costs** before allowing players to initiate casting

## See Also

- [Rules Engine Integration](./rules-engine-integration.md)
- [MTG Comprehensive Rules](../MagicCompRules%2020251114.txt)
- [Keyword Actions Guide](./keyword-actions-guide.md)
