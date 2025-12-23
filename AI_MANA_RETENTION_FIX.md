# AI Mana Retention Fix

## Problem Statement
Earlier, support was added for AI to tap lands to put mana in their mana pools for cards like Omnath, Locus of Mana, Leyline Tyrant, etc. However, ALL AI were tapping ALL their lands regardless of whether they had retention effects, and even when they did have retention effects, they were tapping every single land. This prevented them from responding with instants later, as they had no untapped mana sources.

## Root Cause
The `executeAITapLandsForMana` function in `server/src/socket/ai.ts` was tapping ALL untapped lands that produce the retained colors. While the detection logic for retention effects was correct (checking for cards like Omnath, Leyline Tyrant, Kruphix, etc.), the execution was too aggressive.

Example scenario:
- AI has Omnath, Locus of Mana on battlefield (green mana doesn't empty)
- AI has 10 Forests
- Previous behavior: Tap all 10 Forests
- Problem: AI can't respond to opponent's threats with instant-speed removal

## Solution
Modified `executeAITapLandsForMana` to implement a conservative strategy:

1. **Collect** all tappable lands that produce retained colors
2. **Calculate** how many to actually tap:
   - Keep at least 40% of lands untapped
   - Keep at least 3 lands untapped (whichever is MORE)
3. **Tap** only the calculated portion

### Examples

| Total Lands | Minimum to Keep | Maximum to Tap | Kept for Instants |
|-------------|-----------------|----------------|-------------------|
| 10          | 4 (40%)         | 6              | 4                 |
| 20          | 8 (40%)         | 12             | 8                 |
| 5           | 3 (min)         | 2              | 3                 |
| 2           | 3 (min)         | 0              | 2 (all)           |

## Benefits
1. **Maintains Flexibility**: AI can still respond with instant-speed spells
2. **Keeps Retention Benefit**: AI still gets power boost from cards like Omnath (6 green mana instead of 10 is still significant)
3. **Better Gameplay**: AI is more competitive and less predictable

## Testing
Created `server/tests/ai.mana-retention.test.ts` with comprehensive unit tests covering:
- Land tapping strategy calculations
- Edge cases (1-2 lands, large land counts)
- Retention effect detection (Omnath, Leyline Tyrant, Kruphix, etc.)
- False positive prevention (cards that mention mana but don't have retention)

All tests pass ✅

## Files Changed
- `server/src/socket/ai.ts`: Modified `executeAITapLandsForMana` function
- `server/tests/ai.mana-retention.test.ts`: New comprehensive test suite
