/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts.
 * Public: trySpecialExertStep, trySpecialTurnFaceDownStep, trySpecialTapOrUntapStep,
 * trySpecialForceBlockStep, trySpecialSuspectStep
 */
import type { GameState, BattlefieldPermanent } from '../../shared/src';
import { permanentHasCreatureType } from '../../shared/src/creatureTypes.js';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { tryBatch386SuspectStep } from './oracleIRExecutorSpecialTargetHandlersBatch386Bulk';
import {
  collectBoundIds,
  normalizeRaw,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';
import { resolveContextualCreature } from './oracleIRExecutorSpecialTargetResolve';

export function trySpecialExertStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exert' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  const raw = normalizeRaw(step);
  if (!/exert this permanent/.test(raw)) return null;
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;
  return {
    applied: true,
    state,
    log: [`Exerted ${sourceId}`],
  };
}

export function trySpecialTurnFaceDownStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'turn_face_down' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  const raw = normalizeRaw(step);
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const sourceId = String(ctx.sourceId || '').trim();

  if (/turn it face up if it'?s face down/.test(raw)) {
    const targetId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || ''
    ).trim();
    const target = battlefield.find((perm) => String((perm as any)?.id || '').trim() === targetId);
    if (!target) return null;
    const perm: any = target;
    const isFaceDown = Boolean(perm?.card?.faceDown) || Boolean(perm?.faceDown);
    if (!isFaceDown) {
      return { applied: true, state, log: ['Target is already face up'] };
    }
    const faceUpCard = perm.faceUpCard || perm.card;
    if (!faceUpCard) return null;
    const nextBattlefield = battlefield.map((entry: any) => {
      if (String(entry?.id || '').trim() !== targetId) return entry;
      return {
        ...entry,
        card: { ...(faceUpCard as any), faceDown: false, zone: 'battlefield' },
        faceUpCard: undefined,
        faceDown: false,
        power: faceUpCard.power ?? entry.power,
        toughness: faceUpCard.toughness ?? entry.toughness,
        effectivePower: faceUpCard.power ?? entry.effectivePower,
        effectiveToughness: faceUpCard.toughness ?? entry.effectiveToughness,
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Turned source permanent face up'],
    };
  }

  if (/any number of target tapped nontoken creatures/.test(raw)) {
    const ids = new Set(collectBoundIds(ctx));
    const targets = battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!ids.has(id)) return false;
      if ((perm as any)?.isToken) return false;
      return permanentMatchesType(perm, 'creature') && Boolean((perm as any)?.tapped);
    });
    if (targets.length === 0) return null;
    const nextBattlefield = battlefield.map((perm: any) => {
      if (!targets.some((target) => String((target as any)?.id || '').trim() === String(perm?.id || '').trim())) {
        return perm;
      }
      return { ...perm, card: { ...(perm.card || {}), faceDown: true }, faceUpCard: perm.card || perm };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Turned ${targets.length} creature(s) face down`],
    };
  }

  if (/any number of target creatures with morph abilities other than this creature/.test(raw)) {
    const ids = new Set(collectBoundIds(ctx));
    const targets = battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!ids.has(id) || id === sourceId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (targets.length === 0) return null;
    const nextBattlefield = battlefield.map((perm: any) => {
      if (!targets.some((target) => String((target as any)?.id || '').trim() === String(perm?.id || '').trim())) {
        return perm;
      }
      return { ...perm, card: { ...(perm.card || {}), faceDown: true }, faceUpCard: perm.card || perm };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Turned ${targets.length} morph creature(s) face down`],
    };
  }

  return null;
}

export function trySpecialTapOrUntapStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'tap_or_untap' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  if (/when you do, untap all other creatures you control and after this phase, there is an additional combat phase/i.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      if (!permanentMatchesType(perm, 'creature')) return perm;
      if (String(perm?.id || '').trim() === sourceId) return perm;
      return { ...perm, tapped: false };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield, additionalCombatPhasePending: true } as GameState,
      log: ['Untapped other creatures and scheduled additional combat phase'],
    };
  }
  if (!/untap all creatures you control/.test(raw)) {
    const untapAllSubtypeMatch = raw.match(/^untap all (\w+(?:\s+\w+)*) you control\.?$/i);
    // "Untap all other creatures you control" (Ahn-Crop Champion's exert reward). This is a mass effect
    // with no target, so it must not reach the generic resolver, which found nothing for it and logged
    // "No permanents to tap/untap". The source creature is excluded by the word "other".
    if (untapAllSubtypeMatch && /^other creatures?$/i.test(String(untapAllSubtypeMatch[1] || '').trim())) {
      const controllerId = String(ctx.controllerId || '').trim();
      const sourceId = String(ctx.sourceId || '').trim();
      let untappedCount = 0;
      const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.controller || '').trim() !== controllerId) return perm;
        if (!permanentMatchesType(perm, 'creature')) return perm;
        if (sourceId && String(perm?.id || '').trim() === sourceId) return perm;
        if (!perm?.tapped && !perm?.isTapped) return perm;
        untappedCount += 1;
        return { ...perm, tapped: false, isTapped: false };
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield } as GameState,
        log: [`Untapped ${untappedCount} other creature(s) you control`],
      };
    }
    if (untapAllSubtypeMatch) {
      const rawType = String(untapAllSubtypeMatch[1] || '').toLowerCase().trim();
      const standardBulkTypes = new Set([
        'land', 'lands', 'creature', 'creatures', 'artifact', 'artifacts',
        'enchantment', 'enchantments', 'permanent', 'permanents',
        'other creature', 'other creatures',
      ]);
      if (!standardBulkTypes.has(rawType) && !rawType.startsWith('other ')) {
        const irregularPlurals: Record<string, string> = {
          elves: 'elf', wolves: 'wolf', dwarves: 'dwarf', halves: 'half',
          leaves: 'leaf', knives: 'knife', lives: 'life', selves: 'self', calves: 'calf',
        };
        const creatureType = irregularPlurals[rawType]
          || (rawType.endsWith('s') && rawType.length > 1 ? rawType.slice(0, -1) : rawType);
        const controllerId = String(ctx.controllerId || '').trim();
        let untappedCount = 0;
        const battlefield = ((state.battlefield || []) as BattlefieldPermanent[]).map((perm: any) => {
          if (String(perm?.controller || '').trim() !== controllerId) return perm;
          if (!perm?.tapped && !perm?.isTapped) return perm;
          if (!permanentHasCreatureType(perm, creatureType)) return perm;
          untappedCount += 1;
          return { ...perm, tapped: false, isTapped: false };
        });
        return {
          applied: true,
          state: { ...(state as any), battlefield } as GameState,
          log: [`Untapped ${untappedCount} ${rawType} you control`],
        };
      }
    }
    return null;
  }
  // Compound "you control and … opponent controls" must not short-circuit to you-only.
  if (/untap all creatures you control\s+and\s+(all|each) creatures?/i.test(raw)) {
    return null;
  }
  const controllerId = String(ctx.controllerId || 'p1').trim();
  const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    if (String(perm?.controller || '').trim() !== controllerId) return perm;
    if (!permanentMatchesType(perm, 'creature')) return perm;
    return { ...perm, tapped: false };
  });
  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: ['Untapped all creatures you control'],
  };
}

export function trySpecialForceBlockStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'force_block' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  const blockerText = String((step.blocker as any)?.text || '').trim().toLowerCase();
  if (
    /^target creature an opponent controls blocks this turn if able$/i.test(raw) ||
    (/^target creature an opponent controls$/i.test(blockerText) && /blocks this turn if able$/i.test(raw))
  ) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const controllerId = String(ctx.controllerId || '').trim();
    const boundIds = new Set(collectBoundIds(ctx));
    const blockers = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!id || !boundIds.has(id)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return String(perm?.controller || '').trim() !== controllerId;
    });
    if (blockers.length === 0) {
      return { applied: true, state, log: ['No opponent creature to force block'] };
    }
    const blockerId = String((blockers[0] as any)?.id || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id !== blockerId) return perm;
      return {
        ...perm,
        temporaryEffects: [
          ...(Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : []),
          { id: `${id}:must-block-if-able`, description: 'blocks this turn if able', expiresAt: 'end_of_turn' },
        ],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Marked ${blockerId} to block this turn if able`],
    };
  }
  if (/^target creature attacks or blocks this turn if able$/i.test(raw)) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const boundIds = new Set(collectBoundIds(ctx));
    const targets = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      return boundIds.has(id) && permanentMatchesType(perm, 'creature');
    });
    if (targets.length === 0) {
      return { applied: true, state, log: ['No target creature for attacks-or-blocks requirement'] };
    }
    const targetId = String((targets[0] as any)?.id || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id !== targetId) return perm;
      return {
        ...perm,
        temporaryEffects: [
          ...(Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : []),
          {
            id: `${id}:must-attack-or-block-if-able`,
            description: 'attacks or blocks this turn if able',
            expiresAt: 'end_of_turn',
          },
        ],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Marked ${targetId} to attack or block this turn if able`],
    };
  }
  if (/^they$/.test(blockerText) && /block this turn if able/.test(raw)) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const boundIds = new Set(
      [
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
        ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
        String(ctx.targetCreatureId || '').trim(),
        String(ctx.selectorContext?.targetCreatureId || '').trim(),
      ]
        .map(id => String(id || '').trim())
        .filter(Boolean)
    );
    const blockers = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!id || !boundIds.has(id)) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (blockers.length === 0) {
      return { applied: true, state, log: ['No contextual creatures to force block'] };
    }
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!blockers.some(blocker => String((blocker as any)?.id || '').trim() === id)) return perm;
      return {
        ...perm,
        temporaryEffects: [
          ...(Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : []),
          { id: `${id}:must-block-if-able`, description: 'blocks this turn if able', expiresAt: 'end_of_turn' },
        ],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Marked ${blockers.length} creature(s) to block this turn if able`],
    };
  }
  if (!/all creatures with magnet counters on them block that creature this turn if able/.test(raw)) return null;
  const attacker = resolveContextualCreature((state.battlefield || []) as BattlefieldPermanent[], ctx);
  const attackerId = String((attacker as any)?.id || ctx.selectorContext?.combatOpponentCreatureId || '').trim();
  const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    const counters = (perm?.counters || {}) as Record<string, number>;
    if (Number(counters.magnet ?? 0) <= 0) return perm;
    return {
      ...perm,
      temporaryEffects: [
        ...(Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : []),
        {
          id: `${perm.id}:must-block`,
          description: 'blocks that creature this turn if able',
          expiresAt: 'end_of_turn',
          ...(attackerId ? { mustBlockAttackerId: attackerId } : {}),
        },
      ],
    };
  });
  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: ['Creatures with magnet counters must block that creature if able'],
  };
}

export function trySpecialSuspectStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'suspect' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  const batch386 = tryBatch386SuspectStep(state, step, ctx);
  if (batch386) return batch386;

  const raw = normalizeRaw(step);
  if (!/you may suspect one of the other creatures/.test(raw)) return null;
  const sourceId = String(ctx.sourceId || '').trim();
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const other = battlefield.find((perm) => {
    const id = String((perm as any)?.id || '').trim();
    if (!id || id === sourceId) return false;
    return permanentMatchesType(perm, 'creature');
  });
  if (!other) return null;
  const otherId = String((other as any)?.id || '').trim();
  const nextBattlefield = battlefield.map((perm: any) =>
    String(perm?.id || '').trim() === otherId ? { ...perm, isSuspected: true } : perm
  );
  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Suspected ${otherId}`],
  };
}

