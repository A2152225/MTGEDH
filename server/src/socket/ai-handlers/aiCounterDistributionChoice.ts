/**
 * socket/ai-handlers/aiCounterDistributionChoice.ts
 *
 * AI answer for COUNTER_DISTRIBUTION ("distribute N +1/+1 counters among ..."). The response handler
 * expects `selections` to be a `{ [targetId]: amount }` object whose amounts sum to `totalAmount`
 * and are each at least `minPerTarget`, over ids from `validTargets`.
 */

const HARMFUL_COUNTER_RE = /^-|\b(?:stun|shrink|blight|poison|-1\/-1)\b/i;

/** All counters on the best target: own permanents for helpful counters, opponents' for harmful ones. */
export function chooseAICounterDistributionSelection(game: any, playerId: string, step: any): Record<string, number> | null {
  const targetIds: string[] = (Array.isArray(step?.validTargets) ? step.validTargets : [])
    .map((entry: any) => String(entry?.id ?? entry ?? '').trim())
    .filter(Boolean);
  if (targetIds.length === 0) return null;

  const minPerTarget = Math.max(1, Number(step?.minPerTarget ?? 1) || 1);
  const totalRaw = Number(step?.totalAmount ?? 0);
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? Math.floor(totalRaw) : minPerTarget;
  const harmful = HARMFUL_COUNTER_RE.test(String(step?.counterType || '+1/+1'));
  const battlefield: any[] = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const controllerOf = (id: string) => String(battlefield.find((perm: any) => String(perm?.id) === id)?.controller || '');
  const power = (id: string) => Number(battlefield.find((perm: any) => String(perm?.id) === id)?.card?.power || 0) || 0;

  const ranked = [...targetIds].sort((left, right) => {
    const leftWanted = (controllerOf(left) === String(playerId)) !== harmful ? 1 : 0;
    const rightWanted = (controllerOf(right) === String(playerId)) !== harmful ? 1 : 0;
    return rightWanted - leftWanted || power(right) - power(left);
  });
  return { [ranked[0]]: Math.max(total, minPerTarget) };
}
