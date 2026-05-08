# Casting Cost Framework Overhaul - Implementation Guide

## Overview

This document provides a comprehensive guide to the enhanced casting cost framework implemented in this PR. The framework now supports:

1. **Additional Cost Types** - Sacrifice and discard with structured filtering
2. **Mana Payment Tracking** - Track exact mana composition for converge/sunburst effects
3. **Alternate Costs** - Devastating Mastery style conditional alternate costs
4. **Enhanced Affinity** - Support for artifacts, creatures, equipment, and basic lands
5. **Convoke Mechanic** - Full support with creature tapping and mana contribution
6. **Cost Reducers** - Urza's Incubator with chosen type tracking
7. **Shared Static Cost Adjustments** - Battlefield, plane, and scheme reductions/taxes shared across server, client, and AI castability checks

## Architecture

### Type System (rules-engine/src/types/costs.ts)

#### New Filter Interfaces

**PermanentFilter** - Used for sacrifice and return-to-hand costs:
```typescript
interface PermanentFilter {
  cardTypes?: string[];        // ['creature', 'artifact']
  subtypes?: string[];         // ['goblin', 'equipment']
  colors?: string[];           // ['red', 'blue']
  minPower?: number;           // For casualty N
  maxCMC?: number;
  minCMC?: number;
  nonToken?: boolean;
  legendary?: boolean;
  controller?: ControllerID;
  customFilter?: string;       // "non-Human creature you own"
}
```

**CardFilter** - Used for discard and exile costs:
```typescript
interface CardFilter {
  cardTypes?: string[];        // ['creature', 'instant']
  colors?: string[];           // ['blue'] for Force of Will
  subtypes?: string[];
  minCMC?: number;
  maxCMC?: number;
  customFilter?: string;
}
```

#### Mana Tracking

**ManaPaymentRecord** - Tracks exact mana spent:
```typescript
interface ManaPaymentRecord {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
  generic: number;
}

// Helper functions
getColorsSpent(payment: ManaPaymentRecord): number
wasColorSpent(payment: ManaPaymentRecord, color: string): boolean
```

#### Cost Payment Context

**CostPaymentContext** - Complete payment history:
```typescript
interface CostPaymentContext {
  spellId: string;
  manaPayment?: ManaPaymentRecord;
  additionalCostsPaid: Cost[];
  alternativeCostUsed?: AlternativeCost;
  convokeTappedCreatures?: ObjectID[];
  affinityReduction?: number;
  improviseArtifacts?: ObjectID[];
  delveCards?: ObjectID[];
}
```

### Affinity Support (rules-engine/src/cards/costReduction.ts)

#### Affinity Configuration

```typescript
interface AffinityConfig {
  cardName: string;
  affinityFor: string;      // "artifacts", "creatures", "Plains"
  reductionPer: number;     // Usually 1
  maxReduction?: number;
}

const AFFINITY_CARDS = {
  'thoughtcast': { affinityFor: 'artifacts', reductionPer: 1 },
  'frogmite': { affinityFor: 'artifacts', reductionPer: 1 },
  // ...
};

// Helper functions
hasAffinity(cardName: string, oracleText?: string): boolean
parseAffinityType(oracleText: string): string | undefined
```

### Server-Side Calculations (server/src/socket/game-actions.ts)

#### Enhanced Affinity Calculation

The `calculateCostReduction` function now handles:
- Affinity for artifacts
- Affinity for creatures
- Affinity for equipment  
- Affinity for basic land types (Plains, Island, Swamp, Mountain, Forest)

Example output:
```javascript
{
  generic: 3,
  colors: { white: 0, blue: 0, ... },
  messages: [
    "Affinity for artifacts: -{3} (3 artifacts)",
    "Urza's Incubator: -{2} (goblin)"
  ]
}
```

#### Shared Static Cost Adjustments

Static spell-cost changes are normalized by `server/src/state/modules/cost-adjustments.ts`. The plan builder scans shared static sources through `server/src/state/modules/static-effect-sources.ts`, including battlefield permanents, the active plane, and active schemes. It preserves source metadata so the caller can decide whether to include only battlefield sources or also shared plane/scheme sources.

The shared plan stores generic taxes/reductions separately from colored reductions:

```typescript
const plan = buildCostAdjustmentPlan(game.state, playerId, card);
const live = buildLiveSpellCostAdjustment(plan);
const adjustedCost = applyCostAdjustmentToParsedCost(parsedCost, plan);
```

This lets effects such as "Blue spells cost {U} less to cast" coexist with global taxes such as "Spells cost {1} more to cast" without collapsing everything into a single generic delta. AI castability uses the same adjusted-cost helpers as the socket cast flow, so a spell made free by a plane is considered castable, and a spell made unaffordable by a scheme tax is not.

For command-zone cards, commander tax is folded into display/payment metadata while the internal non-command pending-cast fields remain separate. The shared external payloads are exported from `shared/src/types.ts`:

```typescript
interface PaymentCostAdjustment {
  originalManaCost: string;
  adjustedManaCost: string;
  genericReduction: number;
  coloredReductions: Record<string, number>;
  genericTax: number;
  reductionMessages: string[];
  taxMessages: string[];
  sources: Array<{ kind: 'increase' | 'reduction'; message: string }>;
  kind: 'increase' | 'reduction' | 'mixed';
}

interface CardCostAdjustment {
  originalCost: string;
  adjustedCost: string;
  adjustment: number;
  genericAdjustment?: number;
  sources: string[];
  isIncrease?: boolean;
}
```

`PaymentCostAdjustment` is the client-facing payment prompt contract. Legacy `costReduction`, `externalCostTax`, and `externalCostTaxMessages` still exist inside pending spell casts so older target/payment paths can resolve correctly, but new prompt assertions should prefer `costAdjustment`.

#### Convoke Options Calculation

The `calculateConvokeOptions` function returns:
```javascript
{
  availableCreatures: [
    {
      id: "perm_123",
      name: "Llanowar Elves",
      colors: ['G'],
      canTapFor: ['generic', 'green']
    },
    {
      id: "perm_456", 
      name: "Birds of Paradise",
      colors: ['W', 'U', 'B', 'R', 'G'],
      canTapFor: ['generic', 'white', 'blue', 'black', 'red', 'green']
    }
  ],
  messages: ["Convoke available: 2 untapped creature(s)"]
}
```

### UI Components (client/src/components/CastSpellModal.tsx)

#### Enhanced Props

```typescript
interface CastSpellModalProps {
  // Existing props...
  costAdjustment?: PaymentCostAdjustment;
  convokeOptions?: {
    availableCreatures: Array<{
      id: string;
      name: string;
      colors: string[];
      canTapFor: string[];
    }>;
    messages: string[];
  };
  onConfirm: (
    payment: PaymentItem[], 
    alternateCostId?: string, 
    xValue?: number,
    convokeTappedCreatures?: string[]
  ) => void;
}
```

#### Cost Adjustment Display

Shows original cost, adjusted cost, and the source list for reductions, increases, or mixed adjustments:

```
Cost Adjustments:
{5}{R}{R} -> {R}
- Affinity for artifacts: -{5} (5 artifacts)
```

Older pending-cast internals may still carry `costReduction`, but client prompt rendering should read `costAdjustment`.

#### Convoke UI

Interactive creature selection for convoke:

```
⚡ Convoke: Tap Creatures to Help Pay
Each creature tapped pays for {1} or one mana of its color

☑ Llanowar Elves (pays: generic, green)
☐ Birds of Paradise (pays: generic, white, blue, ...)

✓ Tapping 1 creature
```

## Alternate Costs

The casting UI can surface alternate costs and sends the chosen `alternateCostId` back to the server via the normal cast flow.

Currently supported values:

- `force_of_will`: Force of Will / Force of Negation style alternate cost.
  - Server will prompt (via Resolution Queue `OPTION_CHOICE`) to exile a blue card from hand.
  - Force of Will also requires paying 1 life; Force of Negation has a timing restriction (opponent's turn).
  - When this alternate cost is chosen, the client hides mana payment UI and waits for the server prompt.

## Usage Examples

### Example 1: Thoughtcast with Affinity

**Card**: Thoughtcast {4}{U} - Affinity for artifacts

**With 3 artifacts on battlefield:**
```javascript
// Server calculates
const reduction = calculateCostReduction(game, playerId, thoughtcast);
// Returns: { generic: 3, messages: ["Affinity for artifacts: -{3} (3 artifacts)"] }

// UI displays
Original: {4}{U}
Reduced:  {1}{U}
```

### Example 2: Convoke Spell

**Card**: Chord of Calling {X}{G}{G}{G} - Convoke

**With untapped creatures available:**
```javascript
// Server calculates
const convokeOptions = calculateConvokeOptions(game, playerId, chord);
// Returns available creatures and what they can pay

// Player selects 2 creatures to tap
onConfirm(payment, undefined, xValue, ['creature1', 'creature2'])
```

### Example 3: Converge (Future Implementation)

**Card**: Radiant Flames {2}{R} - Converge

**When cast:**
```javascript
// Track mana payment
const manaPayment: ManaPaymentRecord = {
  white: 1,
  blue: 1,
  black: 0,
  red: 1,
  green: 0,
  colorless: 0,
  generic: 0
};

// Calculate converge
const colors = getColorsSpent(manaPayment); // Returns 3
// Radiant Flames deals 3 damage
```

### Example 4: Conditional Effect (Future Implementation)

**Card**: Boros Fury-Shield {2}{W} - If {R} was spent...

**When cast:**
```javascript
const manaPayment: ManaPaymentRecord = {
  white: 1,
  red: 1,
  generic: 0,
  // ...
};

if (wasColorSpent(manaPayment, 'red')) {
  // Apply bonus effect
}
```

## Testing

### Unit Tests

**Affinity Tests** (rules-engine/test/affinity.test.ts):
- Well-known affinity cards recognition
- Affinity type parsing from oracle text
- Cost calculation with affinity

**Cost Tests** (rules-engine/test/costs.test.ts):
- Mana payment tracking
- Color spent detection
- Permanent and card filters
- Convoke and affinity cost types

## Future Enhancements

### Phase 4: Server Integration
- Wire cost reduction to CastSpellModal from server
- Handle convoke creature tapping
- Apply mana reduction from tapped creatures

### Phase 5: Additional Cost Pickers
- Sacrifice permanent picker with filtering UI
- Discard card picker with filtering UI
- Integration with casting flow

### Phase 6: Mana Payment Tracking
- Server-side tracking of exact mana spent
- Display converge/sunburst values in UI
- Show conditional effects that triggered

## Migration Guide

### For Existing Cards

No changes needed for existing cards. The framework is backward compatible.

### For New Card Implementations

#### Adding Affinity Cards

1. Add to AFFINITY_CARDS database (optional):
```typescript
'my_affinity_card': {
  cardName: 'My Affinity Card',
  affinityFor: 'artifacts',
  reductionPer: 1
}
```

2. Or rely on oracle text parsing:
```
"Affinity for [type]" in oracle text is automatically detected
```

#### Adding Convoke Cards

Just include "Convoke" in oracle text. The system will:
1. Detect convoke keyword
2. Calculate available creatures
3. Display UI for selection
4. Track tapped creatures

#### Adding Conditional Alternate Costs

Use the pattern in oracle text:
```
"You may pay [cost] rather than pay this spell's mana cost.
If the [cost] cost was paid, [effect]"
```

System will detect and track which cost was used.

## Performance Considerations

- Cost reduction calculation: O(n) where n = battlefield permanents
- Convoke options: O(n) where n = controller's creatures
- Affinity detection: Regex-based, cached in card object
- UI rendering: Conditional display minimizes re-renders

## Accessibility

- Color-coded UI panels for different mechanics
- Clear icons (💰 for reductions, ⚡ for convoke)
- Readable font sizes (11-13px for details)
- Hover states for interactive elements
- Keyboard-accessible checkboxes

## Browser Compatibility

Tested with:
- Chrome/Edge (Chromium)
- Firefox
- Safari

Uses standard CSS and HTML, no experimental features.
