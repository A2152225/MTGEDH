/**
 * cards/echoCards.ts
 * 
 * Cards with the Echo mechanic.
 */

export interface EchoConfig {
  readonly cardName: string;
  readonly echoCost: string;
  readonly echoManaCost?: {
    readonly generic?: number;
    readonly white?: number;
    readonly blue?: number;
    readonly black?: number;
    readonly red?: number;
    readonly green?: number;
  };
}

export const ECHO_CARDS: Record<string, EchoConfig> = {
  'deranged hermit': {
    cardName: 'Deranged Hermit',
    echoCost: '{3}{G}{G}',
    echoManaCost: { generic: 3, green: 2 },
  },
  'karmic guide': {
    cardName: 'Karmic Guide',
    echoCost: '{3}{W}{W}',
    echoManaCost: { generic: 3, white: 2 },
  },
  'avalanche riders': {
    cardName: 'Avalanche Riders',
    echoCost: '{3}{R}',
    echoManaCost: { generic: 3, red: 1 },
  },
  'crater hellion': {
    cardName: 'Crater Hellion',
    echoCost: '{4}{R}{R}',
    echoManaCost: { generic: 4, red: 2 },
  },
};

export function hasEcho(cardName: string): boolean {
  return cardName.toLowerCase() in ECHO_CARDS;
}

export function getEchoConfig(cardName: string): EchoConfig | undefined {
  return ECHO_CARDS[cardName.toLowerCase()];
}

/**
 * Detect echo from oracle text
 */
export function detectEchoFromText(oracleText: string): { hasEcho: boolean; cost?: string } {
  const echoMatch = oracleText.match(/echo\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (echoMatch) {
    return { hasEcho: true, cost: echoMatch[1] };
  }
  return { hasEcho: false };
}
