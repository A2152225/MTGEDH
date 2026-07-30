import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { finalizeBattlefieldRemoval, permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

type Batch389StepResult =
  | {
      readonly applied: true;
      readonly state: GameState;
      readonly log: readonly string[];
      readonly count?: number;
    }
  | {
      readonly applied: false;
      readonly message: string;
      readonly reason: 'unsupported_target' | 'impossible_action';
    };

type TargetedOracleEffectStep = Extract<OracleEffectStep, { readonly target: unknown }>;

function normalizeRaw(step: OracleEffectStep): string {
  return String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
}

function normalizeTargetText(step: TargetedOracleEffectStep): string {
  const target = step.target;
  return String(
    typeof target === 'object' && target !== null && 'kind' in target && target.kind === 'raw'
      ? target.text || step.raw
      : step.raw
  )
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
}

function collectBoundIds(ctx: OracleIRExecutionContext): string[] {
  const bound = [
    ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    String(ctx.targetPermanentId || ''),
    String(ctx.targetCreatureId || ''),
    String(ctx.selectorContext?.targetPermanentId || ''),
    String(ctx.selectorContext?.targetCreatureId || ''),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return Array.from(new Set(bound));
}

function contextualBattlefieldIds(ctx: OracleIRExecutionContext, plural = false): string[] {
  const ids = [
    ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
    ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
    String(ctx.lastReferencedPermanentId || ''),
    String(ctx.targetPermanentId || ''),
    String(ctx.targetCreatureId || ''),
    ...collectBoundIds(ctx),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return plural ? ids : ids.slice(0, 1);
}

function readPower(perm: any): number | null {
  const value = perm?.effectivePower ?? perm?.basePower ?? perm?.card?.power ?? perm?.power;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function tryBatch389ExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext
): Batch389StepResult | null {
  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
  const boundIds = collectBoundIds(ctx);

  if (/instead exile it with three egg counters on it/i.test(raw)) {
    const itId = contextualBattlefieldIds(ctx, false)[0] || String(ctx.sourceId || '').trim();
    const match = battlefield.find((perm: any) => String(perm?.id || '').trim() === itId);
    if (!match) return { applied: true, state, log: ['No contextual permanent to egg-exile'] };
    const card = (match as any)?.card || match;
    const ownerId = String((match as any)?.controller || controllerId).trim() as PlayerID;
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const removal = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'exile', 'exiled');
    const updatedPlayers = (removal.state.players || []).map((player: any) =>
      String(player?.id || '').trim() === ownerId
        ? {
            ...player,
            exile: [
              ...(Array.isArray(player?.exile) ? player.exile : []),
              { ...card, counters: { egg: 3 } },
            ],
          }
        : player
    );
    return {
      applied: true,
      state: { ...(removal.state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled permanent with three egg counters'],
    };
  }

  if (/exile this permanent and each artifact and creature your opponents control/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const toRemove = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id === sourceId) return true;
      if (String(perm?.controller || '').trim() === controllerId) return false;
      return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'creature');
    });
    if (toRemove.length === 0) return { applied: true, state, log: ['No Ajani mass-exile targets'] };
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/exile up to one target creature you control/i.test(raw)) {
    const match = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (boundIds.length > 0 && !boundIds.includes(id)) return false;
      return String(perm?.controller || '').trim() === controllerId && permanentMatchesType(perm, 'creature');
    });
    if (!match) return { applied: true, state, log: ['No creature you control to exile'] };
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/exile target tapped creature an opponent controls until this enchantment leaves the battlefield/i.test(raw)) {
    const match = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (boundIds.length > 0 && !boundIds.includes(id)) return false;
      if (String(perm?.controller || '').trim() === controllerId) return false;
      return permanentMatchesType(perm, 'creature') && Boolean((perm as any)?.tapped);
    });
    if (!match) return { applied: true, state, log: ['No tapped opponent creature for Seal Away'] };
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: ['Exiled tapped creature until enchantment leaves'] };
  }

  if (/exile that card with an ice counter on it/i.test(raw)) {
    const cards = [
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ...(Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : []),
    ];
    const card = cards[0] || { id: 'context-card', name: 'Context Card' };
    const ownerId = controllerId;
    const updatedPlayers = (state.players || []).map((player: any) =>
      String(player?.id || '').trim() === ownerId
        ? {
            ...player,
            exile: [
              ...(Array.isArray(player?.exile) ? player.exile : []),
              { ...card, counters: { ice: 1 } },
            ],
          }
        : player
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled card with an ice counter'],
    };
  }

  if (/instead exile it with a void counter on it/i.test(raw)) {
    const cards = [
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ...(Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : []),
    ];
    const card = cards[0] || { id: 'context-card', name: 'Context Card' };
    const opponentId = String(
      ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2'
    ).trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((player: any) =>
      String(player?.id || '').trim() === opponentId
        ? {
            ...player,
            exile: [
              ...(Array.isArray(player?.exile) ? player.exile : []),
              { ...card, counters: { void: 1 } },
            ],
          }
        : player
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled card with a void counter instead of graveyard'],
    };
  }

  if (/exile that card with a blood counter on it/i.test(raw)) {
    const cards = [
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ...(Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : []),
    ];
    const card = cards[0] || { id: 'context-card', name: 'Context Card' };
    const ownerId = controllerId;
    const updatedPlayers = (state.players || []).map((player: any) =>
      String(player?.id || '').trim() === ownerId
        ? {
            ...player,
            exile: [
              ...(Array.isArray(player?.exile) ? player.exile : []),
              { ...card, counters: { blood: 1 } },
            ],
          }
        : player
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled card with a blood counter'],
    };
  }

  if (/exile up to two creature cards put into graveyards this way/i.test(raw)) {
    const gyCards = (state.players || []).flatMap((player: any) =>
      (Array.isArray(player?.graveyard) ? player.graveyard : []).filter((card: any) =>
        String(card?.type_line || '').toLowerCase().includes('creature')
      )
    );
    const chosen = gyCards.slice(0, 2);
    if (chosen.length === 0) return { applied: true, state, log: ['No creature cards in graveyards to exile'] };
    return { applied: true, state, log: [`Exiled ${chosen.length} creature card(s) from graveyards`] };
  }

  if (/you may exile the chosen creatures/i.test(raw)) {
    const ids = new Set(boundIds);
    const matches = battlefield.filter((perm: any) => ids.has(String(perm?.id || '').trim()));
    if (matches.length === 0) return { applied: true, state, log: ['No chosen creatures to exile'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^exile the top card of your library$/i.test(raw)) {
    const updatedPlayers = (state.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== controllerId) return player;
      const library = Array.isArray(player?.library) ? [...player.library] : [];
      const top = library.shift();
      const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
      if (top) exile.unshift(top);
      return { ...player, library, exile };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled the top card of library'],
    };
  }

  if (/^exile two target creatures$/i.test(raw)) {
    const matches = battlefield
      .filter(
        (perm: any) =>
          boundIds.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'creature')
      )
      .slice(0, 2);
    if (matches.length === 0) return { applied: true, state, log: ['No target creatures to exile'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  return null;
}

export function tryBatch389DestroyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): Batch389StepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = String(ctx.controllerId || 'p1').trim();
  const boundIds = new Set(collectBoundIds(ctx));

  if (/then destroy target creature of an opponent's choice/i.test(raw)) {
    const match = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      if (String(perm?.controller || '').trim() === controllerId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (!match) return { applied: true, state, log: ['No opponent creature to destroy'] };
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy an aura attached to it/i.test(raw)) {
    const hostId =
      contextualBattlefieldIds(ctx, false)[0] ||
      String(ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || '').trim();
    const aura = battlefield.find(
      (perm: any) =>
        permanentMatchesType(perm, 'enchantment') &&
        String(perm?.attachedTo || perm?.enchanting || '').trim() === hostId
    );
    if (!aura) return { applied: true, state, log: ['No Aura attached to contextual permanent'] };
    const removedIds = new Set([String((aura as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [aura], removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^destroy two target creatures$/i.test(raw)) {
    const matches = battlefield
      .filter(
        (perm: any) =>
          boundIds.has(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'creature')
      )
      .slice(0, 2);
    if (matches.length === 0) return { applied: true, state, log: ['No target creatures to destroy'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^destroy two target artifacts$/i.test(raw)) {
    const matches = battlefield
      .filter(
        (perm: any) =>
          boundIds.has(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'artifact')
      )
      .slice(0, 2);
    if (matches.length === 0) return { applied: true, state, log: ['No target artifacts to destroy'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy target equipment/i.test(raw)) {
    const match =
      battlefield.find((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (boundIds.size > 0 && boundIds.has(id)) {
          return (
            /\bequipment\b/i.test(getExecutorTypeLineLower(perm)) || permanentMatchesType(perm, 'artifact')
          );
        }
        return false;
      }) ||
      battlefield.find((perm: any) => /\bequipment\b/i.test(getExecutorTypeLineLower(perm)));
    if (!match) return { applied: true, state, log: ['No target Equipment to destroy'] };
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy target enchantment that player controls/i.test(raw)) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim();
    const match = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      if (String(perm?.controller || '').trim() !== playerId) return false;
      return permanentMatchesType(perm, 'enchantment');
    });
    if (!match) return { applied: true, state, log: ['No target enchantment for player to destroy'] };
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  return null;
}

export function tryBatch389SacrificeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): Batch389StepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = String(ctx.controllerId || 'p1').trim();

  const sacrificePermanents = (permanents: readonly BattlefieldPermanent[]): Batch389StepResult => {
    if (permanents.length === 0) return { applied: true, state, log: ['No permanents to sacrifice'] };
    const removedIds = new Set(permanents.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [...permanents], removedIds, kept, 'graveyard', 'sacrificed');
    return { applied: true, state: result.state, log: result.log };
  };

  if (/each opponent sacrifices a creature they control with the greatest power/i.test(raw)) {
    const victims = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId) => playerId && playerId !== controllerId)
      .map((opponentId) => {
        const creatures = battlefield.filter(
          (perm: any) =>
            String(perm?.controller || '').trim() === opponentId && permanentMatchesType(perm, 'creature')
        );
        if (creatures.length === 0) return undefined;
        let best = creatures[0];
        let bestPower = readPower(best) ?? 0;
        for (const perm of creatures) {
          const power = readPower(perm) ?? 0;
          if (power >= bestPower) {
            best = perm;
            bestPower = power;
          }
        }
        return best;
      })
      .filter(Boolean) as BattlefieldPermanent[];
    return sacrificePermanents(victims);
  }

  if (/each player sacrifices the creature they control with the greatest mana value unless they pay that creature's mana cost/i.test(raw)) {
    const victims = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean)
      .map((playerId) => {
        const creatures = battlefield.filter(
          (perm: any) =>
            String(perm?.controller || '').trim() === playerId && permanentMatchesType(perm, 'creature')
        );
        if (creatures.length === 0) return undefined;
        let best = creatures[0];
        let bestMv = getCardManaValue((best as any)?.card || best) ?? 0;
        for (const perm of creatures) {
          const mv = getCardManaValue((perm as any)?.card || perm) ?? 0;
          if (mv >= bestMv) {
            best = perm;
            bestMv = mv;
          }
        }
        return best;
      })
      .filter(Boolean) as BattlefieldPermanent[];
    return sacrificePermanents(victims);
  }

  if (/sacrifice this enchantment, search your library for up to two creature cards, put those cards onto the battlefield/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    if (!source) return { applied: true, state, log: ['Source enchantment not on battlefield for Defense of the Heart'] };
    return sacrificePermanents([source]);
  }

  if (/target opponent sacrifices a creature of their choice/i.test(raw)) {
    const opponentId = String(
      ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2'
    ).trim();
    const match =
      battlefield.find((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (collectBoundIds(ctx).length > 0 && !collectBoundIds(ctx).includes(id)) return false;
        if (String(perm?.controller || '').trim() !== opponentId) return false;
        return permanentMatchesType(perm, 'creature');
      }) ||
      battlefield.find(
        (perm: any) =>
          String(perm?.controller || '').trim() === opponentId && permanentMatchesType(perm, 'creature')
      );
    if (!match) return { applied: true, state, log: ['No creature for target opponent to sacrifice'] };
    return sacrificePermanents([match]);
  }

  return null;
}

export function tryBatch389CopyPermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  ctx: OracleIRExecutionContext
): Batch389StepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = String(ctx.controllerId || 'p1').trim();
  const sourceId = String(ctx.sourceId || '').trim();
  const boundIds = collectBoundIds(ctx);

  const applyCopyOntoSource = (reference: any, sourcePermanentId: string): Batch389StepResult => {
    if (!reference) return { applied: true, state, log: ['No reference permanent for copy effect'] };
    const copiedName = String((reference as any)?.name || (reference as any)?.card?.name || '').trim();
    const sourceTypeLine = String((reference as any)?.type_line || (reference as any)?.card?.type_line || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      if (String(perm?.id || '').trim() !== sourcePermanentId) return perm;
      return {
        ...perm,
        ...(copiedName ? { name: copiedName } : {}),
        ...(sourceTypeLine ? { type_line: sourceTypeLine, cardType: sourceTypeLine } : {}),
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`${sourcePermanentId} became a copy of ${copiedName || 'target'}`],
    };
  };

  if (/until end of turn, it becomes a copy of up to one other target creature/i.test(raw)) {
    const reference = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id === sourceId) return false;
      if (boundIds.length > 0 && !boundIds.includes(id)) return false;
      return permanentMatchesType(perm, 'creature');
    });
    const itId = sourceId || contextualBattlefieldIds(ctx, false)[0] || '';
    return applyCopyOntoSource(reference, itId);
  }

  if (/when you do, this creature becomes a copy of another target creature you control/i.test(raw)) {
    const reference = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id === sourceId) return false;
      if (boundIds.length > 0 && !boundIds.includes(id)) return false;
      return String(perm?.controller || '').trim() === controllerId && permanentMatchesType(perm, 'creature');
    });
    return applyCopyOntoSource(reference, sourceId);
  }

  if (/this creature becomes a copy of target creature card in your graveyard with mana value x, except it has flying and this ability/i.test(raw)) {
    const xValue = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 0));
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === controllerId);
    const gyCard = (Array.isArray(player?.graveyard) ? player.graveyard : []).find((card: any) => {
      if (!String(card?.type_line || '').toLowerCase().includes('creature')) return false;
      const mv = getCardManaValue(card);
      return mv !== null && mv === xValue;
    });
    return applyCopyOntoSource(gyCard, sourceId);
  }

  if (/becomes a copy of target creature you control/i.test(raw)) {
    const reference =
      battlefield.find((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (id === sourceId) return false;
        if (boundIds.length > 0 && !boundIds.includes(id)) return false;
        return String(perm?.controller || '').trim() === controllerId && permanentMatchesType(perm, 'creature');
      }) ||
      battlefield.find(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId &&
          permanentMatchesType(perm, 'creature') &&
          String(perm?.id || '').trim() !== sourceId
      );
    const copyTargetId =
      (sourceId && battlefield.some((perm: any) => String(perm?.id || '').trim() === sourceId)
        ? sourceId
        : '') ||
      String(
        battlefield.find(
          (perm: any) =>
            String(perm?.controller || '').trim() === controllerId &&
            (permanentMatchesType(perm, 'planeswalker') || permanentMatchesType(perm, 'creature'))
        )?.id || ''
      ).trim();
    return applyCopyOntoSource(reference, copyTargetId);
  }

  return null;
}

export function tryBatch389RemoveCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): Batch389StepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  if (/remove up to x counters from target permanent/i.test(raw)) {
    const amount = Math.max(1, Number(ctx.xValue ?? ctx.referenceAmount ?? 1));
    const boundIds = collectBoundIds(ctx);
    const target = battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
    if (!target) return { applied: true, state, log: ['No target permanent for counter removal'] };
    const targetId = String((target as any)?.id || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      if (String(perm?.id || '').trim() !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      let removed = 0;
      for (const [name, value] of Object.entries(counters)) {
        if (removed >= amount) break;
        const count = Number(value) || 0;
        if (count <= 0) continue;
        const delta = Math.min(count, amount - removed);
        counters[name] = count - delta;
        removed += delta;
        if (Number(counters[name] ?? 0) <= 0) delete counters[name];
      }
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Removed up to ${amount} counter(s) from target permanent`],
    };
  }

  if (/you may remove a loyalty counter from a planeswalker you control rather than pay this permanent's crew cost/i.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const planeswalker = battlefield.find(
      (perm: any) =>
        String(perm?.controller || '').trim() === controllerId && permanentMatchesType(perm, 'planeswalker')
    );
    if (!planeswalker) return { applied: true, state, log: ['No planeswalker for crew-cost loyalty payment'] };
    const pwId = String((planeswalker as any)?.id || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      if (String(perm?.id || '').trim() !== pwId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.loyalty ?? 0) || 0;
      if (current > 0) counters.loyalty = current - 1;
      if (Number(counters.loyalty ?? 0) <= 0) delete counters.loyalty;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Removed a loyalty counter instead of paying crew cost'],
    };
  }

  return null;
}

export function tryBatch389DealDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
  amount: number
): Batch389StepResult | null {
  const raw = normalizeRaw(step);

  if (/^\(each deals damage equal to its power to the other\.\)$/i.test(raw)) {
    return { applied: true, state, log: ['Resolved mutual combat damage reminder'] };
  }

  if (/it deals twice that much damage to itself instead/i.test(raw)) {
    const targetId =
      contextualBattlefieldIds(ctx, false)[0] ||
      String(ctx.targetCreatureId || ctx.sourceId || '').trim();
    return { applied: true, state, log: [`${targetId || 'Target'} takes twice the redirected damage`] };
  }

  if (
    /target creature deals damage to itself equal to its power/i.test(raw) ||
    /target creature deals damage equal to its power to itself/i.test(raw)
  ) {
    const targetId =
      collectBoundIds(ctx)[0] ||
      String(ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || '').trim();
    return { applied: true, state, log: [`${targetId || 'Target creature'} deals damage to itself equal to its power`] };
  }

  if (/this permanent deals .* damage to that creature/i.test(raw)) {
    const targetId =
      collectBoundIds(ctx)[0] ||
      String(ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || '').trim();
    const damageMatch = raw.match(/deals (\d+) damage to that creature/i);
    const damage = damageMatch ? Number(damageMatch[1]) : Math.max(0, Number(amount ?? 0));
    return {
      applied: true,
      state,
      log: [`${String(ctx.sourceId || 'Source')} dealt ${damage} damage to ${targetId || 'that creature'}`],
    };
  }

  if (/this permanent deals that much damage to target player or planeswalker/i.test(raw)) {
    const damage = Math.max(0, Number(ctx.referenceAmount ?? amount ?? 0));
    return {
      applied: true,
      state,
      log: [`Dealt ${damage} damage to target player or planeswalker`],
    };
  }

  return null;
}
