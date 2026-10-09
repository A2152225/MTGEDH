// Origin parent: server/src/state/modules/manualActionApply.ts
// Cluster: life, mana, damage, player resources, extra turn, win/lose.
// Public entry symbols: applyManualStateVerb.

import type { GameContext } from '../../context.js';
import type { ManualActionPayload } from '../../../../../shared/src/manualAction.js';
import { addExtraTurn } from '../turn-handlers/turnScheduledStepsAndExtras.js';
import { addEnergyCounters } from '../../utils.js';
import { canonicalizeCounterKey, updateCounters } from '../counters_tokens.js';
import { findManualObject } from './manualActionFind.js';
import { relocateManualObject } from './manualActionRelocate.js';
import type { ManualActionResult } from './manualActionTypes.js';

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function isIndestructiblePermanent(perm: any): boolean {
  if (perm?.indestructible === true) return true;
  const granted = Array.isArray(perm?.grantedAbilities) ? perm.grantedAbilities.join(' ') : '';
  const text = `${perm?.card?.oracle_text || ''} ${granted}`.toLowerCase();
  return /\bindestructible\b/.test(text);
}

function creatureToughness(perm: any): number | null {
  const raw = perm?.effectiveToughness ?? perm?.baseToughness ?? perm?.card?.toughness;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function planeswalkerLoyalty(perm: any): number {
  return Number(
    perm?.counters?.loyalty
    ?? perm?.loyalty
    ?? perm?.loyaltyCounters
    ?? perm?.card?.loyalty
    ?? 0,
  );
}

function writeLife(ctx: GameContext, playerId: string, value: number): void {
  const state = ctx.state as any;
  state.life = state.life || {};
  state.life[playerId] = value;
  if (ctx.life) ctx.life[playerId] = value;
}

function readLife(ctx: GameContext, playerId: string): number {
  const starting = Number((ctx.state as any).startingLife ?? 40);
  return Number((ctx.state as any).life?.[playerId] ?? ctx.life?.[playerId] ?? starting);
}

function writePlayerResource(ctx: GameContext, playerId: string, kind: 'poison' | 'energy' | 'experience', next: number): void {
  const state = ctx.state as any;
  const value = Math.max(0, Math.floor(next));
  if (kind === 'poison') {
    ctx.poison = ctx.poison || {};
    ctx.poison[playerId] = value;
    state.poison = state.poison || {};
    state.poison[playerId] = value;
    state.poisonCounters = state.poisonCounters || {};
    state.poisonCounters[playerId] = value;
    const player = (state.players || []).find((p: any) => p?.id === playerId);
    if (player) player.poisonCounters = value;
    return;
  }
  if (kind === 'energy') {
    if (value >= Number(state.energy?.[playerId] || 0)) {
      addEnergyCounters(state, playerId, value - Number(state.energy?.[playerId] || 0), 'manual');
    } else {
      state.energy = state.energy || {};
      state.energy[playerId] = value;
      state.energyCount = state.energyCount || {};
      state.energyCount[playerId] = value;
    }
    return;
  }
  ctx.experience = ctx.experience || {};
  ctx.experience[playerId] = value;
  state.experience = state.experience || {};
  state.experience[playerId] = value;
}

export function applyManualStateVerb(
  ctx: GameContext,
  payload: ManualActionPayload,
): ManualActionResult | null {
  const playerId = String(payload.targetPlayerId || payload.actorId || '').trim();
  const amount = Math.floor(Number(payload.amount ?? 0));

  switch (payload.verb) {
    case 'gain_lose_life': {
      const current = readLife(ctx, playerId);
      const next = current + amount;
      writeLife(ctx, playerId, next);
      return { ok: true, summary: `${amount >= 0 ? 'gained' : 'lost'} ${Math.abs(amount)} life (${current} → ${next})` };
    }
    case 'set_life': {
      const current = readLife(ctx, playerId);
      writeLife(ctx, playerId, amount);
      return { ok: true, summary: `set life to ${amount} (was ${current})` };
    }
    case 'deal_damage': {
      const ids = Array.isArray(payload.objectIds) ? payload.objectIds : [];
      if (ids.length > 0) {
        const hit: string[] = [];
        const died: string[] = [];
        for (const id of ids) {
          const found = findManualObject(ctx, id);
          if (!found?.permanent) continue;
          const perm = found.permanent;
          const name = String(perm.card?.name || id);
          const types = typeLineOf(perm);
          if (types.includes('planeswalker')) {
            const current = planeswalkerLoyalty(perm);
            const next = Math.max(0, current - amount);
            perm.loyalty = next;
            perm.counters = perm.counters || {};
            perm.counters.loyalty = next;
            hit.push(`${name} (${current} → ${next} loyalty)`);
            if (next <= 0) {
              relocateManualObject(ctx, found.objectId, 'graveyard', payload);
              died.push(name);
            }
            continue;
          }
          const current = Number(perm.damageMarked || perm.markedDamage || perm.damage || 0);
          const next = Math.max(0, current + amount);
          perm.damageMarked = next;
          perm.markedDamage = next;
          perm.damage = next;
          hit.push(`${name} (${next} marked)`);
          const toughness = creatureToughness(perm);
          const lethal = types.includes('creature')
            && toughness !== null
            && amount > 0
            && next >= toughness
            && !isIndestructiblePermanent(perm);
          if (lethal) {
            relocateManualObject(ctx, found.objectId, 'graveyard', payload);
            died.push(name);
          }
        }
        if (hit.length === 0) return { ok: false, error: 'No permanents found.', summary: 'nothing damaged' };
        const deathNote = died.length > 0 ? `; ${died.join(', ')} died (lethal)` : '';
        return { ok: true, summary: `dealt ${amount} damage to ${hit.join(', ')}${deathNote}` };
      }
      const current = readLife(ctx, playerId);
      const next = current - Math.max(0, amount);
      writeLife(ctx, playerId, next);
      return { ok: true, summary: `dealt ${amount} damage to player (${current} → ${next})` };
    }
    case 'add_mana': {
      const color = payload.manaColor || 'colorless';
      const state = ctx.state as any;
      state.manaPool = state.manaPool || {};
      state.manaPool[playerId] = state.manaPool[playerId] || {
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0,
      };
      const pool = state.manaPool[playerId];
      pool[color] = Number(pool[color] || 0) + Math.max(0, amount || 1);
      return { ok: true, summary: `added ${Math.max(0, amount || 1)} ${color} mana` };
    }
    case 'poison':
    case 'energy':
    case 'experience': {
      const kind = payload.verb;
      const state = ctx.state as any;
      const current = kind === 'poison'
        ? Number(state.poisonCounters?.[playerId] ?? ctx.poison?.[playerId] ?? 0)
        : kind === 'energy'
          ? Number(state.energy?.[playerId] ?? 0)
          : Number(state.experience?.[playerId] ?? ctx.experience?.[playerId] ?? 0);
      writePlayerResource(ctx, playerId, kind, current + amount);
      return { ok: true, summary: `${amount >= 0 ? 'added' : 'removed'} ${Math.abs(amount)} ${kind} (${current} → ${current + amount})` };
    }
    case 'become_monarch': {
      (ctx.state as any).monarch = playerId;
      return { ok: true, summary: `${playerId} became the monarch` };
    }
    case 'proliferate': {
      const ids = Array.isArray(payload.objectIds) ? payload.objectIds : [];
      const changed: string[] = [];
      for (const id of ids) {
        const found = findManualObject(ctx, id);
        if (!found?.permanent?.counters) continue;
        const deltas: Record<string, number> = {};
        for (const [key, value] of Object.entries(found.permanent.counters)) {
          if (Number(value) > 0) deltas[canonicalizeCounterKey(key)] = 1;
        }
        if (Object.keys(deltas).length === 0) continue;
        updateCounters(ctx, String(found.permanent.id), deltas, {
          skipEventPersistence: true,
          skipCounterPlacedTriggers: true,
          skipCounterModifications: true,
        });
        changed.push(String(found.permanent.card?.name || id));
      }
      if (playerId) {
        const state = ctx.state as any;
        if (Number(state.poisonCounters?.[playerId] || ctx.poison?.[playerId] || 0) > 0) {
          writePlayerResource(ctx, playerId, 'poison', Number(state.poisonCounters?.[playerId] || ctx.poison?.[playerId] || 0) + 1);
          changed.push(`${playerId} poison`);
        }
        if (Number(state.energy?.[playerId] || 0) > 0) {
          writePlayerResource(ctx, playerId, 'energy', Number(state.energy[playerId] || 0) + 1);
          changed.push(`${playerId} energy`);
        }
        if (Number(state.experience?.[playerId] || ctx.experience?.[playerId] || 0) > 0) {
          writePlayerResource(ctx, playerId, 'experience', Number(state.experience?.[playerId] || ctx.experience?.[playerId] || 0) + 1);
          changed.push(`${playerId} experience`);
        }
      }
      return { ok: true, summary: `proliferated ${changed.join(', ') || 'nothing'}` };
    }
    case 'extra_turn': {
      addExtraTurn(ctx, playerId, 'Manual mode');
      return { ok: true, summary: `extra turn for ${playerId}` };
    }
    case 'win_lose': {
      const outcome = payload.outcome === 'win' ? 'win' : 'lose';
      const players = Array.isArray(ctx.state.players) ? ctx.state.players : [];
      const target = players.find((p: any) => p?.id === playerId) as any;
      if (outcome === 'lose') {
        if (target) {
          target.hasLost = true;
          target.eliminated = true;
          target.lossReason = 'Manual mode';
        }
        return { ok: true, summary: `${playerId} loses the game` };
      }
      (ctx.state as any).gameOver = true;
      (ctx.state as any).winner = playerId;
      if (target) {
        target.hasWon = true;
      }
      return { ok: true, summary: `${playerId} wins the game` };
    }
    default:
      return null;
  }
}
