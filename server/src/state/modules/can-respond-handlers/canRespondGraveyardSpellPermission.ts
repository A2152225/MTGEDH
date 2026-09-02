// server/src/state/modules/can-respond-handlers/canRespondGraveyardSpellPermission.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: source-granted additional costs, leave-battlefield replacements,
// and getSpecificSpellFromGraveyardPermission.
// Public entry symbols: canPaySourceGrantedAdditionalCost,
// sourceLeaveBattlefieldReplacementDestination, sourceLeaveBattlefieldLifeGain,
// getSpecificSpellFromGraveyardPermission, getSourceGrantedAdditionalCost.

import type { GameContext } from '../../context.js';
import type { PlayerID } from '../../../../../shared/src/index.js';
import {
  getPrintedSelfCastPermissionInfo,
  isActivatableStationGraveyardPermissionLine,
  type GraveyardCastingPermission,
  type GraveyardCastingPermissionCostMode,
} from '../graveyard-permissions.js';
import { debugWarn } from '../../../utils/debug.js';
import { canPayCounterRemovalCost } from '../counter-removal-costs.js';
import type { SharedSourceGrantedAdditionalCost } from './canRespondTypes.js';
import { parseWordNumberForGraveyardCost } from './canRespondParseWordNumber.js';
import {
  normalizeRuleText,
  buildSyntheticGraveyardPermissionMetadata,
  findMatchingFirstClassGraveyardPermission,
  firstClassPermissionExilesSpell,
  firstClassPermissionLeaveBattlefieldDestination,
  firstClassPermissionLeaveBattlefieldLifeGain,
  getGraveyardPermissionCostModeFromText,
  hasMarkedGraveyardPermission,
  isPlayersTurnForPermission,
  getGraveyardPermissionTextSources,
  getGraveyardPermanentTypesCastThisTurn,
  isStaticGraveyardPermissionLine,
  spellQualifierMatchesCard,
} from './canRespondGraveyardPermissionMatching.js';

function sourceExilesSpellCastThisWay(oracleText: string): boolean {
  const normalized = normalizeRuleText(oracleText).replace(/\s+/g, ' ').trim();
  return /\bif\s+(?:a|that|this)\s+(?:card|spell)\s+cast\s+this\s+way\s+would\s+be\s+put\s+into\s+your\s+graveyard\s*,?\s*exile\s+it\s+instead\b/.test(normalized);
}

export function sourceLeaveBattlefieldReplacementDestination(oracleText: string): 'exile' | undefined {
  const normalized = normalizeRuleText(oracleText)
    .replace(/["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\bit\s+gains\b.*\bif\s+this\s+permanent\s+would\s+leave\s+the\s+battlefield,\s*exile\s+it\s+instead\s+of\s+putting\s+it\s+anywhere\s+else\b/i.test(normalized)) {
    return 'exile';
  }

  if (/\bit\s+gains\b.*\bwhen\s+this\s+(?:creature\s+dies|permanent\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield),\s*exile\s+it\b/i.test(normalized)) {
    return 'exile';
  }

  return undefined;
}

export function sourceLeaveBattlefieldLifeGain(oracleText: string): number | undefined {
  const normalized = normalizeRuleText(oracleText)
    .replace(/["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = normalized.match(/\bit\s+gains\b.*\bwhen\s+this\s+permanent\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield,\s*exile\s+it\s+and\s+you\s+gain\s+(\d+)\s+life\b/);
  if (!match) {
    return undefined;
  }

  const amount = Number.parseInt(match[1], 10);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function firstClassPermissionAdditionalCostToShared(
  cost: GraveyardCastingPermission['additionalCost'],
): SharedSourceGrantedAdditionalCost | undefined {
  if (!cost) return undefined;

  switch (cost.type) {
    case 'discard':
    case 'sacrifice':
    case 'remove_counters':
      return {
        type: cost.type,
        amount: Math.max(1, Number(cost.amount || 0)),
        ...(cost.filter ? { filter: cost.filter } : {}),
        ...(cost.counterType ? { counterType: cost.counterType } : {}),
        ...(cost.distributed ? { distributed: cost.distributed } : {}),
      };
    default:
      return undefined;
  }
}

function getFirstClassPermissionGrantedAdditionalCost(
  permission: GraveyardCastingPermission | undefined,
): SharedSourceGrantedAdditionalCost | undefined {
  const structured = firstClassPermissionAdditionalCostToShared(permission?.additionalCost);
  if (structured) return structured;
  return getSourceGrantedAdditionalCost(String(permission?.sourceText || ''));
}

export function getSourceGrantedAdditionalCost(oracleText: string): SharedSourceGrantedAdditionalCost | undefined {
  const normalized = normalizeRuleText(oracleText).replace(/\s+/g, ' ').trim();
  const removeCountersMatch = normalized.match(/\bby\s+removing\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(.+?)\s+from\s+among\s+(.+?)\s+you\s+control\s+in\s+addition\s+to\s+paying\s+(?:its|their|that spell's)\s+other\s+costs\b/i);
  if (removeCountersMatch) {
    const amount = parseWordNumberForGraveyardCost(String(removeCountersMatch[1] || ''));
    if (amount <= 0) return undefined;

    const rawCounterPhrase = String(removeCountersMatch[2] || '')
      .replace(/\bcounters?\b/gi, ' ')
      .replace(/\b(?:a|an)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const rawFilter = String(removeCountersMatch[3] || '')
      .replace(/\bpermanents?\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const filter = rawFilter ? rawFilter.replace(/\b([a-z]+)s\b/g, '$1').trim() : 'creature';

    return {
      type: 'remove_counters',
      amount,
      filter: filter || 'creature',
      distributed: true,
      ...(rawCounterPhrase ? { counterType: rawCounterPhrase } : {}),
    };
  }

  const match = normalized.match(/\bby\s+(discarding|sacrificing)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(.+?)\s+in\s+addition\s+to\s+paying\s+(?:its|their|that spell's)\s+other\s+costs\b/i);
  if (!match) return undefined;

  const action = String(match[1] || '').trim().toLowerCase();
  const amount = parseWordNumberForGraveyardCost(String(match[2] || ''));
  if (amount <= 0) return undefined;

  const rawFilter = String(match[3] || '')
    .replace(/\bcards?\b/gi, ' ')
    .replace(/\bpermanents?\b/gi, ' ')
    .replace(/\bspells?\b/gi, ' ')
    .replace(/\b(?:a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const filter = rawFilter ? rawFilter.replace(/\b([a-z]+)s\b/g, '$1').trim() : undefined;

  if (action === 'discarding') {
    return {
      type: 'discard',
      amount,
      ...(filter ? { filter } : {}),
    };
  }

  if (action === 'sacrificing') {
    return {
      type: 'sacrifice',
      amount,
      ...(filter ? { filter } : {}),
    };
  }

  return undefined;
}

export function canPaySourceGrantedAdditionalCost(state: any, playerId: PlayerID, card: any, cost: SharedSourceGrantedAdditionalCost): boolean {
  const amount = Math.max(0, Number(cost?.amount || 0));
  if (amount <= 0) return true;

  const alreadyPaid = (card as any)?.additionalCostPaid === true;
  const paidMethod = String((card as any)?.additionalCostMethod || '').trim().toLowerCase();
  if (alreadyPaid && (!paidMethod || paidMethod === String(cost.type || '').toLowerCase())) {
    return true;
  }

  if (cost.type === 'pay_life') {
    const startingLife = state?.startingLife || 40;
    const currentLife = state?.life?.[playerId] ?? startingLife;
    return currentLife >= amount;
  }

  if (cost.type === 'discard') {
    const hand = Array.isArray(state?.zones?.[playerId]?.hand) ? state.zones[playerId].hand : [];
    const isSourceInHand = String(card?.id || '') && hand.some((h: any) => String(h.id) === String(card.id));
    const eligible = hand.filter((entry: any) => {
      if (isSourceInHand && String(entry.id) === String(card.id)) return false;
      if (!cost.filter) return true;
      return String(entry?.type_line || entry?.typeLine || '').toLowerCase().includes(String(cost.filter).toLowerCase());
    });
    return eligible.length >= amount;
  }

  if (cost.type === 'reveal') {
    const hand = Array.isArray(state?.zones?.[playerId]?.hand) ? state.zones[playerId].hand : [];
    const isSourceInHand = String(card?.id || '') && hand.some((h: any) => String(h.id) === String(card.id));
    const eligible = hand.filter((entry: any) => {
      if (isSourceInHand && String(entry.id) === String(card.id)) return false;
      if (!cost.filter) return true;
      const typeLine = String(entry?.type_line || '').toLowerCase();
      const name = String(entry?.name || '').toLowerCase();
      return typeLine.includes(String(cost.filter).toLowerCase()) || name.includes(String(cost.filter).toLowerCase());
    });
    return eligible.length >= amount;
  }

  if (cost.type === 'sacrifice') {
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const eligible = battlefield.filter((permanent: any) => {
      if (!permanent || String(permanent.controller || '') !== String(playerId || '')) return false;
      if (!cost.filter) return true;
      return String(permanent?.card?.type_line || '').toLowerCase().includes(String(cost.filter).toLowerCase());
    });
    return eligible.length >= amount;
  }

  if (cost.type === 'remove_counters') {
    return canPayCounterRemovalCost(state, String(playerId), {
      amount,
      filter: cost.filter || 'creature',
      counterType: cost.counterType,
      distributed: cost.distributed,
    });
  }

  return true;
}

export function getSpecificSpellFromGraveyardPermission(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
): {
  allowed: boolean;
  exileAfterResolution?: boolean;
  leaveBattlefieldReplacementDestination?: 'exile';
  leaveBattlefieldReplacementSourceName?: string;
  leaveBattlefieldReplacementLifeGain?: number;
  sourceGrantedAdditionalCost?: SharedSourceGrantedAdditionalCost;
  graveyardPermissionId?: string;
  graveyardPermissionSourceName?: string;
  graveyardPermissionCostMode?: GraveyardCastingPermissionCostMode;
  castAsAdventureOnly?: boolean;
} {
  try {
    const state = ctx?.state as any;
    if (!state || !card || typeof card === 'string') return { allowed: false };

    const alreadyCastFromGraveyard = Boolean((state as any)?.castFromGraveyardThisTurn?.[playerId]);
    const usedPermanentTypes = getGraveyardPermanentTypesCastThisTurn(state, playerId);
    const firstClassPermission = findMatchingFirstClassGraveyardPermission(state, playerId, card, 'cast', usedPermanentTypes);
    const firstClassLeaveBattlefieldDestination = firstClassPermissionLeaveBattlefieldDestination(firstClassPermission);
    const firstClassLeaveBattlefieldLifeGain = firstClassPermissionLeaveBattlefieldLifeGain(firstClassPermission);
    if (firstClassPermission) {
      const sourceGrantedAdditionalCost = getFirstClassPermissionGrantedAdditionalCost(firstClassPermission);
      if (sourceGrantedAdditionalCost && !canPaySourceGrantedAdditionalCost(state, playerId, card, sourceGrantedAdditionalCost)) {
        return { allowed: false };
      }

      return {
        allowed: true,
        ...(firstClassPermissionExilesSpell(firstClassPermission) ? { exileAfterResolution: true } : {}),
        ...(firstClassLeaveBattlefieldDestination ? { leaveBattlefieldReplacementDestination: firstClassLeaveBattlefieldDestination } : {}),
        ...(firstClassPermission.replacement?.sourceName || firstClassPermission.sourceName
          ? { leaveBattlefieldReplacementSourceName: firstClassPermission.replacement?.sourceName || firstClassPermission.sourceName }
          : {}),
        ...(firstClassLeaveBattlefieldLifeGain ? { leaveBattlefieldReplacementLifeGain: firstClassLeaveBattlefieldLifeGain } : {}),
        ...(sourceGrantedAdditionalCost ? { sourceGrantedAdditionalCost } : {}),
        graveyardPermissionId: firstClassPermission.id,
        ...(firstClassPermission.sourceName ? { graveyardPermissionSourceName: firstClassPermission.sourceName } : {}),
        graveyardPermissionCostMode: firstClassPermission.costMode || 'normal',
        ...(firstClassPermission.castAsAdventureOnly === true ? { castAsAdventureOnly: true } : {}),
      };
    }

    if (hasMarkedGraveyardPermission(state, playerId, card)) {
      return { allowed: true };
    }

    const printedSelfCastInfo = getPrintedSelfCastPermissionInfo(state, playerId, card, 'graveyard');
    if (printedSelfCastInfo.hasIt) {
      const sourceGrantedAdditionalCost = getSourceGrantedAdditionalCost(String(card?.oracle_text || card?.oracleText || ''));
      if (sourceGrantedAdditionalCost && !canPaySourceGrantedAdditionalCost(state, playerId, card, sourceGrantedAdditionalCost)) {
        return { allowed: false };
      }
      const printedCostMode = getGraveyardPermissionCostModeFromText(String(card?.oracle_text || card?.oracleText || ''));
      return {
        allowed: true,
        ...(sourceGrantedAdditionalCost ? { sourceGrantedAdditionalCost } : {}),
        ...buildSyntheticGraveyardPermissionMetadata(playerId, 'cast', {
          sourceId: String(card?.id || '').trim(),
          sourceName: String(card?.name || '').trim(),
          cardId: String(card?.id || '').trim(),
          qualifier: 'this card',
          costMode: printedCostMode,
        }),
      };
    }

    for (const source of getGraveyardPermissionTextSources(state, playerId)) {
      const permanentTypeLine = source.typeLine;
      const oracleText = source.oracleText;
      const exileAfterResolution = sourceExilesSpellCastThisWay(oracleText);
      const leaveBattlefieldReplacementDestination = sourceLeaveBattlefieldReplacementDestination(oracleText);
      const leaveBattlefieldReplacementLifeGain = sourceLeaveBattlefieldLifeGain(oracleText);
      const lines = oracleText.split(/\r?\n/);

      for (const rawLine of lines) {
        const line = normalizeRuleText(rawLine);
        const sourceGrantedAdditionalCost = getSourceGrantedAdditionalCost(line) || getSourceGrantedAdditionalCost(oracleText);
        const sourceCostMode = getGraveyardPermissionCostModeFromText(line || oracleText);
        if (!isStaticGraveyardPermissionLine(line)) continue;
        if (isActivatableStationGraveyardPermissionLine(rawLine.trim(), oracleText, permanentTypeLine)) continue;
        if (/\bduring(?:\s+each\s+of)?\s+your\s+turns?\b/.test(line) && !isPlayersTurnForPermission(state, playerId)) continue;

        const combinedPlayCastMatch = line.match(/you may play ([^.]+?) and cast ([^.]+?) from your graveyard/i);
        if (combinedPlayCastMatch) {
          const qualifier = String(combinedPlayCastMatch[2] || '').trim();
          const oncePerTurn = /\bonce during each of your turns\b/.test(line);
          if (!(oncePerTurn && alreadyCastFromGraveyard) && qualifier && spellQualifierMatchesCard(card, qualifier, usedPermanentTypes)) {
            if (sourceGrantedAdditionalCost && !canPaySourceGrantedAdditionalCost(state, playerId, card, sourceGrantedAdditionalCost)) {
              continue;
            }
            return {
              allowed: true,
              ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
              ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination } : {}),
              ...(leaveBattlefieldReplacementDestination && source.sourceName ? { leaveBattlefieldReplacementSourceName: source.sourceName } : {}),
              ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
              ...(sourceGrantedAdditionalCost ? { sourceGrantedAdditionalCost } : {}),
              ...buildSyntheticGraveyardPermissionMetadata(playerId, 'cast', {
                sourceId: source.sourceId,
                sourceName: source.sourceName,
                qualifier,
                costMode: sourceCostMode,
                replacement: {
                  ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
                  ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldDestination: leaveBattlefieldReplacementDestination } : {}),
                  ...((leaveBattlefieldReplacementDestination && source.sourceName) ? { sourceName: source.sourceName } : {}),
                  ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
                },
              }),
            };
          }
        }

        if (permanentTypeLine.includes('spacecraft') && line.includes('permanent spell') && line.includes('from your graveyard')) {
          const creatureMatch = line.match(/it's an? (?:artifact )?creature at (\d+)\+/i);
          if (creatureMatch) {
            const threshold = Number.parseInt(creatureMatch[1], 10);
            const chargeCounters = Number(source.counters?.charge || 0);
            if (!Number.isFinite(threshold) || chargeCounters < threshold) {
              continue;
            }
          }
        }

        for (const match of line.matchAll(/\b(?:cast|play) ([^.]+?) from your graveyard/gi)) {
          const qualifier = String(match[1] || '').trim();
          if (!qualifier) continue;

          const oncePerTurn = /\bonce during each of your turns\b/.test(line);
          if (oncePerTurn && alreadyCastFromGraveyard) continue;
          if (spellQualifierMatchesCard(card, qualifier, usedPermanentTypes)) {
            if (sourceGrantedAdditionalCost && !canPaySourceGrantedAdditionalCost(state, playerId, card, sourceGrantedAdditionalCost)) {
              continue;
            }
            return {
              allowed: true,
              ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
              ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination } : {}),
              ...(leaveBattlefieldReplacementDestination && source.sourceName ? { leaveBattlefieldReplacementSourceName: source.sourceName } : {}),
              ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
              ...(sourceGrantedAdditionalCost ? { sourceGrantedAdditionalCost } : {}),
              ...buildSyntheticGraveyardPermissionMetadata(playerId, 'cast', {
                sourceId: source.sourceId,
                sourceName: source.sourceName,
                qualifier,
                costMode: sourceCostMode,
                replacement: {
                  ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
                  ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldDestination: leaveBattlefieldReplacementDestination } : {}),
                  ...((leaveBattlefieldReplacementDestination && source.sourceName) ? { sourceName: source.sourceName } : {}),
                  ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
                },
              }),
            };
          }
        }
      }
    }

    return { allowed: false };
  } catch (err) {
    debugWarn(1, '[canCastSpecificSpellFromGraveyard] Error:', err);
    return { allowed: false };
  }
}

function canCastSpecificSpellFromGraveyard(ctx: GameContext, playerId: PlayerID, card: any): boolean {
  return getSpecificSpellFromGraveyardPermission(ctx, playerId, card).allowed;
}
