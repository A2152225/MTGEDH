// "If you would draw a card, instead reveal the top N cards of your library.
// Put all creature cards revealed this way into your hand and the rest on the
// bottom of your library in any order." One replacement per draw. The bottom
// order is a LIBRARY_SEARCH step when two or more cards are not creatures.
// Origin: replacementOrderChoice.ts draw dispatch, beside Tomorrow's look-put.
// Public: collectRevealCreaturesDrawSpecsFromState, applyRevealCreaturesDraw,
// autoApplyOrQueueRevealCreaturesDraw.

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { syncPlayerLibraryFromContext, writePlayerLibraryToContext } from './zones-handlers/zonesDrawReplacementLibrarySync.js';

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const REVEAL_RE = /if you would draw a card, instead reveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards of your library\. put all creature cards revealed this way into your hand and the rest on the bottom of your library in any order/i;

export const REVEAL_CREATURES_DRAW_EFFECT_ID = 'reveal-top-creatures-hand-rest-bottom';

function countOf(raw: string): number {
  const token = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(token)) return Number(token);
  return WORDS[token] || 0;
}

function isCreatureCard(card: any): boolean {
  return String(card?.type_line || card?.card?.type_line || '').toLowerCase().includes('creature');
}

function cardView(card: any): any {
  const face = card?.card || card;
  return {
    id: String(card?.id || face?.id || ''),
    name: face?.name,
    type_line: face?.type_line,
    oracle_text: face?.oracle_text,
    image_uris: face?.image_uris,
    mana_cost: face?.mana_cost,
    cmc: face?.cmc,
    colors: face?.colors,
  };
}

export function revealCountFromOracle(oracle: string): number {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const match = text.match(REVEAL_RE);
  return match ? countOf(match[1]) : 0;
}

export function collectRevealCreaturesDrawSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const count = revealCountFromOracle(readCardOracleText(rec.card));
    if (count <= 0) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push({
      id: `${sourcePermanentId}:reveal-creatures-draw-${count}`,
      event: 'card-draw',
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
      match: { drawingPlayerIsSourceController: true, exactDrawCount: 1 },
      instead: { choiceRequired: true },
      effectId: REVEAL_CREATURES_DRAW_EFFECT_ID,
      reason: 'controller_draw_reveal_creatures_rest_bottom',
      metadata: { lookAtLibraryTop: count, revealCreaturesToHand: true },
    } as ReplacementEffectSpec);
  }
  return specs;
}

export function applyRevealCreaturesDraw(
  ctx: GameContext,
  playerId: string,
  lookCount: number,
  bottomOrder?: string[],
): { handIds: string[]; bottomIds: string[] } {
  const lib = syncPlayerLibraryFromContext(ctx, playerId);
  const n = Math.min(Math.max(0, Math.floor(lookCount)), lib.length);
  const revealed = lib.splice(0, n);
  const creatures = revealed.filter((card) => isCreatureCard(card));
  const rest = revealed.filter((card) => !isCreatureCard(card));
  const order = Array.isArray(bottomOrder) ? bottomOrder.map((id) => String(id)) : [];
  if (order.length > 0) {
    const byId = new Map(rest.map((card) => [String(card?.id || card?.card?.id || ''), card]));
    const ordered = order.map((id) => byId.get(id)).filter(Boolean);
    const used = new Set(ordered.map((card: any) => String(card?.id || '')));
    for (const card of rest) {
      if (!used.has(String(card?.id || ''))) ordered.push(card);
    }
    rest.splice(0, rest.length, ...ordered);
  }
  const state: any = (ctx as any).state;
  state.zones = state.zones || {};
  state.zones[playerId] = state.zones[playerId] || {};
  const hand = Array.isArray(state.zones[playerId].hand) ? state.zones[playerId].hand : [];
  hand.push(...creatures);
  state.zones[playerId].hand = hand;
  state.zones[playerId].handCount = hand.length;
  lib.push(...rest);
  writePlayerLibraryToContext(ctx, playerId, lib);
  return {
    handIds: creatures.map((card) => String(card?.id || '')),
    bottomIds: rest.map((card) => String(card?.id || '')),
  };
}

export function autoApplyOrQueueRevealCreaturesDraw(
  ctx: GameContext,
  playerId: string,
  metadata: any,
  _remainingAfter: number,
): 'break' | 'continue' | 'none' {
  const lookCount = Math.max(0, Math.floor(Number(metadata?.lookAtLibraryTop || metadata?.look || 3)));
  const replayNext = String((ctx as any)._replayNextEventType || '').trim();
  if ((ctx as any).isReplaying && replayNext === 'librarySearchResolve') return 'break';
  const lib = syncPlayerLibraryFromContext(ctx, playerId);
  const revealed = lib.slice(0, Math.min(lookCount, lib.length));
  if (revealed.length === 0) return 'continue';
  const rest = revealed.filter((card) => !isCreatureCard(card));
  if ((ctx as any).isReplaying || rest.length < 2) {
    applyRevealCreaturesDraw(ctx, playerId, lookCount);
    return 'continue';
  }
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') {
    applyRevealCreaturesDraw(ctx, playerId, lookCount);
    return 'continue';
  }
  const creatures = revealed.filter((card) => isCreatureCard(card)).map(cardView);
  const others = rest.map(cardView);
  const sourceName = String(metadata?.sourceName || 'Replacement').trim() || 'Replacement';
  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: playerId as PlayerID,
    sourceId: String(metadata?.sourcePermanentId || 'reveal-creatures-draw'),
    sourceName,
    description: `${sourceName}: Reveal the top ${revealed.length}. Put all creature cards into your hand and the rest on the bottom in any order.`,
    mandatory: creatures.length > 0,
    searchCriteria: 'all creature cards',
    minSelections: creatures.length,
    maxSelections: creatures.length,
    destination: 'hand',
    reveal: true,
    shuffleAfter: false,
    remainderDestination: 'bottom',
    remainderPlayerChoosesOrder: true,
    availableCards: creatures,
    nonSelectableCards: others,
    revealCreaturesDrawReplacement: true,
    lookAtLibraryTop: lookCount,
  } as any);
  return 'break';
}
