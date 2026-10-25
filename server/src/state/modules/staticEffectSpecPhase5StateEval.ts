// server/src/state/modules/staticEffectSpecPhase5StateEval.ts
// Phase 5 (round 3): state-backed static conditions ("this turn" tracking, delirium, top-card colour,
// equipped-creature tapped state, exactly-N-named, Solved, face-down). Kept apart from
// staticEffectSpecConditionEval.ts / staticEffectSpecPhase5Eval.ts for size.
// Public entry symbols: evalPhase5StateCondition.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { getLibraryTopCardFromState } from './game-state-effects-handlers/gameStateEffectsTopLibrary.js';

type Cond = { kind?: string; count?: number; creatureType?: string; color?: string; option?: string };
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
    case 'source_is_solved':
      return source?.solved === true || source?.isSolved === true;
    case 'target_is_face_down':
      return (permanent as any).faceDown === true || (permanent as any).isFaceDown === true;
    default:
      return undefined;
  }
}
