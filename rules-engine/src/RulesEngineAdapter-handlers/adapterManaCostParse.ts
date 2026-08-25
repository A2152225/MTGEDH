// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: parseManaCostString, canPayManaCostFromPool.
// Public entry symbols: parseManaCostString, canPayManaCostFromPool.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { ManaCost } from '../types/mana';

/** Simple mana pool interface for checking mana availability (doesn't need restricted mana info) */
interface SimpleManaPool {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
}

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterManaCostParseHost = any;

  /**
   * Parse mana cost string like "{2}{U}{U}" into a ManaCost object
   */
export function parseManaCostString(manaCost: string | any): ManaCost {
    // Handle non-string input (could be already parsed object or null/undefined)
    if (!manaCost) {
      return { generic: 0 };
    }
    
    // If already an object with mana properties, return it directly
    if (typeof manaCost === 'object') {
      return {
        generic: manaCost.generic || 0,
        white: manaCost.white || 0,
        blue: manaCost.blue || 0,
        black: manaCost.black || 0,
        red: manaCost.red || 0,
        green: manaCost.green || 0,
        colorless: manaCost.colorless || 0,
      };
    }
    
    // Parse string format like "{R}{R}{2}"
    if (typeof manaCost !== 'string') {
      return { generic: 0 };
    }
    
    const tokens = manaCost.match(/\{[^}]+\}/g) || [];
    
    // Build up the cost object without mutations
    let generic = 0;
    let white = 0;
    let blue = 0;
    let black = 0;
    let red = 0;
    let green = 0;
    let colorless = 0;
    
    for (const token of tokens) {
      const symbol = token.replace(/[{}]/g, '').toUpperCase();
      
      if (/^\d+$/.test(symbol)) {
        // Generic mana like {2}
        generic += parseInt(symbol, 10);
      } else if (symbol === 'W') {
        white += 1;
      } else if (symbol === 'U') {
        blue += 1;
      } else if (symbol === 'B') {
        black += 1;
      } else if (symbol === 'R') {
        red += 1;
      } else if (symbol === 'G') {
        green += 1;
      } else if (symbol === 'C') {
        colorless += 1;
      }
      // Note: hybrid mana, phyrexian mana, etc. not implemented yet
    }
    
    return { generic, white, blue, black, red, green, colorless };
  }
  
  /**
   * Check if a mana cost can be paid from the given mana pool
   */
export function canPayManaCostFromPool(cost: ManaCost, pool: SimpleManaPool): { canPay: boolean; reason?: string } {
    // Check specific color requirements
    if ((cost.white || 0) > pool.white) {
      return { canPay: false, reason: `Need ${cost.white} white mana, have ${pool.white}` };
    }
    if ((cost.blue || 0) > pool.blue) {
      return { canPay: false, reason: `Need ${cost.blue} blue mana, have ${pool.blue}` };
    }
    if ((cost.black || 0) > pool.black) {
      return { canPay: false, reason: `Need ${cost.black} black mana, have ${pool.black}` };
    }
    if ((cost.red || 0) > pool.red) {
      return { canPay: false, reason: `Need ${cost.red} red mana, have ${pool.red}` };
    }
    if ((cost.green || 0) > pool.green) {
      return { canPay: false, reason: `Need ${cost.green} green mana, have ${pool.green}` };
    }
    if ((cost.colorless || 0) > pool.colorless) {
      return { canPay: false, reason: `Need ${cost.colorless} colorless mana, have ${pool.colorless}` };
    }
    
    // Calculate remaining mana after paying colored costs
    const remaining = {
      white: pool.white - (cost.white || 0),
      blue: pool.blue - (cost.blue || 0),
      black: pool.black - (cost.black || 0),
      red: pool.red - (cost.red || 0),
      green: pool.green - (cost.green || 0),
      colorless: pool.colorless - (cost.colorless || 0),
    };
    
    const totalRemaining = remaining.white + remaining.blue + remaining.black + 
                          remaining.red + remaining.green + remaining.colorless;
    
    if ((cost.generic || 0) > totalRemaining) {
      return { canPay: false, reason: `Need ${cost.generic} more mana for generic cost, have ${totalRemaining} remaining` };
    }
    
    return { canPay: true };
  }
