import type {
  PlayerID,
  PlayerRef,
  PlayerZones,
  CommanderInfo,
  KnownCardRef,
  ClientGameView,
} from "../../../../shared/src";
import type { GameContext } from "../context";
import { parsePT } from "../utils";

function canSeeOwnersHidden(ctx: GameContext, viewer: PlayerID, owner: PlayerID) {
  if (viewer === owner) return true;
  const set = ctx.grants.get(owner);
  return !!set && set.has(viewer);
}

export function viewFor(ctx: GameContext, viewer: PlayerID, _spectator: boolean): ClientGameView {
  const { state, zones, libraries, commandZone, inactive, poison, experience } = ctx;

  const filteredBattlefield = state.battlefield.map((perm) => {
    const card = perm.card as any;
    const typeLine = String(card?.type_line || "").toLowerCase();
    const isCreature = /\bcreature\b/.test(typeLine);
    let effectivePower: number | undefined;
    let effectiveToughness: number | undefined;
    if (isCreature) {
      const baseP =
        typeof perm.basePower === "number" ? perm.basePower : parsePT(card?.power);
      const baseT =
        typeof perm.baseToughness === "number"
          ? perm.baseToughness
          : parsePT(card?.toughness);
      if (typeof baseP === "number" && typeof baseT === "number") {
        const plus = perm.counters?.["+1/+1"] ?? 0;
        const minus = perm.counters?.["-1/-1"] ?? 0;
        const delta = plus - minus;
        effectivePower = baseP + delta;
        effectiveToughness = baseT + delta;
      }
    }
    const cz = state.commandZone[perm.controller];
    const isCommander =
      !!cz &&
      Array.isArray(cz.commanderIds) &&
      cz.commanderIds.includes((perm.card as any)?.id);
    return {
      ...perm,
      card: perm.card,
      ...(typeof effectivePower === "number" &&
      typeof effectiveToughness === "number"
        ? { effectivePower, effectiveToughness }
        : {}),
      ...(isCommander ? { isCommander: true } : {}),
    };
  });

  const filteredZones: Record<PlayerID, PlayerZones> = {};
  const viewCommandZone: Record<PlayerID, CommanderInfo> = {};

  for (const p of state.players as any as PlayerRef[]) {
    const z: PlayerZones =
      zones?.[p.id] ?? {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      };
    const libCount = libraries.get(p.id)?.length ?? z.libraryCount ?? 0;
    const canSee = viewer === p.id || canSeeOwnersHidden(ctx, viewer, p.id);

    // Always use the same underlying hand list, but mark known/unknown per viewer.
    const rawHand = Array.isArray(z.hand) ? (z.hand as KnownCardRef[]) : [];
    const visibleHand: KnownCardRef[] = rawHand.map((c) => {
      // Clone so we don't mutate authoritative objects
      const base: KnownCardRef = {
        ...c,
      };
      base.known = canSee && !base.faceDown;
      return base;
    });

    const visibleHandCount =
      typeof z.handCount === "number" ? z.handCount : rawHand.length;

    let libraryTop: KnownCardRef | undefined;
    if (canSee) {
      const libArr = libraries.get(p.id);
      if (libArr && libArr.length > 0) {
        const top = libArr[0];
        libraryTop = {
          id: top.id,
          name: top.name,
          type_line: top.type_line,
          oracle_text: top.oracle_text,
          image_uris: top.image_uris,
          mana_cost: (top as any).mana_cost,
          power: (top as any).power,
          toughness: (top as any).toughness,
          zone: "library",
        } as any;
      }
    }

    filteredZones[p.id] = {
      hand: visibleHand,
      handCount: visibleHandCount,
      libraryCount: libCount,
      graveyard: z.graveyard,
      graveyardCount:
        (z as any).graveyardCount ?? (z.graveyard as any[])?.length ?? 0,
      exile: (z as any).exile,
      libraryTop,
    };

    const baseInfo = commandZone[p.id];
    if (baseInfo) {
      viewCommandZone[p.id] = {
        commanderIds: baseInfo.commanderIds,
        commanderNames: (baseInfo as any).commanderNames,
        tax: baseInfo.tax,
        taxById: baseInfo.taxById,
        commanderCards: (baseInfo as any).commanderCards,
        colorIdentity: (baseInfo as any).colorIdentity,
      } as any;
    }
  }

  const projectedPlayers: PlayerRef[] = (state.players as any as PlayerRef[]).map(
    (p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      inactive: inactive.has(p.id),
    })
  );
console.log("[VIEW_FOR_DEBUG]", {
  viewer,
  zones: Object.fromEntries(
    Object.entries(filteredZones).map(([pid, z]) => [
      pid,
      {
        handCount: z.handCount,
        firstKnown: Array.isArray(z.hand)
          ? (z.hand as any[]).slice(0, 3).map((c) => c.known)
          : null,
      },
    ])
  ),
});

  return {
    ...state,
    battlefield: filteredBattlefield,
    stack: state.stack.slice(),
    players: projectedPlayers,
    zones: filteredZones,
    spectators: [],
    commandZone: viewCommandZone,
    poisonCounters: poison,
    experienceCounters: experience,
  } as any;
}