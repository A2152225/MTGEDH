import type { PlayerID, TargetRef, KnownCardRef } from "../types";
import type { GameContext } from "../context";
import { categorizeSpell, resolveSpell } from "../../rules-engine/targeting";
import { evaluateAction } from "../../rules-engine";
import { runSBA, removePermanent, movePermanentToExile, applyEngineEffects, updateCounters } from "./counters_tokens";
import { uid, parsePT } from "../utils";

export function pushStack(
  ctx: GameContext,
  item:{
    id:string;
    controller:PlayerID;
    card:Pick<KnownCardRef,"id"|"name"|"type_line"|"oracle_text"|"image_uris"|"mana_cost"|"power"|"toughness">;
    targets?:string[];
  }) {
  const { state, passesInRow, bumpSeq } = ctx;
  (state.stack as any).push({
    id:item.id,
    type:"spell",
    controller:item.controller,
    card:{ ...item.card, zone:"stack" },
    targets:item.targets ? [...item.targets] : undefined
  });
  passesInRow.value = 0;
  bumpSeq();
}

export function resolveTopOfStack(ctx: GameContext) {
  const { state, passesInRow, bumpSeq, zones } = ctx;
  const item = state.stack.pop();
  if (!item) return;
  const tline = ((item.card as any)?.type_line || "").toLowerCase();
  const isInstantOrSorcery = /\binstant\b/.test(tline) || /\bsorcery\b/.test(tline);
  if (isInstantOrSorcery) {
    const spec = categorizeSpell((item.card as any).name || "", (item.card as any).oracle_text || "");
    const chosen: TargetRef[] = (item.targets || []).map(s => {
      const [kind,id] = String(s).split(":");
      return { kind: kind as TargetRef["kind"], id } as TargetRef;
    });
    if (spec) {
      const effects = resolveSpell(spec, chosen, state);
      applyTargetEffects(ctx, effects);
    }
    const ctrl = item.controller;
    const z = zones[ctrl] || (zones[ctrl] = { hand:[], handCount:0, libraryCount:0, graveyard:[], graveyardCount:0 } as any);
    (z as any).graveyard = (z as any).graveyard || [];
    (z as any).graveyard.push({
      id:(item.card as any).id,
      name:(item.card as any).name,
      type_line:(item.card as any).type_line,
      oracle_text:(item.card as any).oracle_text,
      image_uris:(item.card as any).image_uris,
      mana_cost:(item.card as any).mana_cost,
      power:(item.card as any).power,
      toughness:(item.card as any).toughness,
      zone:"graveyard"
    });
    (z as any).graveyardCount = ((z as any).graveyard || []).length;
  } else {
    const pRaw = item.card as any;
    const typeLine = (pRaw.type_line || "").toLowerCase();
    const isCreature = /\bcreature\b/.test(typeLine);
    const baseP = isCreature ? parsePT(pRaw.power) : undefined;
    const baseT = isCreature ? parsePT(pRaw.toughness) : undefined;
    state.battlefield.push({
      id: uid("perm"),
      controller: item.controller,
      owner: item.controller,
      tapped: false,
      counters: {},
      basePower: baseP,
      baseToughness: baseT,
      card: { ...(item.card as any), zone:"battlefield" }
    });
    runSBA(ctx);
  }
  passesInRow.value = 0;
  bumpSeq();
}

export function applyTargetEffects(ctx: GameContext, effects: readonly any[]) {
  const { state, zones, bumpSeq } = ctx;
  let changed = false;
  for (const eff of effects) {
    switch (eff.kind) {
      case "DestroyPermanent": {
        const i = state.battlefield.findIndex(b => b.id === eff.id);
        if (i >= 0) { state.battlefield.splice(i,1); changed = true; }
        break;
      }
      case "MoveToExile": {
        movePermanentToExile(ctx, eff.id); changed = true; break;
      }
      case "DamagePlayer": {
        const pid = eff.playerId as PlayerID;
        const cur = state.life[pid] ?? state.startingLife;
        state.life[pid] = Math.max(0, cur - Math.max(0, eff.amount|0));
        changed = true; break;
      }
      case "DamagePermanent": {
        const p = state.battlefield.find(b => b.id === eff.id);
        if (!p) break;
        const baseT = typeof p.baseToughness === "number" ? p.baseToughness : undefined;
        if (typeof baseT !== "number") break;
        const plus = p.counters?.["+1/+1"] ?? 0;
        const minus = p.counters?.["-1/-1"] ?? 0;
        const curT = baseT + (plus - minus);
        const amt = Math.max(0, eff.amount|0);
        if (amt >= curT) {
          const i = state.battlefield.findIndex(b => b.id === eff.id);
          if (i >= 0) { state.battlefield.splice(i,1); changed = true; }
        }
        break;
      }
      case "CounterStackItem": {
        const idx = state.stack.findIndex(s => s.id === eff.id);
        if (idx >= 0) {
          const item = state.stack.splice(idx,1)[0];
          const ctrl = item.controller;
          const z = zones[ctrl] || (zones[ctrl] = { hand:[], handCount:0, libraryCount:0, graveyard:[], graveyardCount:0 } as any);
          (z as any).graveyard = (z as any).graveyard || [];
          (z as any).graveyard.push({
            id:(item.card as any).id,
            name:(item.card as any).name,
            type_line:(item.card as any).type_line,
            oracle_text:(item.card as any).oracle_text,
            image_uris:(item.card as any).image_uris,
            mana_cost:(item.card as any).mana_cost,
            power:(item.card as any).power,
            toughness:(item.card as any).toughness,
            zone:"graveyard"
          });
          (z as any).graveyardCount = ((z as any).graveyard || []).length;
          changed = true;
        }
        break;
      }
      case "Broadcast":
        break;
    }
  }
  if (changed) runSBA(ctx);
}

export function playLand(
  ctx: GameContext,
  playerId: PlayerID,
  card: Pick<KnownCardRef,"id"|"name"|"type_line"|"oracle_text"|"image_uris"|"mana_cost"|"power"|"toughness">
) {
  const { state, bumpSeq } = ctx;
  const tl = (card.type_line || "").toLowerCase();
  const isCreature = /\bcreature\b/.test(tl);
  const baseP = isCreature ? parsePT((card as any).power) : undefined;
  const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
  state.battlefield.push({
    id: uid("perm"),
    controller: playerId,
    owner: playerId,
    tapped: false,
    counters: {},
    basePower: baseP,
    baseToughness: baseT,
    card: { ...card, zone: "battlefield" }
  });
  state.landsPlayedThisTurn![playerId] = (state.landsPlayedThisTurn![playerId] ?? 0) + 1;
  bumpSeq();
  runSBA(ctx);
}