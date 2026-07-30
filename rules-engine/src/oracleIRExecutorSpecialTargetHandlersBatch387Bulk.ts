import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { finalizeBattlefieldRemoval, permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

type Batch387StepResult =
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

function readPower(perm: any): number | null {
  const value = perm?.effectivePower ?? perm?.basePower ?? perm?.card?.power ?? perm?.power;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

export function tryBatch387ExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext
): Batch387StepResult | null {
  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  if (/^exile that creature$/i.test(target) || target === 'that creature') {
    const ids = contextualBattlefieldIds(ctx, false);
    const match = battlefield.find(
      (perm: any) =>
        ids.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'creature')
    );
    if (!match) return { applied: true, state, log: ['No contextual creature to exile'] };
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/exile target creature with the greatest power among creatures on the battlefield/i.test(raw)) {
    const creatures = battlefield.filter((perm: any) => permanentMatchesType(perm, 'creature'));
    if (creatures.length === 0) return { applied: true, state, log: ['No creatures on battlefield to exile'] };
    let best = creatures[0];
    let bestPower = readPower(best) ?? 0;
    for (const perm of creatures) {
      const power = readPower(perm) ?? 0;
      if (power >= bestPower) {
        best = perm;
        bestPower = power;
      }
    }
    const removedIds = new Set([String((best as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [best], removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/exile mangara and target permanent/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const boundIds = collectBoundIds(ctx).filter((id) => id !== sourceId);
    const targetId = boundIds[0] || String(ctx.targetPermanentId || '').trim();
    const toRemove = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      return id === sourceId || (targetId && id === targetId);
    });
    if (toRemove.length === 0) return { applied: true, state, log: ['No Mangara or target permanent to exile'] };
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/exile any number of creatures you control/i.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const boundIds = new Set(collectBoundIds(ctx));
    const matches =
      boundIds.size > 0
        ? battlefield.filter(
            (perm: any) =>
              boundIds.has(String(perm?.id || '').trim()) &&
              String(perm?.controller || '').trim() === controllerId &&
              permanentMatchesType(perm, 'creature')
          )
        : battlefield.filter(
            (perm: any) =>
              String(perm?.controller || '').trim() === controllerId && permanentMatchesType(perm, 'creature')
          );
    if (matches.length === 0) return { applied: true, state, log: ['No creatures you control to exile'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/instead exile cards from the top of your library until you exile a card that shares a card type with the cycled card/i.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const cycledType = String((ctx as any).lastCycledCardType || ctx.selectorContext?.lastCycledCardType || 'instant')
      .trim()
      .toLowerCase();
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== controllerId) return entry;
      const library = Array.isArray(entry?.library) ? [...entry.library] : [];
      const exile = Array.isArray(entry?.exile) ? [...entry.exile] : [];
      let exiled = 0;
      while (library.length > 0) {
        const top = library.shift();
        if (!top) break;
        exile.push(top);
        exiled += 1;
        const typeLine = String((top as any)?.type_line || '').toLowerCase();
        if (typeLine.includes(cycledType)) break;
      }
      void exiled;
      return { ...entry, library, exile };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled from library until matching cycled card type'],
    };
  }

  if (/instead exile it and you gain 2 life/i.test(raw)) {
    const contextualIds = contextualBattlefieldIds(ctx, false);
    const match = battlefield.find((perm: any) => contextualIds.includes(String(perm?.id || '').trim()));
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    let nextState = state;
    if (match) {
      const removedIds = new Set([String((match as any)?.id || '').trim()]);
      const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
      const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'exile', 'exiled');
      nextState = result.state;
    }
    const updatedPlayers = (nextState.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === controllerId
        ? { ...entry, life: (Number(entry?.life ?? 20) || 20) + 2 }
        : entry
    );
    return {
      applied: true,
      state: { ...(nextState as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled contextual permanent and gained 2 life'],
    };
  }

  if (/you may exile the top three black cards of your graveyard rather than pay this spell's mana cost/i.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== controllerId) return entry;
      const graveyard = Array.isArray(entry?.graveyard) ? [...entry.graveyard] : [];
      const blackCards = graveyard.filter((card: any) => {
        const colors = Array.isArray(card?.colors) ? card.colors : [];
        return colors.includes('B') || /\{B\}/i.test(String(card?.mana_cost || ''));
      });
      const toExile = blackCards.slice(0, 3);
      const toExileIds = new Set(toExile.map((card: any) => String(card?.id || card?.name || '').trim()));
      return {
        ...entry,
        graveyard: graveyard.filter(
          (card: any) => !toExileIds.has(String(card?.id || card?.name || '').trim())
        ),
        exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...toExile],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled up to three black cards from graveyard as alternate cost'],
    };
  }

  if (/exile each other nonland permanent with mana value less than or equal to the number of counters removed this way/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const maxMv = Math.max(0, Number(ctx.referenceAmount ?? ctx.xValue ?? 0));
    const toRemove = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id === sourceId) return false;
      if (permanentMatchesType(perm, 'land')) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv <= maxMv;
    });
    if (toRemove.length === 0) return { applied: true, state, log: ['No other nonland permanents at or below removed counter threshold'] };
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^exile it instead\.\)$/i.test(target) || /^exile it instead\.\)$/i.test(raw)) {
    return { applied: true, state, log: ['Replacement exile handled (parenthetical reminder)'] };
  }

  return null;
}

export function tryBatch387DestroyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): Batch387StepResult | null {
  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  if (/then destroy the chosen permanent if its mana value is less than or equal to the number of cards in your graveyard/i.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === controllerId);
    const gyCount = Array.isArray(player?.graveyard) ? player.graveyard.length : Number(ctx.referenceAmount ?? 0);
    const boundIds = collectBoundIds(ctx);
    const match = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (boundIds.length > 0 && !boundIds.includes(id)) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv <= gyCount;
    });
    if (!match) return { applied: true, state, log: ['Chosen permanent destroy condition not met'] };
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy that artifact if it's on the battlefield/i.test(raw)) {
    const ids = contextualBattlefieldIds(ctx, false);
    const matches = battlefield.filter(
      (perm: any) =>
        ids.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'artifact')
    );
    if (matches.length === 0) return { applied: true, state, log: ['Artifact not on battlefield to destroy'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy six target creatures/i.test(raw)) {
    const boundIds = collectBoundIds(ctx);
    const matches = battlefield.filter(
      (perm: any) =>
        boundIds.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'creature')
    );
    const targets = matches.slice(0, 6);
    if (targets.length === 0) return { applied: true, state, log: ['No target creatures to destroy'] };
    const removedIds = new Set(targets.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, targets, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy any number of target artifacts and\/or enchantments/i.test(raw)) {
    const boundIds = new Set(collectBoundIds(ctx));
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!boundIds.has(id)) return false;
      return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'enchantment');
    });
    if (matches.length === 0) return { applied: true, state, log: ['No target artifacts/enchantments to destroy'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  return null;
}

export function tryBatch387SacrificeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): Batch387StepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = String(ctx.controllerId || 'p1').trim();

  const sacrificePermanents = (permanents: readonly BattlefieldPermanent[]): Batch387StepResult => {
    if (permanents.length === 0) return { applied: true, state, log: ['No permanents to sacrifice'] };
    const removedIds = new Set(permanents.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [...permanents], removedIds, kept, 'graveyard', 'sacrificed');
    return { applied: true, state: result.state, log: result.log };
  };

  if (/each opponent sacrifices a creature of their choice/i.test(raw)) {
    const victims = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId) => playerId && playerId !== controllerId)
      .map((opponentId) =>
        battlefield.find(
          (perm: any) =>
            String(perm?.controller || '').trim() === opponentId && permanentMatchesType(perm, 'creature')
        )
      )
      .filter(Boolean) as BattlefieldPermanent[];
    return sacrificePermanents(victims);
  }

  if (/each other player sacrifices an artifact/i.test(raw)) {
    const victims = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId) => playerId && playerId !== controllerId)
      .map((opponentId) =>
        battlefield.find(
          (perm: any) =>
            String(perm?.controller || '').trim() === opponentId && permanentMatchesType(perm, 'artifact')
        )
      )
      .filter(Boolean) as BattlefieldPermanent[];
    return sacrificePermanents(victims);
  }

  if (/each other player sacrifices an enchantment/i.test(raw)) {
    const victims = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId) => playerId && playerId !== controllerId)
      .map((opponentId) =>
        battlefield.find(
          (perm: any) =>
            String(perm?.controller || '').trim() === opponentId && permanentMatchesType(perm, 'enchantment')
        )
      )
      .filter(Boolean) as BattlefieldPermanent[];
    return sacrificePermanents(victims);
  }

  if (/^sacrifice x lands$/i.test(raw)) {
    const count = Math.max(1, Number(ctx.xValue ?? ctx.referenceAmount ?? 1));
    const lands = battlefield
      .filter(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId && permanentMatchesType(perm, 'land')
      )
      .slice(0, count);
    return sacrificePermanents(lands);
  }

  if (/each player sacrifices all other creatures they control that don't share a creature type with the chosen creature they control/i.test(raw)) {
    const chosenByPlayer = new Map<string, string>();
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim();
      const bound = collectBoundIds(ctx).find((id) => {
        const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
        return perm && String((perm as any)?.controller || '').trim() === playerId;
      });
      if (bound) chosenByPlayer.set(playerId, bound);
    }
    const victims = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const owner = String(perm?.controller || '').trim();
      const chosenId = chosenByPlayer.get(owner);
      if (!chosenId) return false;
      const chosen = battlefield.find((entry: any) => String(entry?.id || '').trim() === chosenId);
      const chosenType = getExecutorTypeLineLower(chosen).split('—')[1] || '';
      const permType = getExecutorTypeLineLower(perm).split('—')[1] || '';
      const id = String(perm?.id || '').trim();
      if (id === chosenId) return false;
      return chosenType.trim() !== permType.trim();
    });
    return sacrificePermanents(victims);
  }

  return null;
}

export function tryBatch387CopyPermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  ctx: OracleIRExecutionContext
): Batch387StepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = String(ctx.controllerId || 'p1').trim();
  const boundIds = collectBoundIds(ctx);

  if (/each nonland permanent you control becomes a copy of target non-aura permanent/i.test(raw)) {
    const reference =
      battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim())) ||
      battlefield.find((perm: any) => !getExecutorTypeLineLower(perm).includes('aura'));
    if (!reference) return null;
    const copiedName = String((reference as any)?.name || (reference as any)?.card?.name || '').trim();
    const sourceTypeLine = String((reference as any)?.type_line || (reference as any)?.card?.type_line || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      if (permanentMatchesType(perm, 'land')) return perm;
      if (boundIds.length > 0 && !boundIds.includes(String(perm?.id || '').trim()) && boundIds.includes(String((reference as any)?.id || '').trim())) {
        return perm;
      }
      return {
        ...perm,
        ...(copiedName ? { name: copiedName } : {}),
        ...(sourceTypeLine ? { type_line: sourceTypeLine, cardType: sourceTypeLine } : {}),
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Nonland permanents became copies of ${copiedName || 'target'}`],
    };
  }

  if (/target artifact or creature becomes a copy of another target artifact or creature/i.test(raw)) {
    const ids = boundIds.length >= 2 ? boundIds.slice(0, 2) : boundIds;
    const copyTarget = ids[0]
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === ids[0])
      : undefined;
    const reference = ids[1]
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === ids[1])
      : battlefield.find((perm: any) => permanentMatchesType(perm, 'creature') || permanentMatchesType(perm, 'artifact'));
    if (!copyTarget || !reference) return null;
    const copiedName = String((reference as any)?.name || '').trim();
    const sourceTypeLine = String((reference as any)?.type_line || '').trim();
    const copyTargetId = String((copyTarget as any)?.id || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      if (String(perm?.id || '').trim() !== copyTargetId) return perm;
      return {
        ...perm,
        ...(copiedName ? { name: copiedName } : {}),
        ...(sourceTypeLine ? { type_line: sourceTypeLine, cardType: sourceTypeLine } : {}),
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Target became a copy of ${copiedName || 'reference'}`],
    };
  }

  if (/target legendary creature you control becomes a copy of target creature card in exile with a memory counter on it/i.test(raw)) {
    const legendary =
      battlefield.find(
        (perm: any) =>
          boundIds.includes(String(perm?.id || '').trim()) &&
          String(perm?.controller || '').trim() === controllerId &&
          /\blegendary\b/i.test(getExecutorTypeLineLower(perm))
      ) || battlefield.find((perm: any) => String(perm?.controller || '').trim() === controllerId);
    const exiledRef = (state.players || [])
      .flatMap((player: any) => (Array.isArray(player?.exile) ? player.exile : []))
      .find((card: any) => Number((card as any)?.counters?.memory ?? 0) > 0 || boundIds.includes(String(card?.id || '').trim()));
    if (!legendary || !exiledRef) return { applied: true, state, log: ['No legendary creature or exiled memory-counter card for copy'] };
    const copiedName = String((exiledRef as any)?.name || '').trim();
    const sourceTypeLine = String((exiledRef as any)?.type_line || 'Creature').trim();
    const legendaryId = String((legendary as any)?.id || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      if (String(perm?.id || '').trim() !== legendaryId) return perm;
      return {
        ...perm,
        ...(copiedName ? { name: copiedName } : {}),
        ...(sourceTypeLine ? { type_line: sourceTypeLine, cardType: sourceTypeLine } : {}),
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Legendary creature became a copy of ${copiedName || 'exiled card'}`],
    };
  }

  return null;
}
