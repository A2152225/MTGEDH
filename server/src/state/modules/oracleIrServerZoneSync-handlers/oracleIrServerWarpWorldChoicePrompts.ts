// Origin parent: oracleIrServerZoneSync.ts / oracleIrServerApplyOnServer.ts
// Cluster: Warp World interactive prompts — commander 903.9a, APNAP Aura-host
// announce, remainder any-order BOTTOM_ORDER. Queued from applyOracleIRStepsOnServer.
// Public entries: queueWarpWorldChoicePromptsFromOracleIRResult,
// hasPendingWarpWorldOracleIrPrompt, extractWarpWorldChoiceId, extractBottomOrderIds.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import {
  WARP_WORLD_CHOICE_AURA,
  WARP_WORLD_CHOICE_COMMANDER,
  WARP_WORLD_CHOICE_REMAINDER,
} from '../../../../../rules-engine/src/oracleIRExecutorWarpWorldInteractive.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { lookupLocalCardByNameSync } from '../../../services/localCardLookup.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
  normalizeTopLibraryPromptCard,
  unwrapYouDoResumeSteps,
} from '../oracleIrServerPromptResumeUtils.js';

function cardMatchesWantedId(card: any, wanted: string): boolean {
  if (!wanted) return false;
  return String(card?.id || '').trim() === wanted
    || String(card?.card?.id || '').trim() === wanted;
}

function* iterateLookupPiles(state: any, ctx?: GameContext, extraPiles?: readonly any[][]): Generator<any[]> {
  if (Array.isArray(extraPiles)) {
    for (const pile of extraPiles) {
      if (Array.isArray(pile) && pile.length > 0) yield pile;
    }
  }
  for (const player of state?.players || []) {
    for (const zone of ['library', 'hand', 'exile', 'graveyard'] as const) {
      if (Array.isArray(player?.[zone]) && player[zone].length > 0) yield player[zone];
    }
  }
  const zones = state?.zones || {};
  for (const playerZones of Object.values(zones) as any[]) {
    for (const zone of ['library', 'hand', 'exile', 'graveyard'] as const) {
      if (Array.isArray(playerZones?.[zone]) && playerZones[zone].length > 0) yield playerZones[zone];
    }
  }
  for (const map of [(state as any)?.__serverLibraries, (ctx as any)?.libraries]) {
    if (!map || typeof map.values !== 'function') continue;
    for (const pile of map.values()) {
      if (Array.isArray(pile) && pile.length > 0) yield pile;
    }
  }
}

function promptCardDisplayName(card: any): string {
  return String(card?.name || card?.card?.name || '').trim();
}

function isUsablePromptName(name: string, wantedId: string): boolean {
  return Boolean(name) && name !== wantedId && name !== 'Unknown Card';
}

function collectLedgerCardPiles(state: any, irCtx?: OracleIRExecutionContext): any[] {
  const sources = [irCtx?.stepLedger, state?.oracleIrStepLedger, (irCtx as any)?.state?.oracleIrStepLedger];
  const pile: any[] = [];
  for (const ledger of sources) {
    if (!ledger) continue;
    const groups = typeof ledger.values === 'function' ? [...ledger.values()] : Object.values(ledger);
    for (const snaps of groups) {
      if (!Array.isArray(snaps)) continue;
      for (const snap of snaps) {
        const name = String(snap?.name || '').trim();
        const typeLine = snap?.typeLine || snap?.type_line;
        const imageUris = snap?.image_uris || snap?.imageUris;
        for (const id of [snap?.objectId, snap?.cardInstanceId, snap?.id]) {
          const trimmed = String(id || '').trim();
          if (!trimmed) continue;
          pile.push({
            id: trimmed,
            name,
            type_line: typeLine,
            ...(imageUris ? { image_uris: imageUris } : {}),
          });
        }
      }
    }
  }
  return pile;
}

function findBestRemainderCard(
  state: any,
  cardId: string,
  extraPiles?: readonly any[][],
  ctx?: GameContext,
): any | undefined {
  const wanted = String(cardId || '').trim();
  if (!wanted) return undefined;
  let fallback: any;
  for (const pile of iterateLookupPiles(state, ctx, extraPiles)) {
    for (const entry of pile) {
      if (!cardMatchesWantedId(entry, wanted)) continue;
      if (isUsablePromptName(promptCardDisplayName(entry), wanted)) return entry;
      if (!fallback) fallback = entry;
    }
  }
  return fallback;
}

function fillMissingPromptCardImages(prompt: Record<string, unknown>): Record<string, unknown> {
  const existing = prompt.image_uris as { small?: string; normal?: string; art_crop?: string } | undefined;
  if (existing?.small || existing?.normal || existing?.art_crop || prompt.imageUrl) return prompt;
  const name = String(prompt.name || '').trim();
  const id = String(prompt.id || '').trim();
  if (!name || name === id || name === 'Unknown Card') return prompt;
  try {
    const lookedUp = lookupLocalCardByNameSync(name);
    const imageUris = lookedUp?.image_uris || lookedUp?.card_faces?.[0]?.image_uris;
    if (!imageUris) return prompt;
    const imageUrl = imageUris.normal || imageUris.small || imageUris.art_crop;
    return {
      ...prompt,
      image_uris: imageUris,
      ...(imageUrl ? { imageUrl } : {}),
    };
  } catch {
    return prompt;
  }
}

function parseLastMovedCardPile(raw: string): any[] {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildRemainderPromptCards(
  state: any,
  ctx: GameContext,
  result: OracleIRExecutionResult,
  remainderCardIds: string[],
  inheritedLastMovedJson: string,
  remainderCardsJson: string,
  irCtx?: OracleIRExecutionContext,
): Record<string, unknown>[] {
  const extraPiles = [
    parseLastMovedCardPile(remainderCardsJson),
    Array.isArray(result.lastMovedCards) ? [...result.lastMovedCards] : [],
    parseLastMovedCardPile(inheritedLastMovedJson),
    collectLedgerCardPiles(state, irCtx),
  ];
  return remainderCardIds.map((id) => {
    const card = findBestRemainderCard(state, id, extraPiles, ctx);
    const prompt = card
      ? normalizeTopLibraryPromptCard({ ...card, id })
      : { id, name: 'Unknown Card' };
    prompt.id = id;
    const resolvedName = String(prompt.name || card?.name || card?.card?.name || '').trim();
    if (isUsablePromptName(resolvedName, id)) prompt.name = resolvedName;
    return fillMissingPromptCardImages(prompt);
  });
}

function findBattlefieldPermanent(state: any, permanentId: string): any | undefined {
  const wanted = String(permanentId || '').trim();
  if (!wanted) return undefined;
  return ((state?.battlefield || []) as any[]).find((perm) => String(perm?.id || '').trim() === wanted);
}

function listWarpWorldQueueSteps(gameId: string): any[] {
  const queue = ResolutionQueueManager.getQueue(gameId);
  return [...(queue?.steps || []), ...(queue?.completedSteps || [])];
}

function isWarpWorldShuffleRevealOrPutWave(step: OracleEffectStep): boolean {
  const kind = String((step as any)?.kind || '');
  if (kind === 'reveal_top') return true;
  const raw = String((step as any)?.raw || '');
  if (/\bshuffles all permanents they own\b/i.test(raw)) return true;
  if (/\ball artifact, creature, and land cards revealed this way\b/i.test(raw)) return true;
  if (/\bdoes the same for enchantment cards\b/i.test(raw)) return true;
  return false;
}

function inheritWarpWorldResumeJson(
  gameId: string,
  result: OracleIRExecutionResult,
  warpChoice: string,
): string {
  const pending = result.pendingContinuationSteps;
  // Empty array is authoritative. Remainder/aura skips that consumed the last IR
  // step must not inherit reveal/put from a completed 903.9a prompt's choice JSON
  // — that re-ran Warp World after the first BOTTOM_ORDER and hung the game.
  if (Array.isArray(pending)) {
    return JSON.stringify(unwrapYouDoResumeSteps(pending as OracleEffectStep[]));
  }
  if (warpChoice === WARP_WORLD_CHOICE_REMAINDER || warpChoice === WARP_WORLD_CHOICE_AURA) {
    return JSON.stringify([]);
  }
  for (const step of listWarpWorldQueueSteps(gameId)) {
    if (!String((step as any)?.oracleIrWarpWorldChoice || '').trim()) continue;
    const json = String((step as any)?.oracleIrResumeStepsJson || '').trim();
    if (json) return json;
    const choiceJson = String((step as any)?.oracleIrChoiceStepJson || '').trim();
    if (!choiceJson) continue;
    try {
      const parsed = JSON.parse(choiceJson);
      if (Array.isArray(parsed) && parsed.length > 1) {
        return JSON.stringify(unwrapYouDoResumeSteps(parsed.slice(1)));
      }
    } catch {
      // ignore malformed choice JSON
    }
  }
  return '';
}

function parseWarpWorldRemainingSteps(
  gameId: string,
  result: OracleIRExecutionResult,
  warpChoice: string,
): OracleEffectStep[] {
  const inherited = inheritWarpWorldResumeJson(gameId, result, warpChoice);
  if (!inherited) return [];
  try {
    const parsed = JSON.parse(inherited);
    const steps = Array.isArray(parsed) ? unwrapYouDoResumeSteps(parsed as OracleEffectStep[]) : [];
    if (warpChoice === WARP_WORLD_CHOICE_REMAINDER || warpChoice === WARP_WORLD_CHOICE_AURA) {
      return steps.filter((step) => !isWarpWorldShuffleRevealOrPutWave(step));
    }
    return steps;
  } catch {
    return [];
  }
}

function inheritAccumulatedJson(gameId: string, field: string, fallback: string): string {
  const fromFallback = String(fallback || '').trim();
  if (fromFallback) return fromFallback;
  for (const step of listWarpWorldQueueSteps(gameId)) {
    const json = String((step as any)?.[field] || '').trim();
    if (json && String((step as any)?.oracleIrWarpWorldChoice || '').trim()) return json;
  }
  return '';
}

function inheritWarpWorldCarryJson(gameId: string, field: string, fallback: unknown): string {
  const isPopulated = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value as object).length > 0;
    return false;
  };
  if (isPopulated(fallback)) return JSON.stringify(fallback);
  if (typeof fallback === 'string' && fallback.trim()) {
    try {
      const parsed = JSON.parse(fallback);
      if (isPopulated(parsed)) return fallback.trim();
    } catch {
      // look at queue
    }
  }
  for (const step of listWarpWorldQueueSteps(gameId)) {
    if (!String((step as any)?.oracleIrWarpWorldChoice || '').trim()) continue;
    const json = String((step as any)?.[field] || '').trim();
    if (!json || json === '[]' || json === '{}') continue;
    return json;
  }
  return '';
}

export function hasPendingWarpWorldOracleIrPrompt(gameId: string, exceptStepId?: string): boolean {
  const queue = ResolutionQueueManager.getQueue(gameId);
  const exceptId = String(exceptStepId || '').trim();
  return (queue?.steps || []).some((step: any) => {
    if (!String(step?.oracleIrWarpWorldChoice || '').trim()) return false;
    if (exceptId && String(step?.id || '').trim() === exceptId) return false;
    const status = String(step?.status || '');
    if (status === 'completed' || status === 'cancelled') return false;
    return true;
  });
}

function collectSelectionIds(selections: unknown): string[] {
  if (typeof selections === 'string') {
    const id = selections.trim();
    return id ? [id] : [];
  }
  if (Array.isArray(selections)) {
    return selections
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object') {
          return String((entry as any).id || (entry as any).optionId || (entry as any).value || '').trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  return [];
}

export function extractWarpWorldChoiceId(selections: unknown): string {
  const ids = collectSelectionIds(selections);
  if (ids[0]) return ids[0];
  if (selections && typeof selections === 'object' && !Array.isArray(selections)) {
    const record = selections as Record<string, unknown>;
    for (const key of ['optionId', 'id', 'value', 'choice']) {
      const value = String(record[key] || '').trim();
      if (value) return value;
    }
  }
  if (typeof selections === 'string') return selections.trim();
  return '';
}

export function extractBottomOrderIds(selections: unknown): string[] {
  if (selections && typeof selections === 'object' && !Array.isArray(selections) && 'bottomOrder' in (selections as object)) {
    const raw = (selections as { bottomOrder?: unknown }).bottomOrder;
    if (Array.isArray(raw)) {
      return raw
        .map((entry) => (typeof entry === 'string' ? entry : String((entry as any)?.id || '')))
        .map((id) => id.trim())
        .filter(Boolean);
    }
  }
  return collectSelectionIds(selections);
}

export function queueWarpWorldChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const lastMovedCardsJson = inheritWarpWorldCarryJson(gameId, 'oracleIrLastMovedCardsJson', result.lastMovedCards);
  const lastMovedCountByPlayerJson = inheritWarpWorldCarryJson(
    gameId,
    'oracleIrLastMovedCountByPlayerJson',
    result.lastMovedCountByPlayer,
  );

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'move_zone') continue;
    const warpChoice = String(gap.metadata?.warpWorldChoice || '').trim();
    if (
      warpChoice !== WARP_WORLD_CHOICE_COMMANDER
      && warpChoice !== WARP_WORLD_CHOICE_AURA
      && warpChoice !== WARP_WORLD_CHOICE_REMAINDER
    ) {
      continue;
    }

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;
    if (!step) continue;

    const remainingSteps = parseWarpWorldRemainingSteps(gameId, result, warpChoice);
    const remainderLastMovedJson = warpChoice === WARP_WORLD_CHOICE_REMAINDER
      ? String(gap.metadata?.allRemainderCardsJson || gap.metadata?.remainderCardsJson || '').trim()
      : '';
    const carriedLastMovedJson = remainderLastMovedJson || lastMovedCardsJson;

    const common = {
      mandatory: true,
      sourceId,
      sourceName,
      oracleIrChoiceStepJson: JSON.stringify([step, ...remainingSteps]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
      oracleIrWarpWorldChoice: warpChoice,
      ...(carriedLastMovedJson ? { oracleIrLastMovedCardsJson: carriedLastMovedJson } : {}),
      ...(lastMovedCountByPlayerJson ? { oracleIrLastMovedCountByPlayerJson: lastMovedCountByPlayerJson } : {}),
      oracleIrCommanderLibraryChoicesJson: inheritAccumulatedJson(
        gameId,
        'oracleIrCommanderLibraryChoicesJson',
        String(gap.metadata?.commanderLibraryChoicesJson || ''),
      ),
      oracleIrAuraAttachByCardIdJson: inheritAccumulatedJson(
        gameId,
        'oracleIrAuraAttachByCardIdJson',
        String(gap.metadata?.auraAttachByCardIdJson || ''),
      ),
      oracleIrLibraryBottomOrderByPlayerJson: inheritAccumulatedJson(
        gameId,
        'oracleIrLibraryBottomOrderByPlayerJson',
        String(gap.metadata?.libraryBottomOrderByPlayerJson || ''),
      ),
    };

    let payload: Record<string, unknown> | null = null;
    if (warpChoice === WARP_WORLD_CHOICE_COMMANDER) {
      const permanentId = String(gap.metadata?.pendingCommanderPermanentId || '').trim();
      const ownerId = String(gap.metadata?.pendingCommanderPlayerId || '').trim() as PlayerID;
      const commanderName = String(gap.metadata?.pendingCommanderName || 'Commander');
      if (!permanentId || !ownerId) continue;
      const perm = findBattlefieldPermanent(state, permanentId);
      payload = {
        ...common,
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: ownerId,
        description: `${sourceName}: Your commander ${commanderName} would be shuffled into your library. Move it to the command zone instead?`,
        minSelections: 1,
        maxSelections: 1,
        pendingCommanderPermanentId: permanentId,
        options: [
          { id: 'command', label: 'Move to Command Zone' },
          { id: 'library', label: 'Shuffle into library' },
        ],
        sourceImage: perm?.card?.image_uris?.small || perm?.card?.image_uris?.normal,
      };
    } else if (warpChoice === WARP_WORLD_CHOICE_AURA) {
      const cardId = String(gap.metadata?.pendingAuraCardId || '').trim();
      const chooserId = String(gap.metadata?.pendingAuraChooserId || '').trim() as PlayerID;
      const auraName = String(gap.metadata?.pendingAuraName || 'Aura');
      const legalAttachIds = (Array.isArray(gap.metadata?.legalAttachIds) ? gap.metadata!.legalAttachIds : [])
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean);
      const isPlayerEnchanting = gap.metadata?.pendingAuraIsPlayerEnchanting === true;
      if (!cardId || !chooserId || legalAttachIds.length === 0) continue;
      const auraCard = findBestRemainderCard(state, cardId, undefined, ctx);
      if (isPlayerEnchanting) {
        const players = (state.players || [])
          .filter((player: any) => legalAttachIds.includes(String(player?.id || '').trim()))
          .map((player: any) => ({
            id: String(player.id),
            name: String(player.name || player.id),
            life: state.life?.[player.id] ?? 40,
            isOpponent: String(player.id) !== chooserId,
            isSelf: String(player.id) === chooserId,
          }));
        payload = {
          ...common,
          type: ResolutionStepType.PLAYER_CHOICE,
          playerId: chooserId,
          description: `${sourceName}: Choose a player for ${auraName} to enchant`,
          pendingAuraCardId: cardId,
          players,
        };
      } else {
        const validTargets = legalAttachIds
          .map((id) => {
            const perm = findBattlefieldPermanent(state, id);
            if (!perm) return null;
            return {
              id,
              label: String(perm?.card?.name || perm?.name || id),
              description: String(perm?.card?.type_line || ''),
              imageUrl: perm?.card?.image_uris?.small || perm?.card?.image_uris?.normal,
            };
          })
          .filter(Boolean);
        if (validTargets.length === 0) continue;
        payload = {
          ...common,
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: chooserId,
          description: `${sourceName}: Choose what ${auraName} will enchant`,
          pendingAuraCardId: cardId,
          validTargets,
          targetTypes: ['permanent'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: `what ${auraName} will enchant`,
          sourceImage: auraCard?.image_uris?.small || auraCard?.image_uris?.normal,
        };
      }
    } else {
      const playerId = String(gap.metadata?.pendingRemainderPlayerId || '').trim() as PlayerID;
      const remainderCardIds = (Array.isArray(gap.metadata?.remainderCardIds) ? gap.metadata!.remainderCardIds : [])
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean);
      if (!playerId || remainderCardIds.length < 2) continue;
      const remainderCardsJson = String(gap.metadata?.remainderCardsJson || '').trim();
      const cards = buildRemainderPromptCards(
        state,
        ctx,
        result,
        remainderCardIds,
        lastMovedCardsJson,
        remainderCardsJson,
        params.irCtx,
      );
      payload = {
        ...common,
        type: ResolutionStepType.BOTTOM_ORDER,
        playerId,
        description: `${sourceName}: Put the remaining revealed cards on the bottom of your library in any order`,
        pendingRemainderPlayerId: playerId,
        cards,
      };
    }

    if (!payload) continue;
    const queued = attachOracleIrResumeMetadata(payload, result, params) as any;
    // Remaining Warp World steps live in oracleIrChoiceStepJson so sequential
    // 903.9a prompts re-run shuffle+reveal together. A separate resumeJson would
    // re-apply after completeStep removes the prior prompt from queue.steps.
    delete queued.oracleIrResumeStepsJson;
    queued.oracleIrChoiceStepJson = JSON.stringify([step, ...remainingSteps]);
    queued.oracleIrControllerId = params.controller;
    queued.oracleIrSourceId = sourceId;
    queued.oracleIrSourceName = sourceName;
    ResolutionQueueManager.addStep(gameId, queued);
  }
}
