// server/src/state/modules/kickerReturnCreatureCost.ts
// Arctic Merfolk-style "Kicker—Return a creature you control to its owner's hand":
// optional kicker paid through the existing return-to-hand additional-cost path.
// Public: parseKickerReturnCreature, takeKickerReturnCreatureAdditionalCost,
//   playerChoseKickerReturnCreature.

import { playerChoseKickerPayLife } from './kickerPayLifeCost.js';

const KICKER_RETURN_RE =
  /\bkicker\s*(?:[-—–]\s*)?return\s+(?:a|an|one)\s+creature\s+you\s+control\s+to\s+its\s+owner(?:'s|’s)?\s+hand\b/i;

export function parseKickerReturnCreature(oracleText: string): boolean {
  const text = String(oracleText || '').replace(/\u2019/g, "'");
  return KICKER_RETURN_RE.test(text);
}

export function playerChoseKickerReturnCreature(args: {
  alternateCostId?: unknown;
  card?: any;
}): boolean {
  return playerChoseKickerPayLife(args);
}

export function takeKickerReturnCreatureAdditionalCost(args: {
  oracleText: string;
  alternateCostId?: unknown;
  card?: any;
}): { type: 'return'; amount: 1; filter: 'creature'; kickerReturnCreature: true } | null {
  if (!parseKickerReturnCreature(args.oracleText) || !playerChoseKickerReturnCreature(args)) return null;
  return { type: 'return', amount: 1, filter: 'creature', kickerReturnCreature: true };
}
