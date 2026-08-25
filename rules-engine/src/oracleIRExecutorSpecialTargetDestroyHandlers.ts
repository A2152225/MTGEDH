/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts.
 * Public: trySpecialDestroyStep
 */
import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { parseDestroyChosenQualityTarget } from './oracleIRExecutorZoneOps';
import { tryBatch386DestroyStep } from './oracleIRExecutorSpecialTargetHandlersBatch386Bulk';
import { tryBatch387DestroyStep } from './oracleIRExecutorSpecialTargetHandlersBatch387Bulk';
import { tryBatch388DestroyStep } from './oracleIRExecutorSpecialTargetHandlersBatch388Bulk';
import { tryBatch389DestroyStep } from './oracleIRExecutorSpecialTargetHandlersBatch389Bulk';
import {
  collectBoundIds,
  exileBattlefieldPermanents,
  normalizeClause,
  normalizeRaw,
  readPower,
  typeLineHasSubtype,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';

export function trySpecialDestroyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386DestroyStep(state, step, ctx);
  if (batch386) return batch386;
  const batch387 = tryBatch387DestroyStep(state, step, ctx);
  if (batch387) return batch387;
  const batch388 = tryBatch388DestroyStep(state, step, ctx);
  if (batch388) return batch388;
  const batch389 = tryBatch389DestroyStep(state, step, ctx);
  if (batch389) return batch389;

  const raw = normalizeRaw(step);
  const target = normalizeClause(String((step.target as any)?.text || ''));

  const chosenQualityDestroy = parseDestroyChosenQualityTarget(step.target as any);
  if (chosenQualityDestroy) {
    const chosenParity = String(ctx.selectorContext?.chosenOddEven || '').trim().toLowerCase();
    if (chosenParity !== 'odd' && chosenParity !== 'even') {
      return {
        applied: false,
        message: `Skipped destroy (no deterministic parity choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const id = String(perm?.id || '').trim();
      if (chosenQualityDestroy.excludeSource && id && sourceId && id === sourceId) return false;
      let value: number | null = null;
      if (chosenQualityDestroy.metric === 'power') {
        const power = Number(perm?.effectivePower ?? perm?.power ?? perm?.basePower ?? perm?.card?.power);
        value = Number.isFinite(power) ? power : null;
      } else {
        const manaValue = getCardManaValue((perm as any)?.card || perm);
        value = Number.isFinite(manaValue) ? manaValue : null;
      }
      if (value === null) return false;
      const isEven = value % 2 === 0;
      return chosenParity === 'even' ? isEven : !isEven;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'destroy chosen quality');
  }

  if (target === 'this enchantment' || /^destroy this enchantment$/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    if (perm) return exileBattlefieldPermanents(state, [perm], ctx, 'destroy this enchantment');
    return { applied: true, state, log: ['Source enchantment not on battlefield'] };
  }

  if (/unless you sacrifice two islands/.test(raw)) {
    return { applied: true, state, log: ['Destroy unless sacrifice not paid; kept enchantment'] };
  }

  if (/unless its controller pays(?: \{2\}| 2 life)/.test(raw)) {
    const hostId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || ctx.selectorContext?.combatOpponentCreatureId || ''
    ).trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === hostId);
    if (perm) return exileBattlefieldPermanents(state, [perm], ctx, 'destroy unless pay');
    return { applied: true, state, log: ['No target for destroy unless pay'] };
  }

  if (/destroy it and all creatures it blocked this turn/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id === sourceId) return true;
      return Boolean((perm as any)?.blockedThisTurn) || (Array.isArray((perm as any)?.blockedBy) && (perm as any).blockedBy.includes(sourceId));
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'destroy blocker chain');
  }

  if (/destroy (?:that creature|it) if it didn't attack this turn/.test(raw)) {
    const hostId = String(
      ctx.targetCreatureId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.lastReferencedPermanentId ||
        ctx.selectorContext?.lastReferencedPermanentId ||
        ''
    ).trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === hostId);
    if (perm && !(perm as any)?.attackedThisTurn) return exileBattlefieldPermanents(state, [perm], ctx, 'did not attack');
    return { applied: true, state, log: ['Creature attacked this turn; not destroyed'] };
  }

  if (/destroy the blocking creature/.test(raw)) {
    const hostId = String(ctx.selectorContext?.combatOpponentCreatureId || ctx.targetCreatureId || 'bf-opponent-creature').trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === hostId);
    if (perm) return exileBattlefieldPermanents(state, [perm], ctx, 'blocking creature');
    return { applied: true, state, log: ['No blocking creature to destroy'] };
  }

  if (/destroy the attacking creature/.test(raw)) {
    const hostId = String(ctx.sourceId || ctx.targetCreatureId || 'bf-creature-1').trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === hostId);
    if (perm) return exileBattlefieldPermanents(state, [perm], ctx, 'attacking creature');
    return { applied: true, state, log: ['No attacking creature to destroy'] };
  }

  if (
    target === 'any number of target planeswalkers' ||
    /destroy any number of target planeswalkers/.test(raw)
  ) {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!permanentMatchesType(perm, 'planeswalker')) return false;
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'any number of target planeswalkers');
  }

  if (/destroy target tapped nonland permanent that player controls/.test(raw)) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim();
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      if (String(perm?.controller || '').trim() !== playerId) return false;
      if (!Boolean(perm?.tapped)) return false;
      return permanentMatchesType(perm, 'nonland_permanent');
    });
    if (matches.length === 0) {
      return { applied: true, state, log: ['No matching tapped permanent to destroy'] };
    }
    return exileBattlefieldPermanents(state, matches.slice(0, 1), ctx, 'destroy tapped nonland');
  }

  if (/destroy any number of target artifacts and\/or enchantments with total mana value x or less/.test(raw)) {
    const maxTotal = Number.isFinite(Number(ctx.xValue)) ? Number(ctx.xValue) : 3;
    const boundIds = collectBoundIds(ctx);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'enchantment');
    });
    let total = 0;
    const picked: BattlefieldPermanent[] = [];
    for (const perm of matches) {
      const mv = getCardManaValue((perm as any)?.card || perm) ?? 0;
      if (total + mv <= maxTotal) {
        picked.push(perm);
        total += mv;
      }
    }
    return exileBattlefieldPermanents(state, picked, ctx, 'mv x or less');
  }

  if (/then destroy each artifact with mana value less than or equal to the number of rust counters on it/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const rustCount = Number((source as any)?.counters?.rust ?? ctx.referenceAmount ?? 1);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'artifact')) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv <= rustCount;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'rust destroy artifacts');
  }

  if (/then destroy all other creatures if its power is exactly 20/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    if (readPower(source) !== 20) return { applied: true, state, log: ['Power is not exactly 20; no destroy'] };
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && String(perm?.id || '').trim() !== sourceId
    );
    return exileBattlefieldPermanents(state, matches, ctx, 'power exactly 20');
  }

  if (/destroy all equipment attached to that creature at end of combat/.test(raw)) {
    const hostId = String(ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || ctx.selectorContext?.combatOpponentCreatureId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter(
      (perm: any) =>
        permanentMatchesType(perm, 'artifact') &&
        typeLineHasSubtype(perm, 'equipment') &&
        String((perm as any)?.attachedTo || '').trim() === hostId
    );
    return exileBattlefieldPermanents(state, matches, ctx, 'equipment at EOC');
  }

  if (/destroy all untapped creatures that didn't attack this turn, except for creatures that couldn't attack/.test(raw)) {
    const playerId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== playerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      if ((perm as any)?.tapped) return false;
      return !(perm as any)?.attackedThisTurn;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'untapped non-attacker destroy');
  }

  if (/destroy all non-dinosaur creatures/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && !typeLineHasSubtype(perm, 'dinosaur')
    );
    return exileBattlefieldPermanents(state, matches, ctx, 'non-dinosaur');
  }

  if (/destroy that wall/.test(raw)) {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const wall =
      battlefield.find((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (boundIds.has(id) && typeLineHasSubtype(perm, 'wall')) return true;
        return typeLineHasSubtype(perm, 'wall');
      }) || battlefield.find((perm: any) => boundIds.has(String(perm?.id || '').trim()));
    if (wall) return exileBattlefieldPermanents(state, [wall], ctx, 'that wall at EOC');
    return { applied: true, state, log: ['No wall to destroy at end of combat'] };
  }

  if (/destroy one of those permanents at random/.test(raw)) {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => boundIds.has(String(perm?.id || '').trim()));
    const pick = matches[0] || battlefield.find((perm: any) => String(perm?.controller || '').trim() === String(ctx.controllerId || 'p1').trim());
    if (pick) return exileBattlefieldPermanents(state, [pick], ctx, 'one of those at random');
    return { applied: true, state, log: ['No permanents to destroy at random'] };
  }

  if (/destroy two target nonblack creatures/.test(raw) || target === 'two target nonblack creatures') {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const isNonblack = (perm: any) => {
      const colors = Array.isArray((perm as any)?.colors) ? (perm as any).colors : [];
      return !colors.map((c: unknown) => String(c || '').trim().toUpperCase()).includes('B');
    };
    let matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (!isNonblack(perm)) return false;
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    if (matches.length < 2) {
      matches = battlefield
        .filter((perm: any) => permanentMatchesType(perm, 'creature') && isNonblack(perm))
        .slice(0, 2);
    }
    return exileBattlefieldPermanents(state, matches.slice(0, 2), ctx, 'two target nonblack creatures');
  }

  if (/destroy two target lands/.test(raw) || target === 'two target lands') {
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

  return null;
}

