// server/src/state/modules/untapStepCapChoice.ts
// Player choice for untap-step caps (Winter Orb, Imi Statue, Damping Field, "can't untap more than N").
// CR 502.3: the untapping player chooses which of the capped permanents untap.
// untapPermanentsForPlayer collects every tapped permanent that would untap and is covered by a cap,
// then calls applyUntapStepCaps: when the caps leave a real choice and the player is human, a
// TARGET_SELECTION (flag untapCapChoice, exact N picks) is queued; AI players, replays and
// gameId-less contexts take the heuristic pick inline. The answer is applied by resolveUntapCapChoice
// and persisted as untapCapChoiceResolve.
// Public entry symbols: orderUntapCapCandidates, pickUntapCapDefault, applyUntapStepCaps, resolveUntapCapChoice.

import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { untapLimitAllows, type UntapStepLimit } from './untapStepLimits.js';

type CapSpec = { kind: UntapStepLimit['kind']; max: number; sourceId: string };

function typeLine(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function producesMana(perm: any): boolean {
  return /\badd \{|\badd one mana|\badd (?:two|three) mana/i.test(String(perm?.card?.oracle_text || perm?.oracle_text || ''));
}

function playerNeedsMana(state: any, playerId: string): boolean {
  const hand: any[] = state?.zones?.[playerId]?.hand || [];
  if (hand.some((c: any) => c && !/\bland\b/i.test(String(c?.type_line || '')))) return true;
  const cmdZone: any = state?.commandZone?.[playerId];
  return Array.isArray(cmdZone?.commanderIds) && cmdZone.commanderIds.length > 0 && Array.isArray(cmdZone?.commanderCards) && cmdZone.commanderCards.length > 0;
}

function score(perm: any, needsMana: boolean): number {
  const tl = typeLine(perm);
  const power = Number(perm?.basePower ?? perm?.card?.power ?? 0) || 0;
  if (needsMana) {
    if (tl.includes('land')) return 1000;
    if (producesMana(perm)) return 900;
    if (tl.includes('creature')) return 500 + power;
    if (tl.includes('planeswalker')) return 400;
    return 100;
  }
  if (tl.includes('creature')) return 1000 + power;
  if (tl.includes('land')) return 800;
  if (producesMana(perm)) return 700;
  return 100;
}

/** Candidates sorted best-first for the AI: lands and mana sources first when the player has spells to cast. */
export function orderUntapCapCandidates(state: any, playerId: string, candidates: readonly any[]): any[] {
  const needsMana = playerNeedsMana(state, playerId);
  return candidates
    .map((perm, index) => ({ perm, index, s: score(perm, needsMana) }))
    .sort((a, b) => b.s - a.s || a.index - b.index)
    .map((x) => x.perm);
}

/** Greedy pick in the given order honoring every cap. */
export function pickUntapCapDefault(ordered: readonly any[], limits: readonly CapSpec[]): any[] {
  const used = new Map<UntapStepLimit, number>();
  return ordered.filter((perm) => untapLimitAllows(perm, limits as UntapStepLimit[], used));
}

function untapOne(perm: any, onUntap?: (perm: any) => void): void {
  perm.tapped = false;
  try { onUntap?.(perm); } catch { /* trigger queue best-effort */ }
}

/**
 * Untap the capped candidates. Returns how many untapped right now (a queued prompt untaps later).
 */
export function applyUntapStepCaps(
  ctx: any,
  playerId: string,
  candidates: readonly any[],
  limits: readonly CapSpec[],
  onUntap?: (perm: any) => void,
): { untapped: number; queued: boolean; skipped: number } {
  const state = ctx?.state;
  if (!candidates.length) return { untapped: 0, queued: false, skipped: 0 };
  const ordered = orderUntapCapCandidates(state, playerId, candidates);
  const chosen = pickUntapCapDefault(ordered, limits);
  const skipped = candidates.length - chosen.length;
  const player = (state?.players || []).find((p: any) => String(p?.id) === String(playerId));
  const isAI = Boolean(player && (player.isAI === true || player.ai === true));
  const gameId = String(ctx?.gameId || ctx?.id || '').trim();
  const needsChoice = skipped > 0 && chosen.length > 0;
  if (!needsChoice || isAI || ctx?.isReplaying || !gameId) {
    for (const perm of chosen) untapOne(perm, onUntap);
    return { untapped: chosen.length, queued: false, skipped };
  }
  const capText = limits.map((l) => l.max + ' ' + l.kind + (l.max === 1 ? '' : 's')).join(', ');
  const sources = limits.map((l) => (state?.battlefield || []).find((p: any) => String(p?.id) === l.sourceId)?.card?.name).filter(Boolean);
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId,
    sourceId: limits[0]?.sourceId,
    sourceName: String(sources[0] || 'Untap step'),
    description: 'Untap step: choose which permanents untap (at most ' + capText + ')',
    mandatory: true,
    validTargets: ordered.map((perm: any) => ({
      id: String(perm.id),
      label: String(perm?.card?.name || 'Permanent'),
      name: String(perm?.card?.name || 'Permanent'),
      description: String(perm?.card?.type_line || ''),
      type: 'permanent',
      controller: playerId,
      imageUrl: perm?.card?.image_uris?.small,
    })),
    targetTypes: ['permanent'],
    minTargets: chosen.length,
    maxTargets: chosen.length,
    targetDescription: 'permanents to untap (' + capText + ')',
    untapCapChoice: true,
    untapCapLimits: limits.map((l) => ({ kind: l.kind, max: l.max, sourceId: l.sourceId })),
    untapCapDefaultIds: chosen.map((perm: any) => String(perm.id)),
  } as any);
  return { untapped: 0, queued: true, skipped };
}

/** Apply a submitted untap-cap selection; extra or over-cap picks are dropped, missing picks are filled by the default order. */
export function resolveUntapCapChoice(state: any, step: any, playerId: string, selections: readonly string[], onUntap?: (perm: any) => void): string[] {
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const valid = new Set(((step?.validTargets || []) as any[]).map((t) => String(t.id)));
  const limits: CapSpec[] = Array.isArray(step?.untapCapLimits) ? step.untapCapLimits : [];
  const want = Math.max(0, Number(step?.maxTargets || 0));
  const eligible = (id: string) => {
    const perm = bf.find((x) => String(x?.id) === id);
    return perm && perm.tapped && String(perm.controller) === String(playerId) && valid.has(id) ? perm : null;
  };
  const order = [...new Set([...(selections || []).map(String), ...((step?.untapCapDefaultIds || []) as any[]).map(String)])];
  const used = new Map<UntapStepLimit, number>();
  const out: string[] = [];
  for (const id of order) {
    if (out.length >= want) break;
    const perm = eligible(id);
    if (!perm || !untapLimitAllows(perm, limits as UntapStepLimit[], used)) continue;
    untapOne(perm, onUntap);
    out.push(id);
  }
  return out;
}
