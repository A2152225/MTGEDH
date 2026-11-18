// applyEvent handlers for Planechase / Archenemy zone mutations.
// Restores planar deck, face-up plane, and scheme zones from event snapshots.
// Live play mutates via planechaseRuntime / archenemyRuntime before appendEvent;
// replay rebuilds from these payloads (triggers are not re-queued while isReplaying).
//
// Handles: planeswalk, setSchemeInMotion, abandonScheme, importVariantDecks, planarDieRoll

import type { GameContext } from '../../context.js';
import type { GameEvent } from '../../types.js';
import { debugWarn } from '../../../utils/debug.js';
import { seedActivePlaneAliases } from '../planechaseRuntime.js';
import { applyVariantDeckSnapshot } from '../variantDeckSeeding.js';
import { applyPlanarDieRollSnapshot } from '../planarDieSpecialAction.js';

export function applyPlanechaseArchenemyEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {
    case 'importVariantDecks': {
      // Deck import seeded the planar/scheme decks; restore the exact shuffled snapshot.
      try {
        applyVariantDeckSnapshot(ctx.state as any, e as any);
        ctx.bumpSeq();
      } catch (err) {
        debugWarn(1, 'applyEvent(importVariantDecks): failed', err);
      }
      break;
    }

    case 'planarDieRoll': {
      // Roll action (CR 901.9): restore the per-turn counter, cost and history only. The face's
      // effects are replayed by their own events (planeswalk snapshot / pushTriggeredAbility).
      try {
        applyPlanarDieRollSnapshot(ctx.state as any, e as any);
        ctx.bumpSeq();
      } catch (err) {
        debugWarn(1, 'applyEvent(planarDieRoll): failed', err);
      }
      break;
    }

    case 'planeswalk': {
      try {
        const stateAny = ctx.state as any;
        const toPlane = (e as any).toPlane ?? null;
        const deck = Array.isArray((e as any).planarDeckFaceDown)
          ? (e as any).planarDeckFaceDown.map((card: any) => card)
          : Array.isArray(stateAny.planarDeckFaceDown)
            ? stateAny.planarDeckFaceDown
            : [];
        stateAny.planarDeckFaceDown = deck;
        seedActivePlaneAliases(stateAny, toPlane);
        if ((e as any).playerId) {
          stateAny.planarController = String((e as any).playerId);
        }
        stateAny.planeswalkedThisTurn = true;
        if ((e as any).planeswalksAttempted != null) {
          stateAny.planeswalksAttempted = Number((e as any).planeswalksAttempted) || 0;
        } else {
          stateAny.planeswalksAttempted = Math.max(0, Number(stateAny.planeswalksAttempted) || 0) + 1;
        }
        if ((e as any).planeswalkedToThisTurn) {
          stateAny.planeswalkedToThisTurn = (e as any).planeswalkedToThisTurn;
          stateAny.planeswalkedToPlanesThisTurn = (e as any).planeswalkedToThisTurn;
        }
        if (typeof (e as any).chaoticAetherActive === 'boolean') {
          stateAny.chaoticAetherActive = (e as any).chaoticAetherActive;
        }
        ctx.bumpSeq();
      } catch (err) {
        debugWarn(1, 'applyEvent(planeswalk): failed', err);
      }
      break;
    }

    case 'setSchemeInMotion': {
      try {
        const stateAny = ctx.state as any;
        if (Array.isArray((e as any).schemeDeck)) stateAny.schemeDeck = [...(e as any).schemeDeck];
        if (Array.isArray((e as any).ongoingSchemes)) {
          stateAny.ongoingSchemes = [...(e as any).ongoingSchemes];
          stateAny.activeSchemes = stateAny.ongoingSchemes;
        }
        if (Array.isArray((e as any).schemeGraveyard)) {
          stateAny.schemeGraveyard = [...(e as any).schemeGraveyard];
        }
        if ((e as any).lastSchemeInMotion !== undefined) {
          stateAny.lastSchemeInMotion = (e as any).lastSchemeInMotion;
        } else if ((e as any).scheme && (e as any).ongoing !== true) {
          stateAny.lastSchemeInMotion = (e as any).scheme;
        }
        if ((e as any).playerId) {
          stateAny.archenemyPlayerId = String((e as any).playerId);
        }
        ctx.bumpSeq();
      } catch (err) {
        debugWarn(1, 'applyEvent(setSchemeInMotion): failed', err);
      }
      break;
    }

    case 'abandonScheme': {
      try {
        const stateAny = ctx.state as any;
        if (Array.isArray((e as any).schemeDeck)) stateAny.schemeDeck = [...(e as any).schemeDeck];
        if (Array.isArray((e as any).ongoingSchemes)) {
          stateAny.ongoingSchemes = [...(e as any).ongoingSchemes];
          stateAny.activeSchemes = stateAny.ongoingSchemes;
        }
        if (Array.isArray((e as any).schemeGraveyard)) {
          stateAny.schemeGraveyard = [...(e as any).schemeGraveyard];
        } else if ((e as any).scheme) {
          stateAny.schemeGraveyard = Array.isArray(stateAny.schemeGraveyard)
            ? stateAny.schemeGraveyard
            : [];
          const sid = String((e as any).schemeId || (e as any).scheme?.id || '');
          if (sid && !stateAny.schemeGraveyard.some((s: any) => String(s?.id) === sid)) {
            stateAny.schemeGraveyard.push((e as any).scheme);
          }
          if (Array.isArray(stateAny.ongoingSchemes)) {
            stateAny.ongoingSchemes = stateAny.ongoingSchemes.filter(
              (s: any) => String(s?.id || '') !== sid,
            );
            stateAny.activeSchemes = stateAny.ongoingSchemes;
          }
        }
        ctx.bumpSeq();
      } catch (err) {
        debugWarn(1, 'applyEvent(abandonScheme): failed', err);
      }
      break;
    }

    default:
      return false;
  }

  return true;
}
