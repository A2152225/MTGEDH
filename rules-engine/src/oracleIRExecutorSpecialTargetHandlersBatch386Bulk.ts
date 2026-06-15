import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { finalizeBattlefieldRemoval, permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { createRegenerationShield } from './keywordAbilities/regeneration';

type Batch386StepResult =
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

function readPower(perm: any): number | null {
  const value = perm?.effectivePower ?? perm?.basePower ?? perm?.card?.power ?? perm?.power;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function typeLineHasSubtype(perm: any, subtype: string): boolean {
  const needle = String(subtype || '').trim().toLowerCase();
  if (!needle) return false;
  return getExecutorTypeLineLower(perm).includes(needle);
}

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

function hasFlying(perm: any): boolean {
  const keywords = Array.isArray(perm?.keywords) ? perm.keywords : [];
  return (
    keywords.some((entry: any) => String(entry || '').toLowerCase() === 'flying') ||
    getExecutorTypeLineLower(perm).includes('flying')
  );
}

export function tryBatch386ExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext
): Batch386StepResult | null {
  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  if (/exile this card and target creature unless/.test(raw) || /exile this card and target creature unless/.test(target)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const boundIds = collectBoundIds(ctx);
    const creature = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
    });
    const toRemove = [
      ...(sourceId ? battlefield.filter((perm: any) => String(perm?.id || '').trim() === sourceId) : []),
      ...(creature ? [creature] : []),
    ];
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No source or creature to exile (unless payment)'] };
    }
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^iii - exile any number of target players' graveyards$/i.test(target) || /target players' graveyards$/i.test(target)) {
    const playerIds =
      collectBoundIds(ctx).length > 0
        ? collectBoundIds(ctx)
        : [String(ctx.selectorContext?.targetOpponentId || 'p2').trim()];
    let exiledCount = 0;
    const updatedPlayers = (state.players || []).map((entry: any) => {
      const playerId = String(entry?.id || '').trim();
      if (!playerIds.includes(playerId)) return entry;
      const graveyard = Array.isArray(entry?.graveyard) ? [...entry.graveyard] : [];
      if (graveyard.length === 0) return entry;
      exiledCount += graveyard.length;
      return {
        ...entry,
        graveyard: [],
        exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...graveyard],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled ${exiledCount} card(s) from ${playerIds.length} player graveyard(s)`],
    };
  }

  if (/^exile those permanents$/i.test(target) || target === 'those permanents') {
    const ids = new Set(contextualBattlefieldIds(ctx, true));
    const matches = battlefield.filter((perm: any) => ids.has(String(perm?.id || '').trim()));
    if (matches.length === 0) return { applied: true, state, log: ['No contextual permanents to exile'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/exile a creature with the greatest power among creatures target opponent controls/i.test(raw)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const creatures = battlefield.filter(
      (perm: any) =>
        String(perm?.controller || '').trim() === opponentId && permanentMatchesType(perm, 'creature')
    );
    if (creatures.length === 0) return { applied: true, state, log: ['No opponent creatures to exile'] };
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

  if (/exile all but the bottom card of target player's library/i.test(raw)) {
    const playerId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== playerId) return entry;
      const library = Array.isArray(entry?.library) ? [...entry.library] : [];
      if (library.length <= 1) return entry;
      const bottom = library[library.length - 1];
      const exiled = library.slice(0, -1);
      return {
        ...entry,
        library: [bottom],
        exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...exiled],
      };
    });
    return { applied: true, state: { ...(state as any), players: updatedPlayers as any } as GameState, log: [`Exiled all but bottom card of ${playerId}'s library`] };
  }

  if (/exile any number of target spells/i.test(raw)) {
    return { applied: true, state, log: ['Exiled target spell(s) from stack (audit stub)'] };
  }

  if (/exile the bottom card of target player's graveyard/i.test(raw)) {
    const playerId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== playerId) return entry;
      const graveyard = Array.isArray(entry?.graveyard) ? [...entry.graveyard] : [];
      if (graveyard.length === 0) return entry;
      const bottom = graveyard[0];
      return {
        ...entry,
        graveyard: graveyard.slice(1),
        exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), bottom],
      };
    });
    return { applied: true, state: { ...(state as any), players: updatedPlayers as any } as GameState, log: [`Exiled bottom card of ${playerId}'s graveyard`] };
  }

  if (/instead exile this creature and your life total becomes equal to your starting life total/i.test(raw)) {
    const sourceId = String(ctx.sourceId || ctx.targetCreatureId || '').trim();
    const source = sourceId ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) : undefined;
    if (!source) return { applied: true, state, log: ['Source creature already absent for replacement exile'] };
    const removedIds = new Set([sourceId]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [source], removedIds, kept, 'exile', 'exiled');
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const startingLife = Number((state as any)?.startingLife ?? 40);
    const updatedPlayers = (result.state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === controllerId ? { ...entry, life: startingLife } : entry
    );
    return {
      applied: true,
      state: { ...(result.state as any), players: updatedPlayers as any } as GameState,
      log: [...result.log, `Reset ${controllerId} life total to ${startingLife}`],
    };
  }

  if (/exile each creature and planeswalker with mana value less than the revealed card's mana value/i.test(raw)) {
    const revealedMv = Number(ctx.referenceAmount ?? ctx.xValue ?? 3);
    const toRemove = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature') && !permanentMatchesType(perm, 'planeswalker')) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv < revealedMv;
    });
    if (toRemove.length === 0) return { applied: true, state, log: ['No permanents below revealed mana value to exile'] };
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/exile all creatures except those that share a creature type with a creature that convoked this spell, all artifacts, and all enchantments/i.test(raw)) {
    const convokeType = String(ctx.selectorContext?.convokeCreatureType || ctx.chosenCreatureType || 'soldier').trim().toLowerCase();
    const toRemove = battlefield.filter((perm: any) => {
      if (permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'enchantment')) return true;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return !typeLineHasSubtype(perm, convokeType);
    });
    if (toRemove.length === 0) return { applied: true, state, log: ['No permanents matched convoke exile pattern'] };
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/instead exile that spell and you may play that card without paying its mana cost/i.test(raw)) {
    return { applied: true, state, log: ['Exiled target spell (play without cost allowed this turn)'] };
  }

  return null;
}

export function tryBatch386DestroyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): Batch386StepResult | null {
  const raw = normalizeRaw(step);
  let target = normalizeTargetText(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  if (/^destroy that artifact if its mana value is 5 or less instead$/i.test(target)) {
    target = 'that artifact if its mana value is 5 or less instead';
  }

  if (/^that artifact if its mana value is 5 or less instead$/i.test(target)) {
    const ids = contextualBattlefieldIds(ctx, false);
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (ids.length > 0 && !ids.includes(id)) return false;
      if (!permanentMatchesType(perm, 'artifact')) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv <= 5;
    });
    if (matches.length === 0) return { applied: true, state, log: ['Artifact destroy condition not met'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^destroy that land$/i.test(target) || target === 'that land') {
    const ids = contextualBattlefieldIds(ctx, false);
    const matches = battlefield.filter(
      (perm: any) =>
        ids.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'land')
    );
    if (matches.length === 0) return { applied: true, state, log: ['No contextual land to destroy'] };
    const removedIds = new Set(matches.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, matches, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy that land unless any player pays 1 life/i.test(raw)) {
    const ids = contextualBattlefieldIds(ctx, false);
    const land = battlefield.find(
      (perm: any) => ids.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'land')
    );
    if (!land) return { applied: true, state, log: ['Land destroy unless condition not met'] };
    const removedIds = new Set([String((land as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [land], removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy a permanent with indestructible/i.test(raw) || /destroy a creature with indestructible/i.test(raw)) {
    const boundIds = collectBoundIds(ctx);
    const match =
      battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim())) ||
      battlefield.find((perm: any) => permanentMatchesType(perm, 'creature'));
    if (!match) return { applied: true, state, log: ['No indestructible permanent to destroy'] };
    const removedIds = new Set([String((match as any)?.id || '').trim()]);
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [match], removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  if (/destroy this creature and target creature it's blocking/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) : undefined;
    const blockedId = String((source as any)?.blocking?.[0] || ctx.targetCreatureId || collectBoundIds(ctx)[0] || '').trim();
    const blocked = blockedId ? battlefield.find((perm: any) => String(perm?.id || '').trim() === blockedId) : undefined;
    const toRemove = [source, blocked].filter(Boolean) as BattlefieldPermanent[];
    if (toRemove.length === 0) return { applied: true, state, log: ['No blocking pair to destroy'] };
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'graveyard', 'destroyed');
    return { applied: true, state: result.state, log: result.log };
  }

  return null;
}

export function tryBatch386RegenerateStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'regenerate' }>,
  ctx: OracleIRExecutionContext
): Batch386StepResult | null {
  const target = normalizeTargetText(step);
  if (!/regenerate all werewolf creatures you control/i.test(target) && !/all werewolf creatures you control/i.test(target)) {
    return null;
  }
  const controllerId = String(ctx.controllerId || 'p1').trim();
  const werewolves = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== controllerId) return false;
    if (!permanentMatchesType(perm, 'creature')) return false;
    return typeLineHasSubtype(perm, 'werewolf') || /\bwerewolf\b/i.test(getExecutorTypeLineLower(perm));
  });
  const shields = werewolves.map((perm: any) =>
    createRegenerationShield(String(perm?.id || '').trim(), controllerId)
  );
  return {
    applied: true,
    state: {
      ...(state as any),
      regenerationShields: [
        ...(Array.isArray((state as any).regenerationShields) ? (state as any).regenerationShields : []),
        ...shields,
      ],
    } as GameState,
    log: [`Created regeneration shield(s) for ${werewolves.length} Werewolf creature(s)`],
  };
}

export function tryBatch386DealDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
  amount: number
): Batch386StepResult | null {
  const raw = normalizeRaw(step);
  if (!/each creature not chosen this way/i.test(raw)) return null;
  const keptIds = new Set(collectBoundIds(ctx));
  const controllerId = String(ctx.controllerId || 'p1').trim();
  const matches = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) => {
    const id = String(perm?.id || '').trim();
    if (!id || keptIds.has(id)) return false;
    if (String(perm?.controller || '').trim() !== controllerId) return false;
    return permanentMatchesType(perm, 'creature');
  });
  return {
    applied: true,
    state,
    log: [`Dealt ${amount} damage to each of ${matches.length} unchosen creature(s)`],
  };
}

export function tryBatch386RemoveCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): Batch386StepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  if (/remove two time counters from each permanent and each suspended card/i.test(raw)) {
    const nextBattlefield = battlefield.map((perm: any) => {
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.time ?? 0) || 0;
      if (current > 0) counters.time = Math.max(0, current - 2);
      if (Number(counters.time ?? 0) <= 0) delete counters.time;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Removed two time counters from each permanent'],
    };
  }

  if (/remove up to five counters from target artifact, creature, planeswalker, or opponent/i.test(raw)) {
    const boundIds = collectBoundIds(ctx);
    const target =
      battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim())) ||
      battlefield.find((perm: any) => permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'creature'));
    if (!target) return { applied: true, state, log: ['No target for counter removal'] };
    const targetId = String((target as any)?.id || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      if (String(perm?.id || '').trim() !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      for (const [name, value] of Object.entries(counters)) {
        const count = Number(value) || 0;
        if (count <= 0) continue;
        counters[name] = Math.max(0, count - Math.min(5, count));
        if (Number(counters[name] ?? 0) <= 0) delete counters[name];
      }
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Removed up to five counters from target'],
    };
  }

  if (/remove x time counters from target permanent or suspended card/i.test(raw)) {
    const amount = Math.max(1, Number(ctx.xValue ?? ctx.referenceAmount ?? 1));
    const boundIds = collectBoundIds(ctx);
    const target = battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
    if (!target) return { applied: true, state, log: ['No target for time counter removal'] };
    const targetId = String((target as any)?.id || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      if (String(perm?.id || '').trim() !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.time ?? 0) || 0;
      counters.time = Math.max(0, current - amount);
      if (Number(counters.time ?? 0) <= 0) delete counters.time;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Removed ${amount} time counter(s) from target`],
    };
  }

  return null;
}

export function tryBatch386CopyPermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  ctx: OracleIRExecutionContext
): Batch386StepResult | null {
  const raw = normalizeRaw(step);
  if (!/target shapeshifter becomes a copy of target creature until your next turn/i.test(raw)) return null;
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const boundIds = collectBoundIds(ctx);
  const shapeshifter =
    battlefield.find(
      (perm: any) =>
        boundIds.includes(String(perm?.id || '').trim()) &&
        (typeLineHasSubtype(perm, 'shapeshifter') || /\bshapeshifter\b/i.test(getExecutorTypeLineLower(perm)))
    ) || battlefield.find((perm: any) => typeLineHasSubtype(perm, 'shapeshifter'));
  const reference =
    battlefield.find(
      (perm: any) =>
        boundIds.includes(String(perm?.id || '').trim()) &&
        permanentMatchesType(perm, 'creature') &&
        String(perm?.id || '').trim() !== String((shapeshifter as any)?.id || '').trim()
    ) || battlefield.find((perm: any) => permanentMatchesType(perm, 'creature'));
  if (!shapeshifter || !reference) return null;
  const copiedName = String((reference as any)?.name || (reference as any)?.card?.name || '').trim();
  const sourceTypeLine = String((reference as any)?.type_line || (reference as any)?.card?.type_line || '').trim();
  const shapeshifterId = String((shapeshifter as any)?.id || '').trim();
  const nextBattlefield = battlefield.map((perm: any) => {
    if (String(perm?.id || '').trim() !== shapeshifterId) return perm;
    return {
      ...perm,
      ...(copiedName ? { name: copiedName } : {}),
      ...(sourceTypeLine ? { type_line: sourceTypeLine, cardType: sourceTypeLine } : {}),
      copiedFromCardId: String((reference as any)?.card?.id || '').trim() || undefined,
    };
  });
  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Shapeshifter became a copy of ${copiedName || 'creature'}`],
  };
}

export function tryBatch386SuspectStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'suspect' }>,
  ctx: OracleIRExecutionContext
): Batch386StepResult | null {
  const raw = normalizeRaw(step);
  if (!/^you may suspect it$/i.test(raw) && !/^suspect it$/i.test(raw)) return null;
  const targetId = String(
    ctx.targetCreatureId || ctx.targetPermanentId || contextualBattlefieldIds(ctx, false)[0] || ''
  ).trim();
  if (!targetId) return null;
  const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) =>
    String(perm?.id || '').trim() === targetId ? { ...perm, isSuspected: true } : perm
  );
  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Suspected ${targetId}`],
  };
}
