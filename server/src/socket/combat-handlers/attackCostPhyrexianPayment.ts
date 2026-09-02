// Origin parent: server/src/socket/resolution-handlers/attackCostPaymentBeforeCompleteHandlers.ts
// Cluster: Norn's Annex `{W/P}` attack-tax payment (mix color mana and 2 life).
// Public: buildAttackCostPhyrexianChoices, canAffordAttackCostPayment,
//   parseAttackCostPhyrexianChoices, payAttackCostManaAndLife, refundAttackCostLife
// Leaf must not import resolution.ts.

import { queueLifePaymentTriggers } from '../../state/modules/triggers/pay-life.js';
import type { AttackYouTaxPhyrexianItem } from '../../state/modules/staticEffectSpecAttackYouTaxPhyrexian.js';
import {
  canPayManaCostStringWithAvailableSources,
  payManaCostWithAvailableSources,
  refundGenericManaPayment,
  type AvailableSourceManaPaymentResult,
} from '../util.js';

export interface AttackCostPhyrexianChoicePrompt {
  index: number;
  colorOption: string;
  colorName: string;
  lifeAmount: number;
  hasColorMana: boolean;
  symbol: string;
  source?: string;
}

export interface AttackCostPhyrexianSelection {
  index: number;
  payWithLife: boolean;
}

const COLOR_NAME: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

export function buildAttackCostPhyrexianChoices(
  items: readonly AttackYouTaxPhyrexianItem[],
): AttackCostPhyrexianChoicePrompt[] {
  return items.map((item, index) => {
    const symbol = String(item.symbol || 'W').toUpperCase();
    return {
      index,
      colorOption: symbol,
      colorName: COLOR_NAME[symbol] || symbol,
      lifeAmount: Math.max(1, Math.floor(Number(item.life) || 2)),
      hasColorMana: true,
      symbol: `{${symbol}/P}`,
      source: item.source,
    };
  });
}

export function parseAttackCostPhyrexianChoices(
  raw: unknown,
  expectedCount: number,
): AttackCostPhyrexianSelection[] | null {
  const count = Math.max(0, Math.floor(Number(expectedCount) || 0));
  if (count <= 0) return [];

  const fromObject = (value: any): unknown => {
    if (Array.isArray(value?.phyrexianChoices)) return value.phyrexianChoices;
    return undefined;
  };

  let list: unknown = undefined;
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first && typeof first === 'object' && ('payWithLife' in first || 'index' in first)) {
      list = raw;
    } else if (first && typeof first === 'object') {
      list = fromObject(first);
    }
  } else if (raw && typeof raw === 'object') {
    list = fromObject(raw);
  }

  if (!Array.isArray(list)) {
    return Array.from({ length: count }, (_, index) => ({ index, payWithLife: false }));
  }

  const byIndex = new Map<number, boolean>();
  for (const entry of list) {
    const index = Math.floor(Number((entry as any)?.index));
    if (!Number.isFinite(index) || index < 0 || index >= count) continue;
    byIndex.set(index, Boolean((entry as any)?.payWithLife));
  }
  if (byIndex.size !== count) return null;
  return Array.from({ length: count }, (_, index) => ({
    index,
    payWithLife: byIndex.get(index) === true,
  }));
}

function buildManaCostString(generic: number, colorCounts: Record<string, number>): string {
  const parts: string[] = [];
  for (const [symbol, rawCount] of Object.entries(colorCounts)) {
    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
    for (let i = 0; i < count; i += 1) parts.push(`{${symbol}}`);
  }
  const genericAmount = Math.max(0, Math.floor(Number(generic) || 0));
  if (genericAmount > 0) parts.push(`{${genericAmount}}`);
  return parts.join('');
}

export function canAffordAttackCostPayment(
  gameState: any,
  playerId: string,
  args: {
    generic: number;
    items: readonly AttackYouTaxPhyrexianItem[];
    excludedPermanentIds?: string[];
    choices?: readonly AttackCostPhyrexianSelection[];
    lifePaidCount?: number;
    fixedLife?: number;
  },
): { ok: boolean; error?: string } {
  const items = Array.isArray(args.items) ? args.items : [];
  const generic = Math.max(0, Math.floor(Number(args.generic) || 0));
  const fixedLife = Math.max(0, Math.floor(Number(args.fixedLife) || 0));
  const playerLife = Number(
    gameState?.life?.[playerId]
    ?? (Array.isArray(gameState?.players)
      ? gameState.players.find((player: any) => String(player?.id || '') === String(playerId))?.life
      : undefined)
    ?? 40,
  );

  const trySplit = (lifeIndexes: ReadonlySet<number>): boolean => {
    let totalLife = fixedLife;
    const colorCounts: Record<string, number> = {};
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (lifeIndexes.has(index)) {
        totalLife += Math.max(1, Math.floor(Number(item.life) || 2));
      } else {
        const symbol = String(item.symbol || 'W').toUpperCase();
        colorCounts[symbol] = Number(colorCounts[symbol] || 0) + 1;
      }
    }
    if (totalLife > 0 && playerLife <= totalLife) return false;
    const manaCost = buildManaCostString(generic, colorCounts);
    if (!manaCost) return true;
    return canPayManaCostStringWithAvailableSources(gameState, playerId, manaCost, {
      excludedPermanentIds: args.excludedPermanentIds,
    });
  };

  if (Array.isArray(args.choices) && args.choices.length === items.length) {
    const lifeIndexes = new Set(
      args.choices.filter((choice) => choice.payWithLife).map((choice) => choice.index),
    );
    return trySplit(lifeIndexes)
      ? { ok: true }
      : { ok: false, error: 'Cannot pay the attack cost with available mana and life.' };
  }

  const forcedLifeCount = args.lifePaidCount;
  const minLife = forcedLifeCount == null ? 0 : Math.max(0, Math.floor(forcedLifeCount));
  const maxLife = forcedLifeCount == null ? items.length : minLife;
  for (let lifeCount = minLife; lifeCount <= maxLife; lifeCount += 1) {
    const lifeIndexes = new Set(Array.from({ length: lifeCount }, (_, index) => index));
    if (trySplit(lifeIndexes)) return { ok: true };
  }
  return {
    ok: false,
    error: items.length > 0
      ? 'Cannot pay the attack cost with available mana and life.'
      : `Insufficient mana to pay {${generic}}.`,
  };
}

export interface AttackCostCombinedPayment extends AvailableSourceManaPaymentResult {
  lifePaid: number;
}

export function refundAttackCostLife(gameState: any, playerId: string, lifePaid: number): void {
  const amount = Math.max(0, Math.floor(Number(lifePaid) || 0));
  if (amount <= 0) return;
  gameState.life = gameState.life || {};
  gameState.life[playerId] = Number(gameState.life[playerId] || 0) + amount;
  const playerObj = (Array.isArray(gameState.players) ? gameState.players : [])
    .find((player: any) => String(player?.id || '') === String(playerId));
  if (playerObj) playerObj.life = gameState.life[playerId];
  try {
    const lost = (gameState as any).lifeLostThisTurn || {};
    lost[String(playerId)] = Math.max(0, Number(lost[String(playerId)] || 0) - amount);
    (gameState as any).lifeLostThisTurn = lost;
  } catch { /* ignore */ }
}

export function payAttackCostManaAndLife(
  gameState: any,
  playerId: string,
  args: {
    generic: number;
    items: readonly AttackYouTaxPhyrexianItem[];
    choices: readonly AttackCostPhyrexianSelection[];
    excludedPermanentIds?: string[];
    fixedLife?: number;
  },
): AttackCostCombinedPayment {
  const empty: AttackCostCombinedPayment = {
    ok: false,
    tappedPermanents: [],
    sacrificedPermanents: [],
    paymentManaDelta: {},
    consumed: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    lifePaid: 0,
  };
  const items = Array.isArray(args.items) ? args.items : [];
  const choices = Array.isArray(args.choices) ? args.choices : [];
  if (items.length > 0 && choices.length !== items.length) {
    return { ...empty, error: 'Missing Phyrexian attack-cost choices.' };
  }

  const colorCounts: Record<string, number> = {};
  let lifePaid = Math.max(0, Math.floor(Number(args.fixedLife) || 0));
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const choice = choices[index];
    if (choice?.payWithLife) {
      lifePaid += Math.max(1, Math.floor(Number(item.life) || 2));
    } else {
      const symbol = String(item.symbol || 'W').toUpperCase();
      colorCounts[symbol] = Number(colorCounts[symbol] || 0) + 1;
    }
  }

  const playerLife = Number(
    gameState?.life?.[playerId]
    ?? (Array.isArray(gameState?.players)
      ? gameState.players.find((player: any) => String(player?.id || '') === String(playerId))?.life
      : undefined)
    ?? 40,
  );
  if (lifePaid > 0 && playerLife <= lifePaid) {
    return {
      ...empty,
      error: `Cannot pay ${lifePaid} life (you have ${playerLife} life - payment would be lethal)`,
    };
  }

  const manaCost = buildManaCostString(Math.max(0, Math.floor(Number(args.generic) || 0)), colorCounts);
  const manaPayment = manaCost
    ? payManaCostWithAvailableSources(gameState, playerId, manaCost, {
      excludedPermanentIds: args.excludedPermanentIds,
    })
    : {
      ok: true as const,
      tappedPermanents: [] as string[],
      sacrificedPermanents: [] as string[],
      paymentManaDelta: {} as Record<string, number>,
      consumed: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
  if (!manaPayment.ok) {
    return { ...empty, error: manaPayment.error || 'Insufficient mana.' };
  }

  if (lifePaid > 0) {
    gameState.life = gameState.life || {};
    const startingLife = gameState.startingLife || 40;
    const currentLife = gameState.life?.[playerId] ?? startingLife;
    gameState.life[playerId] = Number(currentLife) - lifePaid;
    try {
      (gameState as any).lifeLostThisTurn = (gameState as any).lifeLostThisTurn || {};
      (gameState as any).lifeLostThisTurn[String(playerId)] =
        ((gameState as any).lifeLostThisTurn[String(playerId)] || 0) + lifePaid;
    } catch { /* ignore */ }
    const playerObj = (Array.isArray(gameState.players) ? gameState.players : [])
      .find((player: any) => String(player?.id || '') === String(playerId));
    if (playerObj) playerObj.life = gameState.life[playerId];
  }

  return { ...manaPayment, ok: true, lifePaid };
}

export function commitAttackCostLifeTriggers(
  game: any,
  playerId: string,
  lifePaid: number,
  sourceName?: string,
): void {
  if (lifePaid <= 0) return;
  queueLifePaymentTriggers(game as any, String(playerId), lifePaid, {
    sourceName: sourceName || 'Phyrexian attack cost',
  });
}

export function refundAttackCostPayment(
  gameState: any,
  playerId: string,
  payment: AttackCostCombinedPayment,
): void {
  refundGenericManaPayment(gameState, playerId, payment);
  refundAttackCostLife(gameState, playerId, payment.lifePaid);
}
