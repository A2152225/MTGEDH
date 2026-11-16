// server/src/state/modules/replacementOrderChoice.ts
// CR 616.1: when two or more optional / choice-bearing replacement effects
// would apply to the same event, the affected player chooses which applies
// first. Auto-applies when only one remains. Public:
// listChoiceBearingReplacements, queueReplacementOrderChoice,
// applyReplacementOrderChoiceOnContext, applyChoiceBearingDrawReplacements,
// applyChoiceBearingTokenReplacements, describeReplacementOrderCandidate.

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from './context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';
import {
  collectReplacementEffectSpecsFromState,
  collectGraveyardDredgeDrawOptions,
  evaluateReplacementEffectSpec,
} from './replacementEffectSpec.js';
import { matchesDrawSpec, matchesTokenSpec } from './replacementEffectSpecEventMatchers.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { autoApplyOrQueueTomorrowDrawReplacement } from './zones-handlers/zonesDrawReplacementTomorrowQueue.js';
import { autoApplyOrQueueRevealCreaturesDraw, REVEAL_CREATURES_DRAW_EFFECT_ID } from './revealCreaturesDrawReplacement.js';
import { autoQueueArchmageAscensionSearchReplacement } from './zones-handlers/zonesDrawReplacementArchmageQueue.js';
import { queueZursWeirdingDrawReplacementStep } from './zones-handlers/zonesDrawReplacementZursQueue.js';
import { queueDredgeDrawReplacementStep } from './zones-handlers/zonesDrawReplacementDredgeQueue.js';
import { queueSkipDrawReplacementStep } from './zones-handlers/zonesDrawReplacementSkipDrawQueue.js';
import { queuePursuitDrawReplacementStep } from './zones-handlers/zonesDrawReplacementPursuitQueue.js';
import { applyOrQueueOpponentLibraryDrawReplacement } from './zones-handlers/zonesDrawReplacementOpponentLibraryExile.js';
import { maybeQueueJinnieFayTokenChoice } from './counters_tokens-handlers/countersTokensJinnieFayQueue.js';
import { maybeQueueFirstTokensCopyEquippedChoice, listFirstTokensCopyEquippedCandidates } from './counters_tokens-handlers/countersTokensFirstTokensCopyEquippedQueue.js';
import { maybeQueueEsixFirstTokensChoice, listEsixFirstTokenSources, ESIX_FIRST_TOKENS_EFFECT_ID } from './batch101EnterCopyAndTokens.js';
import { applyChainsDrawReplacement, applySharedFateDrawReplacement, autoApplyOrQueueLookOneRestGraveyard } from './batch112Draw.js';

export type ReplacementOrderEventKind = 'card-draw' | 'token-creation';

export interface ReplacementOrderCandidate {
  id: string;
  effectId: string;
  sourceName: string;
  sourcePermanentId: string;
  sourceController: string;
  label: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface ReplacementOrderListEvent {
  type: ReplacementOrderEventKind;
  state: unknown;
  playerId?: string;
  controllerId?: string;
  count?: number;
  drawIndex?: number;
  tokenName?: string;
  tokenTypeLine?: string;
  metadata?: Record<string, unknown>;
}

const DESCRIPTIONS: Record<string, string> = {
  'controller-draw-look-top-put-one-in-hand': 'Look at the top cards of your library and put one into your hand',
  [REVEAL_CREATURES_DRAW_EFFECT_ID]: 'Reveal the top cards, put creature cards into your hand, and the rest on the bottom',
  'optional-search-instead-of-draw': 'You may search your library instead of drawing',
  'dredge-draw-replacement-choice': 'You may dredge instead of drawing',
  'zurs-weirding-draw-replacement': "A replacement that may change this draw (Zur's Weirding family)",
  'skip-draw-step-replacement': 'You may skip this draw',
  'look-one-rest-graveyard': 'Look at the top cards, put one into your hand, and the rest into your graveyard',
  'chains-draw-replacement': 'Discard a card instead of drawing. If you do, draw. If you don\'t, mill',
  'shared-fate-draw': 'Exile the top card of an opponent\'s library face down instead of drawing',
  'optional-draw-to-counter': 'You may put a study counter on this instead of drawing',
  'draw-replaced-by-exile-opponent-library': 'Exile cards from an opponent library instead of drawing',
  'optional-token-identity-choice': 'You may create those tokens as a different kind',
  'optional-copy-equipped-first-tokens-this-turn': 'You may create those tokens as copies of the equipped creature',
  'optional-esix-first-tokens-this-turn': 'You may create those tokens as copies of a creature you control other than this one',
};

export function describeReplacementOrderCandidate(effectId: string, sourceName: string): string {
  const text = DESCRIPTIONS[effectId] || 'A replacement effect that would apply to this event';
  const name = String(sourceName || 'Replacement').trim() || 'Replacement';
  return `${name}: ${text}`;
}

function consumedIds(ctx: GameContext | undefined): Set<string> {
  const raw = Array.isArray((ctx as any)?._replacementOrderConsumedIds)
    ? (ctx as any)._replacementOrderConsumedIds
    : [];
  return new Set(raw.map((id: unknown) => String(id || '').trim()).filter(Boolean));
}

function forcedId(ctx: GameContext | undefined): string {
  return String((ctx as any)?._replacementOrderForcedId || '').trim();
}

function candidateId(spec: { id?: string; effectId?: string; sourcePermanentId?: string }): string {
  return String(spec.id || `${spec.effectId || 'replacement'}:${spec.sourcePermanentId || 'src'}`).trim();
}

function isChoiceBearingSpec(spec: ReplacementEffectSpec): boolean {
  return spec?.instead?.choiceRequired === true;
}

function matchesEvent(spec: ReplacementEffectSpec, event: ReplacementOrderListEvent): boolean {
  if (spec.event !== event.type) return false;
  if (event.type === 'card-draw') {
    return matchesDrawSpec(spec as any, {
      type: 'card-draw',
      state: event.state,
      playerId: String(event.playerId || ''),
      count: Math.max(1, Math.floor(Number(event.count || 1))),
      drawIndex: event.drawIndex,
      metadata: event.metadata,
    } as any);
  }
  if (event.type === 'token-creation') {
    return matchesTokenSpec(spec as any, {
      type: 'token-creation',
      state: event.state,
      controllerId: String(event.controllerId || event.playerId || ''),
      count: Math.max(1, Math.floor(Number(event.count || 1))),
      tokenName: event.tokenName,
      tokenTypeLine: event.tokenTypeLine,
      metadata: event.metadata,
    } as any);
  }
  return false;
}

function fromSpec(spec: ReplacementEffectSpec, event: ReplacementOrderListEvent): ReplacementOrderCandidate {
  const effectId = String(spec.effectId || spec.id || '').trim();
  const sourceName = String(spec.sourceName || 'Replacement').trim() || 'Replacement';
  let metadata: Record<string, unknown> = { ...(spec.metadata || {}) };
  try {
    const ev = event.type === 'card-draw'
      ? { type: 'card-draw', state: event.state, playerId: event.playerId, count: event.count ?? 1, drawIndex: event.drawIndex, metadata: event.metadata }
      : { type: 'token-creation', state: event.state, controllerId: event.controllerId || event.playerId, count: event.count ?? 1, tokenName: event.tokenName, tokenTypeLine: event.tokenTypeLine, metadata: event.metadata };
    const evaluated = evaluateReplacementEffectSpec(spec, ev as any);
    if (evaluated?.metadata && typeof evaluated.metadata === 'object') {
      metadata = { ...metadata, ...(evaluated.metadata as any) };
    }
  } catch {
    // Listing must not fail if a single spec cannot be evaluated.
  }
  const id = candidateId(spec);
  return {
    id,
    effectId,
    sourceName,
    sourcePermanentId: String(spec.sourcePermanentId || '').trim(),
    sourceController: String(spec.sourceController || '').trim(),
    label: sourceName,
    description: describeReplacementOrderCandidate(effectId, sourceName),
    metadata,
  };
}

function collectDredgeCandidate(event: ReplacementOrderListEvent): ReplacementOrderCandidate | null {
  if (event.type !== 'card-draw') return null;
  if (event.metadata?.skipDredgeReplacement === true) return null;
  const options = collectGraveyardDredgeDrawOptions({
    type: 'card-draw',
    state: event.state,
    playerId: String(event.playerId || ''),
    count: Math.max(1, Math.floor(Number(event.count || 1))),
    metadata: event.metadata,
  } as any);
  if (!options.length) return null;
  return {
    id: 'dredge-draw-replacement-choice',
    effectId: 'dredge-draw-replacement-choice',
    sourceName: options[0]?.cardName || 'Dredge',
    sourcePermanentId: options[0]?.cardId || 'dredge',
    sourceController: String(event.playerId || ''),
    label: 'Dredge',
    description: describeReplacementOrderCandidate('dredge-draw-replacement-choice', options[0]?.cardName || 'Dredge'),
    metadata: { dredgeOptions: options, playerId: String(event.playerId || '') },
  };
}

export function listChoiceBearingReplacements(
  event: ReplacementOrderListEvent,
  ctx?: GameContext,
): ReplacementOrderCandidate[] {
  const seen = new Set<string>();
  const out: ReplacementOrderCandidate[] = [];
  const skip = consumedIds(ctx);

  const specs = collectReplacementEffectSpecsFromState(event.state) || [];
  for (const spec of specs) {
    if (!isChoiceBearingSpec(spec)) continue;
    if (!matchesEvent(spec, event)) continue;
    const candidate = fromSpec(spec, event);
    if (!candidate.effectId || skip.has(candidate.id)) continue;
    if (event.type === 'card-draw' && (ctx as any)?._suppressArchmageAscensionReplacement === true
      && candidate.effectId === 'optional-search-instead-of-draw') continue;
    if (event.type === 'card-draw' && (ctx as any)?._suppressDredgeReplacement === true
      && candidate.effectId === 'dredge-draw-replacement-choice') continue;
    if (event.type === 'card-draw' && (ctx as any)?._suppressZursWeirdingReplacement === true
      && candidate.effectId === 'zurs-weirding-draw-replacement') continue;
    if (event.type === 'card-draw' && (ctx as any)?._suppressSkipDrawReplacement === true
      && candidate.effectId === 'skip-draw-step-replacement') continue;
    if (event.type === 'card-draw' && (ctx as any)?._suppressPursuitDrawReplacement === true
      && candidate.effectId === 'optional-draw-to-counter') continue;
    if (event.type === 'token-creation' && event.metadata?.skipJinnieFayReplacement === true
      && candidate.effectId === 'optional-token-identity-choice') continue;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    out.push(candidate);
  }

  const dredge = collectDredgeCandidate(event);
  if (dredge && !skip.has(dredge.id) && !seen.has(dredge.id)
    && (ctx as any)?._suppressDredgeReplacement !== true) {
    seen.add(dredge.id);
    out.push(dredge);
  }

  if (event.type === 'token-creation' && event.metadata?.skipCopyEquippedFirstTokens !== true) {
    const controllerId = String(event.controllerId || event.playerId || '');
    const equipped = listFirstTokensCopyEquippedCandidates(event.state, controllerId);
    for (const candidate of equipped) {
      if (skip.has(candidate.id) || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      out.push(candidate);
    }
    const turn = String((event.state as any)?.turnPlayer || (event.state as any)?.activePlayer || '').trim();
    if (!turn || turn === controllerId) {
      for (const source of listEsixFirstTokenSources(event.state, controllerId)) {
        const sourceId = String(source?.id || '').trim();
        if (!sourceId) continue;
        const sourceName = String(source?.card?.name || 'Esix').trim() || 'Esix';
        const candidate = {
          id: `${ESIX_FIRST_TOKENS_EFFECT_ID}:${sourceId}`,
          effectId: ESIX_FIRST_TOKENS_EFFECT_ID,
          sourceName,
          sourcePermanentId: sourceId,
          sourceController: controllerId,
          label: sourceName,
          description: describeReplacementOrderCandidate(ESIX_FIRST_TOKENS_EFFECT_ID, sourceName),
        };
        if (skip.has(candidate.id) || seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        out.push(candidate);
      }
    }
  }

  out.sort((a, b) => {
    const byName = a.sourceName.localeCompare(b.sourceName);
    if (byName !== 0) return byName;
    const bySource = a.sourcePermanentId.localeCompare(b.sourcePermanentId);
    if (bySource !== 0) return bySource;
    return a.effectId.localeCompare(b.effectId);
  });
  return out;
}

export function queueReplacementOrderChoice(
  ctx: GameContext,
  playerId: string,
  payload: {
    eventKind: ReplacementOrderEventKind;
    candidates: ReplacementOrderCandidate[];
    remainingDrawCountAfterChoice?: number;
    tokenCreate?: any;
  },
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  if (candidates.length < 2) return false;
  const pid = String(playerId || '').trim();
  if (!pid) return false;

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: pid as PlayerID,
    description: 'Two or more replacement effects would apply to this event. Choose which applies first. (CR 616.1)',
    mandatory: true,
    sourceId: 'replacement-order',
    sourceName: 'Replacement order',
    replacementOrderChoice: true,
    replacementOrderEventKind: payload.eventKind,
    replacementOrderCandidates: candidates,
    remainingDrawCountAfterChoice: Math.max(0, Math.floor(Number(payload.remainingDrawCountAfterChoice || 0))),
    replacementOrderTokenCreate: payload.tokenCreate || undefined,
    options: candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.description,
    })),
  } as any);
  return true;
}

function selectCandidates(
  all: ReplacementOrderCandidate[],
  ctx: GameContext | undefined,
): { mode: 'none' | 'one' | 'order'; selected: ReplacementOrderCandidate[] } {
  if (!all.length) return { mode: 'none', selected: [] };
  const forced = forcedId(ctx);
  if (forced) {
    const match = all.filter((c) => c.id === forced);
    return match.length ? { mode: 'one', selected: match } : { mode: 'none', selected: [] };
  }
  if (all.length >= 2) return { mode: 'order', selected: all };
  return { mode: 'one', selected: all };
}

function clearForced(ctx: GameContext): void {
  delete (ctx as any)._replacementOrderForcedId;
}

export function markReplacementOrderConsumed(ctx: GameContext, id: string): void {
  const key = String(id || '').trim();
  if (!key) return;
  const current = Array.isArray((ctx as any)._replacementOrderConsumedIds)
    ? (ctx as any)._replacementOrderConsumedIds
    : [];
  if (!current.includes(key)) current.push(key);
  (ctx as any)._replacementOrderConsumedIds = current;
}

export function clearReplacementOrderState(ctx: GameContext): void {
  delete (ctx as any)._replacementOrderForcedId;
  delete (ctx as any)._replacementOrderConsumedIds;
}

function dispatchDrawCandidate(
  ctx: GameContext,
  playerId: string,
  candidate: ReplacementOrderCandidate,
  remainingAfter: number,
): 'break' | 'continue' | 'none' {
  const effectId = candidate.effectId;
  const metadata = { ...(candidate.metadata || {}), sourceName: candidate.sourceName, sourcePermanentId: candidate.sourcePermanentId };
  if (effectId === 'controller-draw-look-top-put-one-in-hand') {
    return autoApplyOrQueueTomorrowDrawReplacement(ctx, playerId, metadata, remainingAfter);
  }
  if (effectId === REVEAL_CREATURES_DRAW_EFFECT_ID) {
    return autoApplyOrQueueRevealCreaturesDraw(ctx, playerId, metadata, remainingAfter);
  }
  if (effectId === 'optional-search-instead-of-draw') {
    return autoQueueArchmageAscensionSearchReplacement(ctx, playerId, metadata, remainingAfter);
  }
  if (effectId === 'zurs-weirding-draw-replacement') {
    const queued = queueZursWeirdingDrawReplacementStep(ctx, playerId, metadata, remainingAfter);
    const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
    if (queued || ((ctx as any).isReplaying && replayNextEventType === 'zursWeirdingDrawReplacementResolve')) return 'break';
    return 'none';
  }
  if (effectId === 'dredge-draw-replacement-choice') {
    const queued = queueDredgeDrawReplacementStep(ctx, playerId, metadata, Number((metadata as any).drawIndex || 0) || 1, remainingAfter);
    const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
    if (queued || ((ctx as any).isReplaying && replayNextEventType === 'dredgeDrawReplacementResolve')) return 'break';
    return 'none';
  }
  if (effectId === 'skip-draw-step-replacement') {
    const queued = queueSkipDrawReplacementStep(ctx, playerId, metadata, remainingAfter);
    const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
    if (queued || ((ctx as any).isReplaying && replayNextEventType === 'skipDrawReplacementResolve')) return 'break';
    return 'none';
  }
  if (effectId === 'optional-draw-to-counter') {
    const queued = queuePursuitDrawReplacementStep(ctx, playerId, metadata, remainingAfter);
    const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
    if (queued || ((ctx as any).isReplaying && replayNextEventType === 'pursuitDrawReplacementResolve')) return 'break';
    return 'none';
  }
  if (effectId === 'look-one-rest-graveyard') {
    return autoApplyOrQueueLookOneRestGraveyard(ctx, playerId, metadata);
  }
  if (effectId === 'chains-draw-replacement') {
    return applyChainsDrawReplacement(ctx, playerId);
  }
  if (effectId === 'shared-fate-draw') {
    return applySharedFateDrawReplacement(ctx, playerId, String(metadata?.sourcePermanentId || ''));
  }
  if (effectId === 'draw-replaced-by-exile-opponent-library') {
    const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
    if ((ctx as any).isReplaying && replayNextEventType === 'opponentLibraryDrawReplacementResolve') return 'break';
    const queued = applyOrQueueOpponentLibraryDrawReplacement(ctx, playerId, metadata, remainingAfter);
    if (queued) return 'break';
    return 'continue';
  }
  return 'none';
}

export function applyChoiceBearingDrawReplacements(
  ctx: GameContext,
  playerId: string,
  remainingAfter: number,
  extras?: { drawIndex?: number; metadata?: Record<string, unknown> },
): 'break' | 'continue' | 'none' {
  const event: ReplacementOrderListEvent = {
    type: 'card-draw',
    state: (ctx as any).state,
    playerId,
    count: 1,
    drawIndex: extras?.drawIndex,
    metadata: {
      ...(extras?.metadata || {}),
      remainingDrawCountAfterChoice: remainingAfter,
    },
  };
  const all = listChoiceBearingReplacements(event, ctx);
  const decision = selectCandidates(all, ctx);
  if (decision.mode === 'order') {
    const replayNext = String((ctx as any)._replayNextEventType || '').trim();
    if ((ctx as any).isReplaying && replayNext === 'replacementOrderChoiceResolve') return 'break';
    const queued = queueReplacementOrderChoice(ctx, playerId, {
      eventKind: 'card-draw',
      candidates: decision.selected,
      remainingDrawCountAfterChoice: remainingAfter,
    });
    return queued ? 'break' : 'none';
  }
  if (decision.mode === 'none' || !decision.selected[0]) return 'none';
  clearForced(ctx);
  return dispatchDrawCandidate(ctx, playerId, decision.selected[0], remainingAfter);
}

export function applyChoiceBearingTokenReplacements(
  ctx: GameContext,
  controller: string,
  pending: {
    name: string;
    count: number;
    basePower?: number;
    baseToughness?: number;
    options?: any;
    skipMirrormindReplacement?: boolean;
    tokensToCreate?: number;
    tokenName?: string;
    tokenPower?: number;
    tokenToughness?: number;
    tokenOptions?: any;
    additionalTokens?: any[];
  },
): boolean {
  const event: ReplacementOrderListEvent = {
    type: 'token-creation',
    state: (ctx as any).state,
    controllerId: String(controller),
    playerId: String(controller),
    count: Math.max(1, Math.floor(Number(pending?.count || pending?.tokensToCreate || 1))),
    tokenName: pending.tokenName || pending.name,
    tokenTypeLine: pending.tokenOptions?.typeLine || pending.options?.typeLine,
    metadata: {
      skipJinnieFayReplacement: pending.options?.skipJinnieFayReplacement === true,
      skipCopyEquippedFirstTokens: pending.skipMirrormindReplacement === true,
    },
  };
  const all = listChoiceBearingReplacements(event, ctx);
  const decision = selectCandidates(all, ctx);
  const tokenCreate = {
    controller,
    name: pending.name,
    count: pending.count,
    basePower: pending.basePower,
    baseToughness: pending.baseToughness,
    options: pending.options,
    skipMirrormindReplacement: pending.skipMirrormindReplacement === true,
    tokensToCreate: pending.tokensToCreate,
    tokenName: pending.tokenName,
    tokenPower: pending.tokenPower,
    tokenToughness: pending.tokenToughness,
    tokenOptions: pending.tokenOptions,
    additionalTokens: pending.additionalTokens,
  };
  if (decision.mode === 'order') {
    if ((ctx as any).isReplaying) return false;
    return queueReplacementOrderChoice(ctx, String(controller), {
      eventKind: 'token-creation',
      candidates: decision.selected,
      tokenCreate,
    });
  }
  if (decision.mode === 'none' || !decision.selected[0]) return false;
  clearForced(ctx);
  return dispatchTokenCandidate(ctx, String(controller), decision.selected[0], tokenCreate);
}

function dispatchTokenCandidate(
  ctx: GameContext,
  controller: string,
  candidate: ReplacementOrderCandidate,
  tokenCreate: any,
): boolean {
  if (candidate.effectId === 'optional-token-identity-choice') {
    return maybeQueueJinnieFayTokenChoice(ctx, controller, {
      name: tokenCreate.name,
      count: tokenCreate.count,
      basePower: tokenCreate.basePower,
      baseToughness: tokenCreate.baseToughness,
      options: tokenCreate.options,
      skipMirrormindReplacement: tokenCreate.skipMirrormindReplacement === true,
    });
  }
  if (candidate.effectId === 'optional-copy-equipped-first-tokens-this-turn') {
    return maybeQueueFirstTokensCopyEquippedChoice(ctx, controller, {
      name: tokenCreate.tokenName || tokenCreate.name,
      count: tokenCreate.tokensToCreate ?? tokenCreate.count,
      basePower: tokenCreate.tokenPower ?? tokenCreate.basePower,
      baseToughness: tokenCreate.tokenToughness ?? tokenCreate.baseToughness,
      options: tokenCreate.tokenOptions || tokenCreate.options,
      sourcePermanentId: candidate.sourcePermanentId,
    });
  }
  if (candidate.effectId === ESIX_FIRST_TOKENS_EFFECT_ID || candidate.effectId === 'optional-esix-first-tokens-this-turn') {
    return maybeQueueEsixFirstTokensChoice(ctx, controller, {
      name: tokenCreate.tokenName || tokenCreate.name,
      count: tokenCreate.tokensToCreate ?? tokenCreate.count,
      basePower: tokenCreate.tokenPower ?? tokenCreate.basePower,
      baseToughness: tokenCreate.tokenToughness ?? tokenCreate.baseToughness,
      options: tokenCreate.tokenOptions || tokenCreate.options,
    });
  }
  return false;
}
