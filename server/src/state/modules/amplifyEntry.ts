/**
 * Amplify N (CR 702.38). As the creature enters, its controller may reveal any number of cards from their
 * hand that share a creature type with it; it enters with N +1/+1 counters for each card revealed.
 * Batch 24: the reveal is a player choice (OPTION_CHOICE multi-select, flag amplifyRevealChoice) and the
 * counters go through updateCounters so counter replacements (Doubling Season etc.) apply and persist.
 * Public entry symbols: amplifyCount, listAmplifyEligibleCards, queueAmplifyRevealChoice, applyAmplifyReveal.
 */
import type { GameContext } from '../context.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { updateCounters } from './counters_tokens.js';
import { persistBattlefieldPermanentPatchAfterMutation } from '../effects/battlefieldPermanentReplayPersistence.js';

function rec(obj: unknown): Record<string, unknown> | null {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function amplifyCount(oracle: string): number {
  const m = oracle.toLowerCase().match(/(?:^|\n)amplify (\d+)\b/);
  return m ? Number(m[1]) : 0;
}

function subtypesOf(card: unknown): string[] {
  const tl = str(rec(card)?.type_line).toLowerCase();
  const parts = tl.split(/\s+(?:\u2014|-)\s+/);
  return parts.length > 1 ? parts[1].split(/\s+/).filter(Boolean) : [];
}

function isChangeling(card: unknown): boolean {
  return /\bchangeling\b/i.test(str(rec(card)?.oracle_text));
}

function sharesCreatureType(a: unknown, b: unknown): boolean {
  if (!/creature|kindred|tribal/i.test(str(rec(b)?.type_line))) return false;
  if (isChangeling(a) || isChangeling(b)) return true;
  const types = new Set(subtypesOf(a));
  return subtypesOf(b).some(t => types.has(t));
}

export interface AmplifyEligibleCard { id: string; name: string }

/** Cards in the controller's hand that may be revealed for the permanent's amplify. */
export function listAmplifyEligibleCards(state: unknown, permanent: unknown, controllerId: string): AmplifyEligibleCard[] {
  const card = rec(permanent)?.card;
  if (amplifyCount(str(rec(card)?.oracle_text)) <= 0) return [];
  const hand = rec(rec(rec(state)?.zones)?.[controllerId])?.hand;
  if (!Array.isArray(hand)) return [];
  const cardId = str(rec(card)?.id);
  return (hand as unknown[])
    .filter(c => str(rec(c)?.id) && str(rec(c)?.id) !== cardId && sharesCreatureType(card, c))
    .map(c => ({ id: str(rec(c)?.id), name: str(rec(c)?.name) || 'Card' }));
}

function findPermanent(state: unknown, permanentId: string): Record<string, unknown> | null {
  const bf = rec(state)?.battlefield;
  if (!Array.isArray(bf)) return null;
  return rec((bf as unknown[]).find(p => str(rec(p)?.id) === permanentId));
}

/**
 * Applies the chosen reveal: validates the ids against the eligible cards, records amplifyRevealed and adds
 * N +1/+1 counters per card through updateCounters. Returns the number of cards revealed.
 */
export function applyAmplifyReveal(ctx: GameContext, permanentId: string, controllerId: string, cardIds: readonly string[]): number {
  const perm = findPermanent(ctx.state, permanentId);
  if (!perm) return 0;
  const n = amplifyCount(str(rec(perm.card)?.oracle_text));
  if (n <= 0) return 0;
  const eligible = listAmplifyEligibleCards(ctx.state, perm, controllerId);
  const wanted = new Set(cardIds.map(id => String(id || '').trim()));
  const revealed = eligible.filter(c => wanted.has(c.id));
  perm.amplifyRevealed = revealed.map(c => c.name);
  try {
    persistBattlefieldPermanentPatchAfterMutation(ctx, perm, { fields: ['amplifyRevealed'] as const, sourceId: permanentId, sourceName: 'Amplify' });
  } catch {}
  if (revealed.length > 0) updateCounters(ctx, permanentId, { '+1/+1': n * revealed.length });
  return revealed.length;
}

/**
 * Queues the reveal choice for a permanent with amplify that just entered. Without a game id (unit contexts)
 * every eligible card is revealed directly. Nothing is queued on replay (the counters replay from events).
 */
export function queueAmplifyRevealChoice(
  ctx: GameContext,
  options: { controller: string; newPermanent: unknown; newPermId: string; isReplaying: boolean },
): 'queued' | 'auto' | 'none' {
  if (options.isReplaying) return 'none';
  const n = amplifyCount(str(rec(rec(options.newPermanent)?.card)?.oracle_text));
  if (n <= 0) return 'none';
  const eligible = listAmplifyEligibleCards(ctx.state, options.newPermanent, options.controller);
  if (!eligible.length) return 'none';
  const name = str(rec(rec(options.newPermanent)?.card)?.name) || 'Creature';
  const gameId = String(Reflect.get(ctx, 'gameId') || '').trim();
  if (!gameId) {
    applyAmplifyReveal(ctx, options.newPermId, options.controller, eligible.map(c => c.id));
    return 'auto';
  }
  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: options.controller,
    sourceId: options.newPermId,
    sourceName: name,
    description: `Amplify ${n}: reveal any number of cards from your hand that share a creature type with ${name}`,
    mandatory: false,
    options: eligible.map(c => ({ id: c.id, label: c.name, value: c.id })),
    minSelections: 0,
    maxSelections: eligible.length,
    amplifyRevealChoice: true,
    amplifyValue: n,
    amplifyPermanentId: options.newPermId,
  });
  return 'queued';
}