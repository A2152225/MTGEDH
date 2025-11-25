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

/**
 * Determine if `viewer` can see `owner`'s hidden zones (hand, library top, etc.)
 *
 * Rules:
 * - Owners always see their own hand.
 * - Telepathy / reveal-hand effects add specific viewer grants per owner via ctx.handVisibilityGrants.
 * - A special pseudo-viewer id "spectator:judge" (when used) sees all hands.
 * - Legacy ctx.grants is kept as a fallback grant source.
 */
function canSeeOwnersHidden(
  ctx: GameContext,
  viewer: PlayerID | "spectator:judge",
  owner: PlayerID
) {
  if (viewer === owner) return true;
  if (viewer === "spectator:judge") return true;

  // Explicit hand visibility grants (Telepathy, reveal-hand, judge, etc.)
  if (ctx.handVisibilityGrants && ctx.handVisibilityGrants.size > 0) {
    const handSet = ctx.handVisibilityGrants.get(owner);
    if (handSet && handSet.has(viewer)) return true;
  }

  // Legacy / fallback grants (existing behavior)
  const set = ctx.grants.get(owner);
  return !!set && set.has(viewer as PlayerID);
}

export function viewFor(
  ctx: GameContext,
  viewer: PlayerID | "spectator:judge",
  _spectator: boolean
): ClientGameView {
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

    // Determine if this viewer can see this owner's hand
    const canSee = canSeeOwnersHidden(ctx, viewer, p.id as PlayerID);

    // Always use the same underlying hand list, but mark known/unknown per viewer.
    const rawHand = Array.isArray(z.hand) ? (z.hand as KnownCardRef[]) : [];
    const visibleHand: KnownCardRef[] = rawHand.map((c) => {
      // Clone so we don't mutate authoritative objects
      const base: KnownCardRef = {
        ...c,
      };
      // Visibility is purely per-viewer: owner, Telepathy/judge grants, AND not face-down.
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
          card_faces: (top as any).card_faces,
          layout: (top as any).layout,
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
        inCommandZone: (baseInfo as any).inCommandZone,
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