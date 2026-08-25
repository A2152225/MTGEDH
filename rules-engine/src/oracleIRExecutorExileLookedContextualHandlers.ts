/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts: leftover exile
 * families after batch 386-389 dispatch (looked/contextual cards, top mill,
 * mass nontoken, and "the rest").
 * Public: tryApplyExileLookedContextualStep
 */
import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { tryApplyExileOneOfThemLookedCards } from './oracleIRExecutorExileOneOfThemHandlers.js';
import {
  collectBoundIds,
  exileBattlefieldPermanents,
  exileContextualCardsFromCtx,
  millToExile,
  normalizeRaw,
  normalizeTargetText,
  readContextualAndExiledCardsFromCtx,
  readContextualCardsFromCtx,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';
import { resolveEnchantedHost } from './oracleIRExecutorSpecialTargetResolve';

export function tryApplyExileLookedContextualStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext,
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);

  if (/exile up to one target creature other than enchanted creature/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const host = resolveEnchantedHost(battlefield, ctx);
    const hostId = String((host as any)?.id || '').trim();
    const boundIds = new Set(collectBoundIds(ctx));
    const targets = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (hostId && id === hostId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    if (targets.length === 0) {
      return { applied: true, state, log: ['No target creature to exile'] };
    }
    const preferredId = String(
      ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || ''
    ).trim();
    const picked =
      targets.find((perm) => String((perm as any)?.id || '').trim() === preferredId) || targets[0];
    return exileBattlefieldPermanents(state, [picked], ctx, 'creature other than enchanted');
  }

  if (
    target === 'them instead of putting them anywhere else' ||
    /exile them instead of putting them anywhere else/.test(raw)
  ) {
    return exileContextualCardsFromCtx(state, ctx, 'replacement exile');
  }

  const normalizedExileTarget = target.replace(/\s+face\s+down$/i, '').trim();
  if (/^the other(?: with a silver counter on it)?$/i.test(normalizedExileTarget) || /^the other with a silver counter on it$/i.test(target)) {
    const contextual = readContextualCardsFromCtx(ctx);
    const chosenIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const otherCards =
      contextual.length >= 2
        ? contextual.filter((card: any) => !chosenIds.has(String(card?.id || '').trim())).slice(0, 1)
        : contextual.length === 2
          ? [contextual[1]]
          : contextual.slice(0, 1);
    if (otherCards.length === 0) {
      return { applied: true, state, log: ['No other card to exile'] };
    }
    const ownerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const exiledCards = otherCards.map((card: any) => ({
      ...card,
      zone: 'exile',
      counters: {
        ...(((card as any)?.counters || {}) as Record<string, number>),
        ...( /silver counter/i.test(raw) ? { silver: 1 } : {}),
      },
    }));
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== ownerId) return entry;
      return {
        ...entry,
        exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...exiledCards],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled the other card${/silver counter/i.test(raw) ? ' with a silver counter' : ''}`],
      lastMovedCards: exiledCards,
      lastExiledCards: exiledCards,
      lastExiledCardCount: exiledCards.length,
    };
  }

  if (
    /^them$|^those cards$|^those creatures$|^those auras$|^one of those cards$|^one of those creatures$/.test(
      normalizedExileTarget
    )
  ) {
    const faceDown = /\bface\s+down\b/i.test(target) || /\bface\s+down\b/i.test(raw);
    const contextual = readContextualAndExiledCardsFromCtx(ctx);
    if (contextual.length === 0) {
      const opponentId = String(ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2').trim();
      const opponent = (state.players || []).find((player: any) => String(player?.id || '').trim() === opponentId) as any;
      const hand = Array.isArray(opponent?.hand) ? [...opponent.hand] : [];
      if (hand.length > 0) {
        const exiledCards = hand.map((card: any) => ({
          ...card,
          zone: 'exile',
          faceDown,
        }));
        const updatedPlayers = (state.players || []).map((player: any) => {
          if (String(player?.id || '').trim() !== opponentId) return player;
          return {
            ...player,
            hand: [],
            exile: [...(Array.isArray(player?.exile) ? player.exile : []), ...exiledCards],
          };
        });
        return {
          applied: true,
          state: { ...(state as any), players: updatedPlayers as any } as GameState,
          log: [`Exiled ${exiledCards.length} card(s) from ${opponentId}'s hand${faceDown ? ' face down' : ''}`],
          lastMovedCards: exiledCards,
          lastExiledCards: exiledCards,
          lastExiledCardCount: exiledCards.length,
        };
      }
    }
    const result = exileContextualCardsFromCtx(state, ctx, normalizedExileTarget);
    if (!result || !faceDown || !result.applied) return result;
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (result.state.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== controllerId) return player;
      const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
      return {
        ...player,
        exile: exile.map((card: any) => ({ ...card, faceDown: true })),
      };
    });
    return {
      ...result,
      state: { ...(result.state as any), players: updatedPlayers as any } as GameState,
    };
  }

  if (
    /^one of them face down with a hatching counter on it$/i.test(target) ||
    /^one of them face down with a hatching counter on it$/i.test(normalizedExileTarget)
  ) {
    const contextual = readContextualCardsFromCtx(ctx);
    if (contextual.length === 0) {
      return { applied: true, state, log: ['No contextual cards to exile with hatching counter'] };
    }
    const chosenId = String(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : '') ||
        contextual[0]?.id ||
        ''
    ).trim();
    const picked =
      contextual.find((card: any) => String(card?.id || '').trim() === chosenId) || contextual[0];
    const pickedId = String(picked?.id || '').trim();
    const ownerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== ownerId) return entry;
      const library = Array.isArray(entry?.library) ? [...entry.library] : [];
      const exile = Array.isArray(entry?.exile) ? [...entry.exile] : [];
      const exiledCard = {
        ...(library.find((card: any) => String(card?.id || '').trim() === pickedId) || picked),
        zone: 'exile',
        faceDown: true,
        counters: { ...(((library.find((card: any) => String(card?.id || '').trim() === pickedId) || picked) as any)?.counters || {}), hatching: 1 },
      };
      return {
        ...entry,
        library: library.filter((card: any) => String(card?.id || '').trim() !== pickedId),
        exile: [...exile, exiledCard],
      };
    });
    const restCards = contextual.filter((card: any) => String(card?.id || '').trim() !== pickedId);
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled one looked-at card face down with a hatching counter'],
      lastMovedCards: restCards,
      lastExiledCards: [{ ...(picked as any), zone: 'exile', faceDown: true }],
      lastExiledCardCount: 1,
    };
  }

  const oneOfThem = tryApplyExileOneOfThemLookedCards(state, ctx, {
    target,
    raw,
    normalizedExileTarget,
  });
  if (oneOfThem) return oneOfThem;

  if (target === 'any number of those cards' || /exile any number of those cards/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'any number of those cards');
  }

  if (
    /^the top (?:x|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards/i.test(target) ||
    /exile the top (?:x|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards/i.test(raw)
  ) {
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
    const source = `${target} ${raw}`.toLowerCase();
    let count = 0;
    if (/\bthe top x cards\b/.test(source)) {
      count = Math.max(1, Number(ctx.xValue ?? ctx.referenceAmount ?? 4));
    } else {
      const match = source.match(/\bthe top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards\b/);
      const token = String(match?.[1] || '').trim().toLowerCase();
      count = countByWord[token] ?? Number.parseInt(token, 10);
    }
    if (!Number.isFinite(count) || count <= 0) count = 1;
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const next = millToExile(state, controllerId, count, false);
    return {
      applied: true,
      state: next,
      log: [`Exiled top ${count} card(s) of library`],
    };
  }

  if (
    /that card and put the rest on the bottom of your library/i.test(target) ||
    /that card and put the rest on the bottom of your library/i.test(raw)
  ) {
    const contextual = readContextualCardsFromCtx(ctx);
    if (contextual.length === 0) {
      return { applied: true, state, log: ['No contextual cards for that-card exile split'] };
    }
    const ownerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const exiledCard = contextual[0];
    const exiledId = String(exiledCard?.id || '').trim();
    const restCards = contextual.filter((card: any) => String(card?.id || '').trim() !== exiledId);
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== ownerId) return entry;
      const library = Array.isArray(entry?.library) ? [...entry.library] : [];
      const contextualIds = new Set(
        contextual.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
      );
      const kept = library.filter((card: any) => !contextualIds.has(String(card?.id || '').trim()));
      const exile = Array.isArray(entry?.exile) ? [...entry.exile] : [];
      return {
        ...entry,
        library: [...kept, ...restCards],
        exile: [...exile, { ...exiledCard, zone: 'exile' }],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled that card and put the rest on library bottom'],
      lastExiledCards: [{ ...exiledCard, zone: 'exile' }],
      lastMovedCards: restCards,
    };
  }

  if (target === 'them again' || /^them again$/i.test(target)) {
    return { applied: true, state, log: ['Exiled returned cards again (scheduled)'] };
  }

  if (
    /exile target tapped creature an opponent controls until this creature leaves the battlefield/i.test(raw) ||
    /until this creature leaves the battlefield/i.test(raw) && /exile target tapped creature an opponent controls/i.test(raw)
  ) {
    const boundIds = collectBoundIds(ctx);
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const target =
      battlefield.find((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (boundIds.length > 0 && !boundIds.includes(id)) return false;
        if (String(perm?.controller || '').trim() === String(ctx.controllerId || '').trim()) return false;
        if (!permanentMatchesType(perm, 'creature')) return false;
        return Boolean((perm as any)?.tapped);
      }) ||
      battlefield.find(
        (perm: any) =>
          String(perm?.controller || '').trim() === opponentId &&
          permanentMatchesType(perm, 'creature') &&
          Boolean((perm as any)?.tapped)
      );
    if (!target) {
      return { applied: true, state, log: ['No tapped opponent creature to exile until leaves'] };
    }
    return exileBattlefieldPermanents(state, [target], ctx, 'until creature leaves');
  }

  if (
    target === 'all nontoken creatures you control' ||
    /exile all nontoken creatures you control/.test(raw)
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if ((perm as any)?.isToken) return false;
      return permanentMatchesType(perm, 'creature');
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'all nontoken creatures you control');
  }

  if (
    target === 'all nontoken permanents' ||
    /^exile all nontoken permanents\b/.test(raw)
  ) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => !(perm as any)?.isToken);
    return exileBattlefieldPermanents(state, matches, ctx, 'all nontoken permanents');
  }

  if (
    /this permanent or up to one target creature/i.test(target) ||
    /this permanent or up to one target creature/i.test(raw)
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const boundIds = collectBoundIds(ctx);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const boundCreature = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
    });
    if (boundCreature) return exileBattlefieldPermanents(state, [boundCreature], ctx, 'target creature');
    const source = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    if (source) return exileBattlefieldPermanents(state, [source], ctx, 'this permanent');
    return { applied: true, state, log: ['No permanent or creature to exile'] };
  }

  if (target === 'the rest' || /^exile the rest$/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'the rest');
  }
  return null;
}
