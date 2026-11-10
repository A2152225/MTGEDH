// server/src/state/modules/staticEffectSpecPhase5StateEval.ts
// Phase 5 (round 3): state-backed static conditions ("this turn" tracking, delirium, top-card colour,
// equipped-creature tapped state, exactly-N-named, Solved, face-down). Kept apart from
// staticEffectSpecConditionEval.ts / staticEffectSpecPhase5Eval.ts for size.
// Public entry symbols: evalPhase5StateCondition.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { getLibraryTopCardFromState } from './game-state-effects-handlers/gameStateEffectsTopLibrary.js';
import { evalCountersPutThisTurnCondition } from './countersPutThisTurnCondition.js';

type Cond = { kind?: string; count?: number; amount?: number; creatureType?: string; color?: string; option?: string; counterType?: string };
const CARD_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery', 'tribal'];
const COLOR_SYMBOL: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

const typeLineOf = (obj: any): string => String(obj?.card?.type_line || obj?.type_line || obj?.typeLine || '').toLowerCase();
const controlledBy = (battlefield: readonly BattlefieldPermanent[], controller: string) =>
  battlefield.filter((perm) => String(perm.controller || '') === controller);

function graveyardCardTypes(state: any, controller: string): number {
  const graveyard = state?.zones?.[controller]?.graveyard;
  const seen = new Set<string>();
  for (const card of Array.isArray(graveyard) ? graveyard : []) {
    const line = typeLineOf(card);
    for (const type of CARD_TYPES) if (new RegExp(`\\b${type}\\b`).test(line)) seen.add(type === 'tribal' ? 'kindred' : type);
  }
  return seen.size;
}

/** Distinct mana values among cards in controller's graveyard (Syndicate Infiltrator). */
function graveyardManaValues(state: any, controller: string): number {
  const graveyard = state?.zones?.[controller]?.graveyard;
  const seen = new Set<number>();
  for (const card of Array.isArray(graveyard) ? graveyard : []) {
    const c = (card as any)?.card || card;
    const mv = Number(c?.cmc ?? c?.mana_value ?? c?.manaValue);
    if (Number.isFinite(mv)) seen.add(mv);
  }
  return seen.size;
}

function cardHasColor(card: any, color: string): boolean {
  const symbol = COLOR_SYMBOL[color];
  const colors: string[] = Array.isArray(card?.colors) ? card.colors : [];
  if (colors.map((c) => String(c).toUpperCase()).includes(symbol)) return true;
  if (colors.length > 0) return false;
  return new RegExp(`\\{[^}]*${symbol}[^}]*\\}`, 'i').test(String(card?.mana_cost || ''));
}

/** Undefined = not a kind this module owns (caller treats as not granting). */
export function evalPhase5StateCondition(
  condition: Cond,
  permanent: BattlefieldPermanent,
  source: any,
  controller: string,
  battlefield: readonly BattlefieldPermanent[],
  state: any,
): boolean | undefined {
  const count = Number(condition.count || 0);
  switch (condition.kind) {
    case 'controller_gained_life_this_turn':
      return Number(state?.lifeGainedThisTurn?.[controller] || 0) > 0;
    case 'controller_lost_life_this_turn':
      return Number(state?.lifeLostThisTurn?.[controller] || 0) > 0;
    case 'controller_completed_dungeon': {
      const st: any = state || {};
      if (st.completedDungeonThisTurn?.[controller] || st.completedDungeon?.[controller] || st.dungeonCompleted?.[controller]) return true;
      const n = Number(st.completedDungeons?.[controller] || 0);
      if (n > 0) return true;
      const names = st.completedDungeonNames?.[controller] ?? st.completedDungeonNameList?.[controller];
      return Array.isArray(names) && names.length > 0;
    }
    case 'controller_creature_type_entered_this_turn': {
      const type = String((condition as any).creatureType || '').toLowerCase();
      const excludeSelf = (condition as any).other === true;
      const selfId = String(permanent?.id || '');
      return controlledBy(battlefield, controller).some((perm) => {
        if (excludeSelf && String(perm.id || '') === selfId) return false;
        if ((perm as any).enteredThisTurn !== true) return false;
        return type ? new RegExp('\\b' + type + 's?\\b').test(typeLineOf(perm)) : /\\bcreature\\b/.test(typeLineOf(perm));
      });
    }
    case 'controller_attacked_with_at_least': {
      const type = String(condition.creatureType || '').toLowerCase();
      return controlledBy(battlefield, controller).filter((perm) => (perm as any).attackedThisTurn === true
        && new RegExp(`\\b${type}s?\\b`).test(typeLineOf(perm))).length >= count;
    }
    case 'controller_nonland_entered_at_least':
      return controlledBy(battlefield, controller).filter((perm) => (perm as any).enteredThisTurn === true
        && !/\bland\b/.test(typeLineOf(perm))).length >= count;
    case 'controller_graveyard_card_types_at_least':
      return graveyardCardTypes(state, controller) >= count;
    case 'controller_graveyard_mana_values_at_least':
      return graveyardManaValues(state, controller) >= count;
    case 'controller_library_top_is_color': {
      const top = state ? getLibraryTopCardFromState(state, controller) : null;
      return Boolean(top) && cardHasColor(top, String(condition.color || ''));
    }
    case 'source_attached_is_tapped':
    case 'source_attached_is_untapped': {
      const hostId = String(source?.attachedTo || '');
      const host = hostId ? battlefield.find((perm) => String(perm.id || '') === hostId) : undefined;
      if (!host) return false;
      return condition.kind === 'source_attached_is_tapped' ? Boolean(host.tapped) : !host.tapped;
    }
    case 'controller_controls_named_exactly': {
      const name = String(condition.option || '').toLowerCase();
      return controlledBy(battlefield, controller).filter((perm) =>
        String((perm.card as any)?.name || '').toLowerCase() === name).length === count;
    }
    case 'controller_controls_named_at_least': {
      const name = String(condition.option || '').toLowerCase();
      const need = Number(condition.count || condition.amount || 0);
      return controlledBy(battlefield, controller).filter((perm) =>
        String((perm.card as any)?.name || '').toLowerCase() === name).length >= need;
    }
    case 'source_is_solved':
      return source?.solved === true || source?.isSolved === true;
    case 'target_is_face_down':
      return (permanent as any).faceDown === true || (permanent as any).isFaceDown === true;
    case 'target_had_counters_put_this_turn':
      return evalCountersPutThisTurnCondition(condition as any, permanent, state);
    case 'controller_land_creature_or_land_entered_this_turn': {
      const mine = controlledBy(battlefield, controller);
      if (mine.some((perm) => /\bland\b/.test(typeLineOf(perm)) && /\bcreature\b/.test(typeLineOf(perm)))) return true;
      return mine.some((perm) => (perm as any).enteredThisTurn === true && /\bland\b/.test(typeLineOf(perm)));
    }
    case 'source_controller_saga_lore_counters_at_least': {
      const mine = controlledBy(battlefield, controller);
      let lore = 0;
      for (const perm of mine) {
        if (!/\bsaga\b/.test(typeLineOf(perm))) continue;
        lore += Number((perm as any).counters?.lore || (perm as any).counters?.Lore || 0);
      }
      return lore >= count;
    }
    case 'controller_instant_or_sorcery_cast_this_turn': {
      const list: any[] = Array.isArray(state?.spellsCastThisTurn) ? state.spellsCastThisTurn : [];
      return list.some((e) => {
        if (String(e?.casterId ?? e?.playerId ?? e?.controllerId ?? e?.controller ?? '') !== controller) return false;
        const tl = String(e?.type_line || e?.card?.type_line || '').toLowerCase();
        return /\binstant\b/.test(tl) || /\bsorcery\b/.test(tl);
      });
    }
    case 'any_graveyard_at_least': {
      const zones = state?.zones || {};
      const need = Number(condition.count || condition.amount || 0);
      return Object.keys(zones).some((id) => {
        const gy = zones[id]?.graveyard;
        return Array.isArray(gy) && gy.length >= need;
      });
    }
    case 'target_lacks_counter': {
      const wanted = String(condition.counterType || condition.option || '').trim().toLowerCase();
      if (!wanted) return false;
      const counters = ((permanent as any).counters || {}) as Record<string, unknown>;
      return !Object.entries(counters).some(([k, v]) => String(k).toLowerCase() === wanted && Number(v) > 0);
    }
    case 'source_controller_dice_rolled_at_least': {
      const need = Number(condition.amount || condition.count || 0);
      if (!Number.isFinite(need) || need <= 0) return false;
      const list = (state as any)?.dieRollsThisTurn?.[controller];
      return Array.isArray(list) && list.length >= need;
    }
    case 'opponent_owns_card_in_exile': {
      const zones = state?.zones || {};
      return Object.keys(zones).some((zoneId) => {
        const exile = zones[zoneId]?.exile;
        if (!Array.isArray(exile) || exile.length === 0) return false;
        return exile.some((card: any) => {
          const owner = String(card?.owner || card?.card?.owner || zoneId || '').trim();
          return !!owner && owner !== controller;
        });
      });
    }
    case 'source_controller_controls_creature_or_land_type_any': {
      const creatureTypes = Array.isArray((condition as any).creatureTypes)
        ? (condition as any).creatureTypes.map((t: unknown) => String(t || '').toLowerCase()).filter(Boolean)
        : [String(condition.creatureType || '').toLowerCase()].filter(Boolean);
      const landTypes = Array.isArray((condition as any).landTypes)
        ? (condition as any).landTypes.map((t: unknown) => String(t || '').toLowerCase()).filter(Boolean)
        : [String((condition as any).landType || '').toLowerCase()].filter(Boolean);
      if (!controller || (creatureTypes.length === 0 && landTypes.length === 0)) return false;
      const sourceId = String((source as any)?.id || '');
      const other = (condition as any).other === true;
      return (battlefield || []).some((p: any) => {
        if (!p || p.phasedOut || String(p.controller || '') !== controller) return false;
        if (other && String(p.id || '') === sourceId) return false;
        const tl = String(p.card?.type_line || p?.type_line || '').toLowerCase();
        if (creatureTypes.length && /\bcreature\b/.test(tl)
          && creatureTypes.some((t: string) => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\b').test(tl))) {
          return true;
        }
        if (landTypes.length && /\bland\b/.test(tl)
          && landTypes.some((t: string) => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\b').test(tl))) {
          return true;
        }
        return false;
      });
    }
    case 'controller_hand_larger_than_each_opponent': {
      if (!controller) return false;
      const myZone = state?.zones?.[controller];
      const mine = typeof myZone?.handCount === 'number' && Number.isFinite(myZone.handCount)
        ? Math.max(0, Math.floor(myZone.handCount))
        : Array.isArray(myZone?.hand) ? myZone.hand.length : 0;
      const players: any[] = Array.isArray(state?.players) ? state.players : [];
      const opponents = players.filter((p: any) => {
        const id = String(p?.id || '');
        return id && id !== controller && !p?.hasLost && !p?.eliminated;
      });
      if (opponents.length === 0) return false;
      return opponents.every((p: any) => {
        const id = String(p.id || '');
        const z = state?.zones?.[id];
        const n = typeof z?.handCount === 'number' && Number.isFinite(z.handCount)
          ? Math.max(0, Math.floor(z.handCount))
          : Array.isArray(z?.hand) ? z.hand.length : 0;
        return mine > n;
      });
    }
    case 'source_controller_controls_creature_with_any_counter': {
      if (!controller) return false;
      return controlledBy(battlefield || [], controller).some((perm) => {
        if (!/\bcreature\b/.test(typeLineOf(perm))) return false;
        return Object.values((perm as any).counters || {}).some((n) => Number(n) > 0);
      });
    }
    case 'target_controller_is_enchanted_player': {
      const enchanted = String((source as any)?.enchantedPlayerId || (source as any)?.attachedTo || '').trim();
      return !!enchanted && String(permanent?.controller || '') === enchanted;
    }
    default:
      return undefined;
  }
}
