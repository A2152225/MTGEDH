/**
 * Collapse a bulk run of identical counter-placement triggers (Cathars' Crusade x460:
 * "put a +1/+1 counter on each creature you control") into one operation.
 *
 * Rules safety comes from letting the engine resolve the FIRST instance normally, then
 * diffing the board: if that instance changed nothing but counters (no permanent entered
 * or left, no life / zone / tapped change, no new stack items or prompts, only static
 * deterministic counter replacements such as Hardened Scales / Doubling Season, whose
 * result is already in the observed deltas, and no counter-placed watchers), every later instance sees the same
 * creatures and does exactly the same thing, so the remaining N-1 resolve as one
 * "resolveIdenticalCounterRun" event carrying the summed per-permanent deltas, with one
 * SBA pass and no per-instance priority events (every player already consented).
 * Any failed precondition returns the instances resolved so far and the caller continues
 * on the per-instance path.
 *
 * Public entry symbols: tryCollapseIdenticalCounterRun, isCollapsibleCounterEffect,
 *   setIdenticalCounterCollapseEnabled, COLLAPSE_MIN_RUN.
 */
import type { Server } from "socket.io";
import type { InMemoryGame } from "../state/types.js";
import { appendGameEvent } from "./util-handlers/appendGameEvent.js";
import { getCounterPlacedTriggers, runWithCounterPlacedDetectionScope } from "../state/modules/triggers/counters.js";
import { runWithReplacementSpecScope } from "../state/modules/replacementEffectSpecScopedCache.js";
import { debug } from "../utils/debug.js";

export const COLLAPSE_MIN_RUN = 3;

let collapseEnabled = true;
/** Test / diagnostics hook: force the per-instance path. */
export function setIdenticalCounterCollapseEnabled(enabled: boolean): void {
  collapseEnabled = enabled;
}

/** Fixed-amount "put N <kind> counter(s) on each ..." with nothing that varies per instance. */
const COUNTER_EACH_RE = /^put (?:a|an|one|two|three|four|five) [^.]*?counters? on each [^.]*?\.?$/;
const VARIABLE_RE = /\b(?:for each|equal to|where|number of|if|unless|then|instead|that|those|it|its)\b/;

export function isCollapsibleCounterEffect(effect: string): boolean {
  const text = String(effect || "").toLowerCase().replace(/\s+/g, " ").trim();
  return COUNTER_EACH_RE.test(text) && !VARIABLE_RE.test(text);
}

type BoardSnapshot = { sig: string; counters: Map<string, Record<string, number>> };

function snapshotBoard(state: any): BoardSnapshot {
  const counters = new Map<string, Record<string, number>>();
  const parts: string[] = [];
  for (const p of state?.battlefield || []) {
    const id = String(p?.id || "");
    counters.set(id, { ...(p?.counters || {}) });
    parts.push(`${id}|${p?.controller}|${p?.tapped ? 1 : 0}|${p?.phasedOut ? 1 : 0}|${(p?.attachedTo) || ""}`);
  }
  const players = (state?.players || []).map((pl: any) => `${pl?.id}:${pl?.life}:${state?.life?.[pl?.id] ?? ""}`);
  const zones = Object.entries(state?.zones || {}).map(([pid, z]: [string, any]) =>
    `${pid}:${z?.handCount ?? z?.hand?.length ?? 0}/${z?.graveyardCount ?? z?.graveyard?.length ?? 0}/${z?.exileCount ?? z?.exile?.length ?? 0}/${z?.libraryCount ?? 0}`);
  return { sig: `${parts.join(";")}#${players.join(",")}#${zones.join(",")}`, counters };
}

function diffCounters(before: BoardSnapshot, state: any): Array<{ permanentId: string; deltas: Record<string, number> }> {
  const out: Array<{ permanentId: string; deltas: Record<string, number> }> = [];
  for (const p of state?.battlefield || []) {
    const id = String(p?.id || "");
    const old = before.counters.get(id) || {};
    const now = (p?.counters || {}) as Record<string, number>;
    const deltas: Record<string, number> = {};
    for (const k of new Set([...Object.keys(old), ...Object.keys(now)])) {
      const d = Number(now[k] || 0) - Number(old[k] || 0);
      if (d !== 0) deltas[k] = d;
    }
    if (Object.keys(deltas).length > 0) out.push({ permanentId: id, deltas });
  }
  return out;
}

/** Text of a static counter-placement replacement (Hardened Scales, Doubling Season, Corpsejack...). */
const COUNTER_REPLACEMENT_RE = /\bcounters? would be (?:put|placed)\b|\bwould put (?:one or more |a |any )?[^.]*?counters?\b|\bthat many plus\b|\btwice that many\b[^.]*counters?|\bput (?:one )?additional\b[^.]*counters?/i;
/** Wording that makes a replacement optional, choice-driven, or dependent on changing counts. */
const NONDETERMINISTIC_RE = /\b(?:you may|may have|choose|chosen|choice|if you do|unless|for each|number of|equal to|if it has|no counters|counters on it|random|vote|pay)\b/i;

/**
 * True when every counter-placement replacement on the battlefield is static and
 * deterministic. Their effect is then already baked into the first instance's observed
 * deltas and is identical for every later instance (the battlefield is unchanged).
 */
export function counterModifiersAreDeterministic(state: any): boolean {
  for (const p of state?.battlefield || []) {
    const text = String(p?.card?.oracle_text || "");
    if (!COUNTER_REPLACEMENT_RE.test(text)) continue;
    for (const sentence of text.split(/\n|(?<=\.)\s+/)) {
      if (COUNTER_REPLACEMENT_RE.test(sentence) && NONDETERMINISTIC_RE.test(sentence)) return false;
    }
  }
  return true;
}

/**
 * Deterministic replacements only (already included in the observed deltas) and no
 * "whenever counters are put" watcher fires.
 */
function placementsArePlain(game: InMemoryGame, perInstance: Array<{ permanentId: string; deltas: Record<string, number> }>): boolean {
  const ctx = ((game as any).ctx || game) as any;
  const state = game.state as any;
  if (!counterModifiersAreDeterministic(state)) return false;
  return runWithReplacementSpecScope(() => runWithCounterPlacedDetectionScope(() => {
    for (const u of perInstance) {
      if (Object.values(u.deltas).some((d) => Number(d) < 0)) return false;
      const perm = (state.battlefield || []).find((p: any) => String(p?.id || "") === u.permanentId);
      if (!perm) return false;
      if (getCounterPlacedTriggers(ctx, perm, u.deltas).length > 0) return false;
    }
    return true;
  }));
}

/**
 * Returns how many instances were resolved (0 when not applicable). The caller keeps
 * going on the per-instance path for whatever is left.
 */
export function tryCollapseIdenticalCounterRun(
  io: Server | null,
  game: InMemoryGame,
  gameId: string,
  options: {
    key: string;
    limit: number;
    /** Ordered stack items of the run (top first) and run length. */
    runItems: () => any[];
    everyoneConsents: () => boolean;
    resolveOne: () => boolean;
  },
): number {
  if (!collapseEnabled) return 0;
  const items = options.runItems();
  const n = Math.min(options.limit, items.length);
  if (n < COLLAPSE_MIN_RUN) return 0;
  const top = items[0];
  if (!isCollapsibleCounterEffect(String(top?.effect || top?.description || ""))) return 0;
  if (!options.everyoneConsents()) return 0;

  const state = game.state as any;
  const stackLenBefore = Array.isArray(state.stack) ? state.stack.length : 0;
  const before = snapshotBoard(state);
  if (!options.resolveOne()) return 0;

  const after = snapshotBoard(state);
  const stackLenAfter = Array.isArray(state.stack) ? state.stack.length : 0;
  const rest = options.runItems().slice(0, n - 1);
  const perInstance = diffCounters(before, state);
  if (
    after.sig !== before.sig
    || stackLenAfter !== stackLenBefore - 1
    || rest.length < n - 1
    || perInstance.length === 0
    || rest.some((item: any) => !String(item?.id || ""))
    || !options.everyoneConsents()
    || !placementsArePlain(game, perInstance)
  ) {
    debug(2, `[identicalTriggerCollapse] not collapsible after first instance of ${options.key}`);
    return 1;
  }

  const copies = rest.length;
  const updates = perInstance.map((u) => ({
    permanentId: u.permanentId,
    deltas: Object.fromEntries(Object.entries(u.deltas).map(([k, v]) => [k, Number(v) * copies])),
  }));
  appendGameEvent(game, gameId, "resolveIdenticalCounterRun", {
    stackItemIds: rest.map((item: any) => String(item?.id || "")),
    updates,
    sourceName: String(top?.sourceName || ""),
    count: copies,
  });
  debug(1, `[identicalTriggerCollapse] collapsed ${copies + 1} instance(s) of ${top?.sourceName || options.key}`);
  void io;
  return copies + 1;
}