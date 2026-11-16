/**
 * AI policy for additional-cost costType pay_life.
 * Pay when remaining life stays comfortably at or above the comfort floor;
 * otherwise decline.
 */
export const AI_PAY_LIFE_REMAINING_MIN = 6;

export function shouldAIPayLifeAdditionalCost(currentLife: number, amount: number): boolean {
  const life = Number(currentLife);
  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  if (!Number.isFinite(life)) return false;
  if (cost <= 0) return true;
  return (life - cost) >= AI_PAY_LIFE_REMAINING_MIN;
}

export function chooseAIPayLifeAdditionalCost(
  game: any,
  playerId: string,
  step: any,
): 'pay' | 'decline' {
  const amount = Math.max(0, Math.floor(Number(step?.amount || 0)));
  const starting = Number(game?.state?.startingLife || 40);
  const current = Number(game?.state?.life?.[playerId] ?? starting);
  return shouldAIPayLifeAdditionalCost(current, amount) ? 'pay' : 'decline';
}
