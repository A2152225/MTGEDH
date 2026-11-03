// server/src/state/modules/apply-event-handlers/applyEventGraveyardSpellCastReplay.ts
// B47: split from applyEventActivateGraveyardAbilityEvents.ts. Replays graveyard spell casts
// (flashback, jump-start, retrace, escape, graveyard-cast, beam-me-up) and disturb.
// Public entry symbols: replayGraveyardSpellCastActivation, replayDisturbCastActivation.
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { recordCardLeftGraveyardThisTurn } from "../turn-tracking.js";
import { buildDiscardProvenanceFields } from "../graveyardEntryUtils.js";
import { buildCastFromGraveyardCard } from "../graveyard-permissions.js";
import { generateDeterministicId, recordGraveyardPermanentTypesCastThisTurn, applyRecordedLifePayment } from "../applyEventReplayZoneCommanderManaHelpers.js";
import { buildDisturbCastCard, consumeRecordedManaCostFromPool } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { persistNamedSpellCastThisGame } from "../namedSpellsCastThisGame.js";
import { applyRecordedBeamUpReturnCost, applyRecordedGraveyardKeywordNonManaCost } from "./applyEventGraveyardCastCostReplay.js"; // B42

/** flashback / jump-start / retrace / escape / graveyard-cast / beam-me-up. */
export function replayGraveyardSpellCastActivation(ctx: GameContext, e: GameEvent, cardId: any, pid: any, abilityType: any): void {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              try {
                const discarded = (e as any).discardedCardIds;
                if (Array.isArray(discarded) && discarded.length > 0 && Array.isArray(z.hand)) {
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

                  for (const cid of discarded) {
                    const discardId = String(cid || '').trim();
                    if (!discardId) continue;
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === discardId);
                    if (handIndex === -1) continue;
                    const [discardedCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.graveyard as any[]).push({
                      ...discardedCard,
                      zone: 'graveyard',
                      ...buildDiscardProvenanceFields(ctx.state, String(pid)),
                    });
                  }

                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;

                  const stateAny = ctx.state as any;
                  stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                  stateAny.discardedCardThisTurn[String(pid)] = true;
                  stateAny.anyPlayerDiscardedCardThisTurn = true;
                }
              } catch {
                // best-effort only
              }

              try {
                const exiledFromHand = (e as any).exiledCardIdsFromHandForCost;
                if (Array.isArray(exiledFromHand) && exiledFromHand.length > 0 && Array.isArray(z.hand)) {
                  z.exile = Array.isArray(z.exile) ? z.exile : [];

                  for (const cid of exiledFromHand) {
                    const exileId = String(cid || '').trim();
                    if (!exileId) continue;
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === exileId);
                    if (handIndex === -1) continue;
                    const [exiledCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.exile as any[]).push({ ...exiledCard, zone: 'exile' });
                  }

                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;

                  const stateAny = ctx.state as any;
                  stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                  stateAny.discardedCardThisTurn[String(pid)] = true;
                  stateAny.anyPlayerDiscardedCardThisTurn = true;
                }
              } catch {
                // best-effort only
              }

              try {
                const exiledFromGraveyard = (e as any).exiledCardIdsFromGraveyardForCost;
                if (Array.isArray(exiledFromGraveyard) && exiledFromGraveyard.length > 0) {
                  z.exile = Array.isArray(z.exile) ? z.exile : [];

                  for (const cid of exiledFromGraveyard) {
                    const exileId = String(cid || '').trim();
                    if (!exileId) continue;
                    const graveyardIndex = (z.graveyard as any[]).findIndex((entry: any) => entry && String(entry.id) === exileId);
                    if (graveyardIndex === -1) continue;
                    const [exiledCard] = (z.graveyard as any[]).splice(graveyardIndex, 1);
                    (z.exile as any[]).push({ ...exiledCard, zone: 'exile' });
                  }

                  z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
                  z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;
                }
              } catch {
                // best-effort only
              }

              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                // Turn-tracking for intervening-if: a card left your graveyard this turn.
                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }

                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);
                applyRecordedGraveyardKeywordNonManaCost(ctx, String(pid), (e as any).nonManaCost); // B42
                applyRecordedBeamUpReturnCost(ctx, (e as any).beamedUpPermanentIdsForCost); // B42

                const stackId = String((e as any).stackId || '').trim() || generateDeterministicId(ctx, 'stack', String(cardId));
                const recordedTargets = Array.isArray((e as any).targets)
                  ? ((e as any).targets as any[]).map((targetId: any) => String(targetId || '').trim()).filter(Boolean)
                  : [];
                const alternateCostId = String((e as any).alternateCostId || '').trim() || undefined;
                const graveyardPermissionId = String((e as any).graveyardPermissionId || '').trim() || undefined;
                const graveyardPermissionSourceName = String((e as any).graveyardPermissionSourceName || '').trim() || undefined;
                const graveyardPermissionCostMode = String((e as any).graveyardPermissionCostMode || '').trim() || undefined;
                const xValue = Number.isFinite(Number((e as any).xValue))
                  ? Math.max(0, Math.floor(Number((e as any).xValue)))
                  : undefined;
                ctx.state.stack = ctx.state.stack || [];
                const graveyardCastCard = {
                  ...buildCastFromGraveyardCard(card, String(abilityType)),
                  castFromGraveyard: true,
                  castSourceZone: 'graveyard',
                  fromZone: 'graveyard',
                  ...(alternateCostId ? { alternateCostId } : {}),
                  ...((e as any).castWithoutPayingManaCost === true ? { castWithoutPayingManaCost: true } : {}),
                  ...(xValue !== undefined ? { xValue } : {}),
                  ...(graveyardPermissionId ? { graveyardPermissionId } : {}),
                  ...(graveyardPermissionSourceName ? { graveyardPermissionSourceName } : {}),
                  ...(graveyardPermissionCostMode ? { graveyardPermissionCostMode } : {}),
                };
                (ctx.state.stack as any[]).push({
                  id: stackId,
                  type: 'spell', // B46 replay scrub
                  controller: pid,
                  card: graveyardCastCard,
                  ...(manaCost ? { manaCost } : {}),
                  castFromGraveyard: true,
                  castSourceZone: 'graveyard',
                  fromZone: 'graveyard',
                  ...(alternateCostId ? { alternateCostId } : {}),
                  ...((e as any).castWithoutPayingManaCost === true ? { castWithoutPayingManaCost: true } : {}),
                  ...(xValue !== undefined ? { xValue } : {}),
                  ...(graveyardPermissionId ? { graveyardPermissionId } : {}),
                  ...(graveyardPermissionSourceName ? { graveyardPermissionSourceName } : {}),
                  ...(graveyardPermissionCostMode ? { graveyardPermissionCostMode } : {}),
                  targets: recordedTargets,
                  ...(graveyardCastCard?.entersBattlefieldWithCounters && typeof graveyardCastCard.entersBattlefieldWithCounters === 'object'
                    ? { entersBattlefieldWithCounters: { ...(graveyardCastCard.entersBattlefieldWithCounters as Record<string, number>) } }
                    : {}),
                });

                const stateAny = ctx.state as any;
                stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
                stateAny.castFromGraveyardThisTurn[String(pid)] = true;
                recordGraveyardPermanentTypesCastThisTurn(stateAny, String(pid), card);
                stateAny.spellsCastThisTurn = Array.isArray(stateAny.spellsCastThisTurn) ? stateAny.spellsCastThisTurn : [];
                stateAny.spellsCastThisTurn.push({
                  id: card?.id || cardId,
                  name: card?.name,
                  casterId: pid,
                  castSourceZone: 'graveyard',
                  card: {
                    id: card?.id || cardId,
                    name: card?.name,
                    type_line: card?.type_line,
                    colors: card?.colors,
                    color_identity: card?.color_identity,
                    castSourceZone: 'graveyard',
                  },
                });
                persistNamedSpellCastThisGame(stateAny, String(pid), { name: card?.name, id: card?.id || cardId });
                if (!String(card?.type_line || '').toLowerCase().includes('creature')) {
                  stateAny.noncreatureSpellsCastThisTurn = stateAny.noncreatureSpellsCastThisTurn || {};
                  stateAny.noncreatureSpellsCastThisTurn[String(pid)] =
                    ((stateAny.noncreatureSpellsCastThisTurn[String(pid)] as number | undefined) || 0) + 1;
                }
              }
            }
}

/** disturb (cast transformed from graveyard). */
export function replayDisturbCastActivation(ctx: GameContext, e: GameEvent, cardId: any, pid: any, abilityType: any): void {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);
                applyRecordedGraveyardKeywordNonManaCost(ctx, String(pid), (e as any).nonManaCost); // B42
                applyRecordedBeamUpReturnCost(ctx, (e as any).beamedUpPermanentIdsForCost); // B42

                const stateAny = ctx.state as any;
                stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
                stateAny.castFromGraveyardThisTurn[String(pid)] = true;
                const disturbSpellCard = buildDisturbCastCard(card);
                recordGraveyardPermanentTypesCastThisTurn(stateAny, String(pid), disturbSpellCard);
                stateAny.spellsCastThisTurn = Array.isArray(stateAny.spellsCastThisTurn) ? stateAny.spellsCastThisTurn : [];
                stateAny.spellsCastThisTurn.push({
                  id: disturbSpellCard?.id || cardId,
                  name: disturbSpellCard?.name,
                  casterId: pid,
                  castSourceZone: 'graveyard',
                  card: {
                    id: disturbSpellCard?.id || cardId,
                    name: disturbSpellCard?.name,
                    type_line: disturbSpellCard?.type_line,
                    colors: disturbSpellCard?.colors,
                    color_identity: card?.color_identity,
                    castSourceZone: 'graveyard',
                  },
                });
                persistNamedSpellCastThisGame(stateAny, String(pid), { name: disturbSpellCard?.name, id: disturbSpellCard?.id || cardId });
                if (!String(disturbSpellCard?.type_line || '').toLowerCase().includes('creature')) {
                  stateAny.noncreatureSpellsCastThisTurn = stateAny.noncreatureSpellsCastThisTurn || {};
                  stateAny.noncreatureSpellsCastThisTurn[String(pid)] =
                    ((stateAny.noncreatureSpellsCastThisTurn[String(pid)] as number | undefined) || 0) + 1;
                }

                const stackId = String((e as any).stackId || '').trim() || generateDeterministicId(ctx, 'stack', String(cardId));
                const recordedTargets = Array.isArray((e as any).targets)
                  ? ((e as any).targets as any[]).map((targetId: any) => String(targetId || '').trim()).filter(Boolean)
                  : [];
                ctx.state.stack = ctx.state.stack || [];
                (ctx.state.stack as any[]).push({
                  id: stackId,
                  type: 'spell',
                  controller: pid,
                  card: disturbSpellCard,
                  targets: recordedTargets,
                });
              }
            }
}
