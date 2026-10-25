// Batch 19: per-draw replacements (CR 614.11) the draw templates miss.
//  - Possessed Portal: "if a player would draw a card, that player skips that draw instead".
//  - Uba Mask: "if a player would draw a card, that player exiles that card face up instead" (top card -> exile,
//    stamped ubaMaskExiledTurn / exiledWithSourceId so a play-permission layer can find it).
//  - Forbidden Crypt: "if you would draw a card, return a card from your graveyard to your hand instead. if you
//    can't, you lose the game" (returns the most recently added graveyard card; no choice prompt yet).
//  - Notion Thief: "if an opponent would draw a card except the first one they draw in each of their draw steps,
//    instead that player skips that draw and you draw a card".
// Called per draw from drawCards after the Batch 18 hook; returns true when the draw was replaced.
// Each replacement is recorded on state.batch18DrawReplacements (the existing client toast feed).
// Public entry symbols: applyBatch19DrawInstead, batch19DrawSources.

import type { GameContext } from '../context.js';
import type { KnownCardRef, PlayerID } from '../../../../shared/src/index.js';
import { hasCantLoseEffect } from './game-state-effects-handlers/gameStateEffectsWinLose.js';
import { markPlayerOutOfPriority } from './priorityEligibility.js';
import { removeLeavingPlayerGameObjects } from './playerLeavingGame.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';

export type B19DrawKind = 'skip' | 'exile_face_up' | 'return_from_graveyard' | 'opponent_redirect';
export interface B19DrawSource { kind: B19DrawKind; sourceId: string; controller: string; sourceName: string }

const PATTERNS: Array<[RegExp, B19DrawKind]> = [
  [/if a player would draw a card, that player skips that draw instead/, 'skip'],
  [/if a player would draw a card, that player exiles that card face up instead/, 'exile_face_up'],
  [/if you would draw a card, return a card from your graveyard to your hand instead/, 'return_from_graveyard'],
  [/if an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card/, 'opponent_redirect'],
];

export function batch19DrawSources(state: GameContext['state'] | undefined): B19DrawSource[] {
  const out: B19DrawSource[] = [];
  for (const p of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!p?.card || p.phasedOut === true) continue;
    const oracle = String(p.card.oracle_text || '').toLowerCase().replace(/\s+/g, ' ');
    for (const [re, kind] of PATTERNS) {
      if (re.test(oracle)) out.push({ kind, sourceId: String(p.id || ''), controller: String(p.controller || ''), sourceName: String(p.card.name || 'Unknown') });
    }
  }
  return out;
}

function record(ctx: GameContext, playerId: string, src: B19DrawSource, effect: string): void {
  const st = ctx.state;
  st.batch18DrawReplacements = Array.isArray(st.batch18DrawReplacements) ? st.batch18DrawReplacements : [];
  st.batch18DrawReplacements.push({ playerId, sourceName: src.sourceName, effect, timestamp: Date.now() });
}

function libraryOf(ctx: GameContext, pid: string): KnownCardRef[] {
  const mapLib = ctx.libraries.get(pid as PlayerID);
  if (Array.isArray(mapLib) && mapLib.length > 0) return mapLib;
  const zone = ctx.state.zones?.[pid];
  const zoneLib: unknown = zone ? Reflect.get(zone, 'library') : undefined;
  return Array.isArray(zoneLib) ? zoneLib : (Array.isArray(mapLib) ? mapLib : []);
}

function syncLibrary(ctx: GameContext, pid: string, lib: KnownCardRef[]): void {
  ctx.libraries.set(pid as PlayerID, lib);
  const zone = ctx.state.zones?.[pid];
  if (zone) { Reflect.set(zone, 'library', lib); zone.libraryCount = lib.length; }
}

function exileTop(ctx: GameContext, pid: string, src: B19DrawSource): boolean {
  const lib = libraryOf(ctx, pid);
  const card = lib.shift();
  syncLibrary(ctx, pid, lib);
  if (!card) return false;
  const zone = ctx.state.zones?.[pid];
  if (!zone) return false;
  const exile: unknown[] = Array.isArray(zone.exile) ? zone.exile : [];
  const turn = Number(ctx.state.turnNumber ?? ctx.state.turn ?? 0);
  // Batch 20: "each player may play lands and cast spells from among cards they exiled with this artifact this turn"
  // uses the generic playable-from-exile fields (canBePlayedBy + playableUntilTurn, gated on the Mask staying in play).
  exile.push({
    ...card, zone: 'exile', faceUp: true, exiledWithSourceId: src.sourceId, ubaMaskExiledTurn: turn,
    canBePlayedBy: pid, playableUntilTurn: turn, playFromExileRequiresSourcePermanentId: src.sourceId, exiledBy: pid,
  });
  Reflect.set(zone, 'exile', exile);
  zone.exileCount = exile.length;
  return true;
}

type GyResult = 'returned' | 'queued' | 'lost' | 'none';

function gyCardId(card: unknown): string {
  return card && typeof card === 'object' ? String(Reflect.get(card, 'id') ?? '') : '';
}

/** Open Forbidden Crypt choices for this player (each will take one graveyard card when answered). */
function pendingCryptChoices(gameId: string, pid: string): number {
  if (!gameId) return 0;
  return ResolutionQueueManager.getStepsForPlayer(gameId, pid)
    .filter((step) => Reflect.get(step, 'forbiddenCryptDrawReplacement') === true).length;
}

function loseForCrypt(ctx: GameContext, pid: string, src: B19DrawSource): GyResult {
  if (hasCantLoseEffect(ctx, pid).cantLose) return 'none';
  const player = (ctx.state.players || []).find((p) => String(p?.id || '') === pid);
  if (!player || player.hasLost) return 'none';
  player.hasLost = true;
  player.lostReason = `Could not return a card from the graveyard (${src.sourceName})`;
  Reflect.set(player, 'lossReason', player.lostReason);
  markPlayerOutOfPriority(ctx, pid);
  removeLeavingPlayerGameObjects(ctx.state, pid, { gameId: String(ctx.gameId || '') });
  return 'lost';
}

/**
 * Forbidden Crypt: one graveyard card -> hand directly; several -> the player chooses through a mandatory
 * GRAVEYARD_SELECTION step (destination hand). Each still-open Crypt choice counts as one card already used,
 * so N replaced draws need N graveyard cards or the player loses.
 */
function returnFromGraveyard(ctx: GameContext, pid: string, src: B19DrawSource): GyResult {
  const zone = ctx.state.zones?.[pid];
  const gy: unknown[] = Array.isArray(zone?.graveyard) ? zone.graveyard : [];
  const gameId = String(ctx.gameId || '');
  const pending = pendingCryptChoices(gameId, pid);
  if (!zone || gy.length - pending <= 0) return loseForCrypt(ctx, pid, src);
  if ((gy.length === 1 && pending === 0) || !gameId) {
    const card = gy[gy.length - 1];
    gy.splice(gy.indexOf(card), 1);
    const hand: unknown[] = Array.isArray(zone.hand) ? zone.hand : [];
    hand.push(card && typeof card === 'object' ? { ...card, zone: 'hand' } : card);
    Reflect.set(zone, 'hand', hand);
    zone.handCount = hand.length;
    zone.graveyardCount = gy.length;
    return 'returned';
  }
  const validTargets = gy.map((c) => ({
    id: gyCardId(c),
    name: String((c && typeof c === 'object' ? Reflect.get(c, 'name') : '') || 'Card'),
    type_line: String((c && typeof c === 'object' ? Reflect.get(c, 'type_line') : '') || ''),
    zone: 'graveyard',
    zoneOwnerId: pid,
    controller: pid,
  }));
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.GRAVEYARD_SELECTION,
    playerId: pid,
    sourceId: src.sourceId,
    sourceName: src.sourceName,
    title: src.sourceName,
    description: `${src.sourceName}: return a card from your graveyard to your hand instead of drawing`,
    mandatory: true,
    validTargets,
    minTargets: 1,
    maxTargets: 1,
    targetPlayerId: pid,
    destination: 'hand',
    forbiddenCryptDrawReplacement: true,
  });
  return 'queued';
}

/**
 * Batch 20: count draws (including replaced ones) each player makes in the current turn's draw step, so Notion
 * Thief exempts exactly the first one drawn in the draw step (not the first draw of the turn).
 */
function bumpDrawStepDraw(ctx: GameContext, pid: string): number {
  const turn = Number(ctx.state.turnNumber ?? ctx.state.turn ?? 0);
  const raw: unknown = Reflect.get(ctx.state, 'batch20DrawStepDraws');
  const prevTurn = raw && typeof raw === 'object' ? Number(Reflect.get(raw, 'turn')) : NaN;
  const prevCounts: unknown = raw && typeof raw === 'object' ? Reflect.get(raw, 'counts') : undefined;
  const counts: Record<string, number> = {};
  if (prevTurn === turn && prevCounts && typeof prevCounts === 'object') {
    for (const [k, v] of Object.entries(prevCounts)) counts[k] = Number(v) || 0;
  }
  counts[pid] = (counts[pid] || 0) + 1;
  Reflect.set(ctx.state, 'batch20DrawStepDraws', { turn, counts });
  return counts[pid];
}

/**
 * Apply the first matching Batch 19 draw replacement for this draw. `drawNumber` is the draw's number this turn
 * (1 = first); `drawOne(pid)` draws a plain card for the Notion Thief controller.
 */
export function applyBatch19DrawInstead(
  ctx: GameContext,
  playerId: string,
  info: { drawNumber: number; isDrawStep: boolean },
  drawOne: (pid: string) => boolean,
): boolean {
  const drawStepIndex = info.isDrawStep ? bumpDrawStepDraw(ctx, playerId) : 0;
  const sources = batch19DrawSources(ctx.state);
  if (sources.length === 0) return false;
  for (const src of sources) {
    switch (src.kind) {
      case 'skip':
        record(ctx, playerId, src, 'skipped that draw');
        return true;
      case 'exile_face_up':
        exileTop(ctx, playerId, src);
        record(ctx, playerId, src, 'exiled the top card face up instead of drawing');
        return true;
      case 'return_from_graveyard': {
        if (playerId !== src.controller) break;
        const r = returnFromGraveyard(ctx, playerId, src);
        if (r === 'none') break;
        record(ctx, playerId, src, r === 'returned' ? 'returned a card from graveyard to hand instead of drawing' : r === 'queued' ? 'is choosing a card to return from graveyard instead of drawing' : 'lost the game (no card to return)');
        return true;
      }
      case 'opponent_redirect': {
        if (!src.controller || playerId === src.controller) break;
        const isActive = String(ctx.state.turnPlayer || '') === playerId;
        if (info.isDrawStep && isActive && drawStepIndex === 1) break;
        record(ctx, playerId, src, `skipped that draw; ${src.controller} draws instead`);
        drawOne(src.controller);
        return true;
      }
    }
  }
  return false;
}