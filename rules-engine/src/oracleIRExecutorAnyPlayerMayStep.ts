/**
 * Executor for any_player_may tax windows (Dash Hopes-style).
 * Nested steps apply when a player pays (opposite of unless_* wrappers).
 */
import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  describeAnyPlayerMayPayment,
  resolveHalfLifeRoundedUp,
  type AnyPlayerMayPayment,
} from './oracleIRAnyPlayerMay';

type AnyPlayerMayResult =
  | {
      readonly applied: true;
      readonly shouldApplyNestedSteps: boolean;
      readonly state?: GameState;
      readonly log: readonly string[];
    }
  | {
      readonly applied: false;
      readonly message: string;
      readonly reason: string;
      readonly options?: {
        readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
        readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
        readonly pending?: boolean;
        readonly persist?: boolean;
      };
      readonly state?: GameState;
    };

function getPlayersInApnapOrder(state: GameState, activePlayerId?: string): PlayerID[] {
  const players = Array.isArray((state as any).players) ? (state as any).players : [];
  const ids = players
    .map((p: any) => String(p?.id || '').trim())
    .filter(Boolean) as PlayerID[];
  if (ids.length === 0) return [];
  const active = String(
    activePlayerId
      || (state as any).activePlayer
      || (state as any).priority
      || ids[0]
      || '',
  ).trim();
  const start = Math.max(0, ids.findIndex((id) => id === active));
  if (start <= 0) return ids;
  return [...ids.slice(start), ...ids.slice(0, start)];
}

function playerCanAfford(
  state: GameState,
  playerId: PlayerID,
  payment: AnyPlayerMayPayment,
): boolean {
  const player = ((state as any).players || []).find(
    (p: any) => String(p?.id || '').trim() === String(playerId),
  );
  if (!player) return false;

  if (payment.kind === 'life') {
    return Number(player.life) >= payment.amount;
  }
  if (payment.kind === 'half_life_rounded_up') {
    const amount = resolveHalfLifeRoundedUp(Number(player.life));
    return amount > 0 && Number(player.life) >= amount;
  }
  if (payment.kind === 'discard') {
    const handSize = Array.isArray(player.hand) ? player.hand.length : 0;
    return handSize >= payment.amount;
  }
  if (payment.kind === 'sacrifice') {
    const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
    return battlefield.some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(playerId)) return false;
      const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
      return /\bcreature\b/.test(typeLine);
    });
  }
  return false;
}

function applyPayment(
  state: GameState,
  playerId: PlayerID,
  payment: AnyPlayerMayPayment,
  ctx: OracleIRExecutionContext,
): { state: GameState; log: string[]; ok: boolean; message?: string } {
  if (payment.kind === 'life' || payment.kind === 'half_life_rounded_up') {
    const player = ((state as any).players || []).find(
      (p: any) => String(p?.id || '').trim() === String(playerId),
    );
    const amount =
      payment.kind === 'life'
        ? payment.amount
        : resolveHalfLifeRoundedUp(Number(player?.life));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { state, log: [], ok: false, message: 'invalid life payment' };
    }
    const players = ((state as any).players || []).map((p: any) => {
      if (String(p?.id || '').trim() !== String(playerId)) return p;
      return { ...p, life: Number(p.life) - amount };
    });
    return {
      state: { ...(state as any), players } as GameState,
      log: [`${playerId} paid ${amount} life`],
      ok: true,
    };
  }

  if (payment.kind === 'discard') {
    const chosenIdsRaw =
      Array.isArray((ctx as any).anyPlayerMayDiscardCardIds)
        ? (ctx as any).anyPlayerMayDiscardCardIds
        : Array.isArray((ctx.selectorContext as any)?.anyPlayerMayDiscardCardIds)
          ? (ctx.selectorContext as any).anyPlayerMayDiscardCardIds
          : [];
    const chosenIds = chosenIdsRaw
      .map((id: unknown) => String(id || '').trim())
      .filter(Boolean);
    if (chosenIds.length < payment.amount) {
      return { state, log: [], ok: false, message: 'discard selection required' };
    }

    const players = ((state as any).players || []).map((p: any) => {
      if (String(p?.id || '').trim() !== String(playerId)) return p;
      const hand = Array.isArray(p.hand) ? [...p.hand] : [];
      const graveyard = Array.isArray(p.graveyard) ? [...p.graveyard] : [];
      const discarded: any[] = [];
      const remainingIds = [...chosenIds];
      while (discarded.length < payment.amount && remainingIds.length > 0) {
        const want = remainingIds.shift()!;
        const idx = hand.findIndex((card: any) => String(card?.id || card?.card?.id || '').trim() === want);
        if (idx < 0) continue;
        discarded.push(hand.splice(idx, 1)[0]);
      }
      if (discarded.length < payment.amount) {
        return { ...p, __anyPlayerMayDiscardFailed: true };
      }
      return { ...p, hand, graveyard: [...graveyard, ...discarded] };
    });
    if (players.some((p: any) => p?.__anyPlayerMayDiscardFailed === true)) {
      return { state, log: [], ok: false, message: 'discard selection required' };
    }
    return {
      state: { ...(state as any), players } as GameState,
      log: [`${playerId} discarded ${payment.amount} card(s)`],
      ok: true,
    };
  }

  if (payment.kind === 'sacrifice') {
    const chosenFromList = Array.isArray((ctx as any).chosenObjectIds)
      ? (ctx as any).chosenObjectIds
      : Array.isArray((ctx.selectorContext as any)?.chosenObjectIds)
        ? (ctx.selectorContext as any).chosenObjectIds
        : [];
    const chosenId = String(
      (ctx as any).anyPlayerMaySacrificePermanentId
        || (ctx.selectorContext as any)?.anyPlayerMaySacrificePermanentId
        || chosenFromList[0]
        || '',
    ).trim();
    if (!chosenId) {
      return { state, log: [], ok: false, message: 'sacrifice selection required' };
    }
    const battlefield = Array.isArray((state as any).battlefield)
      ? [...(state as any).battlefield]
      : [];
    const targetIndex = battlefield.findIndex((p: any) => String(p?.id || '').trim() === chosenId);
    if (targetIndex < 0) {
      return { state, log: [], ok: false, message: 'sacrifice selection required' };
    }
    const targetPerm = battlefield[targetIndex];
    if (String(targetPerm?.controller || '').trim() !== String(playerId)) {
      return { state, log: [], ok: false, message: 'sacrifice selection required' };
    }
    const typeLine = String(targetPerm?.card?.type_line || targetPerm?.type_line || '').toLowerCase();
    if (!/\bcreature\b/.test(typeLine)) {
      return { state, log: [], ok: false, message: 'sacrifice selection required' };
    }
    const [removed] = battlefield.splice(targetIndex, 1);
    const ownerId = String(removed?.owner || removed?.controller || playerId).trim();
    const players = ((state as any).players || []).map((p: any) => {
      if (String(p?.id || '').trim() !== ownerId) return p;
      const graveyard = Array.isArray(p.graveyard) ? [...p.graveyard] : [];
      const card = removed?.card || removed;
      return { ...p, graveyard: [...graveyard, card] };
    });
    return {
      state: { ...(state as any), battlefield, players } as GameState,
      log: [`${playerId} sacrificed ${String(removed?.id || 'creature')}`],
      ok: true,
    };
  }

  return { state, log: [], ok: false, message: 'unsupported payment' };
}

export function evaluateAnyPlayerMayStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'any_player_may' }>,
  ctx: OracleIRExecutionContext,
): AnyPlayerMayResult {
  const payment = (step as any).payment as AnyPlayerMayPayment;
  if (!payment || !payment.kind) {
    return {
      applied: false,
      message: `Skipped any-player-may step (unsupported payment): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'unsupported' },
    };
  }

  const explicitChoice =
    (ctx as any).anyPlayerMayChoice === 'pay' || (ctx as any).anyPlayerMayChoice === 'decline'
      ? (ctx as any).anyPlayerMayChoice
      : ((ctx.selectorContext as any)?.anyPlayerMayChoice === 'pay'
          || (ctx.selectorContext as any)?.anyPlayerMayChoice === 'decline'
          ? (ctx.selectorContext as any).anyPlayerMayChoice
          : undefined);

  const declinedIds = new Set(
    (
      Array.isArray((ctx as any).anyPlayerMayDeclinedPlayerIds)
        ? (ctx as any).anyPlayerMayDeclinedPlayerIds
        : Array.isArray((ctx.selectorContext as any)?.anyPlayerMayDeclinedPlayerIds)
          ? (ctx.selectorContext as any).anyPlayerMayDeclinedPlayerIds
          : []
    ).map((id: unknown) => String(id || '').trim()).filter(Boolean),
  );

  const ordered = getPlayersInApnapOrder(state, String(ctx.controllerId || ''));
  const candidates = ordered.filter(
    (id) => !declinedIds.has(String(id)) && playerCanAfford(state, id, payment),
  );

  if (candidates.length === 0) {
    return {
      applied: true,
      shouldApplyNestedSteps: false,
      log: [`Resolved any-player-may step (no player can ${describeAnyPlayerMayPayment(payment)}): ${step.raw}`],
    };
  }

  if (explicitChoice === 'pay') {
    const payerId = String(
      (ctx as any).anyPlayerMayPayerId
        || (ctx.selectorContext as any)?.anyPlayerMayPayerId
        || candidates[0]
        || '',
    ).trim() as PlayerID;
    if (!payerId || !candidates.includes(payerId)) {
      return {
        applied: false,
        message: `Skipped any-player-may step (invalid payer): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          pending: true,
          metadata: {
            paymentKind: payment.kind,
            paymentLabel: describeAnyPlayerMayPayment(payment),
            candidatePlayerIds: candidates,
            nextPlayerId: candidates[0]!,
          },
        },
      };
    }
    const paid = applyPayment(state, payerId, payment, ctx);
    if (!paid.ok) {
      return {
        applied: false,
        message: `Skipped any-player-may step (${paid.message}): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          pending: true,
          metadata: {
            paymentKind: payment.kind,
            paymentLabel: describeAnyPlayerMayPayment(payment),
            candidatePlayerIds: candidates,
            nextPlayerId: payerId,
          },
        },
      };
    }
    return {
      applied: true,
      shouldApplyNestedSteps: true,
      state: paid.state,
      log: [
        ...paid.log,
        `Resolved any-player-may step (${payerId} paid; applying nested steps): ${step.raw}`,
      ],
    };
  }

  if (explicitChoice === 'decline') {
    const decliningId = String(
      (ctx as any).anyPlayerMayPayerId
        || (ctx.selectorContext as any)?.anyPlayerMayPayerId
        || candidates[0]
        || '',
    ).trim();
    if (decliningId) declinedIds.add(decliningId);
    const remaining = ordered.filter(
      (id) => !declinedIds.has(String(id)) && playerCanAfford(state, id, payment),
    );
    if (remaining.length === 0) {
      return {
        applied: true,
        shouldApplyNestedSteps: false,
        log: [`Resolved any-player-may step (all players declined): ${step.raw}`],
      };
    }
    return {
      applied: false,
      message: `Skipped any-player-may step (next player choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        pending: true,
        metadata: {
          paymentKind: payment.kind,
          paymentLabel: describeAnyPlayerMayPayment(payment),
          candidatePlayerIds: remaining,
          nextPlayerId: remaining[0]!,
          declinedPlayerIds: Array.from(declinedIds),
        },
      },
    };
  }

  return {
    applied: false,
    message: `Skipped any-player-may step (player choice required): ${step.raw}`,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
      pending: true,
      metadata: {
        paymentKind: payment.kind,
        paymentLabel: describeAnyPlayerMayPayment(payment),
        candidatePlayerIds: candidates,
        nextPlayerId: candidates[0]!,
      },
    },
  };
}
