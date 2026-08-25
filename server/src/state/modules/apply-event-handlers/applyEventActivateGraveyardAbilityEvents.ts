// server/src/state/modules/apply-event-handlers/applyEventActivateGraveyardAbilityEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: The activateGraveyardAbility event: paying and resolving graveyard activated abilities.
// Public entry: applyActivateGraveyardAbilityEvents(ctx, e) -> true when it handled the event.
//
// Handles: activateGraveyardAbility
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { recordCardLeftGraveyardThisTurn } from "../turn-tracking.js";
import { buildDiscardProvenanceFields } from "../graveyardEntryUtils.js";
import { filterLibraryCardsForSearch } from "../../../socket/library-search.js";
import { buildEmbalmOrEternalizeTokenPermanent } from "../graveyard-tokens.js";
import { buildCastFromGraveyardCard } from "../graveyard-permissions.js";
import {
  generateDeterministicId,
  recordGraveyardPermanentTypesCastThisTurn,
  applyRecordedLifePayment,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import { buildDisturbCastCard, consumeRecordedManaCostFromPool } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager } from "../../resolution/index.js";

export function applyActivateGraveyardAbilityEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "activateGraveyardAbility": {
        // Graveyard ability (flashback, unearth, etc.)
        // The specific effect depends on the ability, but typically moves the card
        const cardId = (e as any).cardId;
        const pid = (e as any).playerId;
        const abilityType = (e as any).abilityType ?? (e as any).abilityId;
        try {
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const replayGameId = String((ctx as any).gameId || '').trim();
          const queuedStepType = String((rawQueuedStep as any)?.type || '').trim();
          if (replayGameId && rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) && queuedStepType) {
            try {
              const discardedForCost = Array.isArray((rawQueuedStep as any)?.discardedCardIdsForCost)
                ? ((rawQueuedStep as any).discardedCardIdsForCost as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
              const exiledFromHandForCost = Array.isArray((rawQueuedStep as any)?.exiledCardIdsFromHandForCost)
                ? ((rawQueuedStep as any).exiledCardIdsFromHandForCost as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
              const zones = ctx.state.zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.hand)) {
                if (discardedForCost.length > 0) {
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
                  for (const discardId of discardedForCost) {
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
                }
                if (exiledFromHandForCost.length > 0) {
                  z.exile = Array.isArray(z.exile) ? z.exile : [];
                  for (const exileId of exiledFromHandForCost) {
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
              }
            } catch {
              // best-effort only
            }

            const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
            const queuedStepId = String((rawQueuedStep as any)?.id || '').trim();
            const alreadyPresent = Boolean(
              (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
              (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
            );

            if (!alreadyPresent) {
              ResolutionQueueManager.addStep(replayGameId, {
                ...(rawQueuedStep as any),
                ...(queuedStepId ? { id: queuedStepId } : {}),
                type: queuedStepType as any,
                playerId: String((rawQueuedStep as any).playerId || pid || '') as any,
                description: String((rawQueuedStep as any).description || ''),
                mandatory: (rawQueuedStep as any).mandatory !== false,
              } as any);
            }

            ctx.bumpSeq();
            break;
          }

          if (cardId && pid && ['flashback', 'jump-start', 'retrace', 'escape', 'graveyard-cast'].includes(String(abilityType))) {
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
                if (!String(card?.type_line || '').toLowerCase().includes('creature')) {
                  stateAny.noncreatureSpellsCastThisTurn = stateAny.noncreatureSpellsCastThisTurn || {};
                  stateAny.noncreatureSpellsCastThisTurn[String(pid)] =
                    ((stateAny.noncreatureSpellsCastThisTurn[String(pid)] as number | undefined) || 0) + 1;
                }
              }
            }
          } else if (cardId && pid && abilityType === 'unearth') {
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

                const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                  ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                  : [];
                const stateAny = ctx.state as any;
                const currentTurn = Number(stateAny?.turnNumber ?? stateAny?.turn ?? 0) || 0;
                const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
                const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
                const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
                const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

                ctx.state.battlefield = ctx.state.battlefield || [];
                const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', String(cardId));
                (ctx.state.battlefield as any[]).push({
                  id: createdPermanentId,
                  controller: pid,
                  owner: pid,
                  tapped: false,
                  wasUnearthed: true,
                  unearthed: true,
                  counters: {},
                  leaveBattlefieldReplacementDestination: 'exile',
                  leaveBattlefieldReplacementSourceName: String(card?.name || 'Unearth'),
                  card: {
                    ...card,
                    zone: 'battlefield',
                    unearth: true,
                    wasUnearthed: true,
                    leaveBattlefieldReplacementDestination: 'exile',
                    leaveBattlefieldReplacementSourceName: String(card?.name || 'Unearth'),
                  },
                });
                stateAny.pendingExileAtNextEndStep = Array.isArray(stateAny.pendingExileAtNextEndStep)
                  ? stateAny.pendingExileAtNextEndStep
                  : [];
                const pendingExileAtNextEndStep = stateAny.pendingExileAtNextEndStep as any[];
                if (!pendingExileAtNextEndStep.some((entry: any) => String(entry?.permanentId || '') === String(createdPermanentId))) {
                  pendingExileAtNextEndStep.push({
                    permanentId: createdPermanentId,
                    fireAtTurnNumber,
                    sourceName: String(card?.name || 'Unearth'),
                    createdBy: pid,
                  });
                }
              }
            }
          } else if (cardId && pid && (abilityType === 'embalm' || abilityType === 'eternalize')) {
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

                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: 'exile' });
                z.exileCount = (z.exile as any[]).length;

                const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                  ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                  : [];
                ctx.state.battlefield = ctx.state.battlefield || [];
                const createdPermanentId = createdPermanentIds.shift()
                  || generateDeterministicId(ctx, abilityType === 'eternalize' ? 'token_eternalize' : 'token_embalm', String(cardId));
                (ctx.state.battlefield as any[]).push(
                  buildEmbalmOrEternalizeTokenPermanent(card, abilityType as 'embalm' | 'eternalize', String(pid), createdPermanentId),
                );
              }
            }
          } else if (cardId && pid && abilityType === 'disturb') {
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
                  controller: pid,
                  card: disturbSpellCard,
                  targets: recordedTargets,
                });
              }
            }
          } else if (cardId && pid && (abilityType === 'scavenge' || abilityType === 'encore')) {
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

                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: 'exile' });
                z.exileCount = (z.exile as any[]).length;

                if (abilityType === 'encore') {
                  const stateAny = ctx.state as any;
                  const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                    ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                    : [];
                  const players = Array.isArray(stateAny?.players) ? stateAny.players : [];
                  const encoreTargetPlayerIds = Array.isArray((e as any).encoreTargetPlayerIds)
                    ? (e as any).encoreTargetPlayerIds.map((value: any) => String(value))
                    : players
                        .filter((player: any) => player?.id && String(player.id) !== String(pid) && !player.hasLost)
                        .map((player: any) => String(player.id));
                  const currentTurn = Number(stateAny?.turnNumber ?? stateAny?.turn ?? 0) || 0;
                  const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
                  const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
                  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
                  const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

                  ctx.state.battlefield = ctx.state.battlefield || [];
                  stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
                    ? stateAny.pendingSacrificeAtNextEndStep
                    : [];

                  const existingKeywords = Array.isArray(card?.keywords) ? [...card.keywords] : [];
                  if (!existingKeywords.some((ability: string) => String(ability).toLowerCase() === 'haste')) {
                    existingKeywords.push('Haste');
                  }
                  const power = Number.parseInt(String(card?.power ?? ''), 10);
                  const toughness = Number.parseInt(String(card?.toughness ?? ''), 10);
                  const oracleText = String(card?.oracle_text || '');
                  const oracleWithHaste = /(^|\n)haste(\n|$)/i.test(oracleText)
                    ? oracleText
                    : `${oracleText}${oracleText ? '\n' : ''}Haste`;

                  for (const targetPlayerId of encoreTargetPlayerIds) {
                    const tokenId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'token_encore', `${String(cardId)}:${String(targetPlayerId)}`);
                    (ctx.state.battlefield as any[]).push({
                      id: tokenId,
                      controller: pid,
                      owner: pid,
                      tapped: false,
                      counters: {},
                      summoningSickness: false,
                      isToken: true,
                      mustAttack: true,
                      encoreAttackPlayerId: String(targetPlayerId),
                      copiedFromCardId: String(card?.id || ''),
                      ...(Number.isFinite(power) ? { basePower: power } : {}),
                      ...(Number.isFinite(toughness) ? { baseToughness: toughness } : {}),
                      grantedAbilities: existingKeywords,
                      card: {
                        ...card,
                        id: tokenId,
                        zone: 'battlefield',
                        oracle_text: oracleWithHaste,
                        keywords: existingKeywords,
                      },
                    });
                    stateAny.pendingSacrificeAtNextEndStep.push({
                      permanentId: tokenId,
                      fireAtTurnNumber,
                      maxManaValue: 0,
                      sourceName: String(card?.name || 'Encore'),
                      createdBy: pid,
                    });
                  }
                }
              }
            }
          } else if (cardId && pid && abilityType === 'exile-to-add-counters') {
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

                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: 'exile' });
                z.exileCount = (z.exile as any[]).length;

                const creatureType = String((e as any).creatureType || '').trim().toLowerCase();
                if (creatureType) {
                  const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
                  const creatureTypePattern = new RegExp(`\\b${creatureType}s?\\b`, 'i');
                  for (const perm of battlefield as any[]) {
                    if (!perm || String(perm.controller) !== String(pid)) continue;
                    const typeLine = String(perm.card?.type_line || '').toLowerCase();
                    if (!typeLine.includes('creature') || !creatureTypePattern.test(typeLine)) continue;
                    const counters = ((perm as any).counters || {}) as Record<string, number>;
                    counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
                    (perm as any).counters = counters;
                  }
                }
              }
            }
          } else if (cardId && pid && (e as any).isTutor === true) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            const gameId = (ctx as any).gameId;
            if (z && Array.isArray(z.graveyard) && gameId) {
              const graveyard = z.graveyard as any[];
              const card = graveyard.find((c: any) => c && String(c.id) === String(cardId));
              if (card) {
                const manaCost = String((e as any).manaCost || '').trim();
                  const exileSourceOnActivate = (e as any).exileSourceOnActivate === true;
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                  if (exileSourceOnActivate) {
                    const cardIndex = graveyard.findIndex((entry: any) => entry && String(entry.id) === String(cardId));
                    if (cardIndex !== -1) {
                      const [movedCard] = graveyard.splice(cardIndex, 1);
                      z.graveyardCount = graveyard.length;
                      z.exile = Array.isArray((z as any).exile) ? (z as any).exile : [];
                      z.exile.push({ ...movedCard, zone: 'exile' });
                      z.exileCount = z.exile.length;
                      recordCardLeftGraveyardThisTurn(ctx as any, String(pid), movedCard);
                    }
                  }

                const destination = String((e as any).destination || 'hand');
                const searchCriteria = String((e as any).searchCriteria || 'any card');
                const maxSelectionsRaw = Number((e as any).maxSelections);
                const maxSelections = Number.isFinite(maxSelectionsRaw) ? maxSelectionsRaw : 1;
                const filter = ((e as any).filter && typeof (e as any).filter === 'object') ? { ...((e as any).filter as any) } : {};
                const availableCards = filterLibraryCardsForSearch(
                  ctx.libraries.get(pid) || [],
                  filter,
                  ctx.state as any,
                  pid,
                );

                ResolutionQueueManager.addStep(gameId, {
                  type: 'library_search' as any,
                  playerId: pid,
                  sourceId: String(cardId),
                  sourceName: String(card?.name || 'Card'),
                  description: searchCriteria ? `Search for: ${searchCriteria}` : 'Search your library',
                  searchCriteria,
                  minSelections: 0,
                  maxSelections,
                  mandatory: false,
                  destination,
                  reveal: false,
                  shuffleAfter: true,
                  availableCards,
                  filter,
                  splitDestination: (e as any).splitDestination === true,
                  toBattlefield: Number((e as any).toBattlefield || 1),
                  toHand: Number((e as any).toHand || 1),
                  entersTapped: (e as any).entersTapped === true,
                  persistLibrarySearchResolve: true,
                  persistLibrarySearchResolveReason: 'graveyard_ability',
                  persistLibrarySearchResolveAbilityId: String(abilityType || ''),
                } as any);
              }
            }
          } else if (
            cardId &&
            pid &&
            (abilityType === 'return-from-graveyard' || abilityType === 'graveyard-activated' || String(abilityType || '').includes('-return-')) &&
            (e as any).isTutor !== true
          ) {
            const destination = String((e as any).destination || '');
            const manaCost = String((e as any).manaCost || '').trim();
            const tappedCreatureIds = Array.isArray((e as any).tappedCreatureIds)
              ? ((e as any).tappedCreatureIds as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (destination === 'hand' || destination === 'battlefield') {
              const zones = ctx.state.zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.graveyard)) {
                const graveyard = z.graveyard as any[];
                const idx = graveyard.findIndex((c: any) => c.id === cardId);
                if (idx !== -1) {
                  const [card] = graveyard.splice(idx, 1);
                  z.graveyardCount = graveyard.length;

                  recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                  const manaPool = (ctx.state as any).manaPool?.[pid];
                  if (manaPool && manaCost) {
                    consumeRecordedManaCostFromPool(manaPool, manaCost);
                  }
                  applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                  if (tappedCreatureIds.length > 0) {
                    const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
                    for (const permanentId of tappedCreatureIds) {
                      const permanent = battlefield.find((entry: any) => entry && String(entry.id) === String(permanentId));
                      if (permanent) {
                        (permanent as any).tapped = true;
                      }
                    }

                    const stateAny = ctx.state as any;
                    stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                    stateAny.tappedNonlandPermanentThisTurnByPlayer[String(pid)] = true;
                  }

                  const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                    ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                    : [];
                  if (destination === 'battlefield') {
                    ctx.state.battlefield = ctx.state.battlefield || [];
                    const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', String(cardId));
                    (ctx.state.battlefield as any[]).push({
                      id: createdPermanentId,
                      controller: pid,
                      owner: pid,
                      tapped: false,
                      counters: {},
                      card: { ...card, zone: 'battlefield' },
                    });
                  } else {
                    z.hand = z.hand || [];
                    (z.hand as any[]).push({ ...card, zone: 'hand' });
                    z.handCount = (z.hand as any[]).length;
                  }
                }
              }
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(activateGraveyardAbility): failed", err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
