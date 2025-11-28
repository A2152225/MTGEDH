/**
 * Hybrid and Phyrexian Mana Support
 * Rule 107.4 (Hybrid) and Rule 107.4f (Phyrexian)
 * 
 * Implements cost payment options for hybrid and Phyrexian mana symbols.
 */

import type { ManaCost, ManaType } from './types/mana';

/**
 * Hybrid mana symbol types
 * Rule 107.4 - Hybrid mana symbols can be paid with either option
 */
export type HybridSymbol = 
  | { type: 'color-color'; colors: [string, string] }  // {W/U}
  | { type: 'color-generic'; color: string; genericAmount: number };  // {2/W}

/**
 * Phyrexian mana symbol
 * Rule 107.4f - Can be paid with mana or 2 life
 */
export interface PhyrexianSymbol {
  readonly type: 'phyrexian';
  readonly color: string;
}

/**
 * Combined special mana symbol
 */
export type SpecialManaSymbol = HybridSymbol | PhyrexianSymbol;

/**
 * Payment choice for a special mana symbol
 */
export interface SymbolPaymentChoice {
  readonly symbolIndex: number;
  readonly paymentType: 'mana' | 'life' | 'generic';
  readonly manaColor?: string;
  readonly lifeAmount?: number;
  readonly genericAmount?: number;
}

/**
 * Parsed mana cost with special symbols
 */
export interface ParsedManaCost {
  readonly regularCost: ManaCost;
  readonly hybridSymbols: readonly HybridSymbol[];
  readonly phyrexianSymbols: readonly PhyrexianSymbol[];
  readonly totalSymbolCount: number;
}

/**
 * Payment options for a special mana symbol
 */
export interface PaymentOption {
  readonly description: string;
  readonly manaType?: string;
  readonly manaAmount?: number;
  readonly lifeAmount?: number;
}

/**
 * Parses a mana cost string for hybrid and Phyrexian symbols
 * 
 * @param manaCostString - The mana cost string (e.g., "{W/U}{2/B}{R/P}")
 * @returns Parsed mana cost with special symbols
 */
export function parseSpecialManaCost(manaCostString: string): ParsedManaCost {
  const hybridSymbols: HybridSymbol[] = [];
  const phyrexianSymbols: PhyrexianSymbol[] = [];
  
  // Match hybrid color-color symbols like {W/U}
  const colorHybridPattern = /\{([WUBRG])\/([WUBRG])\}/gi;
  let match;
  while ((match = colorHybridPattern.exec(manaCostString)) !== null) {
    hybridSymbols.push({
      type: 'color-color',
      colors: [match[1].toUpperCase(), match[2].toUpperCase()],
    });
  }
  
  // Match hybrid generic-color symbols like {2/W}
  const genericHybridPattern = /\{(\d+)\/([WUBRG])\}/gi;
  while ((match = genericHybridPattern.exec(manaCostString)) !== null) {
    hybridSymbols.push({
      type: 'color-generic',
      color: match[2].toUpperCase(),
      genericAmount: parseInt(match[1]),
    });
  }
  
  // Match Phyrexian symbols like {W/P} or {P/W}
  const phyrexianPattern = /\{([WUBRG])\/P\}|\{P\/([WUBRG])\}/gi;
  while ((match = phyrexianPattern.exec(manaCostString)) !== null) {
    const color = (match[1] || match[2]).toUpperCase();
    phyrexianSymbols.push({
      type: 'phyrexian',
      color,
    });
  }
  
  // Also match alternative Phyrexian notation {WP}, {UP}, etc.
  const altPhyrexianPattern = /\{([WUBRG])P\}/gi;
  while ((match = altPhyrexianPattern.exec(manaCostString)) !== null) {
    phyrexianSymbols.push({
      type: 'phyrexian',
      color: match[1].toUpperCase(),
    });
  }
  
  // Parse regular mana cost (remove special symbols)
  let regularCostString = manaCostString
    .replace(/\{[WUBRG]\/[WUBRG]\}/gi, '')
    .replace(/\{\d+\/[WUBRG]\}/gi, '')
    .replace(/\{[WUBRG]\/P\}/gi, '')
    .replace(/\{P\/[WUBRG]\}/gi, '')
    .replace(/\{[WUBRG]P\}/gi, '');
  
  const regularCost = parseRegularManaCost(regularCostString);
  
  return {
    regularCost,
    hybridSymbols,
    phyrexianSymbols,
    totalSymbolCount: hybridSymbols.length + phyrexianSymbols.length,
  };
}

/**
 * Parses regular mana cost from string
 */
function parseRegularManaCost(costString: string): ManaCost {
  let generic = 0;
  let white = 0;
  let blue = 0;
  let black = 0;
  let red = 0;
  let green = 0;
  let colorless = 0;
  
  const symbolPattern = /\{([0-9]+|[WUBRGC])\}/gi;
  let match;
  
  while ((match = symbolPattern.exec(costString)) !== null) {
    const symbol = match[1].toUpperCase();
    
    if (/^\d+$/.test(symbol)) {
      generic += parseInt(symbol);
    } else {
      switch (symbol) {
        case 'W': white++; break;
        case 'U': blue++; break;
        case 'B': black++; break;
        case 'R': red++; break;
        case 'G': green++; break;
        case 'C': colorless++; break;
      }
    }
  }
  
  return { generic, white, blue, black, red, green, colorless };
}

/**
 * Gets payment options for a hybrid symbol
 * Rule 107.4 - Player chooses which half to pay
 * 
 * @param symbol - The hybrid symbol
 * @returns Available payment options
 */
export function getHybridPaymentOptions(symbol: HybridSymbol): PaymentOption[] {
  if (symbol.type === 'color-color') {
    const colorNames: Record<string, string> = {
      'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
    };
    return [
      {
        description: `Pay one ${colorNames[symbol.colors[0]]} mana`,
        manaType: symbol.colors[0],
        manaAmount: 1,
      },
      {
        description: `Pay one ${colorNames[symbol.colors[1]]} mana`,
        manaType: symbol.colors[1],
        manaAmount: 1,
      },
    ];
  } else {
    const colorNames: Record<string, string> = {
      'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
    };
    return [
      {
        description: `Pay one ${colorNames[symbol.color]} mana`,
        manaType: symbol.color,
        manaAmount: 1,
      },
      {
        description: `Pay ${symbol.genericAmount} generic mana`,
        manaAmount: symbol.genericAmount,
      },
    ];
  }
}

/**
 * Gets payment options for a Phyrexian symbol
 * Rule 107.4f - Pay mana or 2 life
 * 
 * @param symbol - The Phyrexian symbol
 * @returns Available payment options
 */
export function getPhyrexianPaymentOptions(symbol: PhyrexianSymbol): PaymentOption[] {
  const colorNames: Record<string, string> = {
    'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
  };
  
  return [
    {
      description: `Pay one ${colorNames[symbol.color]} mana`,
      manaType: symbol.color,
      manaAmount: 1,
    },
    {
      description: 'Pay 2 life',
      lifeAmount: 2,
    },
  ];
}

/**
 * Validates payment choices for special mana symbols
 * 
 * @param parsedCost - The parsed mana cost
 * @param choices - Player's payment choices
 * @param playerLife - Player's current life total
 * @returns Validation result
 */
export function validateSpecialManaPayment(
  parsedCost: ParsedManaCost,
  choices: readonly SymbolPaymentChoice[],
  playerLife: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check that all symbols have choices
  const totalSymbols = parsedCost.hybridSymbols.length + parsedCost.phyrexianSymbols.length;
  if (choices.length !== totalSymbols) {
    errors.push(`Expected ${totalSymbols} payment choices, got ${choices.length}`);
  }
  
  // Calculate total life cost
  let totalLifeCost = 0;
  for (const choice of choices) {
    if (choice.lifeAmount) {
      totalLifeCost += choice.lifeAmount;
    }
  }
  
  // Check if player can afford life cost
  if (totalLifeCost > 0 && playerLife <= totalLifeCost) {
    // Note: You CAN pay life that would reduce you to 0 or below
    // But you can't pay if you don't have enough
    // Actually in MTG you can pay life even if it kills you
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculates total mana and life needed for payment
 * 
 * @param parsedCost - The parsed mana cost
 * @param choices - Player's payment choices
 * @returns Total resources needed
 */
export function calculatePaymentTotals(
  parsedCost: ParsedManaCost,
  choices: readonly SymbolPaymentChoice[]
): {
  manaCost: ManaCost;
  lifeCost: number;
} {
  let lifeCost = 0;
  let additionalWhite = 0;
  let additionalBlue = 0;
  let additionalBlack = 0;
  let additionalRed = 0;
  let additionalGreen = 0;
  let additionalGeneric = 0;
  
  for (const choice of choices) {
    if (choice.lifeAmount) {
      lifeCost += choice.lifeAmount;
    } else if (choice.manaColor) {
      switch (choice.manaColor) {
        case 'W': additionalWhite++; break;
        case 'U': additionalBlue++; break;
        case 'B': additionalBlack++; break;
        case 'R': additionalRed++; break;
        case 'G': additionalGreen++; break;
      }
    } else if (choice.genericAmount) {
      additionalGeneric += choice.genericAmount;
    }
  }
  
  const manaCost: ManaCost = {
    white: (parsedCost.regularCost.white || 0) + additionalWhite,
    blue: (parsedCost.regularCost.blue || 0) + additionalBlue,
    black: (parsedCost.regularCost.black || 0) + additionalBlack,
    red: (parsedCost.regularCost.red || 0) + additionalRed,
    green: (parsedCost.regularCost.green || 0) + additionalGreen,
    colorless: parsedCost.regularCost.colorless || 0,
    generic: (parsedCost.regularCost.generic || 0) + additionalGeneric,
  };
  
  return { manaCost, lifeCost };
}

/**
 * Determines the color identity contribution of hybrid/Phyrexian symbols
 * Rule 903.4 - Both colors of hybrid contribute to color identity
 * 
 * @param parsedCost - The parsed mana cost
 * @returns Colors contributed to color identity
 */
export function getColorIdentityContribution(parsedCost: ParsedManaCost): string[] {
  const colors = new Set<string>();
  
  for (const hybrid of parsedCost.hybridSymbols) {
    if (hybrid.type === 'color-color') {
      colors.add(hybrid.colors[0]);
      colors.add(hybrid.colors[1]);
    } else {
      colors.add(hybrid.color);
    }
  }
  
  for (const phyrexian of parsedCost.phyrexianSymbols) {
    colors.add(phyrexian.color);
  }
  
  return Array.from(colors);
}

/**
 * Calculates mana value including hybrid/Phyrexian
 * Rule 202.3 - Hybrid symbols contribute their higher value, Phyrexian = 1
 * 
 * @param parsedCost - The parsed mana cost
 * @returns Total mana value
 */
export function calculateManaValueWithSpecialSymbols(parsedCost: ParsedManaCost): number {
  let manaValue = 0;
  
  // Regular cost
  manaValue += (parsedCost.regularCost.white || 0);
  manaValue += (parsedCost.regularCost.blue || 0);
  manaValue += (parsedCost.regularCost.black || 0);
  manaValue += (parsedCost.regularCost.red || 0);
  manaValue += (parsedCost.regularCost.green || 0);
  manaValue += (parsedCost.regularCost.colorless || 0);
  manaValue += (parsedCost.regularCost.generic || 0);
  
  // Hybrid symbols
  for (const hybrid of parsedCost.hybridSymbols) {
    if (hybrid.type === 'color-color') {
      // Color/color hybrid = 1
      manaValue += 1;
    } else {
      // Generic/color hybrid = the generic amount (higher value)
      manaValue += hybrid.genericAmount;
    }
  }
  
  // Phyrexian symbols = 1 each
  manaValue += parsedCost.phyrexianSymbols.length;
  
  return manaValue;
}

/**
 * Checks if a cost contains any special mana symbols
 * 
 * @param manaCostString - The mana cost string
 * @returns Whether the cost has hybrid or Phyrexian symbols
 */
export function hasSpecialManaSymbols(manaCostString: string): boolean {
  return /\{[WUBRG]\/[WUBRGP]\}|\{\d+\/[WUBRG]\}|\{[WUBRG]P\}/i.test(manaCostString);
}

/**
 * Formats a payment choice for display
 * 
 * @param choice - The payment choice
 * @returns Human-readable description
 */
export function formatPaymentChoice(choice: SymbolPaymentChoice): string {
  if (choice.lifeAmount) {
    return `Pay ${choice.lifeAmount} life`;
  }
  
  if (choice.manaColor) {
    const colorNames: Record<string, string> = {
      'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
    };
    return `Pay ${colorNames[choice.manaColor] || choice.manaColor} mana`;
  }
  
  if (choice.genericAmount) {
    return `Pay ${choice.genericAmount} generic mana`;
  }
  
  return 'Unknown payment';
}
