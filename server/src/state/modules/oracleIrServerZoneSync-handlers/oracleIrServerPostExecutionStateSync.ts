// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerPostExecutionStateSync.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: the post-execution "mirror rules-engine result back onto server
// state" sync pass that applyOracleIRStepsOnServer runs after an Oracle IR
// execution - graveyard->exile provenance on the exiling permanent, copy-token
// provenance, prepared state, linked exiles, reanimation riders, at-next-end-step
// token sacrifice/exile scheduling, impulse-exile pending draws, temporary
// granted abilities, and temporary power/toughness modifiers.
// Public entry symbols: syncIrGraveyardExilesToSourcePermanentExiledCards,
//   syncIrCopyTokenProvenanceFromOracleIRResult, syncIrPreparedStateFromOracleIRResult,
//   syncIrLinkedExilesFromOracleIRResult, syncIrReanimationRidersFromOracleIRResult,
//   syncIrAtNextEndStepTokenSacrificeFromOracleIRResult, syncIrImpulseExileToPendingImpulseDraws,
//   syncIrTemporaryGrantEffectsToServerTemporaryAbilities
//   (also stamps turnApplied on until-next-turn staticAbilityGrantEffects / grant bags),
//   syncIrPowerToughnessModifiersToTemporaryPTMods.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import { copyAsEntersCopiableChoicesFromSource } from '../../../../../shared/src/copyTokenUtils.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';
import { clearPreparedPermanent, setPermanentPrepared } from '../prepared.js';
import { getNextEndStepFireTurnNumber } from '../triggerDelayedEffectUtils.js';
import { registerLinkedExile } from '../triggers/linked-exile.js';

function findCardsMovedFromGraveyardToExile(
  state: any,
  graveyardBefore: Map<string, Set<string>>,
  exileBefore: Map<string, Set<string>>,
): Array<{ ownerId: PlayerID; card: any }> {
  const moved: Array<{ ownerId: PlayerID; card: any }> = [];
  const zones = state.zones || {};

  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const wasInGraveyard = graveyardBefore.get(playerId) || new Set<string>();
    const beforeExile = exileBefore.get(playerId) || new Set<string>();
    const exile = Array.isArray(zones[playerId]?.exile)
      ? zones[playerId].exile
      : Array.isArray(player?.exile)
        ? player.exile
        : [];

    for (const card of exile) {
      const cardId = String(card?.id || '').trim();
      if (!cardId) continue;
      if (wasInGraveyard.has(cardId) && !beforeExile.has(cardId)) {
        moved.push({ ownerId: playerId as PlayerID, card });
      }
    }
  }

  return moved;
}

function oracleIrResultExiledFromGraveyard(result: OracleIRExecutionResult): boolean {
  return (result.appliedSteps || []).some((step) => {
    if (step.kind === 'exile') {
      const targetZone = String((step as any).target?.zone || (step as any).from || '').toLowerCase();
      const selectorText = String((step as any).selector || (step as any).what?.text || '').toLowerCase();
      return targetZone.includes('graveyard') || selectorText.includes('graveyard');
    }
    if (step.kind === 'move_zone') {
      const from = String((step as any).from || '').toLowerCase();
      const to = String((step as any).to || '').toLowerCase();
      const whatText = String((step as any).what?.text || (step as any).what || '').toLowerCase();
      return to === 'exile' && (from.includes('graveyard') || whatText.includes('graveyard'));
    }
    return false;
  });
}

export function syncIrGraveyardExilesToSourcePermanentExiledCards(
  state: any,
  result: OracleIRExecutionResult,
  graveyardBefore: Map<string, Set<string>>,
  exileBefore: Map<string, Set<string>>,
  irCtx: OracleIRExecutionContext,
  params?: {
    triggerItem?: any;
    sourceItem?: any;
  },
): void {
  if (!oracleIrResultExiledFromGraveyard(result)) return;

  const sourcePermanentId = String(
    irCtx.sourceId
    || params?.sourceItem?.permanentId
    || params?.sourceItem?.source
    || params?.triggerItem?.permanentId
    || params?.triggerItem?.source
    || '',
  ).trim();
  if (!sourcePermanentId) return;

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '') === sourcePermanentId);
  if (!sourcePermanent) return;

  const movedCards = findCardsMovedFromGraveyardToExile(state, graveyardBefore, exileBefore);
  if (movedCards.length === 0) return;

  (sourcePermanent as any).exiledCards = Array.isArray((sourcePermanent as any).exiledCards)
    ? (sourcePermanent as any).exiledCards
    : [];

  for (const { card } of movedCards) {
    const cardId = String(card?.id || '').trim();
    if (!cardId) continue;
    if ((sourcePermanent as any).exiledCards.some((entry: any) => String(entry?.id || '') === cardId)) {
      continue;
    }
    (sourcePermanent as any).exiledCards.push({
      ...card,
      zone: 'exile',
      exiledWith: sourcePermanentId,
    });
  }
}

export function syncIrCopyTokenProvenanceFromOracleIRResult(
  state: any,
  result: OracleIRExecutionResult,
  irCtx: OracleIRExecutionContext,
): void {
  const copyStepApplied = (result.appliedSteps || []).some(
    (step) =>
      step.kind === 'create_token'
      && /copy of target creature/i.test(String((step as { token?: string }).token || '')),
  );
  if (!copyStepApplied) return;

  const preferredIds = [
    String(irCtx.targetPermanentId || '').trim(),
    String(irCtx.targetCreatureId || '').trim(),
    String(irCtx.selectorContext?.targetPermanentId || '').trim(),
    ...(Array.isArray(irCtx.selectorContext?.chosenObjectIds)
      ? irCtx.selectorContext.chosenObjectIds.map((id: unknown) => String(id || '').trim())
      : []),
  ].filter(Boolean);

  const sourceId = preferredIds.find((id) =>
    (state.battlefield || []).some(
      (perm: any) => String(perm?.id || '').trim() === id && perm?.isToken !== true,
    ),
  );
  if (!sourceId) return;

  for (const perm of state.battlefield || []) {
    if (!perm?.isToken || perm.copiedFromPermanentId) continue;
    perm.copiedFromPermanentId = sourceId;
    const sourcePermanent = (state.battlefield || []).find(
      (entry: any) => String(entry?.id || '').trim() === sourceId,
    );
    if (sourcePermanent) {
      copyAsEntersCopiableChoicesFromSource(sourcePermanent, perm);
      const creatureType = String(perm.chosenCreatureType || '').trim();
      if (creatureType && String(perm?.card?.name || perm?.name || '').toLowerCase().includes('morophon')) {
        const morophonChosenType = (state.morophonChosenType || {}) as Record<string, string>;
        morophonChosenType[String(perm.id || '')] = creatureType;
        state.morophonChosenType = morophonChosenType;
      }
    }
    break;
  }
}

function resolvePreparedStateGrantTargets(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  irCtx: OracleIRExecutionContext,
): any[] {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const targetText = String((step.target as any)?.text || '').trim().toLowerCase();
  const sourceId = String(irCtx.sourceId || (irCtx as any).sourcePermanentId || '').trim();

  if ((targetText === 'this creature' || targetText === 'this permanent' || targetText === 'it') && sourceId) {
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    return sourcePermanent ? [sourcePermanent] : [];
  }

  return [];
}

export function syncIrPreparedStateFromOracleIRResult(
  state: any,
  result: OracleIRExecutionResult,
  irCtx: OracleIRExecutionContext,
): void {
  const appliedSteps = result.appliedSteps || [];
  const appliedPreparedGrant = appliedSteps.some((step) => {
    if (step.kind !== 'grant_static_ability') return false;
    const grantedText = [
      ...(Array.isArray((step as any).effectText) ? (step as any).effectText : []),
      ...(Array.isArray((step as any).abilities) ? (step as any).abilities : []),
    ]
      .map((entry: unknown) => String(entry || '').trim().toLowerCase())
      .join(' ');
    return grantedText.includes('becomes prepared') || grantedText.includes('becomes unprepared');
  });

  if (appliedPreparedGrant) {
    for (const step of appliedSteps) {
      if (step.kind !== 'grant_static_ability') continue;
      const grantedText = [
        ...(Array.isArray((step as any).effectText) ? (step as any).effectText : []),
        ...(Array.isArray((step as any).abilities) ? (step as any).abilities : []),
      ]
        .map((entry: unknown) => String(entry || '').trim().toLowerCase())
        .join(' ');
      const becomesPrepared = grantedText.includes('becomes prepared');
      const becomesUnprepared = grantedText.includes('becomes unprepared');
      if (!becomesPrepared && !becomesUnprepared) continue;

      for (const permanent of resolvePreparedStateGrantTargets(state, step as any, irCtx)) {
        if (becomesUnprepared) {
          clearPreparedPermanent(state, permanent);
        } else {
          setPermanentPrepared(state, permanent);
        }
      }
    }
    return;
  }

  for (const perm of state.battlefield || []) {
    const granted = (Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [])
      .map((ability: unknown) => String(ability || '').trim().toLowerCase());
    if (granted.includes('becomes unprepared')) {
      clearPreparedPermanent(state, perm);
      continue;
    }
    if (granted.includes('becomes prepared') && perm.prepared !== true) {
      setPermanentPrepared(state, perm);
    }
  }
}

function findExiledCardForLinkedExileRegistration(
  state: any,
  cardRef: string,
): { card: any; ownerId: string; controllerId: string } | null {
  const normalizedRef = String(cardRef || '').trim();
  if (!normalizedRef) return null;

  const zones = (state as any).zones || {};
  for (const [playerId, zone] of Object.entries(zones)) {
    const exile = Array.isArray((zone as any)?.exile) ? (zone as any).exile : [];
    const found = exile.find((card: any) => {
      const id = String(card?.id || '').trim();
      const name = String(card?.name || '').trim();
      return (
        id === normalizedRef ||
        name === normalizedRef ||
        id === `${normalizedRef}_card` ||
        (normalizedRef.endsWith('_card') && id === normalizedRef.slice(0, -5))
      );
    });
    if (!found) continue;
    return {
      card: found,
      ownerId: String(found?.owner || found?.ownerId || playerId),
      controllerId: String(found?.controller || found?.controllerId || playerId),
    };
  }

  return null;
}

export function syncIrLinkedExilesFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  irCtx: OracleIRExecutionContext,
): void {
  const appliedSteps = result.appliedSteps || [];
  const hasLinkedExileStep = appliedSteps.some((step) => {
    if (step.kind !== 'exile') return false;
    const raw = String((step as any).raw || '').trim();
    const targetText = String((step.target as any)?.text || '').trim();
    return /until\b.+\bleaves the battlefield/i.test(`${raw} ${targetText}`);
  });
  if (!hasLinkedExileStep) return;

  const exilingPermanentId = String(irCtx.sourceId || '').trim();
  if (!exilingPermanentId) return;

  const exilingPermanent = (state.battlefield || []).find(
    (perm: any) => String(perm?.id || '').trim() === exilingPermanentId,
  );
  const exilingPermanentName =
    String(irCtx.sourceName || '').trim() ||
    String(exilingPermanent?.card?.name || '').trim() ||
    'Linked Exile Source';

  const targetIds = Array.from(new Set(
    [
      ...(Array.isArray(irCtx.selectorContext?.chosenObjectIds) ? irCtx.selectorContext.chosenObjectIds : []),
      String(irCtx.targetCreatureId || '').trim(),
      String(irCtx.targetPermanentId || '').trim(),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  ));

  state.linkedExiles = Array.isArray(state.linkedExiles) ? state.linkedExiles : [];

  for (const targetId of targetIds) {
    const alreadyRegistered = state.linkedExiles.some((entry: any) =>
      String(entry?.exilingPermanentId || '') === exilingPermanentId &&
      (
        String(entry?.exiledCardId || '') === targetId ||
        String(entry?.exiledCardName || '').trim() === targetId
      ),
    );
    if (alreadyRegistered) continue;

    const located = findExiledCardForLinkedExileRegistration(state, targetId);
    if (!located) continue;

    registerLinkedExile(
      ctx,
      exilingPermanentId,
      exilingPermanentName,
      located.card,
      located.ownerId,
      located.controllerId,
    );
  }
}

export function syncIrReanimationRidersFromOracleIRResult(
  state: any,
  result: OracleIRExecutionResult,
  params: { controller: PlayerID; sourceName: string },
): void {
  const appliedSteps = result.appliedSteps || [];
  const appliedKinds = new Set(appliedSteps.map((step) => step.kind));
  const hasReanimationBridge =
    appliedKinds.has('move_zone')
    || appliedKinds.has('grant_temporary_ability')
    || appliedKinds.has('grant_static_ability')
    || appliedKinds.has('grant_leave_battlefield_replacement')
    || appliedKinds.has('schedule_delayed_battlefield_action');

  if (!hasReanimationBridge) return;

  for (const perm of state.battlefield || []) {
    if (!perm || typeof perm !== 'object') continue;

    const granted = (Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [])
      .map((ability: unknown) => String(ability || '').trim().toLowerCase());
    if (granted.includes('haste')) {
      perm.summoningSickness = false;
    }

    const leaveReplacement = String(perm.leaveBattlefieldReplacement || perm.leaveBattlefieldReplacementDestination || '').trim().toLowerCase();
    if (leaveReplacement === 'exile') {
      perm.leaveBattlefieldReplacementDestination = 'exile';
      if (params.sourceName) {
        perm.leaveBattlefieldReplacementSourceName = params.sourceName;
      }
      perm.card = {
        ...(perm.card || {}),
        leaveBattlefieldReplacementDestination: 'exile',
        ...(params.sourceName ? { leaveBattlefieldReplacementSourceName: params.sourceName } : {}),
      };
    }
  }

  if (!appliedKinds.has('schedule_delayed_battlefield_action')) return;

  const registry = state.delayedTriggerRegistry as { triggers?: Record<string, unknown> } | undefined;
  const triggers = registry?.triggers ? Object.values(registry.triggers) : [];
  if (triggers.length === 0) return;

  state.pendingExileAtNextEndStep = Array.isArray(state.pendingExileAtNextEndStep)
    ? state.pendingExileAtNextEndStep
    : [];

  const fireAtTurnNumber = getNextEndStepFireTurnNumber(state);

  for (const delayed of triggers) {
    const effect = String((delayed as any)?.effect || '').toLowerCase();
    if (!effect.includes('exile')) continue;

    const timing = String((delayed as any)?.timing || '').toUpperCase();
    if (!timing.includes('END_STEP')) continue;

    const targetIds = Array.isArray((delayed as any)?.targets)
      ? (delayed as any).targets.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    for (const permanentId of targetIds) {
      const alreadyScheduled = (state.pendingExileAtNextEndStep as any[]).some(
        (entry: any) => String(entry?.permanentId || '').trim() === permanentId,
      );
      if (alreadyScheduled) continue;

      state.pendingExileAtNextEndStep.push({
        permanentId,
        fireAtTurnNumber,
        sourceName: params.sourceName,
        createdBy: String(params.controller),
      });
    }
  }
}

function stampHasteTempAbilityOnPermanent(perm: any): void {
  if (!perm || typeof perm !== 'object') return;
  const granted = (Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [])
    .map((ability: unknown) => String(ability || '').trim().toLowerCase());
  if (!granted.includes('haste')) return;
  perm.summoningSickness = false;
  perm.tempAbilities = Array.isArray(perm.tempAbilities) ? perm.tempAbilities : [];
  if (!perm.tempAbilities.some((ability: unknown) => String(ability || '').toLowerCase() === 'haste')) {
    perm.tempAbilities.push('haste');
  }
}

export function syncIrAtNextEndStepTokenSacrificeFromOracleIRResult(
  state: any,
  result: OracleIRExecutionResult,
  params: { controller: PlayerID; sourceName: string },
): void {
  const createTokenSteps = (result.appliedSteps || []).filter((step) => step.kind === 'create_token');
  const scheduledSacrifice = createTokenSteps.some(
    (step) => (step as { atNextEndStep?: string }).atNextEndStep === 'sacrifice',
  );
  const scheduledExile = createTokenSteps.some(
    (step) => (step as { atNextEndStep?: string }).atNextEndStep === 'exile',
  );
  const grantedHaste = createTokenSteps.some((step) => Boolean((step as { grantsHaste?: string }).grantsHaste));
  if (grantedHaste) {
    for (const perm of state.battlefield || []) {
      if (perm?.isToken) stampHasteTempAbilityOnPermanent(perm);
    }
  }
  if (!scheduledSacrifice && !scheduledExile) return;

  const registry = state.delayedTriggerRegistry as { triggers?: Record<string, unknown> } | undefined;
  const triggers = registry?.triggers ? Object.values(registry.triggers) : [];
  if (triggers.length === 0) return;

  const fireAtTurnNumber = getNextEndStepFireTurnNumber(state);

  if (scheduledSacrifice) {
    state.pendingSacrificeAtNextEndStep = Array.isArray(state.pendingSacrificeAtNextEndStep)
      ? state.pendingSacrificeAtNextEndStep
      : [];
  }
  if (scheduledExile) {
    state.pendingExileAtNextEndStep = Array.isArray(state.pendingExileAtNextEndStep)
      ? state.pendingExileAtNextEndStep
      : [];
  }

  for (const delayed of triggers) {
    const effect = String((delayed as any)?.effect || '');
    const timing = String((delayed as any)?.timing || '').toUpperCase();
    if (!timing.includes('END_STEP')) continue;

    const targetIds = Array.isArray((delayed as any)?.targets)
      ? (delayed as any).targets.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    if (scheduledSacrifice && /sacrifice (?:that|those) tokens?\.?/i.test(effect)) {
      for (const permanentId of targetIds) {
        const alreadyScheduled = (state.pendingSacrificeAtNextEndStep as any[]).some(
          (entry: any) => String(entry?.permanentId || '').trim() === permanentId,
        );
        if (alreadyScheduled) continue;

        state.pendingSacrificeAtNextEndStep.push({
          permanentId,
          fireAtTurnNumber,
          maxManaValue: 0,
          sourceName: params.sourceName,
          createdBy: String(params.controller),
        });
      }
    }

    if (scheduledExile && /\bexile\b/i.test(effect.toLowerCase())) {
      for (const permanentId of targetIds) {
        const alreadyScheduled = (state.pendingExileAtNextEndStep as any[]).some(
          (entry: any) => String(entry?.permanentId || '').trim() === permanentId,
        );
        if (alreadyScheduled) continue;

        state.pendingExileAtNextEndStep.push({
          permanentId,
          fireAtTurnNumber,
          sourceName: params.sourceName,
          createdBy: String(params.controller),
        });
      }
    }
  }
}

export function syncIrImpulseExileToPendingImpulseDraws(
  state: any,
  result: OracleIRExecutionResult,
  sourceName: string,
): void {
  const hadImpulseExile = (result.appliedSteps || []).some((step) => step.kind === 'impulse_exile_top');
  if (!hadImpulseExile) return;

  state.pendingImpulseDraws = state.pendingImpulseDraws || {};

  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const playableMap = state.playableFromExile?.[playerId];
    if (!playableMap || typeof playableMap !== 'object') continue;

    const exileCards = [
      ...(Array.isArray(state.zones?.[playerId]?.exile) ? state.zones[playerId].exile : []),
      ...(Array.isArray(player?.exile) ? player.exile : []),
    ];

    state.pendingImpulseDraws[playerId] = state.pendingImpulseDraws[playerId] || [];

    for (const card of exileCards) {
      const cardId = String(card?.id || '').trim();
      if (!cardId || playableMap[cardId] === undefined) continue;

      const playableUntilTurn = Number(card?.playableUntilTurn ?? playableMap[cardId]);
      if (!Number.isFinite(playableUntilTurn)) continue;

      const alreadyQueued = state.pendingImpulseDraws[playerId].some(
        (entry: any) => String(entry?.cardId || '') === cardId,
      );
      if (alreadyQueued) continue;

      state.pendingImpulseDraws[playerId].push({
        cardId,
        cardName: card?.name,
        exiledBy: card?.exiledBy || sourceName,
        playableUntilTurn,
      });
    }
  }
}

function normalizeTemporaryAbilityKeyForSync(ability: string): string {
  return String(ability || '')
    .toLowerCase()
    .replace(/\s+this turn/g, '')
    .trim();
}

function preferTemporaryAbilityText(existing: string, candidate: string): string {
  const left = String(existing || '').trim();
  const right = String(candidate || '').trim();
  if (!left) return right;
  if (!right) return left;
  if (/\bthis turn\b/i.test(left) && !/\bthis turn\b/i.test(right)) return left;
  if (/\bthis turn\b/i.test(right) && !/\bthis turn\b/i.test(left)) return right;
  return left.length >= right.length ? left : right;
}

function isUntilNextTurnGrantEntryForStamp(entry: any): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (String(entry.duration || '').trim() === 'until_next_turn') return true;
  if (String(entry.expiresOnControllerTurn || '').trim()) return true;
  return false;
}

function stampUntilNextTurnGrantTurnApplied(entry: any, turnNumber: number): void {
  if (!isUntilNextTurnGrantEntryForStamp(entry)) return;
  if (Number.isFinite(Number(entry.turnApplied)) && Number(entry.turnApplied) > 0) return;
  entry.turnApplied = turnNumber;
}

function stampUntilNextTurnGrantBag(bag: any, turnNumber: number): void {
  if (!Array.isArray(bag) || turnNumber <= 0) return;
  for (const entry of bag) stampUntilNextTurnGrantTurnApplied(entry, turnNumber);
}

function stampUntilNextTurnGrantsOnState(state: any, turnNumber: number): void {
  if (!state || typeof state !== 'object' || turnNumber <= 0) return;
  stampUntilNextTurnGrantBag(state.staticAbilityGrantEffects, turnNumber);
  for (const player of Array.isArray(state.players) ? state.players : []) {
    if (!player || typeof player !== 'object') continue;
    stampUntilNextTurnGrantBag(player.temporaryAbilities, turnNumber);
    stampUntilNextTurnGrantBag(player.grantedAbilities, turnNumber);
    stampUntilNextTurnGrantBag(player.temporaryEffects, turnNumber);
  }
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    stampUntilNextTurnGrantBag(perm.staticAbilityGrantEffects, turnNumber);
    stampUntilNextTurnGrantBag(perm.temporaryAbilities, turnNumber);
    stampUntilNextTurnGrantBag(perm.grantedAbilities, turnNumber);
    stampUntilNextTurnGrantBag(perm.temporaryEffects, turnNumber);
  }
}

function canonicalizeTemporaryAbilityForServer(abilityText: string, expiresAt: string): string {
  const text = String(abilityText || '').trim();
  if (!text) return text;
  if (expiresAt !== 'end_of_turn' && expiresAt !== 'end_of_combat') return text;
  if (/\bthis turn\b/i.test(text)) return text;
  if (/can't be blocked by creatures with power \d+ or less$/i.test(text)) {
    return `${text} this turn`;
  }
  if (/^prevent all combat damage that would be dealt to this creature$/i.test(text)) {
    return `${text} this turn`;
  }
  return text;
}

export function syncIrTemporaryGrantEffectsToServerTemporaryAbilities(
  state: any,
  sourceName: string,
): void {
  const turnNumber = Number(state?.turnNumber || 0);
  stampUntilNextTurnGrantsOnState(state, turnNumber);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;

    const pendingAbilities: string[] = [];
    const temporaryEffects = Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : [];
    for (const effect of temporaryEffects) {
      if (!effect || typeof effect !== 'object') continue;
      const expiresAt = String(effect.expiresAt || '').trim();
      if (expiresAt && expiresAt !== 'end_of_turn' && expiresAt !== 'end_of_combat') continue;

      const description = String(effect.description || '').trim();
      if (description) {
        pendingAbilities.push(description);
        continue;
      }

      const effectGranted = Array.isArray(effect.grantedAbilities) ? effect.grantedAbilities : [];
      for (const ability of effectGranted) {
        const text = String(ability || '').trim();
        if (text) pendingAbilities.push(text);
      }
    }

    if (pendingAbilities.length === 0) continue;

    perm.temporaryAbilities = Array.isArray(perm.temporaryAbilities) ? perm.temporaryAbilities : [];
    for (const abilityText of pendingAbilities) {
      const canonicalAbility = canonicalizeTemporaryAbilityForServer(abilityText, 'end_of_turn');
      const key = normalizeTemporaryAbilityKeyForSync(canonicalAbility);
      const existingIndex = perm.temporaryAbilities.findIndex((entry: any) =>
        normalizeTemporaryAbilityKeyForSync(String(entry?.ability || entry || '')) === key
        && String(entry?.source || sourceName) === String(sourceName)
        && String(entry?.expiresAt || 'end_of_turn') === 'end_of_turn'
      );
      if (existingIndex >= 0) {
        const existingAbility = String(perm.temporaryAbilities[existingIndex]?.ability || '').trim();
        const merged = preferTemporaryAbilityText(existingAbility, canonicalAbility);
        if (merged !== existingAbility) {
          perm.temporaryAbilities[existingIndex] = {
            ...perm.temporaryAbilities[existingIndex],
            ability: merged,
          };
        }
        continue;
      }

      perm.temporaryAbilities.push({
        ability: canonicalAbility,
        source: sourceName,
        expiresAt: 'end_of_turn',
        turnApplied: turnNumber,
      });
    }
  }
}

export function syncIrPowerToughnessModifiersToTemporaryPTMods(
  state: any,
  sourceName: string,
): void {
  const turnNumber = Number(state?.turnNumber || 0);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const modifiers = Array.isArray(perm.modifiers) ? perm.modifiers : [];
    if (modifiers.length === 0) continue;

    perm.temporaryPTMods = Array.isArray(perm.temporaryPTMods) ? perm.temporaryPTMods : [];
    for (const modifier of modifiers) {
      if (String(modifier?.type || '').trim() !== 'powerToughness') continue;
      const duration = String(modifier?.duration || 'end_of_turn').trim();
      if (duration !== 'end_of_turn') continue;

      const power = Number(modifier?.power ?? 0);
      const toughness = Number(modifier?.toughness ?? 0);
      // Use the modifier's own identity. Using the currently resolving effect's
      // source name here caused every later Oracle IR resolution to mirror old
      // modifiers again under a new source (for example, stacking Overkill's
      // -0/-9999 repeatedly).
      const modifierSource = String(
        modifier?.sourceId
        || modifier?.sourceName
        || sourceName,
      ).trim();
      const duplicate = perm.temporaryPTMods.some((entry: any) =>
        Number(entry?.power ?? 0) === power
        && Number(entry?.toughness ?? 0) === toughness
        && String(entry?.source || '') === modifierSource
        && String(entry?.expiresAt || 'end_of_turn') === 'end_of_turn'
        && Number(entry?.turnApplied ?? turnNumber) === turnNumber
      );
      if (duplicate) continue;

      perm.temporaryPTMods.push({
        power,
        toughness,
        source: modifierSource,
        expiresAt: 'end_of_turn',
        turnApplied: turnNumber,
      });
    }
  }
}
