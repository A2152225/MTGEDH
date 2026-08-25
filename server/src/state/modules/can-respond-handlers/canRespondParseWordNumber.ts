// server/src/state/modules/can-respond-handlers/canRespondParseWordNumber.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: parseWordNumberForGraveyardCost (a/an/one..ten plus integers).
// Public entry symbols: parseWordNumberForGraveyardCost.

export function parseWordNumberForGraveyardCost(value: string): number {
  const normalized = String(value || '').trim().toLowerCase();
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  if (words[normalized]) return words[normalized];
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
