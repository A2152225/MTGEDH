import type {
  PlayerID,
  PlayerRef,
  PlayerZones,
  CommanderInfo,
  KnownCardRef,
  ClientGameView,
  BattlefieldPermanent,
} from "../../../../shared/src/index.js";
import type { GameContext } from "../context.js";
import { parsePT, calculateVariablePT, calculateAllPTBonuses, calculateAllPTBonusesWithSources, type PTBonusSource } from "../utils.js";

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
  const { state, libraries, commandZone, inactive, poison, experience } = ctx;
  const zones = state.zones || {};

  const filteredBattlefield = state.battlefield.map((perm: BattlefieldPermanent) => {
    const card = perm.card as any;
    const typeLine = String(card?.type_line || "").toLowerCase();
    const isCreature = /\bcreature\b/.test(typeLine);
    let effectivePower: number | undefined;
    let effectiveToughness: number | undefined;
    if (isCreature) {
      let baseP =
        typeof perm.basePower === "number" ? perm.basePower : parsePT(card?.power);
      let baseT =
        typeof perm.baseToughness === "number"
          ? perm.baseToughness
          : parsePT(card?.toughness);
      
      // Handle variable P/T (*/*) creatures like Morophon
      if (baseP === undefined || baseT === undefined) {
        const variablePT = calculateVariablePT({ ...card, controller: perm.controller }, state);
        if (variablePT) {
          baseP = baseP ?? variablePT.power;
          baseT = baseT ?? variablePT.toughness;
        }
      }
      
      if (typeof baseP === "number" && typeof baseT === "number") {
        // Calculate counter bonuses (+1/+1, -1/-1, and other counter types)
        const plus = perm.counters?.["+1/+1"] ?? 0;
        const minus = perm.counters?.["-1/-1"] ?? 0;
        const counterDelta = plus - minus;
        
        // Check for other counter types that affect P/T
        // +1/+0, +0/+1, +2/+2, etc. counters
        let otherCounterPower = 0;
        let otherCounterToughness = 0;
        if (perm.counters) {
          for (const [counterType, count] of Object.entries(perm.counters)) {
            if (counterType === "+1/+1" || counterType === "-1/-1") continue;
            // Parse counter types like "+1/+0", "+0/+2", "+2/+2", "-2/-2", etc.
            const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
            if (counterMatch) {
              const pMod = parseInt(counterMatch[1], 10);
              const tMod = parseInt(counterMatch[2], 10);
              otherCounterPower += pMod * (count as number);
              otherCounterToughness += tMod * (count as number);
            }
          }
        }
        
        // Calculate ALL other bonuses with source tracking (equipment, auras, anthems, lords, emblems, etc.)
        const allBonusesResult = calculateAllPTBonusesWithSources(perm, state);
        
        effectivePower = baseP + counterDelta + otherCounterPower + allBonusesResult.power;
        effectiveToughness = baseT + counterDelta + otherCounterToughness + allBonusesResult.toughness;
        
        // Build P/T sources array for tooltip display
        const ptSources: PTBonusSource[] = [];
        
        // Add counters as a source if they modify P/T
        if (counterDelta !== 0) {
          ptSources.push({ name: '+1/+1 counters', power: counterDelta, toughness: counterDelta, type: 'counter' });
        }
        if (otherCounterPower !== 0 || otherCounterToughness !== 0) {
          ptSources.push({ name: 'Other counters', power: otherCounterPower, toughness: otherCounterToughness, type: 'counter' });
        }
        
        // Add all other sources
        ptSources.push(...allBonusesResult.sources);
        
        // Store ptSources on the permanent for client use
        (perm as any).ptSources = ptSources;
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
      ...((perm as any).ptSources?.length > 0 ? { ptSources: (perm as any).ptSources } : {}),
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
      const base = {
        ...c,
      } as any;
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
      ...(libraryTop ? { libraryTop } : {}),
    } as any;

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
    stackLength: state.stack?.length || 0,
    stackItems: state.stack?.slice(0, 3).map((s: any) => s?.card?.name || s?.id) || [],
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
    // Map turnNumber to turn for client compatibility
    turn: (state as any).turnNumber ?? 1,
    // Set viewer field for playable cards calculation
    // Exclude spectator viewers (e.g., "spectator:judge") as they don't have priority
    viewer: typeof viewer === 'string' && viewer.startsWith('spectator:') ? undefined : viewer,
  } as any;
}