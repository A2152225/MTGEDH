/**
 * Rule 706: Rolling a Die
 * 
 * An effect that instructs a player to roll a die will specify what kind of die
 * to roll and how many of those dice to roll.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 706
 */

/**
 * Rule 706.1a: Die types
 * 
 * An effect may refer to an "N-sided die," "N-sided dice," or one or more "dN,"
 * where N is a positive integer. In those cases, the die must have N equally
 * likely outcomes, numbered from 1 to N. For example, a d20 is a twenty-sided
 * die with possible outcomes from 1 to 20.
 */

export type DieType = number; // Number of sides (e.g., 6 for d6, 20 for d20)

export interface DieRoll {
  readonly playerId: string;
  readonly dieType: DieType;
  readonly naturalResult: number; // Result before modifiers
  readonly modifiers: readonly DieRollModifier[];
  readonly result: number; // Final result after all modifiers
}

export interface DieRollModifier {
  readonly source: string;
  readonly amount: number; // Positive for increase, negative for decrease
  readonly description: string;
}

/**
 * Rule 706.1b: Alternate methods
 * 
 * Players may agree to use an alternate method for rolling a die, including a
 * digital substitute, as long as the method used has the same number of equally
 * likely outcomes as the die specified in the instruction.
 */
export const ALTERNATE_DIE_METHODS_ALLOWED = true;

/**
 * Rule 706.2: Natural result and modifiers
 * 
 * After the roll, the number indicated on the top face of the die before any
 * modifiers is the natural result. The instruction may include modifiers to the
 * roll which add to or subtract from the natural result. Modifiers may also
 * come from other sources. After considering all applicable modifiers, the
 * final number is the result of the die roll.
 */

/**
 * Generate a random die roll result
 */
export function rollDie(dieType: DieType): number {
  return Math.floor(Math.random() * dieType) + 1;
}

/**
 * Create a die roll without modifiers
 */
export function createDieRoll(
  playerId: string,
  dieType: DieType,
  naturalResult: number
): DieRoll {
  return {
    playerId,
    dieType,
    naturalResult,
    modifiers: [],
    result: naturalResult,
  };
}

/**
 * Rule 706.2a: Optional modifiers with costs
 * 
 * Modifiers may be optional and/or have associated costs. If a modifier has an
 * associated mana cost, the player who rolled has the chance to activate mana
 * abilities before applying it.
 */
export function addModifier(
  roll: DieRoll,
  modifier: DieRollModifier
): DieRoll {
  const modifiers = [...roll.modifiers, modifier];
  const result = modifiers.reduce(
    (total, mod) => total + mod.amount,
    roll.naturalResult
  );
  
  return {
    ...roll,
    modifiers,
    result,
  };
}

/**
 * Rule 706.2b: Choosing modifier order
 * 
 * If two or more effects are attempting to modify the natural result, the
 * player who rolled chooses one to apply, following these steps: First,
 * consider any effects that modify the result of a die roll by rerolling that
 * die. Second, consider any effects that modify the result of a die roll by
 * increasing or decreasing that result by a specified amount.
 */

export type ModifierType = 'reroll' | 'adjust';

export interface TypedDieRollModifier extends DieRollModifier {
  readonly modifierType: ModifierType;
}

/**
 * Apply modifiers in the correct order (rerolls first, then adjustments)
 */
export function applyModifiersInOrder(
  roll: DieRoll,
  modifiers: readonly TypedDieRollModifier[]
): DieRoll {
  // Separate rerolls and adjustments
  const rerolls = modifiers.filter(m => m.modifierType === 'reroll');
  const adjustments = modifiers.filter(m => m.modifierType === 'adjust');
  
  let currentRoll = roll;
  
  // Apply rerolls first (player chooses order)
  for (const reroll of rerolls) {
    currentRoll = addModifier(currentRoll, reroll);
  }
  
  // Then apply adjustments (player chooses order)
  for (const adjustment of adjustments) {
    currentRoll = addModifier(currentRoll, adjustment);
  }
  
  return currentRoll;
}

/**
 * Rule 706.3: Results tables
 * 
 * Some abilities that instruct a player to roll one or more dice include a
 * results table.
 */

export interface ResultsTableEntry {
  readonly range: readonly [number, number | null]; // [min, max] or [min, null] for N+
  readonly effect: string;
}

export interface ResultsTable {
  readonly entries: readonly ResultsTableEntry[];
}

/**
 * Rule 706.3a: Results table format
 * 
 * The results table appears as a list or as a chart with multiple striations.
 * Each list item or striation includes possible results and an effect associated
 * with those results. The possible results indicated could be a single number, a
 * range of numbers with two endpoints in the form "N1–N2," or a range with a
 * single endpoint in the form "N+." Each one means "If the result was in this
 * range, [effect]."
 */
export function checkResultsTable(
  roll: DieRoll,
  table: ResultsTable
): ResultsTableEntry | null {
  for (const entry of table.entries) {
    const [min, max] = entry.range;
    
    if (max === null) {
      // N+ format (e.g., "10+")
      if (roll.result >= min) {
        return entry;
      }
    } else {
      // N1-N2 format or single number
      if (roll.result >= min && roll.result <= max) {
        return entry;
      }
    }
  }
  
  return null;
}

/**
 * Rule 706.3c: Roll again
 * 
 * Some effects in results charts include the text "Roll again." This additional
 * roll uses the same kind of and number of dice originally called for,
 * including any applicable modifiers.
 */
export const ROLL_AGAIN_USES_SAME_DIE = true;

/**
 * Rule 706.4: Rolls without results tables
 * 
 * Some abilities that instruct a player to roll one or more dice do not include
 * a results table. The text of those abilities will indicate how to use the
 * results of the die rolls, if at all.
 */

/**
 * Rule 706.5: Rolled doubles
 * 
 * One card (Celebr-8000) has an ability that instructs a player to roll two
 * dice and has an additional effect if that player "rolled doubles." A player
 * has rolled doubles if the result of each of those rolls is equal to the other.
 */
export function checkRolledDoubles(
  roll1: DieRoll,
  roll2: DieRoll
): boolean {
  return roll1.result === roll2.result;
}

/**
 * Rule 706.6: Ignoring rolls
 * 
 * If a player is instructed to ignore a roll, that roll is considered to have
 * never happened. No abilities trigger because of the ignored roll, and no
 * effects apply to that roll. If that player was instructed to ignore the
 * lowest roll and multiple results are tied for the lowest, the player chooses
 * one of those rolls to be ignored.
 */
export function ignoreRoll(rolls: readonly DieRoll[], rollToIgnore: DieRoll): readonly DieRoll[] {
  return rolls.filter(r => r !== rollToIgnore);
}

export function ignoreLowestRoll(rolls: readonly DieRoll[]): readonly DieRoll[] {
  if (rolls.length === 0) return rolls;
  
  const lowest = Math.min(...rolls.map(r => r.result));
  const lowestRoll = rolls.find(r => r.result === lowest);
  
  return lowestRoll ? ignoreRoll(rolls, lowestRoll) : rolls;
}

/**
 * Rule 706.7: Planar die
 * 
 * In a Planechase game, rolling the planar die will cause any ability that
 * triggers whenever a player rolls one or more dice to trigger. However, any
 * effect that refers to a numerical result of a die roll, including ones that
 * exchange the results of that roll with another value or compare the results
 * of that roll to other rolls or to a given number, ignores the rolling of the
 * planar die.
 */
export const PLANAR_DIE_TRIGGERS_DIE_ROLL_ABILITIES = true;
export const PLANAR_DIE_HAS_NO_NUMERICAL_RESULT = true;

/**
 * Rule 706.8: Storing die results
 * 
 * One card (Centaur of Attention) has an ability that instructs a player to
 * roll dice and "store" those results on it and another ability that allows a
 * player to reroll any number of those results.
 */

export interface StoredDieResult {
  readonly dieType: DieType;
  readonly value: number;
}

/**
 * Rule 706.8a: Storing results
 * 
 * To store the result of a die roll on a permanent means to note both the kind
 * of die rolled and the result of that roll. That noted information is
 * considered a "stored result" of that permanent, and the result is the "value"
 * of that stored result.
 */
export function storeResult(roll: DieRoll): StoredDieResult {
  return {
    dieType: roll.dieType,
    value: roll.result,
  };
}

/**
 * Rule 706.8b: Rerolling stored results
 * 
 * To reroll one or more stored results of a permanent, roll one of the kind of
 * die noted for each of them. If one kind of die is noted for more than one of
 * those results, roll that many of that kind of die. The results you rerolled
 * stop being stored results, and you store the results of each of the new die
 * rolls on that permanent.
 */
export function rerollStoredResults(
  playerId: string,
  storedResults: readonly StoredDieResult[]
): readonly DieRoll[] {
  return storedResults.map(stored => {
    const naturalResult = rollDie(stored.dieType);
    return createDieRoll(playerId, stored.dieType, naturalResult);
  });
}

/**
 * Perform a complete die roll with the specified die type
 */
export function performDieRoll(
  playerId: string,
  dieType: DieType
): DieRoll {
  const naturalResult = rollDie(dieType);
  return createDieRoll(playerId, dieType, naturalResult);
}

/**
 * Perform multiple die rolls
 */
export function performMultipleDieRolls(
  playerId: string,
  dieType: DieType,
  count: number
): readonly DieRoll[] {
  const rolls: DieRoll[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(performDieRoll(playerId, dieType));
  }
  return rolls;
}
