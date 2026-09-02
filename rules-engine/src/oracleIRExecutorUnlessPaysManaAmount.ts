/**
 * Origin parent: oracleIRExecutorPlayerStepHandlers.ts
 * Cluster: resolve variable unless-pays-mana amounts (“{1} for each …”,
 *   “{2} plus additional {1} for each …”, “{X} where X is …”).
 * Public: resolveUnlessPaysManaCostString
 * Leaf must not import oracleIRExecutorPlayerStepHandlers.ts or oracleIRExecutorMainLoop.ts.
 */

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { tryResolveForEachReferenceAmount } from './oracleIRExecutorForEachQuantity';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';
import { parseClassList } from './oracleIRExecutorModifyPtClassUtils';

function readThisWayCount(ctx: OracleIRExecutionContext, kind: 'energy' | 'revealed' | 'discarded'): number | null {
  if (kind === 'energy') {
    const energy = Number(ctx.energyPaidThisWay ?? ctx.referenceAmount ?? ctx.xValue);
    return Number.isFinite(energy) ? Math.max(0, Math.floor(energy)) : null;
  }
  if (kind === 'revealed') {
    const revealedCards = Array.isArray(ctx.lastRevealedCards) ? ctx.lastRevealedCards : undefined;
    const revealed = Number(
      ctx.lastRevealedCardCount
      ?? (revealedCards ? revealedCards.length : undefined)
      ?? ctx.referenceAmount
      ?? (Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards.length : undefined),
    );
    return Number.isFinite(revealed) ? Math.max(0, Math.floor(revealed)) : null;
  }
  const discardedCards = Array.isArray(ctx.lastDiscardedCards) ? ctx.lastDiscardedCards : undefined;
  const discarded = Number(
    (discardedCards ? discardedCards.length : undefined)
    ?? ctx.referenceAmount
    ?? (Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards.length : undefined),
  );
  return Number.isFinite(discarded) ? Math.max(0, Math.floor(discarded)) : null;
}

function resolveNamedCardName(rawName: string, ctx: OracleIRExecutionContext): string {
  const normalized = normalizeOracleText(rawName);
  if (/^this (?:permanent|card|spell|creature)$/i.test(normalized)) {
    return String(ctx.sourceName || '').trim();
  }
  return String(rawName || '').trim();
}

function countNamedCardsInAllGraveyards(state: GameState, name: string): number {
  const wanted = normalizeOracleText(name);
  if (!wanted) return 0;
  const zones = (state as { zones?: Record<string, { graveyard?: unknown[] }> }).zones;
  return (state.players || []).reduce((sum, player: any) => {
    const playerId = String(player?.id || '').trim();
    const zoneGy = Array.isArray(zones?.[playerId]?.graveyard) ? zones[playerId].graveyard : [];
    const playerGy = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const gy = playerGy.length > 0 ? playerGy : zoneGy;
    const count = gy.filter((card: any) => {
      const cardName = String(card?.name || card?.card?.name || '').trim();
      return normalizeOracleText(cardName) === wanted;
    }).length;
    return sum + count;
  }, 0);
}

function countOnBattlefield(state: GameState, classText: string): number | null {
  const classes = parseClassList(classText);
  if (!classes || classes.length === 0) return null;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.filter((perm) => classes.some((klass) => hasExecutorClass(perm, klass))).length;
}

function resolveEachPart(
  state: GameState,
  controllerId: PlayerID,
  eachPart: string,
  ctx: OracleIRExecutionContext,
): number | null {
  const normalized = normalizeOracleText(eachPart);
  if (!normalized) return null;

  if (/^(?:\{e\}|energy) paid this way$/i.test(normalized)) {
    return readThisWayCount(ctx, 'energy');
  }
  if (/^cards? revealed this way$/i.test(normalized)) {
    return readThisWayCount(ctx, 'revealed');
  }
  if (/^cards? discarded this way$/i.test(normalized)) {
    return readThisWayCount(ctx, 'discarded');
  }

  const namedEachGraveyard = normalized.match(/^cards? named (.+?) in each graveyard$/i);
  if (namedEachGraveyard) {
    return countNamedCardsInAllGraveyards(state, resolveNamedCardName(String(namedEachGraveyard[1] || ''), ctx));
  }

  if (/^basic land types? among lands you control$/i.test(normalized)) {
    return evaluateModifyPtWhereX(
      state,
      controllerId,
      'x is the number of basic land types among lands you control',
      undefined,
      ctx,
    );
  }

  if (/^creatures? in your party$/i.test(normalized)) {
    return evaluateModifyPtWhereX(
      state,
      controllerId,
      'x is the number of creatures in your party',
      undefined,
      ctx,
    );
  }

  const onBattlefield = normalized.match(/^(.+) on the battlefield$/i);
  if (onBattlefield) {
    return countOnBattlefield(state, String(onBattlefield[1] || ''));
  }

  const viaForEach = tryResolveForEachReferenceAmount(
    state,
    controllerId,
    `1 for each ${normalized}`,
    ctx,
  );
  if (viaForEach !== null) return viaForEach;

  return evaluateModifyPtWhereX(
    state,
    controllerId,
    `x is the number of ${normalized}`,
    undefined,
    ctx,
  );
}

function resolveManaAmountRaw(
  state: GameState,
  controllerId: PlayerID,
  raw: string,
  ctx: OracleIRExecutionContext,
): number | null {
  const normalized = normalizeOracleText(raw);
  if (!normalized) return null;

  const plusEach = normalized.match(/^(\d+)\s+plus\s+(\d+)\s+for\s+each\s+(.+)$/i);
  if (plusEach) {
    const base = parseInt(String(plusEach[1] || '0'), 10);
    const extra = parseInt(String(plusEach[2] || '0'), 10);
    const count = resolveEachPart(state, controllerId, String(plusEach[3] || ''), ctx);
    if (!Number.isFinite(base) || !Number.isFinite(extra) || count === null) return null;
    return Math.max(0, base + extra * count);
  }

  const unitEach = normalized.match(/^(\d+)\s+for\s+each\s+(.+)$/i);
  if (unitEach) {
    const unit = parseInt(String(unitEach[1] || '0'), 10);
    const count = resolveEachPart(state, controllerId, String(unitEach[2] || ''), ctx);
    if (!Number.isFinite(unit) || count === null) return null;
    return Math.max(0, unit * count);
  }

  const viaForEach = tryResolveForEachReferenceAmount(state, controllerId, normalized, ctx);
  if (viaForEach !== null) return viaForEach;

  return null;
}

function opponentStackObjectCount(state: GameState, controllerId: PlayerID, sourceId?: string): number {
  const stack = Array.isArray((state as { stack?: unknown[] }).stack) ? (state as { stack: any[] }).stack : [];
  const source = String(sourceId || '').trim();
  return stack.filter((item) => {
    const id = String(item?.id || '').trim();
    if (!id || (source && id === source)) return false;
    const itemController = String(item?.controller || item?.controllerId || '').trim();
    return Boolean(itemController) && itemController !== String(controllerId || '').trim();
  }).length;
}

/**
 * Returns a simple mana string (`{N}` / `{X}`) the existing mana payer can parse.
 * `{0}` is a legal payment (the unless is satisfied; nested counter does not apply).
 */
export function resolveUnlessPaysManaCostString(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_pays_mana' }>,
  ctx: OracleIRExecutionContext,
): string | null {
  const controllerId = String(ctx.controllerId || '').trim() as PlayerID;
  // Whirlwind Denial iterates each opponent stack object at {N} apiece.
  // An empty stack is a no-op in the for-each loop, not a multiplied {0}.
  if (step.forEachOpponentStackObjects && !String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim()) {
    const count = opponentStackObjectCount(state, controllerId, ctx.sourceId);
    if (count <= 0) return '{0}';
  }

  if (step.whereX) {
    const resolved = evaluateModifyPtWhereX(
      state,
      controllerId,
      `x is ${step.whereX}`,
      undefined,
      ctx,
    );
    if (resolved === null) return null;
    return `{${Math.max(0, resolved)}}`;
  }

  if (step.manaAmountRaw) {
    const resolved = resolveManaAmountRaw(state, controllerId, step.manaAmountRaw, ctx);
    if (resolved === null) return null;
    return `{${Math.max(0, resolved)}}`;
  }

  const mana = String(step.mana || '').trim();
  return mana || null;
}
