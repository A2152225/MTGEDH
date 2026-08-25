// server/src/socket/util-handlers/manaProductionAmountParse.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: parseSpelledOutAmount - spelled-out / numeric mana amount tokens.
// Public entry symbols: parseSpelledOutAmount.

export function parseSpelledOutAmount(rawAmount: string): number | undefined {
  const normalized = String(rawAmount || '').trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  const wordToAmount: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  return wordToAmount[normalized];
}
