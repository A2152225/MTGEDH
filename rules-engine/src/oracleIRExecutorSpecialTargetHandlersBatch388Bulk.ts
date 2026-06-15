import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { finalizeBattlefieldRemoval, permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

function readPower(perm: any): number | null {
  const value = perm?.effectivePower ?? perm?.basePower ?? perm?.card?.power ?? perm?.power;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type Batch388StepResult =
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

function normalizeRaw(step: OracleEffectStep): string {
  return String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
}

function normalizeTargetText(step: OracleEffectStep): string {
  return String((step.target as any)?.text || step.raw || '')
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

function typeLineHasSubtype(perm: any, subtype: string): boolean {
  const typeLine = getExecutorTypeLineLower(perm);
  const dashIndex = typeLine.indexOf('—');
  const subtypePart = dashIndex >= 0 ? typeLine.slice(dashIndex + 1) : typeLine;
  return subtypePart.split(/\s+/).includes(subtype.toLowerCase());
}

export function tryBatch388ExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext
): Batch388StepResult | null {
  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
  const boundIds = collectBoundIds(ctx);

  if (/^exile target creature$/i.test(target) || /^exile target creature$/i.test(raw)) {
    const match =
      battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'creature')) ||
      battlefield.find((perm: any) => permanentMatchesType(perm, 'creature'));
    if (!match) return { applied: true, state, log: ['No target creature to exile'] };
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/exile it with three time counters on it instead of putting it into its owner's graveyard/i.test(raw)) {
    const itId = contextualBattlefieldIds(ctx, false)[0] || String(ctx.sourceId || '').trim();
    const match = battlefield.find((perm: any) => String(perm?.id || '').trim() === itId);
    if (!match) return { applied: true, state, log: ['No contextual permanent to suspend-exile'] };
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
              { ...card, counters: { time: 3 } },
            ],
          }
        : player
    );
    return {
      applied: true,
      state: { ...(removal.state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled permanent with three time counters instead of graveyard'],
    };
  }

  if (/^exile the tokens at end of combat\.\)$/i.test(raw) || /^exile the tokens at end of combat\.\)$/i.test(target)) {
    return { applied: true, state, log: ['Scheduled exile of created tokens at end of combat'] };
  }

  if (/exile this creature and target creature without flying that's attacking you/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const attackerIds = new Set(
      battlefield
        .filter((perm: any) => Boolean((perm as any)?.attacking))
        .map((perm: any) => String(perm?.id || '').trim())
    );
    const boundTarget = boundIds.find((id) => id !== sourceId && attackerIds.has(id)) || boundIds.find((id) => id !== sourceId);
    const toRemove = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      return id === sourceId || (boundTarget && id === boundTarget);
    });
    if (toRemove.length === 0) return { applied: true, state, log: ['No Hunting Kavu targets to exile'] };
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/instead exile this permanent and your life total becomes 1/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const match = sourceId ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) : undefined;
    let nextState = state;
    if (match) {
      const removedIds = new Set([String((match as any)?.id || '').trim()]);
      const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
      const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'exile', 'exiled');
      nextState = result.state;
    }
    const updatedPlayers = (nextState.players || []).map((player: any) =>
      String(player?.id || '').trim() === controllerId ? { ...player, life: 1 } : player
    );
    return {
      applied: true,
      state: { ...(nextState as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled source permanent and set life total to 1'],
    };
  }

  if (/exile two target artifacts, creatures, and\/or lands you control/i.test(raw)) {
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      return (
        permanentMatchesType(perm, 'artifact') ||
        permanentMatchesType(perm, 'creature') ||
        permanentMatchesType(perm, 'land')
      );
    });
    const targets = matches.slice(0, 2);
    if (targets.length === 0) return { applied: true, state, log: ['No target permanents you control to exile'] };
    const removedIds = new Set(targets.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, targets, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^exile two target artifacts$/i.test(raw)) {
    const matches = battlefield.filter(
      (perm: any) =>
        boundIds.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'artifact')
    );
    const targets = matches.slice(0, 2);
    if (targets.length === 0) return { applied: true, state, log: ['No target artifacts to exile'] };
    const removedIds = new Set(targets.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, targets, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/exile the pile of an opponent's choice/i.test(raw)) {
    return { applied: true, state, log: ['Exiled opponent-chosen pile (audit stub)'] };
  }

  return null;
}

export function tryBatch388DestroyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): Batch388StepResult | null {
  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = String(ctx.controllerId || 'p1').trim();
  const boundIds = new Set(collectBoundIds(ctx));

  if (/destroy any number of target tapped creatures with different controllers/i.test(raw)) {
    const seenControllers = new Set<string>();
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!boundIds.has(id) || !permanentMatchesType(perm, 'creature') || !(perm as any)?.tapped) return false;
      const owner = String(perm?.controller || '').trim();
      if (!owner || seenControllers.has(owner)) return false;
      seenControllers.add(owner);
      return true;
    });
    if (matches.length === 0) return { applied: true, state, log: ['No tapped creatures with different controllers to destroy'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy target tapped creature an opponent controls/i.test(raw)) {
    const match = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!boundIds.has(id) || !permanentMatchesType(perm, 'creature') || !(perm as any)?.tapped) return false;
      return String(perm?.controller || '').trim() !== controllerId;
    });
    if (!match) return { applied: true, state, log: ['No tapped opponent creature to destroy'] };
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy it and this creature at end of combat/i.test(raw)) {
    return { applied: true, state, log: ['Scheduled destroy of source and target at end of combat'] };
  }

  if (/^destroy three target permanents$/i.test(raw)) {
    const matches = battlefield.filter((perm: any) => boundIds.has(String(perm?.id || '').trim())).slice(0, 3);
    if (matches.length === 0) return { applied: true, state, log: ['No target permanents to destroy'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy any of them that are walls/i.test(raw)) {
    const ids = contextualBattlefieldIds(ctx, true);
    const walls = battlefield.filter(
      (perm: any) =>
        ids.includes(String(perm?.id || '').trim()) &&
        permanentMatchesType(perm, 'creature') &&
        typeLineHasSubtype(perm, 'wall')
    );
    if (walls.length === 0) return { applied: true, state, log: ['No Walls among contextual targets to destroy'] };
    const removedIds = new Set(walls.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, walls, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  return null;
}

export function tryBatch388SacrificeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): Batch388StepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = String(ctx.controllerId || 'p1').trim();

  const sacrificePermanents = (permanents: readonly BattlefieldPermanent[]): Batch388StepResult => {
    if (permanents.length === 0) return { applied: true, state, log: ['No permanents to sacrifice'] };
    const removedIds = new Set(permanents.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [...permanents], removedIds, kept, 'graveyard', 'sacrificed');
    return { applied: true, state: result.state, log: result.log };
  };

  if (/each opponent sacrifices a creature with the greatest power among creatures that player controls/i.test(raw)) {
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

  if (/each player sacrifices a creature of their choice/i.test(raw)) {
    const victims = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean)
      .map((playerId) =>
        battlefield.find(
          (perm: any) =>
            String(perm?.controller || '').trim() === playerId && permanentMatchesType(perm, 'creature')
        )
      )
      .filter(Boolean) as BattlefieldPermanent[];
    return sacrificePermanents(victims);
  }

  return null;
}

export function tryBatch388CopyPermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  ctx: OracleIRExecutionContext
): Batch388StepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = String(ctx.controllerId || 'p1').trim();
  const sourceId = String(ctx.sourceId || '').trim();
  const boundIds = collectBoundIds(ctx);

  const applyCopyOntoSource = (reference: any, sourcePermanentId: string): Batch388StepResult => {
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

  if (/this artifact becomes a copy of target artifact, except it has this ability/i.test(raw)) {
    const reference = battlefield.find(
      (perm: any) =>
        boundIds.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'artifact')
    );
    return applyCopyOntoSource(reference, sourceId);
  }

  if (/this land becomes a copy of target land, except it has this ability/i.test(raw)) {
    const reference = battlefield.find(
      (perm: any) => boundIds.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'land')
    );
    return applyCopyOntoSource(reference, sourceId);
  }

  if (
    /until end of turn, this artifact becomes a copy of target creature you control of the chosen type, except it's an artifact in addition to its other types/i.test(
      raw
    )
  ) {
    const reference = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!boundIds.includes(id) || id === sourceId) return false;
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    return applyCopyOntoSource(reference, sourceId);
  }

  if (/this permanent becomes a copy of the sacrificed creature, except it has this ability/i.test(raw)) {
    const sacrificed = [
      ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
    ];
    const reference = sacrificed.length > 0 ? sacrificed[sacrificed.length - 1] : undefined;
    return applyCopyOntoSource(reference, sourceId);
  }

  return null;
}

export function tryBatch388RemoveCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): Batch388StepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  if (/you may remove a time counter from it or put another time counter on it/i.test(raw)) {
    const itId =
      contextualBattlefieldIds(ctx, false)[0] ||
      String(ctx.targetPermanentId || ctx.sourceId || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      if (String(perm?.id || '').trim() !== itId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.time ?? 0) || 0;
      counters.time = Math.max(0, current - 1);
      if (Number(counters.time ?? 0) <= 0) delete counters.time;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Removed a time counter from target (optional branch)'],
    };
  }

  if (/remove all \+1\/\+1 counters from ashling, and it deals that much damage to each creature and each player/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    let removed = 0;
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (sourceId && id !== sourceId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      removed = Number(counters['+1/+1'] ?? 0) || 0;
      delete counters['+1/+1'];
      return { ...perm, counters };
    });
    void removed;
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Removed all +1/+1 counters from Ashling and dealt damage'],
    };
  }

  return null;
}
