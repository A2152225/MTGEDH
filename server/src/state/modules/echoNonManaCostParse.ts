// server/src/state/modules/echoNonManaCostParse.ts
// B40: import-free parser for Echo with a non-mana cost, used by upkeep trigger detection
// (kept dependency-free so detection does not pull socket modules into the upkeep import graph).
// Public entry symbols: EchoNonManaCost, parseEchoNonManaCost.

export type EchoNonManaCost = { kind: 'discard' } | { kind: 'life'; amount: number };

const DASH = '(?:\\u2014|\\u2013|-|:)';

/** Parses "Echo\u2014Discard a card" / "Echo\u2014Pay N life" from oracle text or "<cost> or sacrifice" text. */
export function parseEchoNonManaCost(text: unknown): { cost: EchoNonManaCost; label: string } | null {
  const s = String(text || '');
  const m = s.match(new RegExp('(?:^|\\n|\\b)echo\\s*' + DASH + '\\s*(discard an? card|pay (\\d+) life)', 'i'))
    || s.match(/^\s*(discard an? card|pay (\d+) life) or sacrifice\b/i);
  if (!m) return null;
  if (/^discard/i.test(m[1])) return { cost: { kind: 'discard' }, label: 'Discard a card' };
  return { cost: { kind: 'life', amount: Number(m[2]) }, label: `Pay ${Number(m[2])} life` };
}
