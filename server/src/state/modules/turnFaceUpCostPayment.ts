/**
 * Batch 14: plan and apply the non-mana parts of a turn-face-up cost.
 * planTurnFaceUpNonManaCost only checks (and asks for choices); applyTurnFaceUpCostEffects
 * moves cards / pays life and is shared by the live socket handler and event replay.
 */
import type { GameContext } from '../context.js';
import { debugWarn } from '../../utils/debug.js';
import { candidatesForComponent, describeTurnFaceUpCostComponents, type TurnFaceUpChoiceComponent, type TurnFaceUpCostComponent } from './turnFaceUpCostComponents.js';
import { movePermanentToHand } from './zones.js';
import { movePermanentToGraveyard } from './counters_tokens.js';

export interface TurnFaceUpCostChoices {
  reveal?: string;
  return?: string[];
  sacrifice?: string[];
  discard?: string[];
}

export interface TurnFaceUpCostEffects {
  lifePaid?: number;
  revealedCardIds?: string[];
  returnedPermanentIds?: string[];
  sacrificedPermanentIds?: string[];
  discardedCardIds?: string[];
}

export interface TurnFaceUpCostPrompt {
  component: TurnFaceUpChoiceComponent;
  description: string;
  count: number;
  candidateIds: string[];
  colorWord?: string;
}

export interface TurnFaceUpPlan {
  ok: boolean;
  code?: string;
  error?: string;
  prompt?: TurnFaceUpCostPrompt;
  effects?: TurnFaceUpCostEffects;
  revealedCards?: any[];
}

function asIdList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string' && v) return [v];
  return [];
}

export function planTurnFaceUpNonManaCost(
  state: any,
  playerId: string,
  permanentId: string,
  components: TurnFaceUpCostComponent[],
  choicesIn?: TurnFaceUpCostChoices,
): TurnFaceUpPlan {
  const choices = choicesIn || {};
  const effects: TurnFaceUpCostEffects = {};
  const revealedCards: any[] = [];
  for (const comp of components) {
    if (comp.type === 'mana') continue;
    if (comp.type === 'life') {
      const current = Number(state?.life?.[playerId] ?? state?.startingLife ?? 40);
      if (current < comp.amount) return { ok: false, code: 'CANNOT_PAY_LIFE', error: `You can't pay ${comp.amount} life.` };
      effects.lifePaid = (effects.lifePaid || 0) + comp.amount;
      continue;
    }
    const candidates = candidatesForComponent(state, playerId, comp, permanentId);
    const count = comp.type === 'reveal' ? 1 : comp.count;
    const label = describeTurnFaceUpCostComponents([comp]);
    if (candidates.length < count) {
      const code = comp.type === 'reveal' ? 'NO_REVEAL_CARD' : 'CANNOT_PAY_TURN_FACE_UP';
      return { ok: false, code, error: `You can't pay "${label}".` };
    }
    const chosen = asIdList((choices as any)[comp.type]);
    if (chosen.length === 0) {
      return {
        ok: false,
        code: comp.type === 'reveal' ? 'NEEDS_REVEAL' : 'NEEDS_COST_CHOICE',
        prompt: {
          component: comp.type,
          description: label,
          count,
          candidateIds: candidates.map((c: any) => String(c.id)),
          ...(comp.type === 'reveal' ? { colorWord: comp.colorWord } : {}),
        },
      };
    }
    const ids = new Set(candidates.map((c: any) => String(c.id)));
    const unique = Array.from(new Set(chosen));
    if (unique.length !== count || unique.some((id) => !ids.has(id))) {
      return {
        ok: false,
        code: comp.type === 'reveal' ? 'BAD_REVEAL_CARD' : 'BAD_COST_CHOICE',
        error: `Choose ${count} for "${label}".`,
      };
    }
    if (comp.type === 'reveal') {
      effects.revealedCardIds = unique;
      revealedCards.push(...candidates.filter((c: any) => unique.includes(String(c.id))));
    } else if (comp.type === 'return') effects.returnedPermanentIds = unique;
    else if (comp.type === 'sacrifice') effects.sacrificedPermanentIds = unique;
    else if (comp.type === 'discard') effects.discardedCardIds = unique;
  }
  return { ok: true, effects, revealedCards };
}

function payLife(state: any, playerId: string, amount: number): void {
  state.life = state.life || {};
  const current = Number(state.life[playerId] ?? state.startingLife ?? 40);
  state.life[playerId] = current - amount;
  const player = (state.players || []).find((p: any) => String(p?.id) === String(playerId));
  if (player && typeof player.life === 'number') player.life = state.life[playerId];
  state.lifeLostThisTurn = state.lifeLostThisTurn || {};
  state.lifeLostThisTurn[playerId] = (state.lifeLostThisTurn[playerId] || 0) + amount;
}

function discardFromHand(state: any, playerId: string, cardId: string): void {
  const zones = state.zones = state.zones || {};
  const z = zones[playerId];
  if (!z || !Array.isArray(z.hand)) return;
  const idx = z.hand.findIndex((c: any) => c && String(c.id) === cardId);
  if (idx < 0) return;
  const [card] = z.hand.splice(idx, 1);
  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
  z.graveyard.push({ ...card, zone: 'graveyard' });
  z.handCount = z.hand.length;
  z.graveyardCount = z.graveyard.length;
}

/** Apply paid cost effects. On replay, sacrifices don't re-queue death triggers (those are persisted separately). */
export function applyTurnFaceUpCostEffects(
  ctx: GameContext,
  playerId: string,
  effects: TurnFaceUpCostEffects | undefined,
  opts?: { replay?: boolean },
): void {
  if (!effects) return;
  const state: any = ctx.state;
  try {
    if (effects.lifePaid && effects.lifePaid > 0) payLife(state, playerId, effects.lifePaid);
    for (const id of effects.returnedPermanentIds || []) movePermanentToHand(ctx as any, id);
    for (const id of effects.sacrificedPermanentIds || []) movePermanentToGraveyard(ctx as any, id, opts?.replay !== true);
    for (const id of effects.discardedCardIds || []) discardFromHand(state, playerId, id);
  } catch (err) {
    debugWarn(1, '[turnFaceUp] applying cost effects failed:', err);
  }
}