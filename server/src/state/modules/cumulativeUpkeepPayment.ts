// server/src/state/modules/cumulativeUpkeepPayment.ts
// Cumulative upkeep (rule 702.24): on resolution put an age counter on the
// permanent, then its controller pays the upkeep cost once per age counter or
// sacrifices it. Supports mana costs, "{A} or {B}" mana alternatives and
// "pay N life". Queued as an optional-payment prompt; AI picks via
// chooseAICumulativeUpkeepPayment.
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { broadcastGame, canPayManaCostStringWithAvailableSources, payManaCostWithAvailableSources } from '../../socket/util.js';
import { queueOptionalPaymentStep } from '../../socket/optional-payment-prompts.js';
import { addAgeCounter, sacrificePermanent } from './upkeep-triggers.js';

export type CumulativeUpkeepCost =
  | { kind: 'mana'; options: string[] }
  | { kind: 'life'; amount: number }
  | { kind: 'addMana'; unit: string };

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
export const CUMULATIVE_UPKEEP_DESCRIPTION = /^(?:pay )?(.+?) for each age counter/i;

export function parseCumulativeUpkeepCost(raw: string): CumulativeUpkeepCost | null {
  let text = String(raw || '').trim().replace(/^[\u2014\-:\s]+/, '').replace(/[.]+$/, '').trim();
  text = text.replace(/^pay\s+/i, '').trim();
  // Beneficial cost (Braid of Fire): "Add {R}" -> paying adds mana per age counter.
  const add = text.match(/^add\s+((?:\{[WUBRGC]\}\s*)+)$/i);
  if (add) return { kind: 'addMana', unit: add[1].replace(/\s+/g, '').toUpperCase() };
  const life = text.match(/^(\d+|a|an|one|two|three|four|five|six)\s+life$/i);
  if (life) {
    const n = /^\d+$/.test(life[1]) ? Number(life[1]) : NUMBER_WORDS[life[1].toLowerCase()];
    return n > 0 ? { kind: 'life', amount: n } : null;
  }
  const parts = text.split(/\s+or\s+/i).map((p) => p.replace(/\s+/g, ''));
  if (parts.length > 0 && parts.every((p) => /^(?:\{[^}]+\})+$/.test(p))) {
    return { kind: 'mana', options: parts };
  }
  return null;
}

/** Repeat a mana cost n times, folding generic numbers together. */
export function scaleManaCost(unit: string, n: number): string {
  const symbols = String(unit || '').match(/\{[^}]+\}/g) || [];
  let generic = 0;
  const colored: string[] = [];
  for (const s of symbols) {
    const inner = s.slice(1, -1);
    if (/^\d+$/.test(inner)) generic += Number(inner);
    else colored.push(s);
  }
  const count = Math.max(0, Math.floor(n));
  const out: string[] = [];
  if (generic * count > 0) out.push(`{${generic * count}}`);
  for (let i = 0; i < count; i++) out.push(...colored);
  return out.join('');
}

/** Choose the scaled mana option to offer: first affordable, else the first. */
export function pickCumulativeManaCost(state: any, playerId: string, options: string[], ages: number): string {
  const scaled = options.map((o) => scaleManaCost(o, ages));
  for (const cost of scaled) {
    try {
      if (canPayManaCostStringWithAvailableSources(state, playerId, cost)) return cost;
    } catch { /* ignore */ }
  }
  return scaled[0] || '';
}

/** All scaled mana options the player can currently afford (deduped, in printed order). */
export function affordableCumulativeManaCosts(state: any, playerId: string, options: string[], ages: number): string[] {
  const out: string[] = [];
  for (const cost of options.map((o) => scaleManaCost(o, ages))) {
    if (!cost || out.includes(cost)) continue;
    try { if (canPayManaCostStringWithAvailableSources(state, playerId, cost)) out.push(cost); } catch { /* ignore */ }
  }
  return out;
}

const POOL_KEYS: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless' };

/** Add a mana string like "{R}{R}" to the player's mana pool (empties at end of step). */
export function addCumulativeUpkeepMana(state: any, playerId: string, mana: string): void {
  if (!state || !playerId) return;
  state.manaPool = state.manaPool || {};
  const pool = state.manaPool[playerId] = state.manaPool[playerId] || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
  for (const m of String(mana || '').matchAll(/\{([WUBRGC])\}/gi)) {
    const key = POOL_KEYS[m[1].toUpperCase()];
    pool[key] = Number(pool[key] || 0) + 1;
  }
}

function payLife(state: any, playerId: string, amount: number): void {
  state.life = state.life || {};
  const current = Number(state.life[playerId] ?? state.startingLife ?? 40);
  state.life[playerId] = current - amount;
  const player = (state.players || []).find((p: any) => String(p?.id) === playerId);
  if (player) player.life = state.life[playerId];
}

/** AI: keep paying while it is affordable, cheap relative to resources, and safe. */
export function chooseAICumulativeUpkeepPayment(game: any, playerId: string, step: any): 'pay' | 'decline' {
  const ages = Number(step?.ageCounters || 1);
  if (step?.cumulativeUpkeepAddMana) return 'pay'; // adding mana is beneficial
  const lifeCost = Number(step?.lifeCost || 0);
  if (lifeCost > 0) {
    const life = Number(game?.state?.life?.[playerId] ?? 40);
    return life - lifeCost >= Math.max(10, lifeCost * 2) ? 'pay' : 'decline';
  }
  const manaCost = String(step?.manaCost || step?.optionalPaymentManaCost || '');
  if (!manaCost) return 'decline';
  let affordable = false;
  try { affordable = canPayManaCostStringWithAvailableSources(game?.state, playerId, manaCost); } catch { affordable = false; }
  if (!affordable) return 'decline';
  const symbols = (manaCost.match(/\{[^}]+\}/g) || ([] as string[])).reduce((sum: number, s: string) => {
    const inner = s.slice(1, -1);
    return sum + (/^\d+$/.test(inner) ? Number(inner) : 1);
  }, 0);
  return symbols <= 6 && ages <= 6 ? 'pay' : 'decline';
}

export function maybeQueueCumulativeUpkeepTriggeredAbility(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
): boolean {
  const match = String(description || '').trim().match(CUMULATIVE_UPKEEP_DESCRIPTION);
  if (!match) return false;
  const cost = parseCumulativeUpkeepCost(match[1]);
  if (!cost) return false;
  const permanentId = String(item?.source || item?.sourceId || sourceId || '').trim();
  const state: any = (ctx as any).state;
  const permanent = (state?.battlefield || []).find((p: any) => String(p?.id) === permanentId);
  if (!permanent) return true; // source left the battlefield: nothing to do
  const controller = String(permanent.controller || triggerController);
  const ages = addAgeCounter(ctx, permanentId) || 1;
  if ((ctx as any).isReplaying) return true;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return false;

  const broadcast = () => {
    const io = (ctx as any).io;
    if (io) broadcastGame(io as any, ctx as any, gameId);
  };
  if (cost.kind === 'addMana') {
    const addMana = scaleManaCost(cost.unit, ages);
    queueOptionalPaymentStep(gameId, {
      playerId: controller,
      sourceName,
      sourceId: permanentId,
      sourceImage: item?.sourceImage,
      description: `${sourceName}: cumulative upkeep (${ages} age counter${ages === 1 ? '' : 's'}). Add ${addMana} or sacrifice it.`,
      mandatory: true,
      payChoiceId: 'pay_cumulative_upkeep',
      payLabel: `Add ${addMana}`,
      payDescription: `Add ${addMana} to your mana pool and keep ${sourceName}.`,
      declineChoiceId: 'decline',
      declineLabel: 'Sacrifice it',
      declineDescription: `Sacrifice ${sourceName}.`,
      validationKind: 'none',
      stepData: { cumulativeUpkeepChoice: true, cumulativeUpkeepAddMana: addMana, permanentId, cardName: sourceName, ageCounters: ages },
      onPay: async () => {
        addCumulativeUpkeepMana(state, controller, addMana);
        (ctx as any).bumpSeq?.();
        broadcast();
      },
      onDecline: async () => {
        sacrificePermanent(ctx, permanentId, controller);
        broadcast();
      },
    });
    return true;
  }
  const lifeCost = cost.kind === 'life' ? cost.amount * ages : 0;
  const manaCost = cost.kind === 'mana' ? pickCumulativeManaCost(state, controller, cost.options, ages) : '';
  const costLabel = lifeCost > 0 ? `${lifeCost} life` : manaCost;

  // "{A} or {B}": when several options are affordable, let the player choose by
  // chaining the existing pay-or-sacrifice prompt ("Pay A" / "Pay B instead").
  const affordable = cost.kind === 'mana' ? affordableCumulativeManaCosts(state, controller, cost.options, ages) : [];
  if (affordable.length > 1) {
    const queueAlternative = (index: number): void => {
      const option = affordable[index];
      const rest = affordable.slice(index + 1);
      queueOptionalPaymentStep(gameId, {
        playerId: controller,
        sourceName,
        sourceId: permanentId,
        sourceImage: item?.sourceImage,
        description: `${sourceName}: cumulative upkeep (${ages} age counter${ages === 1 ? '' : 's'}). Choose a cost: ${affordable.join(' or ')}.`,
        mandatory: true,
        payChoiceId: 'pay_cumulative_upkeep',
        payLabel: `Pay ${option}`,
        payDescription: `Pay ${option} to keep ${sourceName}.`,
        declineChoiceId: 'decline',
        declineLabel: `Pay ${rest.join(' or ')} instead`,
        declineDescription: `Choose a different cost (or sacrifice ${sourceName}).`,
        validationKind: 'mana',
        manaCost: option,
        stepData: { cumulativeUpkeepAlternativeOffer: true, permanentId, cardName: sourceName, ageCounters: ages, manaCost: option },
        onPay: async () => {
          payManaCostWithAvailableSources(state, controller, option);
          (ctx as any).bumpSeq?.();
          broadcast();
        },
        onDecline: async () => {
          if (index + 1 < affordable.length - 1) queueAlternative(index + 1);
          else queueFinal(affordable[affordable.length - 1]);
          broadcast();
        },
      });
    };
    queueAlternative(0);
    return true;
  }
  queueFinal(manaCost);
  return true;

  function queueFinal(manaCost: string): void {
  const costLabel = lifeCost > 0 ? `${lifeCost} life` : manaCost;

  queueOptionalPaymentStep(gameId, {
    playerId: controller,
    sourceName,
    sourceId: permanentId,
    sourceImage: item?.sourceImage,
    description: `${sourceName}: cumulative upkeep (${ages} age counter${ages === 1 ? '' : 's'}). Pay ${costLabel} or sacrifice it.`,
    mandatory: true,
    payChoiceId: 'pay_cumulative_upkeep',
    payLabel: `Pay ${costLabel}`,
    payDescription: `Pay ${costLabel} to keep ${sourceName}.`,
    declineChoiceId: 'decline',
    declineLabel: 'Sacrifice it',
    declineDescription: `Sacrifice ${sourceName}.`,
    validationKind: lifeCost > 0 ? 'life' : 'mana',
    ...(lifeCost > 0 ? { lifeAmount: lifeCost } : { manaCost }),
    stepData: {
      cumulativeUpkeepChoice: true,
      permanentId,
      cardName: sourceName,
      ageCounters: ages,
      ...(lifeCost > 0 ? { lifeCost, payLifeAmount: lifeCost } : { manaCost }),
    },
    onPay: async () => {
      if (lifeCost > 0) payLife(state, controller, lifeCost);
      else payManaCostWithAvailableSources(state, controller, manaCost);
      (ctx as any).bumpSeq?.();
      broadcast();
    },
    onDecline: async () => {
      sacrificePermanent(ctx, permanentId, controller);
      broadcast();
    },
  });
  }
}

/** Replay of a recorded cumulative upkeep choice (mana is consumed by the generic replay path). */
export function replayCumulativeUpkeepChoice(ctx: GameContext, event: any, paid: boolean): void {
  const playerId = String(event?.playerId || '').trim();
  const sourceId = String(event?.sourceId || '').trim();
  if (!playerId) return;
  if (paid) {
    const lifeCost = Number(event?.lifeCost || 0);
    if (lifeCost > 0) payLife((ctx as any).state, playerId, lifeCost);
    const addMana = String(event?.cumulativeUpkeepAddMana || '').trim();
    if (addMana) addCumulativeUpkeepMana((ctx as any).state, playerId, addMana);
  } else if (sourceId) {
    sacrificePermanent({ ...(ctx as any), zones: (ctx as any).state?.zones } as any, sourceId, playerId);
  }
}