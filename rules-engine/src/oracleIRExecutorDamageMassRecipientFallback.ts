/**
 * Origin parent: oracleIRExecutorDamageExtendedTargetFallback.ts (deal_damage tail fallback).
 * Cluster: mass / compound deal_damage recipients that the simple battlefield selector parser misses:
 * - "each creature blocking it", "each creature it blocked this combat", "each of those creatures"
 * - generic mass creature selectors via resolveMassBattlefieldSelector (colors, "other", subtype teams)
 * - compound lists: "each attacking creature and each blocking creature",
 *   "each opponent and each battle they protect", "each opponent and 1 damage to each creature your opponents control"
 * - "each opponent who didn't ... this way" / "each player who sacrificed a Plains this way"
 *   (bound by selectorContext.playersWhoDidThisWay)
 * - trailing "and you gain N life"
 * Public entry: tryApplyMassDamageRecipients. Damage per recipient is delegated to the caller's
 * applyBoundTarget so prevention, replacement, and lifelink stay in one place.
 */

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  ApplyBoundDamageTarget,
  DamageTargetFallbackResult,
} from './oracleIRExecutorDamageExtendedTargetFallback';
import { resolveCreatureTargetIds } from './oracleIRExecutorCreatureStepUtils';
import { resolveMassBattlefieldSelector } from './oracleIRExecutorMassBattlefieldSelectorResolver';
import { adjustLife, resolvePlayers } from './oracleIRExecutorPlayerUtils';

type DealDamageStep = Extract<OracleEffectStep, { kind: 'deal_damage' }>;

type Recipients = { readonly playerIds: string[]; readonly permanentIds: string[] };

const BLOCK_OR_ANTECEDENT_RE =
  /^(?:each creature (?:it|this creature|~) blocked this combat|each creature blocking (?:it|this creature)|(?:each of )?those creatures)$/;

function playerIdSet(state: GameState): Set<string> {
  return new Set(((state.players || []) as any[]).map((player) => String(player?.id || '').trim()).filter(Boolean));
}

function resolveRecipientPart(
  state: GameState,
  partText: string,
  ctx: OracleIRExecutionContext
): Recipients | null {
  const text = partText.replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text) return null;
  const opponentIds = resolvePlayers(state, { kind: 'each_opponent' }, ctx).map((id) => String(id));

  if (text === 'each opponent' || text === 'each of your opponents') {
    return { playerIds: opponentIds, permanentIds: [] };
  }

  const whoDid = Array.isArray((ctx.selectorContext as any)?.playersWhoDidThisWay)
    ? ((ctx.selectorContext as any).playersWhoDidThisWay as PlayerID[]).map((id) => String(id))
    : [];
  if (/^each opponent who (?:didn't|did not) .+ this way$/.test(text)) {
    return { playerIds: opponentIds.filter((id) => !whoDid.includes(id)), permanentIds: [] };
  }
  if (/^each (?:opponent|player) who (?!didn't|did not).+ this way$/.test(text)) {
    const pool = text.startsWith('each opponent') ? opponentIds : [...playerIdSet(state)];
    return { playerIds: pool.filter((id) => whoDid.includes(id)), permanentIds: [] };
  }

  if (/^each battle (?:they|that player|each opponent) protects?$/.test(text)) {
    const opponentSet = new Set(opponentIds);
    const permanentIds = ((state.battlefield || []) as any[])
      .filter((perm) => /\bbattle\b/.test(String(perm?.type_line || perm?.card?.type_line || '').toLowerCase()))
      .filter((perm) => opponentSet.has(String(perm?.protectorId || perm?.protector || perm?.defendingPlayerId || '').trim()))
      .map((perm) => String(perm?.id || '').trim())
      .filter(Boolean);
    return { playerIds: [], permanentIds };
  }

  const creatureIds = resolveCreatureTargetIds(state, { kind: 'raw', text: partText } as any, ctx);
  if (creatureIds.length > 0) return { playerIds: [], permanentIds: creatureIds };
  if (BLOCK_OR_ANTECEDENT_RE.test(text)) return { playerIds: [], permanentIds: [] };
  const mass = resolveMassBattlefieldSelector(state, partText, ctx);
  if (mass) {
    return { playerIds: [], permanentIds: mass.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean) };
  }
  return null;
}

export function tryApplyMassDamageRecipients(args: {
  readonly state: GameState;
  readonly step: DealDamageStep;
  readonly ctx: OracleIRExecutionContext;
  readonly amount: number | null;
  readonly applyBoundTarget: ApplyBoundDamageTarget;
}): DamageTargetFallbackResult | null {
  const { state, step, ctx, applyBoundTarget } = args;
  if ((step.target as any)?.kind !== 'raw') return null;
  let targetText = String((step.target as any).text || '').replace(/\s+/g, ' ').trim();
  if (!targetText || /\btarget\b/i.test(targetText)) return null;

  let lifeGain = 0;
  const gainMatch = targetText.match(/^(.*?)\s+and you gain (\d+) life$/i);
  if (gainMatch) {
    lifeGain = Number(gainMatch[2]);
    targetText = String(gainMatch[1]).trim();
  }

  // "each opponent and 1 damage to each creature your opponents control" / "... and each battle they protect"
  const parts = targetText
    .split(/\s+and\s+(?:(?:\d+|x|that much) damage to\s+)?(?=each\b)/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const playerIds: string[] = [];
  const permanentIds: string[] = [];
  for (const part of parts) {
    const recipients = resolveRecipientPart(state, part, ctx);
    if (!recipients) return null;
    playerIds.push(...recipients.playerIds);
    permanentIds.push(...recipients.permanentIds);
  }

  let workingState = state;
  const log: string[] = [];
  const damagedIds: string[] = [];
  let total = 0;
  let excess = 0;
  const damageOne = (id: string, isPlayer: boolean): void => {
    const boundCtx = {
      ...ctx,
      selectorContext: {
        ...(ctx.selectorContext || {}),
        chosenObjectIds: undefined,
        targetPlayerId: isPlayer ? id : undefined,
        targetPermanentId: isPlayer ? undefined : id,
      },
      targetPlayerId: isPlayer ? id : undefined,
      targetPermanentId: isPlayer ? undefined : id,
    } as OracleIRExecutionContext;
    const result = applyBoundTarget(
      workingState,
      {
        ...step,
        target: { kind: 'raw', text: 'any target' },
        ...(args.amount !== null ? { amount: { kind: 'number', value: args.amount } } : {}),
      } as DealDamageStep,
      boundCtx
    );
    if (!result.applied || !result.state) return;
    workingState = result.state;
    log.push(...(result.log || []));
    total += Number(result.count) || 0;
    excess += Number(result.excessDamageDealtThisWay) || 0;
    damagedIds.push(...(result.lastDamagedBattlefieldPermanentIds || []));
  };

  for (const id of new Set(playerIds)) damageOne(id, true);
  for (const id of new Set(permanentIds)) damageOne(id, false);

  const controllerId = String(ctx.controllerId || '').trim();
  if (lifeGain > 0 && controllerId) {
    const gained = adjustLife(workingState, controllerId as PlayerID, lifeGain);
    workingState = gained.state;
    log.push(...gained.log);
  }
  if (playerIds.length === 0 && permanentIds.length === 0 && lifeGain === 0) {
    log.push(`No recipients for mass damage: ${step.raw}`);
  }

  return {
    applied: true,
    state: workingState,
    log,
    count: total,
    excessDamageDealtThisWay: excess,
    ...(damagedIds.length > 0 ? { lastDamagedBattlefieldPermanentIds: damagedIds } : {}),
  };
}
