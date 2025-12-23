# X-Cost Activated Abilities - Pattern-Based Implementation

## Overview

Instead of maintaining a hardcoded registry of specific cards, the system uses **pattern-based detection** from oracle text to automatically support any card with X-cost activated abilities.

## How It Works

### 1. Pattern Detection

When a player activates an ability, the system:
1. Reads the card's oracle text
2. Looks for lines matching `{X}: <effect>`
3. Analyzes the effect text to categorize the pattern
4. Extracts metadata (once per turn, timing restrictions, etc.)

### 2. Supported Patterns

The system recognizes these common X-ability patterns:

| Pattern | Example Cards | Oracle Text Pattern |
|---------|--------------|---------------------|
| **DESTROY_MV_X** | Steel Hellkite | `destroy` + `mana value X` |
| **BECOME_X_X** | Chimeric Staff, Mirror Entity | `becomes` + `X/X` |
| **BASE_POWER_X** | Minsc, Beloved Ranger | `base power and toughness X/X` |
| **PLUS_X_ZERO** | Demonspine Whip | `gets +X/+0` |
| **PLUS_X_X** | Various | `gets +X/+X` |
| **DEAL_X_DAMAGE** | Crypt Rats, Vengeful Archon | `deals X damage` |
| **PREVENT_X_DAMAGE** | Vengeful Archon | `prevent` + `X damage` |
| **PUT_X_COUNTERS** | Helix Pinnacle, Energy Vortex | `put X` + `counter` |
| **COPY_MV_X** | Lazav, Likeness Looter | `copy` + `mana value X` |
| **SCRY_X** | Soothsaying | `look at` or `scry` + `X card` |
| **SEARCH_MV_X** | Citanul Flute | `search` + `mana value X` |

### 3. Automatic Metadata Extraction

The system automatically detects:
- **Once per turn**: "Activate only once each turn"
- **Timing restriction**: "Activate only as a sorcery"
- **Combat damage requirement**: "combat damage" in ability text
- **Mana restriction**: "Spend only black mana on X"

## Example: Steel Hellkite

```typescript
Oracle text:
"{X}: Destroy each nonland permanent with mana value X whose controller 
was dealt combat damage by this creature this turn. Activate only once each turn."

Detected pattern: DESTROY_MV_X
Metadata extracted:
  - requiresCombatDamage: true (contains "combat damage")
  - oncePerTurn: true (contains "Activate only once each turn")
```

## Example: Crypt Rats

```typescript
Oracle text:
"{X}: This creature deals X damage to each creature and each player. 
Spend only black mana on X."

Detected pattern: DEAL_X_DAMAGE
Metadata extracted:
  - manaRestriction: "black" (from "Spend only black mana")
```

## Example: Mirror Entity

```typescript
Oracle text:
"{X}: Until end of turn, creatures you control have base power and 
toughness X/X and gain all creature types."

Detected pattern: BASE_POWER_X
Metadata extracted:
  - (none, simple activation)
```

## Implementation Architecture

### Pattern Detection (`detectXAbility`)
```typescript
// Analyzes oracle text and returns:
{
  pattern: XAbilityPattern,
  oracleText: string,
  requiresCombatDamage?: boolean,
  oncePerTurn?: boolean,
  timingRestriction?: 'sorcery' | 'instant',
  manaRestriction?: string
}
```

### Pattern Execution (`executeXAbility`)
```typescript
// Routes to pattern-specific implementation:
switch (abilityInfo.pattern) {
  case DESTROY_MV_X: return executeDestroyManaValueX(...)
  case DEAL_X_DAMAGE: return executeDealXDamage(...)
  case PUT_X_COUNTERS: return executePutXCounters(...)
  // ... more patterns
}
```

### Combat Damage Tracking (Generic)
```typescript
// In turn.ts - tracks for ANY card with X ability requiring combat damage
if (oracleText.includes('{x}') && oracleText.includes('combat damage')) {
  // Track damaged players on the permanent
  permanent.dealtCombatDamageTo = Set([damagedPlayerId])
}
```

## Adding New Pattern Support

To support a new pattern:

1. Add enum value to `XAbilityPattern`
2. Add pattern detection in `detectXAbility()`
3. Implement pattern handler (e.g., `executeNewPattern()`)
4. Add case to switch in `executeXAbility()`

**No card-specific code needed!** The system automatically detects and handles any card matching the pattern.

## Benefits Over Registry Approach

### Before (Registry-based):
```typescript
// Had to add each card manually
X_ACTIVATED_ABILITIES = {
  'steel hellkite': { cardName: 'Steel Hellkite', cost: '{X}', ... },
  'heliod, the radiant dawn': { cardName: 'Heliod', ... },
  'ramos, dragon engine': { cardName: 'Ramos', ... },
  // ... hundreds more cards
}
```

### After (Pattern-based):
```typescript
// Automatically supports ALL cards matching patterns
// Steel Hellkite, Crypt Rats, Mirror Entity, etc.
// Zero configuration needed per card!
```

## Currently Implemented Patterns

✅ **DESTROY_MV_X** - Fully implemented (Steel Hellkite and similar)
✅ **DEAL_X_DAMAGE** - Fully implemented (Crypt Rats and similar)
✅ **PUT_X_COUNTERS** - Fully implemented (Helix Pinnacle and similar)

🏗️ **Other patterns** - Detection ready, execution needs implementation

## Cards Automatically Supported

With current implementation:
- **Steel Hellkite** - Destroy permanents with mana value X (combat damage)
- **Crypt Rats** - Deal X damage to each creature and player
- **Helix Pinnacle** - Put X tower counters
- **Energy Vortex** - Put X vortex counters
- **Chromatic Armor** - Put X sleight counters
- Plus any other cards matching these patterns!

## Testing Examples

### Steel Hellkite Flow (unchanged from before)
1. Combat: Steel Hellkite deals damage to player(s) → tracked on permanent
2. Player activates X ability → modal appears for X selection
3. Server detects pattern: DESTROY_MV_X with combat damage requirement
4. Server validates and destroys matching permanents
5. End of turn cleanup

### Crypt Rats Flow (new)
1. Player activates X ability → modal appears
2. Server detects pattern: DEAL_X_DAMAGE to each creature and player
3. Server deals X damage to all creatures and players
4. Returns success message

### Helix Pinnacle Flow (new)
1. Player activates X ability → modal appears
2. Server detects pattern: PUT_X_COUNTERS (tower type)
3. Server adds X tower counters to Helix Pinnacle
4. Returns success message

