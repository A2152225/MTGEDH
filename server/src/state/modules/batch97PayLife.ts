// server/src/state/modules/batch97PayLife.ts
// B97: shared life-payment chokepoint. "If you would pay life while your
// library has at least that many cards in it, exile that many cards from the
// top of your library instead." (Ashiok, Wicked Manipulator.) Every cost that
// pays life should go through payLifeAmount so the replacement cannot be
// missed. Paying life is not life loss. Public: canPayLifeAmount, payLifeAmount.

import { applyAshiokLifePayExile, playerHasAshiokLifePayExile } from './batch96LifePayExile.js';
import { listPayLifeReplacementCandidates, queuePayLifeReplacementOrderIfNeeded } from './payLifeReplacementOrder.js';
import { playersCannotPayLifeToCastOrActivateNonMana } from './karnsSylexPayLifeRestriction.js';

function currentLife(state: any, playerId: string): number {
  const fromMap = state?.life?.[playerId];
  if (typeof fromMap === 'number') return fromMap;
  const player = (Array.isArray(state?.players) ? state.players : []).find((p: any) => String(p?.id) === String(playerId));
  return Number(player?.life ?? state?.startingLife ?? 0);
}

function libraryCount(state: any, playerId: string): number {
  const zones = state?.zones?.[playerId];
  if (Array.isArray(zones?.library)) return zones.library.length;
  if (typeof zones?.libraryCount === 'number') return zones.libraryCount;
  const player = (Array.isArray(state?.players) ? state.players : []).find((p: any) => String(p?.id) === String(playerId));
  if (Array.isArray(player?.library)) return player.library.length;
  return 0;
}

function ashiokCanReplace(state: any, playerId: string, amount: number): boolean {
  if (!amount || !playerHasAshiokLifePayExile(state, playerId)) return false;
  return libraryCount(state, playerId) >= amount;
}

/** True when the player can pay `amount` life, or Ashiok can replace that payment. */
export function canPayLifeAmount(state: any, playerId: string, amount: number, opts?: { allowPayToZero?: boolean; forSpellOrNonManaAbility?: boolean; isManaAbility?: boolean }): boolean {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (!n) return true;
  if (opts?.forSpellOrNonManaAbility && !opts?.isManaAbility && playersCannotPayLifeToCastOrActivateNonMana(state, playerId)) return false;
  if (ashiokCanReplace(state, playerId, n)) return true;
  const life = currentLife(state, playerId);
  return opts?.allowPayToZero === false ? life > n : life >= n;
}

export interface PayLifeAmountResult {
  paid: boolean;
  replaced: boolean;
  newLife: number;
  exiled: number;
  pendingReplacementOrder?: boolean;
}

/**
 * Pay `amount` life, applying Ashiok's exile-library-top replacement when it
 * applies. Mutates state.life and players[].life when life is actually paid.
 * When Ashiok replaces the payment, also notes mana values for Bell Borca.
 */
export function payLifeAmount(state: any, playerId: string, amount: number, opts?: {
  ctx?: { state?: any; gameId?: string; isReplaying?: boolean };
  skipReplacementOrder?: boolean;
  alreadyAppliedEffectIds?: string[];
  forSpellOrNonManaAbility?: boolean;
  isManaAbility?: boolean;
}): PayLifeAmountResult {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const life = currentLife(state, playerId);
  if (!state || !playerId) return { paid: false, replaced: false, newLife: life, exiled: 0 };
  if (!n) return { paid: true, replaced: false, newLife: life, exiled: 0 };
  if (opts?.forSpellOrNonManaAbility && !opts?.isManaAbility && playersCannotPayLifeToCastOrActivateNonMana(state, playerId)) {
    return { paid: false, replaced: false, newLife: life, exiled: 0 };
  }

  if (!opts?.skipReplacementOrder) {
    const ctx = opts?.ctx && typeof opts.ctx === 'object' ? opts.ctx : { state };
    if (!(ctx as any).state) (ctx as any).state = state;
    const candidates = listPayLifeReplacementCandidates(state, playerId, n)
      .filter((candidate) => !(opts?.alreadyAppliedEffectIds || []).includes(candidate.effectId));
    if (candidates.length >= 2) {
      const queued = queuePayLifeReplacementOrderIfNeeded({ ctx: ctx as any, playerId, amount: n });
      if (queued.queued) {
        return { paid: false, replaced: false, newLife: life, exiled: 0, pendingReplacementOrder: true } as PayLifeAmountResult;
      }
    }
  }

  const applied = applyAshiokLifePayExile(state, playerId, n);
  if (applied.replaced) {
    return { paid: true, replaced: true, newLife: currentLife(state, playerId), exiled: applied.exiled };
  }

  const next = life - n;
  if (!state.life || typeof state.life !== 'object') state.life = {};
  state.life[playerId] = next;
  const player = (Array.isArray(state.players) ? state.players : []).find((p: any) => String(p?.id) === String(playerId));
  if (player) player.life = next;
  return { paid: true, replaced: false, newLife: next, exiled: 0 };
}
