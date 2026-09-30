/**
 * socket/resolution-handlers/targetSelectionSacrificeFollowupHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the two "you picked which permanent to sacrifice, now pay out" branches -
 * the generic `sacrificeWhenYouDo` reflexive trigger (sacrifice, then push the follow-up ability
 * with inferred target metadata) and `sacrificeAnotherPermanentForBenefitChoice` (sacrifice, gain
 * life, draw). `targetDescriptionFromType` came along because only this cluster read it.
 * Public entry symbols: handleSacrificeWhenYouDoTargetSelection,
 * handleSacrificeAnotherPermanentForBenefitTargetSelection.
 *
 * Both branches always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { inferFollowupTargetMetadata } from "../resolutionDiscardTriggerUtils.js";
import {
  buildTriggeredAbilitySourceContext,
  getResolutionSourcePermanentSnapshot,
} from "../resolutionKeywordChoiceHandlers.js";
import { broadcastGame, getEffectivePower, getEffectiveToughness, getPlayerName } from "../util.js";

/**
 * Last-known information for the permanent about to be sacrificed (rule 608.2h): the reflexive
 * follow-up ("damage equal to the sacrificed creature's power", "if it was a Giant") reads it after the
 * permanent has left the battlefield. Power/toughness are the current, lord-adjusted values.
 */
function snapshotPermanentBeforeSacrifice(game: any, permanent: any): Record<string, unknown> | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;
  const power = getEffectivePower(permanent, game.state);
  const toughness = getEffectiveToughness(permanent, game.state);
  const card = permanent.card || {};
  return {
    id: String(permanent.id || ''),
    name: String(card.name || permanent.name || 'permanent'),
    controller: String(permanent.controller || ''),
    owner: String(permanent.owner || permanent.ownerId || permanent.controller || ''),
    typeLine: String(card.type_line || '').toLowerCase(),
    power: Number.isFinite(power) ? power : null,
    effectivePower: Number.isFinite(power) ? power : undefined,
    toughness: Number.isFinite(toughness) ? toughness : null,
    manaValue: null,
    colors: Array.isArray(card.colors) ? [...card.colors] : [],
    card: permanent.card ? { ...permanent.card } : undefined,
  };
}

function targetDescriptionFromType(targetType: string | undefined): string {
  const normalized = String(targetType || '').trim().toLowerCase();
  if (!normalized || normalized === 'any' || normalized === 'any target' || normalized === 'any_target') {
    return 'any target';
  }
  return `target ${targetType}`;
}

/** TARGET_SELECTION with `sacrificeWhenYouDo`: sacrifice, then queue the reflexive follow-up. */
export function handleSacrificeWhenYouDoTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];

  const subtype = String((step as any).sacrificeWhenYouDoSubtype || '').trim();
  const damage = Number((step as any).sacrificeWhenYouDoDamage || 0);
  const lifeGain = Number((step as any).sacrificeWhenYouDoLifeGain || 0);
  const controllerId = String((step as any).sacrificeWhenYouDoController || pid);
  const sourceName = String((step as any).sacrificeWhenYouDoSourceName || step.sourceName || 'Ability');
  const sourcePermanentId = (step as any).sacrificeWhenYouDoSourcePermanentId as string | undefined;
  const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, step as any, sourcePermanentId || undefined);
  const sourceContext = buildTriggeredAbilitySourceContext(sourcePermanentSnapshot);
  const explicitFollowupDescription = String(
    (step as any).sacrificeWhenYouDoFollowupDescription ||
    (step as any).sacrificeWhenYouDoFollowupEffect ||
    ''
  ).trim();
  const permanentIdToSac = selections[0];
  const sacrificedPermanent = (game.state?.battlefield || []).find((p: any) => p?.id === permanentIdToSac);
  const sacrificedName = String(sacrificedPermanent?.card?.name || '').trim() || `a ${subtype}`;
  const sacrificedSnapshot = snapshotPermanentBeforeSacrifice(game, sacrificedPermanent);
  const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const triggerDescription = explicitFollowupDescription || `${sourceName} deals ${damage} damage to any target and you gain ${lifeGain} life.`;
  const targetMetadata = explicitFollowupDescription
    ? inferFollowupTargetMetadata(game, controllerId, sourceName, sourcePermanentId, triggerDescription, sourcePermanentSnapshot)
    : { requiresTarget: true, needsTargetSelection: true, targetType: 'any_target' };
  const targetType = String((targetMetadata as any).targetType || '').trim();
  const targetDescription = String(
    (step as any).sacrificeWhenYouDoTargetDescription ||
    (targetMetadata as any).targetDescription ||
    targetDescriptionFromType(targetType)
  ).trim();
  const sacrificeResolvePayload = {
    playerId: controllerId,
    sourceName,
    sourcePermanentId,
    sacrificedPermanentId: permanentIdToSac,
    subtype,
    damage,
    lifeGain,
    triggerId,
    description: triggerDescription,
    effect: triggerDescription,
    targetDescription,
    ...(sacrificedSnapshot ? { lastSacrificedPermanents: [sacrificedSnapshot] } : {}),
    ...sourceContext,
    ...targetMetadata,
  };

  game.applyEvent({
    type: 'sacrificeWhenYouDoResolve',
    ...sacrificeResolvePayload,
  } as any);

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: ${getPlayerName(game, controllerId)} sacrificed ${sacrificedName}.`,
    ts: Date.now(),
  });

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'sacrificeWhenYouDoResolve', sacrificeResolvePayload);
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist sacrificeWhenYouDoResolve event:', err);
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
      triggerId,
      sourceId: sourcePermanentId || null,
      ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
      sourceName,
      controllerId,
      description: triggerDescription,
      effect: triggerDescription,
      mandatory: true,
      ...(sacrificedSnapshot ? { lastSacrificedPermanents: [sacrificedSnapshot] } : {}),
      ...sourceContext,
      ...targetMetadata,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist pushTriggeredAbility for sacrificeWhenYouDo:', err);
  }

  broadcastGame(io, game, gameId);
}

/** TARGET_SELECTION with `sacrificeAnotherPermanentForBenefitChoice`: sacrifice, gain life, draw. */
export async function handleSacrificeAnotherPermanentForBenefitTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];

  const controllerId = String((step as any).sacrificeAnotherPermanentForBenefitController || pid);
  const lifeGain = Number((step as any).sacrificeAnotherPermanentForBenefitLifeGain || 0);
  const drawCount = Number((step as any).sacrificeAnotherPermanentForBenefitDrawCount || 0);
  const sourceName = String((step as any).sacrificeAnotherPermanentForBenefitSourceName || step.sourceName || 'Ability');
  const sourcePermanentId = String((step as any).sacrificeAnotherPermanentForBenefitSourcePermanentId || step.sourceId || '').trim();
  const permanentIdToSac = selections[0];
  const battlefieldBefore = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const permanentBefore = battlefieldBefore.find((permanent: any) => permanent && String(permanent.id || '') === String(permanentIdToSac));
  const sacrificedPermanentSnapshot = permanentBefore && typeof permanentBefore === 'object'
    ? JSON.parse(JSON.stringify(permanentBefore))
    : undefined;

  const ctx = {
    state: game.state,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    zones: game.state?.zones,
    gameId,
  } as unknown as GameContext;

  const sacrificedName = sacrificePermanent(ctx, permanentIdToSac, controllerId);
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: ${getPlayerName(game, controllerId)} sacrificed ${sacrificedName || 'a permanent'}.`,
    ts: Date.now(),
  });

  // Gain life
  const startingLife = game.state.startingLife || 40;
  game.state.life = game.state.life || {};
  const currentLife = game.state.life?.[controllerId] ?? startingLife;
  game.state.life[controllerId] = currentLife + lifeGain;
  const playerObj = ((game.state as any).players || []).find((player: any) => String(player?.id || '') === controllerId);
  if (playerObj) playerObj.life = game.state.life[controllerId];

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: ${getPlayerName(game, controllerId)} gains ${lifeGain} life${drawCount > 0 ? ` and draws ${drawCount} card${drawCount === 1 ? '' : 's'}` : ''}.`,
    ts: Date.now(),
  });

  if (drawCount > 0 && typeof (game as any).drawCards === 'function') {
    (game as any).drawCards(controllerId, drawCount);
  } else {
    const zones = game.state?.zones?.[controllerId];
    if (zones) {
      zones.hand = zones.hand || [];
      const lib = (game as any).libraries?.get?.(controllerId) || zones.library || [];
      if (Array.isArray(lib)) {
        for (let i = 0; i < drawCount; i++) {
          if (lib.length <= 0) break;
          const drawn = lib.shift();
          zones.hand.push({ ...drawn, zone: 'hand' });
        }
      }
      zones.handCount = zones.hand.length;
      zones.libraryCount = Array.isArray(lib) ? lib.length : zones.libraryCount;
      if ((game as any).libraries?.set && Array.isArray(lib)) {
        (game as any).libraries.set(controllerId, lib);
      }
    }
  }

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'sacrificeAnotherPermanentForBenefitResolve', {
      playerId: pid,
      controllerId,
      sourceId: sourcePermanentId || undefined,
      sourceName,
      resolvedStepId: String(step.id || '').trim() || undefined,
      sacrificedPermanentId: String(permanentIdToSac || '').trim(),
      sacrificedName: sacrificedName || sacrificedPermanentSnapshot?.card?.name || undefined,
      sacrificedPermanentSnapshot,
      lifeGain,
      drawCount,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist sacrificeAnotherPermanentForBenefitResolve event:', err);
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
}
