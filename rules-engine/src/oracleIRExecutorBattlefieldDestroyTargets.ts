// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: resolveDestroyTargets.
// Public entry: resolveDestroyTargets.

import type { BattlefieldPermanent } from '../../shared/src';
import { getMarkedDamage } from '../../shared/src/markedDamage.js';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { readCharacteristicNumber } from './oracleIRExecutorBattlefieldCharacteristicNumber';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { resolveBoundSelectorMatches } from './oracleIRExecutorBattlefieldContextualResolvers';
import { battlefieldPermanentHasFlying } from './oracleIRExecutorBattlefieldPermanentMatchers';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import {
  parseSimpleBattlefieldSelector,
} from './oracleIRExecutorBattlefieldParser';
import {
  permanentMatchesSelector,
  permanentMatchesType,
} from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';

export function resolveDestroyTargets(
  battlefield: readonly BattlefieldPermanent[],
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  const rawTargetText = String((step.target as any)?.text || '');
  let targetText = normalizeBattlefieldTargetReferenceText(rawTargetText)
    .replace(/\s+unless\s+that\s+player\s+pays\b.*$/i, '')
    .replace(/,\s*where\s+x\s+is\b.*$/i, '')
    .replace(/\s+they can't be regenerated$/i, '')
    .trim();

  if (/^it$/i.test(targetText) || /^them$/i.test(targetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, /^them$/i.test(targetText));
    const matches = battlefield.filter((perm: any) =>
      ids.includes(String((perm as any)?.id || '').trim())
    );
    return matches.length > 0 ? matches : [];
  }

  if (/^(?:destroy )?target attacking creature without flying$/i.test(targetText)) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    const withoutFlying = (perm: any) =>
      permanentMatchesType(perm, 'creature') && !battlefieldPermanentHasFlying(perm);
    const bound = battlefield.filter(
      (perm: any) => boundIds.has(String((perm as any)?.id || '').trim()) && withoutFlying(perm),
    );
    if (bound.length > 0) return bound.slice(0, 1);
    const attacking = battlefield.filter((perm: any) => {
      if (!withoutFlying(perm)) return false;
      return Boolean(
        (perm as any)?.isAttacking ||
          (perm as any)?.attacking ||
          (perm as any)?.attackingPlayerId ||
          (perm as any)?.defendingPlayerId,
      );
    });
    return attacking.slice(0, 1);
  }

  const conditionalCounterMatch = rawTargetText.match(
    /if\s+it\s+has\s+((?:\d+)|(?:one|two|three|four|five|six|seven|eight|nine|ten))\s+or\s+more\s+([a-z+/-]+)\s+counters?\s+on\s+it$/i
  );
  if (conditionalCounterMatch && /^this enchantment$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    if (!sourcePermanent) return [];
    const counterName = String(conditionalCounterMatch[2] || '').trim().toLowerCase();
    const thresholdRaw = String(conditionalCounterMatch[1] || '').trim().toLowerCase();
    const threshold = /^\d+$/.test(thresholdRaw)
      ? Number(thresholdRaw)
      : ({
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
        }[thresholdRaw] ?? 0);
    const counterCount = Number(((sourcePermanent as any)?.counters || {})[counterName] ?? 0);
    if (!Number.isFinite(counterCount) || counterCount < threshold) return [];
    return [sourcePermanent];
  }

  if (/^one of them chosen at random$/i.test(targetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const matches = battlefield.filter((perm: any) => ids.includes(String((perm as any)?.id || '').trim()));
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^the other creature$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const enchantedCreatureId = String(
      (sourcePermanent as any)?.attachedTo ||
      ctx.targetCreatureId ||
      ctx.targetPermanentId ||
      ctx.selectorContext?.targetCreatureId ||
      ''
    ).trim();
    const opponentCreatureId = String(ctx.selectorContext?.combatOpponentCreatureId || '').trim();
    const combatIds = new Set(
      [enchantedCreatureId, opponentCreatureId, sourceId].filter(Boolean)
    );
    const excludedId = enchantedCreatureId || sourceId;
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return combatIds.has(permanentId) && permanentId !== excludedId;
    });
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^both creatures$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const opponentCreatureId = String(ctx.selectorContext?.combatOpponentCreatureId || '').trim();
    const wantedIds = new Set([sourceId, opponentCreatureId].filter(Boolean));
    const matches = battlefield.filter((perm: any) => wantedIds.has(String((perm as any)?.id || '').trim()));
    return matches.length > 0 ? matches : [];
  }

  if (/^up to x target artifacts$/i.test(targetText)) {
    const xValue = Number(ctx.xValue);
    const maxCount = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const artifacts = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return boundIds.includes(permanentId) && permanentMatchesType(perm, 'artifact');
    });
    return maxCount > 0 ? artifacts.slice(0, maxCount) : [];
  }

  if (/^up to x target artifacts and\/or enchantments$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const verseCount = Number(((sourcePermanent as any)?.counters || {})?.verse);
    const xValue = Number.isFinite(verseCount) ? verseCount : Number(ctx.xValue);
    const maxCount = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(permanentId)) return false;
      return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'enchantment');
    });
    return maxCount > 0 ? matches.slice(0, maxCount) : [];
  }

  if (/^all walls your opponents control$/i.test(targetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    return battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() === controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return typeLineHasSubtype(perm, 'wall');
    });
  }

  if (/^all nonenchantment creatures$/i.test(targetText)) {
    return battlefield.filter(
      (perm: any) =>
        permanentMatchesType(perm, 'creature') && !permanentMatchesType(perm, 'enchantment')
    );
  }

  if (/^that land$/i.test(targetText)) {
    return resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: 'that land' }, ctx);
  }

  if (/^enchanted permanent$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const attachedToId = String((sourcePermanent as any)?.attachedTo || '').trim();
    const enchantedPermanent = attachedToId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === attachedToId)
      : undefined;
    return enchantedPermanent ? [enchantedPermanent] : [];
  }

  if (/^each creature with mana value equal to the number of ([a-z]+) counters on this enchantment$/i.test(targetText)) {
    const counterMatch = targetText.match(
      /^each creature with mana value equal to the number of ([a-z]+) counters on this enchantment$/i
    );
    const counterName = String(counterMatch?.[1] || '').trim().toLowerCase();
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const counterCount = Number(((sourcePermanent as any)?.counters || {})[counterName] ?? 0);
    if (!Number.isFinite(counterCount) || counterCount < 0) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const manaValue = getCardManaValue((perm as any)?.card || perm);
      return manaValue !== null && manaValue === counterCount;
    });
  }

  if (/^up to x target lands$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const verseCount = Number(((sourcePermanent as any)?.counters || {})?.verse);
    const xValue = Number.isFinite(verseCount) ? verseCount : Number(ctx.xValue);
    const maxCount = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const lands = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return boundIds.includes(permanentId) && permanentMatchesType(perm, 'land');
    });
    return maxCount > 0 ? lands.slice(0, maxCount) : [];
  }

  if (/^each creature whose coin comes up tails$/i.test(targetText)) {
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const typeLineLower = getExecutorTypeLineLower(perm);
      return !/\b(demon|devil|imp)s?\b/i.test(typeLineLower);
    });
  }

  if (/^all artifacts and creatures other than this creature$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'creature');
    });
  }

  // "Destroy all other creatures" (Martial Coup): "other" means other than the object doing this, and
  // other than the tokens this same resolution just made (rulings 2009-02-01: tokens are created first,
  // then the wipe happens, and the new Soldiers survive). Older tokens are still destroyed.
  if (/^all other creatures$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const madeHereIds = new Set(
      [
        ...((Array.isArray((ctx as any).lastCreatedTokenIds) ? (ctx as any).lastCreatedTokenIds : []) as unknown[]),
        ...((Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []) as unknown[]),
      ]
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    );
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      return !((perm as any)?.isToken && madeHereIds.has(permanentId));
    });
  }

  if (/^all creatures other than this (?:creature|permanent)$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const permanentId = String((perm as any)?.id || '').trim();
      return !sourceId || permanentId !== sourceId;
    });
  }

  {
    const nonSubtypeCreaturesMatch = targetText.match(/^all non-([a-z]+) creatures$/i);
    if (nonSubtypeCreaturesMatch) {
      const excludedSubtype = String(nonSubtypeCreaturesMatch[1] || '').trim();
      return battlefield.filter(
        (perm: any) =>
          permanentMatchesType(perm, 'creature') && !typeLineHasSubtype(perm, excludedSubtype)
      );
    }
  }

  if (/^enchanted (?:creature|land|permanent)$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const attachedToId = String((sourcePermanent as any)?.attachedTo || '').trim();
    const enchantedPermanent = attachedToId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === attachedToId)
      : undefined;
    return enchantedPermanent ? [enchantedPermanent] : [];
  }

  {
    const attachedAurasMatch = targetText.match(/^all auras attached to (?:that|target) creature$/i);
    if (attachedAurasMatch) {
      const hostId = String(
        ctx.targetCreatureId ||
          ctx.targetPermanentId ||
          ctx.selectorContext?.targetCreatureId ||
          ''
      ).trim();
      if (!hostId) return [];
      return battlefield.filter((perm: any) => {
        if (!permanentMatchesType(perm, 'enchantment')) return false;
        return String((perm as any)?.attachedTo || '').trim() === hostId;
      });
    }
  }

  {
    const attachedEquipmentMatch = targetText.match(/^all equipment attached to (?:that|target) creature$/i);
    if (attachedEquipmentMatch) {
      const hostId = String(
        ctx.targetCreatureId ||
          ctx.targetPermanentId ||
          ctx.selectorContext?.targetCreatureId ||
          ''
      ).trim();
      if (!hostId) return [];
      return battlefield.filter((perm: any) => {
        if (!permanentMatchesType(perm, 'artifact') || !typeLineHasSubtype(perm, 'equipment')) return false;
        return String((perm as any)?.attachedTo || '').trim() === hostId;
      });
    }
  }

  if (/^all untapped creatures that didn't attack this turn(?:, except for creatures that couldn't attack)?$/i.test(targetText)) {
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      if ((perm as any)?.tapped) return false;
      return !(perm as any)?.attackedThisTurn;
    });
  }

  if (/^all other creatures that share a color with it$/i.test(targetText)) {
    const referenceId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || ''
    ).trim();
    const reference = referenceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === referenceId)
      : undefined;
    const referenceColors = new Set(
      Array.isArray((reference as any)?.colors)
        ? (reference as any).colors.map((color: unknown) => String(color || '').trim().toUpperCase()).filter(Boolean)
        : []
    );
    if (referenceColors.size === 0) return [];
    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (referenceId && permanentId === referenceId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      const colors = Array.isArray((perm as any)?.colors) ? (perm as any).colors : [];
      return colors.some((color: unknown) => referenceColors.has(String(color || '').trim().toUpperCase()));
    });
  }

  if (/^all curses attached to you$/i.test(targetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    return battlefield.filter((perm: any) => {
      if (!typeLineHasSubtype(perm, 'curse')) return false;
      const enchantedPlayerId = String(
        (perm as any)?.enchantedPlayerId || (perm as any)?.attachedToPlayer || ''
      ).trim();
      if (enchantedPlayerId) return enchantedPlayerId === controllerId;
      return String((perm as any)?.controller || '').trim() === controllerId;
    });
  }

  if (/^each creature your opponents control with a prey counter on it$/i.test(targetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    return battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() === controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Number(((perm as any)?.counters || {}).prey ?? 0) > 0;
    });
  }

  if (/^all creatures with flying$/i.test(targetText)) {
    return battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && battlefieldPermanentHasFlying(perm)
    );
  }

  if (/^that creature and this creature$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const targetId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || ''
    ).trim();
    const wantedIds = new Set([sourceId, targetId].filter(Boolean));
    return battlefield.filter((perm: any) => wantedIds.has(String((perm as any)?.id || '').trim()));
  }

  if (/^all auras attached to target land$/i.test(targetText)) {
    const landId = String(
      ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || ctx.selectorContext?.targetLandId || ''
    ).trim();
    if (!landId) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'enchantment')) return false;
      if (!typeLineHasSubtype(perm, 'aura')) return false;
      return String((perm as any)?.attachedTo || '').trim() === landId;
    });
  }

  if (/^all auras attached to that creature$/i.test(targetText)) {
    let hostId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.combatOpponentCreatureId ||
        ''
    ).trim();
    if (!hostId) {
      const boundIds = collectBoundBattlefieldIds(ctx);
      hostId =
        boundIds.find((candidateId) =>
          battlefield.some(
            (perm: any) =>
              permanentMatchesType(perm, 'enchantment') &&
              String((perm as any)?.attachedTo || '').trim() === candidateId
          )
        ) || '';
    }
    if (!hostId) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'enchantment')) return false;
      return String((perm as any)?.attachedTo || '').trim() === hostId;
    });
  }

  if (/^all equipment attached to that creature$/i.test(targetText)) {
    const hostId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.combatOpponentCreatureId ||
        ''
    ).trim();
    if (!hostId) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'artifact') || !typeLineHasSubtype(perm, 'equipment')) return false;
      return String((perm as any)?.attachedTo || '').trim() === hostId;
    });
  }

  if (/^up to one nonbasic land that player controls$/i.test(targetText)) {
    const playerId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const lands = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== playerId) return false;
      if (!permanentMatchesType(perm, 'land')) return false;
      const typeLine = getExecutorTypeLineLower(perm);
      return !/\bbasic\b/.test(typeLine);
    });
    return lands.length > 0 ? lands.slice(0, 1) : [];
  }

  if (/^the creature with the least power(?: it can't be regenerated)?$/i.test(targetText)) {
    const creatures = battlefield.filter((perm: any) => permanentMatchesType(perm, 'creature'));
    if (creatures.length === 0) return [];
    let leastPower: number | null = null;
    let leastMatches: BattlefieldPermanent[] = [];
    for (const perm of creatures) {
      const power = readCharacteristicNumber(
        (perm as any)?.effectivePower,
        (perm as any)?.basePower,
        (perm as any)?.card?.power,
        (perm as any)?.power
      );
      if (power === undefined) continue;
      if (leastPower === null || power < leastPower) {
        leastPower = power;
        leastMatches = [perm];
      } else if (power === leastPower) {
        leastMatches.push(perm);
      }
    }
    return leastMatches.length > 0 ? leastMatches.slice(0, 1) : [];
  }

  if (/^all nonartifact, nonblack creatures(?: they can't be regenerated)?$/i.test(targetText)) {
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (permanentMatchesType(perm, 'artifact')) return false;
      const colors = Array.isArray((perm as any)?.colors) ? (perm as any).colors : [];
      return !colors.map((c: unknown) => String(c || '').trim().toUpperCase()).includes('B');
    });
  }

  if (/^all tapped creatures$/i.test(targetText)) {
    return battlefield.filter((perm: any) => permanentMatchesType(perm, 'creature') && Boolean((perm as any)?.tapped));
  }

  if (/^all djinns and efreets(?: they can't be regenerated)?$/i.test(targetText)) {
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      return typeLineHasSubtype(perm, 'djinn') || typeLineHasSubtype(perm, 'efreet');
    });
  }

  if (/^this enchantment$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    return sourcePermanent ? [sourcePermanent] : [];
  }

  if (/^one of them at random$/i.test(targetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const matches = battlefield.filter((perm: any) => ids.includes(String((perm as any)?.id || '').trim()));
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^up to x target nonblack creatures(?: they can't be regenerated)?$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const verseCount = Number(((sourcePermanent as any)?.counters || {})?.verse);
    const xValue = Number.isFinite(verseCount) ? verseCount : Number(ctx.xValue);
    const maxCount = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(permanentId)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      const colors = Array.isArray((perm as any)?.colors) ? (perm as any).colors : [];
      return !colors.map((c: unknown) => String(c || '').trim().toUpperCase()).includes('B');
    });
    return maxCount > 0 ? matches.slice(0, maxCount) : [];
  }

  if (/^each creature with mana value equal to the number of \+1\/\+1 counters on this creature$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const counterCount = Number(((sourcePermanent as any)?.counters || {})['+1/+1'] ?? 0);
    if (!Number.isFinite(counterCount) || counterCount < 0) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const manaValue = getCardManaValue((perm as any)?.card || perm);
      return manaValue !== null && manaValue === counterCount;
    });
  }

  if (/^all creatures with power (\d+) or greater$/i.test(targetText)) {
    const threshold = Number(String(targetText.match(/^all creatures with power (\d+) or greater$/i)?.[1] || '0'));
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const power = readCharacteristicNumber(
        (perm as any)?.effectivePower,
        (perm as any)?.basePower,
        (perm as any)?.card?.power,
        (perm as any)?.power
      );
      return power !== undefined && power >= threshold;
    });
  }

  if (/^all other creatures that were dealt damage this turn$/i.test(targetText)) {
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const sourceId = String(ctx.sourceId || '').trim();
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      const damageMarked = getMarkedDamage(perm);
      return damageMarked > 0;
    });
  }

  if (/^the creature you chose$/i.test(targetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const boundIds = collectBoundBattlefieldIds(ctx);
    const match = battlefield.find((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    return match ? [match] : [];
  }

  if (/^the creature your opponent chose$/i.test(targetText)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const boundIds = collectBoundBattlefieldIds(ctx);
    const boundMatch = battlefield.find((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      if (String((perm as any)?.controller || '').trim() !== opponentId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (boundMatch) return [boundMatch];
    const fallback = battlefield.find(
      (perm: any) =>
        String((perm as any)?.controller || '').trim() === opponentId && permanentMatchesType(perm, 'creature')
    );
    return fallback ? [fallback] : [];
  }

  if (/^that non-wall creature$/i.test(targetText)) {
    const hostId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.combatOpponentCreatureId ||
        ''
    ).trim();
    const host = hostId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === hostId)
      : undefined;
    if (host && permanentMatchesType(host, 'creature') && !typeLineHasSubtype(host, 'wall')) {
      return [host];
    }
    return [];
  }

  if (/^destroy the rest$/i.test(targetText) || /^the rest$/i.test(targetText)) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const excludedIds = new Set([...boundIds, ...contextualIds]);
    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (excludedIds.has(permanentId)) return false;
      return permanentMatchesType(perm, 'creature');
    });
  }

  if (/^the chosen creatures$/i.test(targetText)) {
    const chosenIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    if (chosenIds.size === 0) return [];
    return battlefield.filter((perm: any) => chosenIds.has(String((perm as any)?.id || '').trim()));
  }

  if (/^(?:destroy )?any number of target creatures$/i.test(targetText)) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return boundIds.has(permanentId) && permanentMatchesType(perm, 'creature');
    });
  }

  if (/^destroy two target enchantments$/i.test(targetText) || /^two target enchantments$/i.test(targetText)) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    return battlefield
      .filter((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        return boundIds.has(permanentId) && permanentMatchesType(perm, 'enchantment');
      })
      .slice(0, 2);
  }

  if (/^destroy the chosen permanents$/i.test(targetText) || /^the chosen permanents$/i.test(targetText)) {
    const chosenIds = new Set(collectBoundBattlefieldIds(ctx));
    return battlefield.filter((perm: any) => chosenIds.has(String((perm as any)?.id || '').trim()));
  }

  if (/^destroy that land$/i.test(targetText) || /^that land$/i.test(targetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, false);
    return battlefield.filter(
      (perm: any) => ids.includes(String((perm as any)?.id || '').trim()) && permanentMatchesType(perm, 'land')
    );
  }

  if (/^destroy that artifact if its mana value is 5 or less instead$/i.test(targetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, false);
    return battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (!ids.includes(id) || !permanentMatchesType(perm, 'artifact')) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv <= 5;
    });
  }

  if (/^(?:destroy )?two target artifacts and\/or enchantments$/i.test(targetText)) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    return battlefield
      .filter((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        if (!boundIds.has(permanentId)) return false;
        return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'enchantment');
      })
      .slice(0, 2);
  }

  const normalizedTarget = { ...(step.target as any), text: targetText };
  const selector = parseSimpleBattlefieldSelector(normalizedTarget as any);
  if (selector) {
    const matched = battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
    if (/^target\b/i.test(targetText)) {
      const boundMatches = resolveBoundSelectorMatches(battlefield, selector, ctx);
      if (boundMatches.length > 0) return boundMatches.slice(0, 1);
      if (matched.length >= 1) return matched.slice(0, 1);
      return [];
    }
    return matched;
  }
  return resolveDirectBattlefieldPermanents(battlefield, normalizedTarget as any, ctx);
}


