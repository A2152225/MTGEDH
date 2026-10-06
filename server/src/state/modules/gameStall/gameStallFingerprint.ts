/**
 * server/src/state/modules/gameStall/gameStallFingerprint.ts
 *
 * Cheap, deterministic fingerprint of the parts of a live game that change
 * whenever the game makes real progress. Used by gameStallDetector.ts to tell
 * "the same no-op keeps happening" apart from legit loops (a combo loop moves
 * counters, tokens, life, stack ids, zones or mana, so its fingerprint moves).
 *
 * Two hashes are produced:
 *  - board: everything except who currently holds priority / who already passed.
 *    Priority ping-pong rotates the holder without progress, so the detector
 *    compares this one.
 *  - full: board + priority holder + passed set (reported for diagnostics).
 *
 * Public entry symbols: computeGameStallFingerprint, collectGameStallPendingPrompts,
 * summarizeGameStallStack, stableStringify, GameStallFingerprint, GameStallPendingPrompt.
 */

import { createHash } from 'node:crypto';
import { ResolutionQueueManager } from '../../resolution/ResolutionQueueManager.js';
import { collectResolutionQueueGameIds } from '../../resolution/resolutionQueueGameIds.js';

export interface GameStallPendingPrompt {
  id: string;
  type: string;
  playerId: string;
  status: string;
  sourceName?: string;
  description?: string;
  createdAt?: number;
}

export interface GameStallFingerprint {
  board: string;
  full: string;
  turn: number | null;
  phase: string;
  step: string;
  priority: string | null;
  turnPlayer: string | null;
  stackLength: number;
}

const MAX_STABLE_DEPTH = 4;

/** Key-sorted JSON-ish serialization with bounded depth (no functions, no cycles). */
export function stableStringify(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return String(value);
  if (t === 'string') return JSON.stringify(value);
  if (t === 'bigint') return String(value);
  if (t === 'function' || t === 'symbol') return '';
  if (depth >= MAX_STABLE_DEPTH) return '"~"';
  if (value instanceof Set) {
    return `S[${[...value].map((entry) => stableStringify(entry, depth + 1)).sort().join(',')}]`;
  }
  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([k, v]) => `${String(k)}:${stableStringify(v, depth + 1)}`)
      .sort();
    return `M{${entries.join(',')}}`;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry, depth + 1)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const serialized = stableStringify(obj[key], depth + 1);
    if (serialized === '') continue;
    parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(',')}}`;
}

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function cardIdList(zone: unknown): string {
  if (!Array.isArray(zone)) return typeof zone === 'number' ? `#${zone}` : '-';
  const ids: string[] = [];
  for (const card of zone) {
    if (card && typeof card === 'object') {
      ids.push(String((card as any).id ?? (card as any).cardId ?? '?'));
    } else {
      ids.push(String(card ?? '?'));
    }
  }
  return `${ids.length}:${ids.join(',')}`;
}

function libraryCount(ctx: any, zones: any, playerId: string): number {
  try {
    const libraries = ctx?.libraries;
    if (libraries && typeof libraries.get === 'function') {
      const lib = libraries.get(playerId);
      if (Array.isArray(lib)) return lib.length;
    }
  } catch {
    // ignore
  }
  const count = Number(zones?.libraryCount);
  if (Number.isFinite(count)) return count;
  return Array.isArray(zones?.library) ? zones.library.length : -1;
}

function stepStatusIsOpen(step: any): boolean {
  const status = String(step?.status || '').toLowerCase();
  return status !== 'completed' && status !== 'cancelled';
}

/** Unresolved Resolution Queue steps for this game (all candidate queue ids). */
export function collectGameStallPendingPrompts(game: any, gameId?: string): GameStallPendingPrompt[] {
  const state = game?.state || {};
  const ctx = game?.ctx || game;
  const ids = collectResolutionQueueGameIds(gameId, game?.gameId, ctx?.gameId, state?.id, state?.gameId);
  const seen = new Set<string>();
  const prompts: GameStallPendingPrompt[] = [];
  for (const id of ids) {
    let steps: any[] = [];
    try {
      steps = ResolutionQueueManager.getQueue(id)?.steps || [];
    } catch {
      steps = [];
    }
    for (const step of steps) {
      if (!step || !stepStatusIsOpen(step)) continue;
      const stepId = String(step.id || '');
      if (seen.has(stepId)) continue;
      seen.add(stepId);
      prompts.push({
        id: stepId,
        type: String(step.type || ''),
        playerId: String(step.playerId || ''),
        status: String(step.status || ''),
        sourceName: step.sourceName ? String(step.sourceName) : undefined,
        description: step.description ? String(step.description).slice(0, 200) : undefined,
        createdAt: Number.isFinite(Number(step.createdAt)) ? Number(step.createdAt) : undefined,
      });
    }
  }
  return prompts;
}

/** Legacy `pending*` state fields with their key counts (keeps the fingerprint cheap). */
export function collectLegacyPendingStateSummary(state: any): Record<string, number> {
  const summary: Record<string, number> = {};
  if (!state || typeof state !== 'object') return summary;
  for (const key of Object.keys(state)) {
    if (!key.startsWith('pending')) continue;
    const value = state[key];
    if (value === null || value === undefined || value === false) continue;
    if (Array.isArray(value)) {
      if (value.length) summary[key] = value.length;
    } else if (value instanceof Set || value instanceof Map) {
      if (value.size) summary[key] = value.size;
    } else if (typeof value === 'object') {
      const n = Object.keys(value).length;
      if (n) summary[key] = n;
    } else {
      summary[key] = 1;
    }
  }
  return summary;
}

export function summarizeGameStallStack(state: any): Array<Record<string, unknown>> {
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  return stack.map((item: any, index: number) => ({
    index,
    id: item?.id ?? null,
    type: item?.type ?? item?.kind ?? null,
    name: item?.card?.name ?? item?.name ?? item?.sourceName ?? item?.cardName ?? null,
    controller: item?.controller ?? item?.playerId ?? null,
    targets: Array.isArray(item?.targets) ? item.targets.length : undefined,
  }));
}

/**
 * Build the fingerprint. Never throws; returns stable sentinel hashes on failure.
 */
export function computeGameStallFingerprint(game: any, gameId?: string): GameStallFingerprint {
  const state: any = game?.state || {};
  const ctx: any = game?.ctx || game;
  const parts: string[] = [];
  try {
    const turnRaw = Number(state.turnNumber ?? state.turn);
    const turn = Number.isFinite(turnRaw) ? turnRaw : null;
    parts.push(`t=${turn}|p=${String(state.phase ?? '')}|s=${String(state.step ?? '')}|tp=${String(state.turnPlayer ?? '')}`);

    const stack = Array.isArray(state.stack) ? state.stack : [];
    parts.push(`stack=${stack.length}:${stack.map((item: any) => String(item?.id ?? '?')).join(',')}`);

    const players: any[] = Array.isArray(state.players) ? state.players : [];
    for (const player of players) {
      const pid = String(player?.id ?? '');
      if (!pid) continue;
      const zones = state.zones?.[pid] || {};
      const life = state.life?.[pid] ?? player?.life ?? ctx?.life?.[pid];
      parts.push([
        `pl=${pid}`,
        `life=${life}`,
        `poison=${ctx?.poison?.[pid] ?? player?.poison ?? state.poison?.[pid] ?? 0}`,
        `pc=${stableStringify(player?.counters)}`,
        `lost=${player?.hasLost ? 1 : 0}${player?.eliminated ? 1 : 0}${player?.conceded ? 1 : 0}`,
        `hand=${cardIdList(Array.isArray(zones.hand) ? zones.hand : zones.handCount)}`,
        `gy=${cardIdList(Array.isArray(zones.graveyard) ? zones.graveyard : zones.graveyardCount)}`,
        `ex=${cardIdList(Array.isArray(zones.exile) ? zones.exile : zones.exileCount)}`,
        `lib=${libraryCount(ctx, zones, pid)}`,
        `mana=${stableStringify(state.manaPool?.[pid])}`,
        `cz=${stableStringify(state.commandZone?.[pid]?.inCommandZone)}`,
      ].join('|'));
    }

    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const bf: string[] = [];
    for (const perm of battlefield) {
      if (!perm) continue;
      const counters = perm.counters && typeof perm.counters === 'object' ? stableStringify(perm.counters) : '';
      bf.push(`${String(perm.id ?? '?')}:${String(perm.controller ?? '')}:${perm.tapped ? 1 : 0}:${Number(perm.damage ?? perm.markedDamage ?? 0) || 0}:${counters}:${perm.attachedTo ?? ''}`);
    }
    parts.push(`bf=${bf.length}:${bf.join(',')}`);
    parts.push(`cmdDmg=${stableStringify(state.commanderDamage)}`);
    parts.push(`combat=${stableStringify(state.attackersDeclaredBy)}|${stableStringify(state.blockersDeclaredBy)}`);

    const prompts = collectGameStallPendingPrompts(game, gameId);
    parts.push(`rq=${prompts.map((p) => `${p.id}:${p.type}:${p.playerId}:${p.status}`).join(',')}`);
    parts.push(`legacy=${stableStringify(collectLegacyPendingStateSummary(state))}`);

    const boardText = parts.join('\n');
    const priority = state.priority === null || state.priority === undefined ? null : String(state.priority);
    const passed = state.priorityPassedBy instanceof Set ? [...state.priorityPassedBy].map(String).sort().join(',') : '';
    return {
      board: hash(boardText),
      full: hash(`${boardText}\nprio=${priority}|passed=${passed}`),
      turn,
      phase: String(state.phase ?? ''),
      step: String(state.step ?? ''),
      priority,
      turnPlayer: state.turnPlayer ? String(state.turnPlayer) : null,
      stackLength: stack.length,
    };
  } catch {
    return {
      board: 'fingerprint_error',
      full: 'fingerprint_error',
      turn: null,
      phase: String(state?.phase ?? ''),
      step: String(state?.step ?? ''),
      priority: state?.priority ? String(state.priority) : null,
      turnPlayer: state?.turnPlayer ? String(state.turnPlayer) : null,
      stackLength: Array.isArray(state?.stack) ? state.stack.length : 0,
    };
  }
}
