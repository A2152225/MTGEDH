/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts.
 * Public: trySpecialCopyPermanentStep
 */
import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { collectExiledCardsLedgerFirst } from './oracleIRLedgerCardAccess';
import {
  tryBatch386CopyPermanentStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch386Bulk';
import {
  tryBatch387CopyPermanentStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch387Bulk';
import {
  tryBatch388CopyPermanentStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch388Bulk';
import {
  tryBatch389CopyPermanentStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch389Bulk';
import {
  collectBoundIds,
  normalizeRaw,
  readContextualCardsFromRuntime,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';
import {
  resolveContextualCreature,
  resolveEnchantedHost,
  resolveSourcePermanent,
} from './oracleIRExecutorSpecialTargetResolve';

export function trySpecialCopyPermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  ctx: OracleIRExecutionContext,
  runtime?: { lastMovedCards?: readonly any[]; lastExiledCards?: readonly any[] }
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386CopyPermanentStep(state, step, ctx);
  if (batch386) return batch386;
  const batch387 = tryBatch387CopyPermanentStep(state, step, ctx);
  if (batch387) return batch387;
  const batch388 = tryBatch388CopyPermanentStep(state, step, ctx);
  if (batch388) return batch388;
  const batch389 = tryBatch389CopyPermanentStep(state, step, ctx);
  if (batch389) return batch389;

  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const sourceId = String(ctx.sourceId || '').trim();
  const controllerId = String(ctx.controllerId || 'p1').trim();

  const applyCopyToTargets = (targetIds: string[], sourceCard: any): SpecialTargetStepResult => {
    const copiedName = String(sourceCard?.name || '').trim();
    const sourceTypeLine = String(sourceCard?.type_line || '').trim();
    const copiedPower = Number.parseInt(String(sourceCard?.power ?? ''), 10);
    const copiedToughness = Number.parseInt(String(sourceCard?.toughness ?? ''), 10);
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!targetIds.includes(id)) return perm;
      const existingCard = perm?.card && typeof perm.card === 'object' ? { ...perm.card } : {};
      const nextCard = {
        ...existingCard,
        ...(copiedName ? { name: copiedName } : {}),
        ...(sourceTypeLine ? { type_line: sourceTypeLine } : {}),
        ...(Number.isFinite(copiedPower) ? { power: String(copiedPower) } : {}),
        ...(Number.isFinite(copiedToughness) ? { toughness: String(copiedToughness) } : {}),
      };
      return {
        ...perm,
        ...(copiedName ? { name: copiedName } : {}),
        ...(sourceTypeLine ? { cardType: sourceTypeLine, type_line: sourceTypeLine } : {}),
        ...(Number.isFinite(copiedPower) ? { power: copiedPower, basePower: copiedPower } : {}),
        ...(Number.isFinite(copiedToughness) ? { toughness: copiedToughness, baseToughness: copiedToughness } : {}),
        copiedFromCardId: String(sourceCard?.id || '').trim() || undefined,
        card: nextCard,
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`${targetIds.length} permanent(s) became a copy of ${copiedName || 'source'}`],
    };
  };

  if (/each other nontoken creature you control becomes a copy of that creature/.test(raw)) {
    const reference = resolveContextualCreature(battlefield, ctx);
    if (!reference) return null;
    const referenceCard = (reference as any)?.card || reference;
    const targetIds = battlefield
      .filter((perm) => {
        const id = String((perm as any)?.id || '').trim();
        if (id === sourceId || id === String((reference as any)?.id || '').trim()) return false;
        if ((perm as any)?.isToken) return false;
        return (
          permanentMatchesType(perm, 'creature') &&
          String((perm as any)?.controller || '').trim() === controllerId
        );
      })
      .map((perm) => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    return applyCopyToTargets(targetIds, referenceCard);
  }

  if (/each other token you control becomes a copy of that token/.test(raw)) {
    const reference = resolveContextualCreature(battlefield, ctx);
    if (!reference) return null;
    const referenceCard = (reference as any)?.card || reference;
    const targetIds = battlefield
      .filter((perm) => {
        const id = String((perm as any)?.id || '').trim();
        if (id === sourceId || id === String((reference as any)?.id || '').trim()) return false;
        return (
          Boolean((perm as any)?.isToken) &&
          String((perm as any)?.controller || '').trim() === controllerId
        );
      })
      .map((perm) => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    return applyCopyToTargets(targetIds, referenceCard);
  }

  if (/that creature becomes a copy of this creature/.test(raw) || /it becomes a copy of this creature/.test(raw)) {
    const target = resolveContextualCreature(battlefield, ctx);
    const source = resolveSourcePermanent(battlefield, ctx);
    const targetId = String((target as any)?.id || '').trim();
    const sourcePermanentId = String((source as any)?.id || '').trim();
    if (!target || !source || !targetId || targetId === sourcePermanentId) return null;
    return applyCopyToTargets([targetId], (source as any)?.card || source);
  }

  if (/this enchantment becomes a copy of that card/.test(raw)) {
    const contextualCards = readContextualCardsFromRuntime(ctx, runtime);
    const sourceCard = contextualCards[0];
    if (!sourceCard || !sourceId) return null;
    return applyCopyToTargets([sourceId], sourceCard);
  }

  if (/that creature becomes a copy of a creature card exiled with this equipment/.test(raw)) {
    const host = resolveEnchantedHost(battlefield, ctx);
    const exiledCards = collectExiledCardsLedgerFirst(ctx) as any[];
    const sourceCard = exiledCards.find((card: any) => /\bcreature\b/i.test(String(card?.type_line || ''))) || exiledCards[0];
    if (!host || !sourceCard) return null;
    return applyCopyToTargets([String((host as any)?.id || '').trim()], sourceCard);
  }

  if (/this permanent becomes a copy of target creature with a counter on it/.test(raw)) {
    const boundIds = collectBoundIds(ctx);
    const target = battlefield.find((perm) => boundIds.includes(String((perm as any)?.id || '').trim()));
    if (!target || !sourceId) return null;
    return applyCopyToTargets([sourceId], (target as any)?.card || target);
  }

  if (/this permanent becomes a copy of target creature card in your graveyard with mana value x/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const gyCard = (state.players || [])
      .find((player: any) => String(player?.id || '').trim() === controllerId)
      ?.graveyard?.find((card: any) => /\bcreature\b/i.test(String(card?.type_line || '')));
    if (!gyCard || !sourceId) return null;
    return applyCopyToTargets([sourceId], gyCard);
  }

  if (/this permanent becomes a copy of up to one other target creature you control/.test(raw)) {
    const boundIds = collectBoundIds(ctx).filter((id) => id !== sourceId);
    const target = battlefield.find((perm) => boundIds.includes(String((perm as any)?.id || '').trim()));
    if (!target || !sourceId) return null;
    return applyCopyToTargets([sourceId], (target as any)?.card || target);
  }

  if (/this land becomes a copy of target nontoken artifact you control with mana value x/i.test(raw)) {
    const xValue = Number(ctx.xValue ?? ctx.referenceAmount ?? 3);
    const boundIds = collectBoundIds(ctx);
    const artifact = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (boundIds.length > 0 && !boundIds.includes(id)) return false;
      if ((perm as any)?.isToken) return false;
      if (!permanentMatchesType(perm, 'artifact')) return false;
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv === Math.floor(xValue);
    });
    if (!artifact || !sourceId) return null;
    return applyCopyToTargets([sourceId], (artifact as any)?.card || artifact);
  }

  if (/enchanted creature becomes a copy of that creature/.test(raw)) {
    const host = resolveEnchantedHost(battlefield, ctx);
    if (!host) return null;
    const contextualCards = readContextualCardsFromRuntime(ctx, runtime);
    const sourceCard =
      contextualCards.find((card: any) => /\bcreature\b/i.test(String(card?.type_line || ''))) ||
      contextualCards[0];
    if (!sourceCard) return null;
    return applyCopyToTargets([String((host as any)?.id || '').trim()], sourceCard);
  }

  if (/this permanent becomes a copy of up to one target creature on the battlefield or creature card in a graveyard/.test(raw)) {
    if (!sourceId) return null;
    const boundIds = collectBoundIds(ctx);
    const creatureTarget = battlefield.find((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      return permanentMatchesType(perm, 'creature');
    });
    const gyCard = (state.players || [])
      .flatMap((player: any) => (Array.isArray(player?.graveyard) ? player.graveyard : []))
      .find((card: any) => {
        const id = String(card?.id || '').trim();
        if (boundIds.length > 0 && id && !boundIds.includes(id)) return false;
        return /\bcreature\b/i.test(String(card?.type_line || ''));
      });
    const sourceCard = creatureTarget
      ? ((creatureTarget as any)?.card || creatureTarget)
      : gyCard;
    if (!sourceCard) return null;
    return applyCopyToTargets([sourceId], sourceCard);
  }

  if (/this permanent becomes a copy of up to one target artifact, non-aura enchantment, or land/.test(raw)) {
    if (!sourceId) return null;
    const boundIds = collectBoundIds(ctx);
    const copyTarget = battlefield.find((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      if (permanentMatchesType(perm, 'artifact')) return true;
      if (permanentMatchesType(perm, 'land')) return true;
      if (permanentMatchesType(perm, 'enchantment')) {
        const typeLine = getExecutorTypeLineLower(perm);
        return !/\baura\b/i.test(typeLine);
      }
      return false;
    });
    if (!copyTarget) return null;
    return applyCopyToTargets([sourceId], (copyTarget as any)?.card || copyTarget);
  }

  return null;
}

