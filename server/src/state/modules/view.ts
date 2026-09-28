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
import { computeCurrentPowerToughnessWithSources } from "./currentPowerToughness.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { getContinuousGrantedAbilitiesForPermanent, syncDerivedContinuousEffects } from "./staticEffectSpec.js";
import { collectBattlefieldAbilityBadgesForView } from "./battlefieldAbilityBadges.js";
import { detectDamageReplacementEffects, canLookAtTopOfLibrary } from "./game-state-effects.js";
import { maskFaceDownExileCardForViewer, applyCurrentExiledWithSourcePlayLook } from "./impulse-exile-utils.js";
import {
  applyCurrentHideawayExamination,
  collectMissingHideawayExileCards,
  sanitizeHideawayCardForViewer,
} from "./hideawayExile.js";

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

function canSeeRevealedLibraryTop(
  ctx: GameContext,
  viewer: PlayerID | "spectator:judge",
  owner: PlayerID,
  topCardId: string | undefined
) {
  if (!topCardId) return false;
  const revealed = ctx.revealedLibraryTopByOwner?.get(owner);
  if (!revealed || revealed.cardId !== topCardId) return false;
  return revealed.viewers.has(viewer);
}

function isLibraryTopRevealedToAll(ctx: GameContext, owner: PlayerID): boolean {
  const battlefield = ctx.state.battlefield || [];
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    
    // Check if owner's own card forces reveal
    if (perm.controller === owner) {
      if (
        cardName.includes("oracle of mul daya") ||
        cardName.includes("courser of kruphix") ||
        cardName.includes("future sight") ||
        cardName.includes("magus of the future")
      ) {
        return true;
      }
      if (oracleText.includes("play with the top card of your library revealed")) {
        return true;
      }
    }
    
    // Check global reveals affecting all players
    if (oracleText.includes("play with the top card of their libraries revealed") ||
        (oracleText.includes("play with the top card of your library revealed") && oracleText.includes("players play with"))) {
      return true;
    }
  }
  
  if ((ctx.state as any).activePlane) {
    const planeText = String((ctx.state as any).activePlane.oracle_text || '').toLowerCase();
    if (planeText.includes("revealed") && planeText.includes("top card of")) {
      return true;
    }
  }
  
  return false;
}

export function viewFor(
  ctx: GameContext,
  viewer: PlayerID | "spectator:judge",
  _spectator: boolean
): ClientGameView {
  const { state, libraries, commandZone, inactive, poison, experience } = ctx;
  const zones = state.zones || {};

  // One derived continuous-effects pass per view build (avoids O(n²) recompute per permanent).
  try {
    syncDerivedContinuousEffects(state);
  } catch {
    // Best-effort only; view construction must not fail.
  }

  // Server-computed hints for client UX gating (avoid oracle-text heuristics client-side).
  // For damage replacement ordering, a player has a meaningful choice only when >=2 effects apply
  // to a single damage event (MTG 616.1). We approximate by taking the maximum count over all
  // possible opponents as the damage dealer.
  let damageReplacementActiveCount = 0;
  try {
    if (viewer !== "spectator:judge") {
      const viewerId = viewer as PlayerID;
      const playerIds = Array.isArray(state.players) ? (state.players as any[]).map((p) => p?.id).filter(Boolean) : [];
      for (const dealerId of playerIds) {
        if (!dealerId || dealerId === viewerId) continue;
        const effects = detectDamageReplacementEffects(ctx, String(dealerId), viewerId, true);
        damageReplacementActiveCount = Math.max(damageReplacementActiveCount, effects.length);
        if (damageReplacementActiveCount > 1) break;
      }
    }
  } catch {
    // Best-effort only; never break view construction.
    damageReplacementActiveCount = 0;
  }

  const filteredBattlefield = state.battlefield.map((perm: BattlefieldPermanent) => {
    const card = perm.card as any;
    const typeLine = String(card?.type_line || "").toLowerCase();
    const isCreature = /\bcreature\b/.test(typeLine);
    let effectivePower: number | undefined;
    let effectiveToughness: number | undefined;
    
    const continuousAbilities = getContinuousGrantedAbilitiesForPermanent(perm, state);
    const existingAbilities = collectBattlefieldAbilityBadgesForView(perm, continuousAbilities);

    if (isCreature) {
      // Shared with rules effects (fight, bite, damage equal to power) via currentPowerToughness.ts.
      const current = computeCurrentPowerToughnessWithSources(perm, state);
      if (current) {
        effectivePower = current.power;
        effectiveToughness = current.toughness;
        // Store ptSources on the permanent for client use (tooltip display)
        (perm as any).ptSources = current.sources;
      }
    }
    const cz = state.commandZone[perm.controller];
    const isCommander =
      !!cz &&
      Array.isArray(cz.commanderIds) &&
      cz.commanderIds.includes((perm.card as any)?.id);
    const { grantedAbilities: _rawGrantedAbilities, hideawayCard: rawHideawayCard, ...permWithoutRawGrants } = perm as any;
    const viewedHideaway = sanitizeHideawayCardForViewer(
      rawHideawayCard,
      String(viewer || ''),
      String(perm.controller || ''),
    );
    return {
      ...permWithoutRawGrants,
      card: perm.card,
      ...(viewedHideaway ? { hideawayCard: viewedHideaway } : {}),
      ...(typeof effectivePower === "number" &&
      typeof effectiveToughness === "number"
        ? { effectivePower, effectiveToughness }
        : {}),
      ...(isCommander ? { isCommander: true } : {}),
      ...((perm as any).ptSources?.length > 0 ? { ptSources: (perm as any).ptSources } : {}),
      // Include granted abilities from continuous effects (Avacyn, Svyelun, anthems, etc.)
      ...(existingAbilities.length > 0 ? { grantedAbilities: existingAbilities } : {}),
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
    const libArr = libraries.get(p.id);
    const top = libArr && libArr.length > 0 ? libArr[0] : undefined;
    
    let canSeeLibraryTop = false;
    if (viewer === "spectator:judge") {
      canSeeLibraryTop = true;
    } else {
      const isRevealedObj = isLibraryTopRevealedToAll(ctx, p.id as PlayerID);
      const isRevealedForMe = canSeeRevealedLibraryTop(ctx, viewer, p.id as PlayerID, top?.id);
      
      if (isRevealedObj || isRevealedForMe) {
        canSeeLibraryTop = true;
      } else if (viewer === p.id) {
        const lookPerm = canLookAtTopOfLibrary(ctx, viewer);
        canSeeLibraryTop = lookPerm.canLook;
      }
    }

    if (canSeeLibraryTop && top) {
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

    const rawExile = Array.isArray((z as any).exile) ? [...(z as any).exile] : [];
    const missingHideaway = collectMissingHideawayExileCards(p.id as PlayerID, state.battlefield || []);
    for (const hidden of missingHideaway) {
      const cardId = String(hidden?.id || '');
      const sourceId = String(hidden?.hideawaySourcePermanentId || '');
      const alreadyPresent = rawExile.some((card: any) =>
        (cardId && String(card?.id || '') === cardId)
        || (sourceId && String(card?.hideawaySourcePermanentId || '') === sourceId),
      );
      if (!alreadyPresent) rawExile.push(hidden);
    }
    const visibleExile = rawExile
      .map((card: any) => applyCurrentHideawayExamination(card, state.battlefield || []))
      .map((card: any) => applyCurrentExiledWithSourcePlayLook(card, state.battlefield || []))
      .map((card: any) => maskFaceDownExileCardForViewer(card, viewer));

    filteredZones[p.id] = {
      hand: visibleHand,
      handCount: visibleHandCount,
      libraryCount: libCount,
      graveyard: z.graveyard,
      graveyardCount:
        (z as any).graveyardCount ?? (z.graveyard as any[])?.length ?? 0,
      exile: visibleExile,
      exileCount: (z as any).exileCount ?? visibleExile.length,
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
    (p) => {
      const lifeTotal = (state as any).life?.[p.id] ?? (p as any).life;
      const lifeNum = Number(lifeTotal);
      const outOfGame =
        inactive.has(p.id)
        || Boolean((p as any).hasLost)
        || Boolean((p as any).eliminated)
        || (Number.isFinite(lifeNum) && lifeNum <= 0);
      return {
        id: p.id,
        name: p.name,
        seat: p.seat,
        inactive: outOfGame,
        hasLost: Boolean((p as any).hasLost) || (Number.isFinite(lifeNum) && lifeNum <= 0),
        eliminated: Boolean((p as any).eliminated) || outOfGame,
        lostReason: (p as any).lostReason || (p as any).lossReason,
        life: lifeTotal,
        isAI: Boolean((p as any).isAI),
        deckName: typeof (p as any).deckName === 'string' && (p as any).deckName.trim()
          ? (p as any).deckName
          : undefined,
      };
    }
  );

  debug(3, "[VIEW_FOR_DEBUG]", {
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
    replacementEffectHints: {
      damageActiveCount: damageReplacementActiveCount,
    },
    // Map turnNumber to turn for client compatibility
    turn: (state as any).turnNumber ?? 1,
    // Set viewer field for playable cards calculation
    // Exclude spectator:judge as they are not players in the game
    viewer: viewer === "spectator:judge" ? undefined : viewer,
    // Include max lands per turn for client-side validation
    maxLandsPerTurn: (state as any).maxLandsPerTurn || {},
  } as any;
}

