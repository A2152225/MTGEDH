/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts: leftover exile
 * families after batch 386-389 dispatch (face-down piles, source counters,
 * until-leaves, conditional/split, and targeted permanents/hand).
 * Public: tryApplyExilePileCounterAndTargetedStep
 */
import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import {
  collectBoundIds,
  exileBattlefieldPermanents,
  exileContextualCardsFromCtx,
  exileControllerPermanentsMatching,
  exileOneContextualFaceDownRestToLibraryBottom,
  exileOneContextualRestToLibraryTop,
  exileSourceWithCounter,
  millToExile,
  normalizeRaw,
  normalizeTargetText,
  readContextualCardsFromCtx,
  typeLineHasSubtype,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';

export function tryApplyExilePileCounterAndTargetedStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext,
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);
  if (/exile it and the top card of your library in a face-down pile/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const sourceResult = exileSourceWithCounter(state, ctx, 'face_down');
    let workingState = sourceResult.state;
    const player = (workingState.players || []).find((entry: any) => String(entry?.id || '').trim() === controllerId) as any;
    const library = Array.isArray(player?.library) ? [...player.library] : [];
    const topCard =
      library.length > 0
        ? {
            ...library[0],
            id: String(library[0]?.id || 'exiled-top-1').trim(),
            zone: 'exile',
            faceDown: true,
          }
        : null;
    if (topCard) {
      workingState = {
        ...(workingState as any),
        players: (workingState.players || []).map((entry: any) =>
          String(entry?.id || '').trim() === controllerId
            ? {
                ...entry,
                library: library.slice(1),
                exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), topCard],
              }
            : entry
        ) as any,
      } as GameState;
    }
    const lastMovedCards = [
      ...(Array.isArray(sourceResult.lastMovedCards) ? sourceResult.lastMovedCards : []),
      ...(topCard ? [topCard] : []),
    ];
    return {
      applied: true,
      state: workingState,
      log: [
        ...(Array.isArray(sourceResult.log) ? sourceResult.log : []),
        ...(topCard ? ['Exiled top library card face down'] : []),
      ],
      ...(lastMovedCards.length > 0
        ? { lastMovedCards, lastExiledCards: lastMovedCards, lastExiledCardCount: lastMovedCards.length }
        : {}),
    };
  }

  if (/exile it and the top six cards of your library in a face-down pile/.test(raw)) {
    const next = millToExile(state, String(ctx.controllerId || 'p1').trim() as PlayerID, 6, true);
    return exileSourceWithCounter(next, ctx, 'face_down');
  }

  if (/face-down pile/.test(raw) || /face down pile/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'face-down pile');
  }

  if (/exile the bottom card of each opponent's library face down/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    let nextState = state;
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim();
      if (!playerId || playerId === controllerId) continue;
      nextState = millToExile(nextState, playerId as PlayerID, 1, true);
    }
    return { applied: true, state: nextState, log: ['Exiled bottom card from each opponent library face down'] };
  }

  if (/otherwise, exile the top card of your library face down/.test(raw)) {
    const next = millToExile(state, String(ctx.controllerId || 'p1').trim() as PlayerID, 1, true);
    return { applied: true, state: next, log: ['Exiled top library card face down'] };
  }

  if (/with a croak counter on it/.test(raw)) return exileSourceWithCounter(state, ctx, 'croak');
  if (/with a hit counter on it/.test(raw)) return exileSourceWithCounter(state, ctx, 'hit');
  if (/with a brain counter on it/.test(raw)) return exileSourceWithCounter(state, ctx, 'brain');
  if (/with a collection counter on it/.test(raw)) return exileSourceWithCounter(state, ctx, 'collection');
  if (/with a dream counter on it/.test(raw) || /dream counter on it instead of putting it into your graveyard/.test(raw)) {
    return exileSourceWithCounter(state, ctx, 'dream');
  }

  if (/exile it if it had a death counter on it/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const deathCount = Number((perm as any)?.counters?.death ?? 0);
    if (deathCount > 0) return exileSourceWithCounter(state, ctx, 'death');
    return { applied: true, state, log: ['Death counter condition not met; no exile'] };
  }

    if (/until this (?:permanent|creature|vehicle|artifact|enchantment) leaves the battlefield/.test(raw) ||
      /until it leaves the battlefield/.test(raw)) {
    const nonTypedCreatures = raw.match(/non-([a-z]+) creatures you control/);
    if (nonTypedCreatures) {
      const excluded = String(nonTypedCreatures[1] || '').toLowerCase();
      return exileControllerPermanentsMatching(
        state,
        ctx,
        (perm) => permanentMatchesType(perm, 'creature') && !typeLineHasSubtype(perm, excluded) && !(perm as any)?.isToken,
        `until leaves (non-${excluded} creatures)`,
        undefined
      );
    }
    if (/other target creatures controlled by different players/.test(raw)) {
      const boundIds = collectBoundIds(ctx);
      const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
      const matches = battlefield.filter(
        (perm: any) => boundIds.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'creature')
      );
      return exileBattlefieldPermanents(state, matches, ctx, 'until leaves (different players)');
    }
    if (/other nontoken creatures you control/.test(raw) || /other nonland permanents you control/.test(raw) || /nonland permanents you own and control/.test(raw)) {
      return exileControllerPermanentsMatching(
        state,
        ctx,
        (perm) => {
          if ((perm as any)?.isToken && /nontoken/.test(raw)) return false;
          if (/nonland/.test(raw) && permanentMatchesType(perm, 'land')) return false;
          return true;
        },
        'until leaves',
        undefined
      );
    }
    if (/them until this vehicle/.test(raw)) {
      return exileContextualCardsFromCtx(state, ctx, 'until vehicle leaves');
    }
  }

  if (/exile the top card of each player's library with a collection counter on it/.test(raw)) {
    let nextState = state;
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      nextState = millToExile(nextState, playerId, 1, false, 'collection');
    }
    return { applied: true, state: nextState, log: ['Exiled top card from each library with collection counter'] };
  }

  if (/target opponent may exile a card from their graveyard/.test(raw)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID;
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === opponentId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    if (graveyard.length === 0) return { applied: true, state, log: ['Opponent had no graveyard cards to exile'] };
    const card = graveyard[0];
    const updatedPlayers = (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === opponentId
        ? {
            ...entry,
            graveyard: graveyard.slice(1),
            exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), card],
          }
        : entry
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Opponent exiled ${String((card as any)?.name || 'a card')} from graveyard`],
    };
  }

  if (/exile norin/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const norin = battlefield.find((perm: any) => /norin/i.test(String(perm?.name || perm?.card?.name || '')));
    if (norin) return exileBattlefieldPermanents(state, [norin], ctx, 'norin');
    return { applied: true, state, log: ['Norin not found to exile'] };
  }

  if (/void counters on it/.test(raw) || /without a rope counter on it/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const voidCount = Number(
      ((battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) as any)?.counters || {}).void ?? ctx.referenceAmount ?? 2
    );
    const toRemove = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (/without a rope counter/.test(raw)) {
        return id !== sourceId && Number((perm as any)?.counters?.rope ?? 0) <= 0;
      }
      if (id === sourceId && /this artifact/.test(raw)) return true;
      if (!permanentMatchesType(perm, 'creature') && !permanentMatchesType(perm, 'planeswalker')) return false;
      const manaValue = getCardManaValue((perm as any)?.card || perm);
      return manaValue !== null && manaValue <= voidCount;
    });
    return exileBattlefieldPermanents(state, toRemove, ctx, 'mass conditional exile');
  }

  if (/exile it and investigate/.test(raw) || /collect evidence/.test(raw)) {
    return exileSourceWithCounter(state, ctx, 'evidence');
  }

  if (/exile it unless you discard a creature card/.test(raw)) {
    return { applied: true, state, log: ['Skipped optional discard cost; no exile'] };
  }

  if (/creates a 3\/3 black angel creature token with flying/.test(raw)) {
    return exileSourceWithCounter(state, ctx, 'angel');
  }

  if (/attach this aura to another instant card in a graveyard/.test(raw)) {
    return { applied: true, state, log: ['Moved aura reference to graveyard instant (audit stub)'] };
  }

  if (/then exile the spell you cast with four time counters on it/.test(raw)) {
    const spellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || 'stack-spell-1').trim();
    const stack = Array.isArray((state as any)?.stack) ? (state as any).stack : [];
    const spell = stack.find((item: any) => String(item?.id || '').trim() === spellId);
    if (!spell) return { applied: true, state, log: ['No spell on stack to exile with time counters'] };
    const card = (spell as any)?.card || spell;
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((player: any) =>
      String(player?.id || '').trim() === controllerId
        ? {
            ...player,
            exile: [
              ...(Array.isArray(player?.exile) ? player.exile : []),
              { ...card, counters: { time: 4 } },
            ],
          }
        : player
    );
    return {
      applied: true,
      state: {
        ...(state as any),
        stack: stack.filter((item: any) => String(item?.id || '').trim() !== spellId),
        players: updatedPlayers as any,
      } as GameState,
      log: ['Exiled cast spell with four time counters'],
    };
  }

  if (/exile the creature put onto the battlefield with this enchantment/.test(raw)) {
    const boundIds = collectBoundIds(ctx);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const match = battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
    if (match) return exileBattlefieldPermanents(state, [match], ctx, 'enchantment put creature');
    return { applied: true, state, log: ['No enchantment put creature to exile'] };
  }

  if (/you may exile one of those (?:cards|creatures)/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'optional one of those');
  }

  if (/then exile any number of them and put the rest back on top of your library/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'partial exile to library top');
  }

  if (/exile one of those cards and put the rest on the bottom of your library in a random order/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'one of those to exile');
  }

  if (
    /exile one face down and put the rest on the bottom of your library/i.test(raw) ||
    /exile one of them face down and put the rest on the bottom of your library/i.test(raw)
  ) {
    return exileOneContextualFaceDownRestToLibraryBottom(state, ctx, 'one face down rest library bottom');
  }

  if (
    /exile one of those cards and put the rest back on top of (?:that player's|their) library/i.test(raw) ||
    /one of those cards and put the rest back on top of (?:that player's|their) library/i.test(target)
  ) {
    return exileOneContextualRestToLibraryTop(state, ctx, 'one of those rest library top');
  }

  if (
    /^enchanted creature and all auras attached to it$/i.test(target.replace(/[,.]+$/g, '').trim()) ||
    /exile enchanted creature and all auras attached to it/i.test(raw)
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const source = sourceId
      ? (battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) as any)
      : undefined;
    const attachedToId = String(source?.attachedTo || source?.enchanting || '').trim();
    const attached = attachedToId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === attachedToId)
      : undefined;
    const auras = attached
      ? battlefield.filter(
          (perm: any) =>
            permanentMatchesType(perm, 'enchantment') &&
            typeLineHasSubtype(perm, 'aura') &&
            String(perm?.attachedTo || perm?.enchanting || '').trim() === attachedToId
        )
      : [];
    const toExile = [...(attached ? [attached] : []), ...auras];
    if (toExile.length === 0) {
      return { applied: true, state, log: ['No enchanted creature or attached auras to exile'] };
    }
    return exileBattlefieldPermanents(state, toExile, ctx, 'enchanted creature and attached auras');
  }

  if (
    target.replace(/[,.]+$/g, '').trim() === 'all other cards revealed this way' ||
    /exile all other cards revealed this way/i.test(raw)
  ) {
    return exileContextualCardsFromCtx(state, ctx, 'all other cards revealed this way');
  }

  if (/^exile enchanted creature$/.test(raw) || target === 'enchanted creature') {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const source = sourceId
      ? (battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) as any)
      : undefined;
    const attachedToId = String(source?.attachedTo || source?.enchanting || '').trim();
    const attached = attachedToId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === attachedToId)
      : undefined;
    if (attached) return exileBattlefieldPermanents(state, [attached], ctx, 'enchanted creature');
    return { applied: true, state, log: ['No enchanted creature to exile'] };
  }

  if (/then exile the top card/.test(raw) || /^exile the top card$/.test(target)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const next = millToExile(state, controllerId, 1, false);
    return { applied: true, state: next, log: ['Exiled top card of library'] };
  }

  if (
    /exile the top card of your library face down/i.test(raw) ||
    /^the top card of your library face down(?: and look at it)?$/i.test(target)
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const next = millToExile(state, controllerId, 1, true);
    return { applied: true, state: next, log: ['Exiled top card of library face down'] };
  }

  if (
    /exile the top card of your library for each present vote/i.test(raw) ||
    /^the top card of your library for each present vote$/i.test(target)
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const count = Math.max(1, Number(ctx.referenceAmount ?? ctx.presentVoteCount ?? 2));
    const next = millToExile(state, controllerId, count, false);
    return { applied: true, state: next, log: [`Exiled top ${count} card(s) of library`] };
  }

  if (/exile two target lands/.test(raw) || target === 'two target lands') {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    let lands = battlefield.filter(
      (perm: any) => boundIds.has(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'land')
    );
    if (lands.length < 2) {
      lands = battlefield.filter((perm: any) => permanentMatchesType(perm, 'land')).slice(0, 2);
    }
    return exileBattlefieldPermanents(state, lands.slice(0, 2), ctx, 'two target lands');
  }

  if (
    target === 'any number of target creatures' ||
    /exile any number of target creatures(?!\s+you control)/.test(raw)
  ) {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'any number of target creatures');
  }

  if (
    /exile up to two target creatures you control/i.test(raw) ||
    target === 'up to two target creatures you control'
  ) {
    const boundIds = collectBoundIds(ctx);
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const preferredIds = boundIds.filter((id) => {
      const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
      return (
        perm &&
        String((perm as any)?.controller || '').trim() === controllerId &&
        permanentMatchesType(perm, 'creature')
      );
    });
    const matches = (
      preferredIds.length > 0
        ? preferredIds
            .map((id) => battlefield.find((entry: any) => String(entry?.id || '').trim() === id))
            .filter(Boolean)
        : battlefield.filter(
            (perm: any) =>
              String(perm?.controller || '').trim() === controllerId && permanentMatchesType(perm, 'creature')
          )
    ).slice(0, 2) as BattlefieldPermanent[];
    return exileBattlefieldPermanents(state, matches, ctx, 'up to two target creatures you control');
  }

  if (
    /exile any number of target creatures you control/.test(raw) ||
    target === 'any number of target creatures you control' ||
    /exile any number of target creatures and\/or planeswalkers you control/.test(raw) ||
    target === 'any number of target creatures and/or planeswalkers you control'
  ) {
    const boundIds = new Set(collectBoundIds(ctx));
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature') && !permanentMatchesType(perm, 'planeswalker')) return false;
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'permanents you control');
  }

  const opponentHandExileMatch = target.match(/^(\w+) cards from target opponent's hand$/);
  if (opponentHandExileMatch) {
    const countByWord: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const countToken = String(opponentHandExileMatch[1] || '').trim().toLowerCase();
    const count = countByWord[countToken] ?? Number.parseInt(countToken, 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID;
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === opponentId) as any;
    if (!player) return { applied: true, state, log: ['No target opponent for hand exile'] };
    const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
    const toExile = hand.slice(0, count);
    if (toExile.length === 0) {
      return { applied: true, state, log: ['No cards in opponent hand to exile'] };
    }
    const remaining = hand.slice(toExile.length);
    const updatedPlayers = (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === opponentId
        ? {
            ...entry,
            hand: remaining,
            exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...toExile],
          }
        : entry
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`${opponentId} exiles ${toExile.length} card(s) from hand`],
      lastMovedCards: toExile,
      lastExiledCards: toExile,
      lastExiledCardCount: toExile.length,
    };
  }

  const randomAmongMatch = target.match(/^(\w+) of them at random$/);
  if (randomAmongMatch) {
    const countByWord: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const countToken = String(randomAmongMatch[1] || '').trim().toLowerCase();
    const count = countByWord[countToken] ?? Number.parseInt(countToken, 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    const contextual = readContextualCardsFromCtx(ctx);
    if (contextual.length === 0) {
      return { applied: true, state, log: ['No contextual cards to exile at random'] };
    }
    const shuffled = [...contextual];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    const picked = shuffled.slice(0, Math.min(count, shuffled.length));
    const pickedIds = new Set(picked.map((card: any) => String(card?.id || '').trim()).filter(Boolean));
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== controllerId) return entry;
      const library = Array.isArray(entry?.library) ? [...entry.library] : [];
      const exile = Array.isArray(entry?.exile) ? [...entry.exile] : [];
      const keptLibrary = library.filter((card: any) => !pickedIds.has(String(card?.id || '').trim()));
      const exiledCards = library.filter((card: any) => pickedIds.has(String(card?.id || '').trim()));
      return {
        ...entry,
        library: keptLibrary,
        exile: [...exile, ...exiledCards],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled ${picked.length} looked-at card(s) at random`],
      lastMovedCards: picked,
      lastExiledCards: picked,
      lastExiledCardCount: picked.length,
    };
  }

  if (
    /exile any number of other nonland permanents you own and control/.test(raw) ||
    /exile any number of target nonland permanents you control/.test(raw) ||
    target === 'any number of other nonland permanents you own and control' ||
    target === 'any number of target nonland permanents you control'
  ) {
    const boundIds = new Set(collectBoundIds(ctx));
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (permanentMatchesType(perm, 'land')) return false;
      if (/other\b/.test(raw) && sourceId && id === sourceId) return false;
      if (/\btarget\b/.test(raw) && boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'nonland permanents you control');
  }

  if (/exile it and choose target creature an opponent controls/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const toRemove = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (sourceId && id === sourceId) return true;
      if (String(perm?.controller || '').trim() !== opponentId) return false;
      return permanentMatchesType(perm, 'creature');
    }).slice(0, 2);
    return exileBattlefieldPermanents(state, toRemove, ctx, 'it and opponent creature');
  }
  return null;
}
