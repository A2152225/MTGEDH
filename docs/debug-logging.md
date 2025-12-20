# Debug Logging System

## Overview

The MTGEDH platform uses an environment-based debug logging system that allows you to control the verbosity of debug output without modifying code. This is especially useful for:

- Debugging specific issues without being overwhelmed by logs
- Running production servers with minimal output
- Investigating complex game state interactions

## Debug Levels

The system uses three debug levels controlled by the `DEBUG_STATE` environment variable:

### Level 0 - Production Mode (Default)
**Environment:** `DEBUG_STATE=0` or not set

No debug output. Only critical errors and warnings are shown through standard error handling.

**Use when:**
- Running in production
- You don't need any debug information
- Performance is critical

### Level 1 - Essential Debugging
**Environment:** `DEBUG_STATE=1`

Shows important state changes, errors, and game flow information:
- Player actions (mulligan, play land, cast spell)
- Game state transitions (turn changes, phase changes)
- Priority changes
- Commander damage tracking
- Player defeats/eliminations
- Critical errors and warnings
- Socket connections/disconnections

**Use when:**
- Debugging game flow issues
- Investigating player action problems
- Monitoring game state
- General development work

### Level 2 - Verbose Debugging
**Environment:** `DEBUG_STATE=2`

Shows all Level 1 logs plus detailed investigation information:
- ETB (Enter the Battlefield) triggers
- Specific card interactions
- Detailed combat calculations
- Mana ability resolutions
- Devotion calculations
- Token creation details
- Stack resolution details
- Library/graveyard operations

**Use when:**
- Debugging specific card interactions
- Investigating complex game mechanics
- Deep diving into rules engine behavior
- Reporting bugs with detailed logs

## Configuration

### Server (Backend)

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` and set `DEBUG_STATE`:
```bash
# .env
DEBUG_STATE=1  # Set to 0, 1, or 2
```

3. Start the server:
```bash
npm run dev:server
```

Or set it inline:
```bash
DEBUG_STATE=1 npm run dev:server
```

### Client (Frontend)

For the client, use `VITE_DEBUG_STATE`:

1. Create `.env.local`:
```bash
# client/.env.local
VITE_DEBUG_STATE=1  # Set to 0, 1, or 2
```

2. Start the client:
```bash
npm run dev:client
```

## Usage in Code

### Basic Usage

```typescript
import { debug, debugWarn, debugError } from './utils/debug';

// Level 1 - Essential debugging
debug(1, '[module] Player action:', action);
debugWarn(1, '[module] Warning:', warningMessage);
debugError(1, '[module] Error:', error);

// Level 2 - Verbose debugging
debug(2, '[module] Detailed state:', complexObject);
```

### Checking Debug Level

```typescript
import { isDebugEnabled } from './utils/debug';

if (isDebugEnabled(2)) {
  // Expensive debug calculation only when level 2
  const detailedInfo = calculateDetailedInfo();
  debug(2, '[module] Detailed info:', detailedInfo);
}
```

## Examples

### Example 1: No Debug Output
```bash
# .env
DEBUG_STATE=0

# Console output: (none)
```

### Example 2: Essential Debugging
```bash
# .env
DEBUG_STATE=1

# Console output:
# [mulligan] Free first mulligan applied for player1
# [nextTurn] Turn 2: player2
# [dealCombatDamage] Attacker dealt 3 damage to player1
# ⚠️ COMMANDER DAMAGE LETHAL: player1 has taken 21+ damage
```

### Example 3: Verbose Debugging
```bash
# .env
DEBUG_STATE=2

# Console output (includes Level 1 + Level 2):
# [mulligan] Free first mulligan applied for player1
# [playLand] Player player1 has played 1 lands this turn, max is 1
# [playLand] Temple of Enlightenment conditional ETB: enters tapped (scry pattern)
# [playLand] Temple of Enlightenment has "scry 1" ETB trigger
# [nextTurn] Turn 2: player2
# [checkCreatureEntersTapped] Grizzly Bears enters tapped due to Authority of the Consuls
# [dealCombatDamage] Grizzly Bears power calculation: base=2, counters=0, bonuses=0, total=2
```

## Best Practices

1. **Development**: Use `DEBUG_STATE=1` for general development
2. **Bug Investigation**: Use `DEBUG_STATE=2` when investigating specific issues
3. **Production**: Use `DEBUG_STATE=0` or leave unset
4. **Performance**: Avoid expensive computations in debug statements unless wrapped with `isDebugEnabled()`
5. **Consistency**: Use level 1 for game flow, level 2 for details

## Migration Notes

All existing `console.log`, `console.warn`, `console.error`, and `console.info` statements have been converted to use the debug system:

- Most logs are level 2 (verbose)
- Important state changes are level 1 (essential)
- Errors and warnings default to level 1

This ensures backward compatibility while providing fine-grained control over logging.

## Troubleshooting

**Q: Debug logs aren't showing**
- Check that `DEBUG_STATE` is set correctly in `.env`
- Verify the server/client was restarted after changing the environment variable
- Check that you're using the correct environment variable name (`DEBUG_STATE` for server, `VITE_DEBUG_STATE` for client)

**Q: Too many logs even at level 1**
- Some logs may need reclassification - please report as an issue
- Consider using `DEBUG_STATE=0` and checking specific error logs

**Q: Want to see only specific module logs**
- Currently not supported, but you can use `grep` to filter:
  ```bash
  DEBUG_STATE=2 npm run dev:server 2>&1 | grep '\[playLand\]'
  ```

## Contributing

When adding new debug statements:

1. Use level 1 for important game state changes that help understand game flow
2. Use level 2 for detailed information useful for investigating specific mechanics
3. Include module/function name in brackets: `[moduleName] message`
4. Include relevant context (player ID, card name, etc.)
5. Use `debugWarn` for warnings, `debugError` for errors
