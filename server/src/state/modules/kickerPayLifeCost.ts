// server/src/state/modules/kickerPayLifeCost.ts
// Phyrexian Scuta-style "Kicker—Pay N life": optional kicker paid through
// the existing pay_life additional-cost confirm path.

export function parseKickerPayLifeAmount(oracleText: string): number | null {
  const text = String(oracleText || '').replace(/\u2019/g, "'").replace(/[—–]/g, '-');
  const match = text.match(/\bkicker\s*(?:-\s*)?pay\s+(\d+)\s+life\b/i);
  if (!match) return null;
  const amount = Math.max(0, Math.floor(Number(match[1]) || 0));
  return amount > 0 ? amount : null;
}

export function playerChoseKickerPayLife(args: {
  alternateCostId?: unknown;
  card?: any;
}): boolean {
  const alternate = String(args.alternateCostId || '').trim().toLowerCase();
  if (alternate === 'kicker') return true;
  const card = args.card;
  if (!card || typeof card !== 'object') return false;
  return card.castWithKicker === true || card.wasKicked === true || card.payKicker === true;
}

export function takeKickerPayLifeAdditionalCost(args: {
  oracleText: string;
  alternateCostId?: unknown;
  card?: any;
}): { type: 'pay_life'; amount: number; kickerPayLife: true } | null {
  const amount = parseKickerPayLifeAmount(args.oracleText);
  if (!amount || !playerChoseKickerPayLife(args)) return null;
  return { type: 'pay_life', amount, kickerPayLife: true };
}
