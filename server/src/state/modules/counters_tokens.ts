import type { PlayerID } from "../types";
import type { GameContext } from "../context";
import { applyStateBasedActions, evaluateAction } from "../../rules-engine";
import { uid } from "../utils";

export function updateCounters(ctx: GameContext, permanentId: string, deltas: Record<string, number>) {
  const { state, bumpSeq } = ctx;
  const p = state.battlefield.find(b => b.id === permanentId);
  if (!p) return;
  const current: Record<string, number> = { ...(p.counters ?? {}) };
  for (const [k, vRaw] of Object.entries(deltas)) {
    const v = Math.floor(Number(vRaw) || 0);
    if (!v) continue;
    current[k] = (current[k] ?? 0) + v;
    if (current[k] <= 0) delete current[k];
  }
  p.counters = Object.keys(current).length ? current : undefined;
  bumpSeq();
  runSBA(ctx);
}

export function applyUpdateCountersBulk(ctx: GameContext, updates:{ permanentId:string; deltas:Record<string,number> }[]) {
  for (const u of updates) updateCounters(ctx, u.permanentId, u.deltas);
}

export function createToken(
  ctx: GameContext,
  controller: PlayerID,
  name: string,
  count = 1,
  basePower?: number,
  baseToughness?: number
) {
  const { state, bumpSeq } = ctx;
  for (let i = 0; i < Math.max(1, count | 0); i++) {
    state.battlefield.push({
      id: uid("tok"),
      controller,
      owner: controller,
      tapped: false,
      counters: {},
      basePower,
      baseToughness,
      card: { id: uid("card"), name, type_line: "Token", zone: "battlefield" }
    });
  }
  bumpSeq();
  runSBA(ctx);
}

export function removePermanent(ctx: GameContext, permanentId: string) {
  const { state, bumpSeq } = ctx;
  const idx = state.battlefield.findIndex(p => p.id === permanentId);
  if (idx >= 0) {
    state.battlefield.splice(idx,1);
    bumpSeq();
    runSBA(ctx);
  }
}

export function movePermanentToExile(ctx: GameContext, permanentId: string) {
  const { state, zones, bumpSeq } = ctx;
  const idx = state.battlefield.findIndex(p => p.id === permanentId);
  if (idx < 0) return;
  const perm = state.battlefield.splice(idx,1)[0];
  const owner = perm.owner;
  const z = zones[owner] || (zones[owner] = { hand:[], handCount:0, libraryCount:0, graveyard:[], graveyardCount:0, exile:[] } as any);
  const card = perm.card as any;
  const kc = {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    power: card.power,
    toughness: card.toughness,
    zone: "exile"
  };
  (z as any).exile = (z as any).exile || [];
  (z as any).exile.push(kc);
  bumpSeq();
}

export function runSBA(ctx: GameContext) {
  const { state, bumpSeq } = ctx;
  const res = applyStateBasedActions(state);
  let changed = false;
  for (const upd of res.counterUpdates) {
    const perm = state.battlefield.find(b => b.id === upd.permanentId);
    if (!perm) continue;
    const before = perm.counters ?? {};
    const after = upd.counters;
    const same = Object.keys(before).length === Object.keys(after).length &&
      Object.keys(after).every(k => (before as any)[k] === (after as any)[k]);
    if (!same) { perm.counters = Object.keys(after).length ? { ...after } : undefined; changed = true; }
  }
  if (res.destroys.length) {
    for (const id of res.destroys) {
      const idx = state.battlefield.findIndex(b => b.id === id);
      if (idx >= 0) { state.battlefield.splice(idx,1); changed = true; }
    }
  }
  if (changed) bumpSeq();
}

export function applyEngineEffects(ctx: GameContext, effects: readonly any[]) {
  if (!effects.length) return;
  for (const eff of effects) {
    switch (eff.kind) {
      case "AddCounters": updateCounters(ctx, eff.permanentId, { [eff.counter]: eff.amount }); break;
      case "DestroyPermanent": removePermanent(ctx, eff.permanentId); break;
    }
  }
}