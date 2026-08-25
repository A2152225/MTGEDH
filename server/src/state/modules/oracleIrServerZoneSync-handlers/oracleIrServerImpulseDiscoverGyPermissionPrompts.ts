// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerImpulseDiscoverGyPermissionPrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: graveyard-cast permission metadata, impulse-exile play
//   permissions, choose-one impulse exile play prompts, and discover
//   cast-or-hand prompts, plus the helpers they close over.
// Public entry symbols: collectGrantGraveyardPermissionModifyMetadata,
//   resolveGrantGraveyardCastChoiceCard,
//   syncGraveyardCastFreeExilePermissionsFromOracleIR,
//   syncImpulseExilePlayPermissionsToState,
//   queueChooseOneImpulseExilePlayPromptsFromOracleIRResult,
//   queueDiscoverCastOrHandPromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import {
  getPlayableUntilTurnForImpulseDuration,
  impulseExileTopIsDiscoverCastOrHand,
  impulseExileTopRequiresChooseOne,
} from '../../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { queueCastFromExileResolutionPrompt } from '../triggerCastFromExileUtils.js';

export function collectGrantGraveyardPermissionModifyMetadata(
  result: OracleIRExecutionResult,
): { withoutPayingManaCost: boolean; exileAfterResolution: boolean } {
  const steps = [
    ...(result.skippedSteps || []),
    ...(result.pendingContinuationSteps || []),
    ...(result.appliedSteps || []),
  ];
  for (const step of steps) {
    if (step.kind !== 'modify_graveyard_permissions') continue;
    return {
      withoutPayingManaCost: (step as any).withoutPayingManaCost === true,
      exileAfterResolution: (step as any).exileInsteadOfGraveyard === true,
    };
  }
  return { withoutPayingManaCost: false, exileAfterResolution: false };
}

export function resolveGrantGraveyardCastChoiceCard(
  state: any,
  controller: PlayerID,
  irCtx: OracleIRExecutionContext,
  triggerItem?: any,
): any | undefined {
  const chosenIds = new Set<string>([
    ...((irCtx.selectorContext as any)?.chosenObjectIds || irCtx.chosenObjectIds || []),
    String(triggerItem?.effectData?.discardedCardId || '').trim(),
    String(triggerItem?.boundGraveyardCardId || '').trim(),
    ...(Array.isArray(triggerItem?.targets)
      ? triggerItem.targets.map((target: any) => String(typeof target === 'string' ? target : target?.id || '').trim())
      : []),
  ].filter(Boolean));

  const searchPlayerIds = [String(controller), ...Object.keys(state?.zones || {}).filter((id) => id !== String(controller))];
  for (const playerId of searchPlayerIds) {
    const graveyard = Array.isArray(state?.zones?.[playerId]?.graveyard)
      ? state.zones[playerId].graveyard
      : [];
    for (const card of graveyard) {
      const cardId = String(card?.id || '').trim();
      if (!cardId) continue;
      if (chosenIds.size === 0 || chosenIds.has(cardId)) {
        return card;
      }
    }
  }
  return undefined;
}

function impulseDurationToPlayWindowText(duration: string): string {
  const normalized = String(duration || '').trim();
  if (normalized === 'until_end_of_next_turn' || normalized === 'until_next_turn') {
    return 'until the end of your next turn';
  }
  if (normalized === 'this_turn' || normalized === 'during_resolution') {
    return 'this turn';
  }
  return 'this turn';
}

function collectPendingImpulseExileChoiceCards(state: any, sourceName: string): any[] {
  const normalizedSource = String(sourceName || '').trim();
  if (!normalizedSource) return [];

  const cards: any[] = [];
  const seen = new Set<string>();

  const appendFromExile = (exileZone: any[], requireSourceMatch: boolean) => {
    for (const card of exileZone) {
      const cardId = String(card?.id || '').trim();
      if (!cardId || seen.has(cardId)) continue;
      if (card?.canBePlayedBy) continue;
      if (requireSourceMatch && String(card?.exiledBy || '').trim() !== normalizedSource) continue;
      seen.add(cardId);
      cards.push(card);
    }
  };

  for (const player of state?.players || []) {
    appendFromExile(Array.isArray(player?.exile) ? player.exile : [], true);
  }

  const zones = state?.zones || {};
  for (const ownerId of Object.keys(zones)) {
    appendFromExile(Array.isArray(zones[ownerId]?.exile) ? zones[ownerId].exile : [], true);
  }

  if (cards.length > 1) return cards;

  seen.clear();
  const fallbackCards: any[] = [];
  const appendFallback = (exileZone: any[]) => {
    for (const card of exileZone) {
      const cardId = String(card?.id || '').trim();
      if (!cardId || seen.has(cardId)) continue;
      if (card?.canBePlayedBy) continue;
      seen.add(cardId);
      fallbackCards.push(card);
    }
  };

  for (const player of state?.players || []) {
    appendFallback(Array.isArray(player?.exile) ? player.exile : []);
  }
  for (const ownerId of Object.keys(zones)) {
    appendFallback(Array.isArray(zones[ownerId]?.exile) ? zones[ownerId].exile : []);
  }

  return fallbackCards.length > 1 ? fallbackCards : cards;
}

export function syncGraveyardCastFreeExilePermissionsFromOracleIR(
  state: any,
  steps: readonly OracleEffectStep[],
  result: OracleIRExecutionResult,
  irCtx: OracleIRExecutionContext,
): void {
  if (String(irCtx.castFromZone || '').trim().toLowerCase() !== 'graveyard') return;

  const expectsFreeExileCast = steps.some((step) => {
    if (step.kind === 'modify_exile_permissions' && step.withoutPayingManaCost) return true;
    if (step.kind !== 'conditional') return false;
    return (step.steps || []).some(
      (inner) => inner.kind === 'modify_exile_permissions' && inner.withoutPayingManaCost,
    );
  });
  if (!expectsFreeExileCast) return;

  const appliedFreeModify = (result.appliedSteps || []).some(
    (step) => step.kind === 'modify_exile_permissions' && (step as any).withoutPayingManaCost,
  );
  if (appliedFreeModify) return;

  const impulseApplied = (result.appliedSteps || []).some((step) => step.kind === 'impulse_exile_top');
  if (!impulseApplied) return;

  const sourceName = String(irCtx.sourceName || '').trim();
  const patchCard = (card: any): any => {
    if (!card || typeof card !== 'object') return card;
    if (sourceName && String(card?.exiledBy || '').trim() && String(card?.exiledBy || '').trim() !== sourceName) {
      return card;
    }
    if (!card?.canBePlayedBy && !(state.playableFromExile && Object.values(state.playableFromExile).some(
      (entry: any) => entry && typeof entry === 'object' && entry[String(card?.id || '')] !== undefined,
    ))) {
      return card;
    }
    if (card?.castWithoutPayingManaCost === true) return card;
    return {
      ...card,
      withoutPayingManaCost: true,
      castWithoutPayingManaCost: true,
    };
  };

  if (Array.isArray(state.players)) {
    state.players = state.players.map((player: any) => {
      const exile = Array.isArray(player?.exile) ? player.exile : [];
      if (exile.length === 0) return player;
      const updatedExile = exile.map(patchCard);
      if (updatedExile.some((card: any, index: number) => card !== exile[index])) {
        return { ...player, exile: updatedExile };
      }
      return player;
    });
  }

  const zones = state?.zones;
  if (zones && typeof zones === 'object') {
    for (const ownerId of Object.keys(zones)) {
      const exile = Array.isArray(zones[ownerId]?.exile) ? zones[ownerId].exile : [];
      if (exile.length === 0) continue;
      const updatedExile = exile.map(patchCard);
      if (updatedExile.some((card: any, index: number) => card !== exile[index])) {
        zones[ownerId] = {
          ...zones[ownerId],
          exile: updatedExile,
        };
      }
    }
  }
}

export function syncImpulseExilePlayPermissionsToState(state: any): void {
  if (!state || typeof state !== 'object') return;

  state.playableFromExile = state.playableFromExile || {};
  const patchZones = (exile: any[]) => {
    for (const card of exile) {
      const cardId = String(card?.id || '').trim();
      const canBePlayedBy = String(card?.canBePlayedBy || '').trim();
      if (!cardId || !canBePlayedBy) continue;
      const until = typeof card?.playableUntilTurn === 'number' && Number.isFinite(card.playableUntilTurn)
        ? card.playableUntilTurn
        : Number.MAX_SAFE_INTEGER;
      if (typeof card.playableUntilTurn !== 'number' || !Number.isFinite(card.playableUntilTurn)) {
        card.playableUntilTurn = until;
      }
      state.playableFromExile[canBePlayedBy] = state.playableFromExile[canBePlayedBy] || {};
      state.playableFromExile[canBePlayedBy][cardId] = until;
    }
  };

  for (const player of state.players || []) {
    patchZones(Array.isArray(player?.exile) ? player.exile : []);
  }

  const zones = state.zones || {};
  for (const ownerId of Object.keys(zones)) {
    patchZones(Array.isArray(zones[ownerId]?.exile) ? zones[ownerId].exile : []);
  }
}

export function queueChooseOneImpulseExilePlayPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const appliedImpulseSteps = (result.appliedSteps || []).filter(
    (step) => step.kind === 'impulse_exile_top' && impulseExileTopRequiresChooseOne(step),
  );
  if (appliedImpulseSteps.length === 0) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const controllerId = String(params.controller || '').trim();
  if (!controllerId) return;

  const exiledCards = collectPendingImpulseExileChoiceCards(state, sourceName);
  if (exiledCards.length <= 1) return;

  const impulseStep = appliedImpulseSteps[appliedImpulseSteps.length - 1] as Extract<OracleEffectStep, { kind: 'impulse_exile_top' }>;
  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, impulseStep.duration) ?? Number(state?.turnNumber ?? 0);
  const playWindowText = impulseDurationToPlayWindowText(String(impulseStep.duration || ''));
  const exiledCardIds = exiledCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
  if (exiledCardIds.length <= 1) return;

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controllerId,
    description: `${sourceName}: Choose an exiled card. You may play it ${playWindowText}.`,
    mandatory: true,
    sourceName,
    options: exiledCards.map((card: any) => ({
      id: String(card.id),
      label: String(card.name || 'Exiled card'),
      description: String(card.type_line || ''),
    })),
    minSelections: 1,
    maxSelections: 1,
    grantPlayableFromExileChoice: true,
    grantPlayableFromExileController: controllerId,
    grantPlayableFromExileSourceName: sourceName,
    grantPlayableFromExileCardIds: exiledCardIds,
    grantPlayableFromExileUntilTurn: playableUntilTurn,
    grantPlayableFromExileWindowText: playWindowText,
  } as any);
}

function collectDiscoverHitCardsStillInExile(
  state: any,
  controllerId: string,
  sourceName: string,
  lastMovedCards: readonly any[] | undefined,
): any[] {
  const preferredIds = new Set(
    (Array.isArray(lastMovedCards) ? lastMovedCards : [])
      .map((card) => String(card?.id || '').trim())
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const hits: any[] = [];
  const consider = (card: any) => {
    const id = String(card?.id || '').trim();
    if (!id || seen.has(id)) return;
    if (preferredIds.size > 0 && !preferredIds.has(id)) return;
    const canBePlayedBy = String(card?.canBePlayedBy || '').trim();
    const exiledBy = String(card?.exiledBy || '').trim();
    if (canBePlayedBy !== controllerId && exiledBy !== sourceName) return;
    seen.add(id);
    hits.push(card);
  };

  for (const player of state?.players || []) {
    if (String(player?.id || '').trim() !== controllerId) continue;
    for (const card of Array.isArray(player?.exile) ? player.exile : []) consider(card);
  }
  const zoneExile = state?.zones?.[controllerId]?.exile;
  if (Array.isArray(zoneExile)) {
    for (const card of zoneExile) consider(card);
  }
  return hits;
}

export function queueDiscoverCastOrHandPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const appliedDiscoverSteps = (result.appliedSteps || []).filter(
    (step) => step.kind === 'impulse_exile_top' && impulseExileTopIsDiscoverCastOrHand(step),
  );
  if (appliedDiscoverSteps.length === 0) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const controllerId = String(params.controller || '').trim();
  if (!controllerId) return;

  const hitCards = collectDiscoverHitCardsStillInExile(
    state,
    controllerId,
    sourceName,
    result.lastMovedCards,
  );
  if (hitCards.length === 0) return;

  const sourceId = String(params.sourceId || '').trim() || undefined;
  for (const hitCard of hitCards) {
    const cardName = String(hitCard?.name || 'that card');
    queueCastFromExileResolutionPrompt(
      ctx,
      gameId,
      controllerId as PlayerID,
      sourceName,
      sourceId,
      undefined,
      hitCard,
      {
        declineDestination: 'hand',
        declineLabel: `Put ${cardName} into your hand`,
        castLabel: `Cast ${cardName} without paying its mana cost`,
        description: `${sourceName}: Cast ${cardName} without paying its mana cost or put it into your hand.`,
        mandatory: true,
      },
    );
  }
}

