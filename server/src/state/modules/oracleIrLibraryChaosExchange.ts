import type { GameContext } from '../context.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { uid } from '../utils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { movePermanentToLibrary } from './zones.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';

export type LibraryChaosExchangeStep = Extract<OracleEffectStep, { kind: 'library_chaos_exchange' }>;

export interface LibraryChaosCastOffer {
  readonly playerId: string;
  readonly card: any;
}

export function queueLibraryChaosCastOffers(
  ctx: GameContext,
  offers: readonly LibraryChaosCastOffer[],
  source: { sourceId?: string; sourceName?: string },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;
  const sourceName = String(source.sourceName || 'Ability').trim() || 'Ability';

  for (const offer of offers) {
    const playerId = String(offer.playerId || '').trim();
    const card = offer.card;
    if (!playerId || !card?.id) continue;
    const queuedStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as PlayerID,
      description: `${sourceName}: You may cast ${card.name || 'the exiled card'} without paying its mana cost.`,
      mandatory: false,
      sourceId: source.sourceId,
      sourceName,
      options: [
        { id: 'cast', label: `Cast ${card.name || 'the exiled card'}` },
        { id: 'decline', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      castFromExileCardId: String(card.id),
      castFromExileCard: { ...card },
      castFromExileDeclineDestination: 'exile',
      castFromExileCastWithoutPayingManaCost: true,
      castFromExileBypassExilePermissionCheck: true,
      castFromExileIgnoreTimingRestrictions: true,
      oracleIrLibraryChaosCastPrompt: true,
    } as any);
    appendQueuedResolutionPromptEvent(ctx, {
      playerId,
      sourceId: source.sourceId,
      queuedResolutionStep: queuedStep,
    });
  }
}

export function permanentMatchesLibraryChaosTarget(permanent: any, targetText: string): boolean {
  if (!permanent) return false;
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  const normalized = String(targetText || '').toLowerCase();
  if (normalized.includes('nonenchantment') && typeLine.includes('enchantment')) return false;
  if (normalized.includes('nonland') && typeLine.includes('land')) return false;
  return true;
}

function syncLibrary(ctx: GameContext, playerId: string, library: any[]): void {
  const cards = library.map((card: any) => ({ ...card, zone: 'library' }));
  ctx.libraries.set(playerId as PlayerID, cards);
  const state: any = ctx.state;
  state.zones = state.zones || {};
  state.zones[playerId] = state.zones[playerId] || {};
  state.zones[playerId].library = cards;
  state.zones[playerId].libraryCount = cards.length;
  const player = (state.players || []).find((entry: any) => String(entry?.id || '') === playerId);
  if (player) player.library = cards;
}

function appendToExile(ctx: GameContext, playerId: string, card: any): any {
  const state: any = ctx.state;
  state.zones = state.zones || {};
  state.zones[playerId] = state.zones[playerId] || {};
  const exile = Array.isArray(state.zones[playerId].exile) ? state.zones[playerId].exile : [];
  const exiled = { ...card, zone: 'exile' };
  exile.push(exiled);
  state.zones[playerId].exile = exile;
  state.zones[playerId].exileCount = exile.length;
  const player = (state.players || []).find((entry: any) => String(entry?.id || '') === playerId);
  if (player) player.exile = exile;
  return exiled;
}

function shuffleCards(cards: any[], rng: () => number): any[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.max(0, Math.min(0.999999, rng())) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function executeLibraryChaosExchange(
  ctx: GameContext,
  step: LibraryChaosExchangeStep,
  targetPermanentIds: readonly string[],
  source: { sourceId?: string; sourceName?: string; resolvedStepId?: string },
): { castOffers: LibraryChaosCastOffer[]; affectedPlayers: string[] } {
  const state: any = ctx.state;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '');
  const selected = targetPermanentIds
    .map((id) => battlefield.find((permanent: any) => String(permanent?.id || '') === String(id)))
    .filter((permanent: any) => permanentMatchesLibraryChaosTarget(permanent, targetText));

  const removedPermanents = selected.map((permanent: any) => ({
    id: String(permanent.id),
    owner: String(permanent.owner || permanent.controller || ''),
    controller: String(permanent.controller || permanent.owner || ''),
    card: { ...(permanent.card || {}) },
  }));
  const originalControllers = [...new Set(removedPermanents.map((entry) => entry.controller).filter(Boolean))];
  // Audacious-style top-card exchanges act on the permanent's owner.
  // Guff-style exile-until acts on each player who controlled a chosen permanent.
  const exchangePlayers = step.exileMode === 'top_card'
    ? [...new Set(removedPermanents.map((entry) => entry.owner).filter(Boolean))]
    : originalControllers;
  const affectedLibraryPlayers = new Set<string>([
    ...removedPermanents.map((entry) => entry.owner).filter(Boolean),
    ...exchangePlayers,
  ]);

  let rngDrawCount = 0;
  const originalRng = typeof (ctx as any).rng === 'function'
    ? (ctx as any).rng.bind(ctx)
    : Math.random;
  const countingRng = () => {
    rngDrawCount += 1;
    return Number(originalRng()) || 0;
  };
  (ctx as any).rng = countingRng;

  try {
    for (const permanent of selected) {
      movePermanentToLibrary(ctx, String(permanent.id), 'shuffle');
    }

    const castOffers: LibraryChaosCastOffer[] = [];
    const exileAddedByPlayer: Record<string, any[]> = {};
    const battlefieldAdded: any[] = [];

    for (const playerId of exchangePlayers) {
      const library = [...(ctx.libraries.get(playerId as PlayerID) || [])];
      if (library.length === 0) {
        syncLibrary(ctx, playerId, library);
        continue;
      }

      if (step.exileMode === 'top_card') {
        const topCard = library.shift();
        if (!topCard) continue;
        const typeLine = String(topCard?.type_line || '').toLowerCase();
        if (step.putLandOntoBattlefield && typeLine.includes('land')) {
          const permanent = {
            id: uid('perm'),
            owner: playerId,
            controller: playerId,
            tapped: false,
            counters: {},
            summoningSickness: false,
            card: { ...topCard, zone: 'battlefield' },
          };
          state.battlefield.push(permanent);
          battlefieldAdded.push(permanent);
        } else {
          const exiled = appendToExile(ctx, playerId, topCard);
          exileAddedByPlayer[playerId] = [...(exileAddedByPlayer[playerId] || []), exiled];
          castOffers.push({ playerId, card: exiled });
        }
        syncLibrary(ctx, playerId, library);
        continue;
      }

      const revealed: any[] = [];
      let hit: any | undefined;
      while (library.length > 0) {
        const card = library.shift();
        if (!card) break;
        if (!String(card?.type_line || '').toLowerCase().includes('land')) {
          hit = card;
          break;
        }
        revealed.push(card);
      }
      const randomizedRest = step.bottomRestRandom ? shuffleCards(revealed, countingRng) : revealed;
      library.push(...randomizedRest.map((card) => ({ ...card, zone: 'library' })));
      if (hit) {
        const exiled = appendToExile(ctx, playerId, hit);
        exileAddedByPlayer[playerId] = [...(exileAddedByPlayer[playerId] || []), exiled];
        castOffers.push({ playerId, card: exiled });
      }
      syncLibrary(ctx, playerId, library);
    }

    const librarySnapshots: Record<string, any[]> = {};
    for (const playerId of affectedLibraryPlayers) {
      librarySnapshots[playerId] = [...(ctx.libraries.get(playerId as PlayerID) || [])].map((card: any) => ({ ...card }));
    }

    if (!(ctx as any).isReplaying) {
      const gameId = String((ctx as any).gameId || '').trim();
      if (gameId && gameId !== 'unknown') {
        appendEvent(gameId, Number((ctx as any).seq ?? state?.seq ?? 0), 'libraryChaosExchangeResolved', {
          sourceId: source.sourceId,
          sourceName: source.sourceName,
          resolvedStepId: source.resolvedStepId,
          removedPermanents,
          librarySnapshots,
          exileAddedByPlayer,
          battlefieldAdded,
          rngDrawCount,
        });
      }
    }

    if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
    return { castOffers, affectedPlayers: exchangePlayers };
  } catch (err) {
    debugWarn(1, '[OracleIR] library chaos exchange failed:', err);
    return { castOffers: [], affectedPlayers: exchangePlayers };
  } finally {
    (ctx as any).rng = originalRng;
  }
}
