// server/src/state/modules/apply-event-handlers/applyEventGraveyardPermanentAbilityReplay.ts
// B47: split from applyEventActivateGraveyardAbilityEvents.ts. Replays graveyard abilities that
// make permanents or counters: unearth, embalm/eternalize, scavenge/encore, exile-to-add-counters.
// Public entry symbols: replayUnearthActivation, replayEmbalmEternalizeActivation, replayScavengeEncoreActivation, replayExileToAddCountersActivation.
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { recordCardLeftGraveyardThisTurn } from "../turn-tracking.js";
import { buildEmbalmOrEternalizeTokenPermanent } from "../graveyard-tokens.js";
import { generateDeterministicId, applyRecordedLifePayment } from "../applyEventReplayZoneCommanderManaHelpers.js";
import { consumeRecordedManaCostFromPool } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { applyRecordedBeamUpReturnCost, applyRecordedGraveyardKeywordNonManaCost } from "./applyEventGraveyardCastCostReplay.js"; // B42

/** unearth. */
export function replayUnearthActivation(ctx: GameContext, e: GameEvent, cardId: any, pid: any, abilityType: any): void {
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
}

/** embalm / eternalize. */
export function replayEmbalmEternalizeActivation(ctx: GameContext, e: GameEvent, cardId: any, pid: any, abilityType: any): void {
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
}

/** scavenge / encore. */
export function replayScavengeEncoreActivation(ctx: GameContext, e: GameEvent, cardId: any, pid: any, abilityType: any): void {
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
}

/** exile-to-add-counters. */
export function replayExileToAddCountersActivation(ctx: GameContext, e: GameEvent, cardId: any, pid: any, abilityType: any): void {
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
}
