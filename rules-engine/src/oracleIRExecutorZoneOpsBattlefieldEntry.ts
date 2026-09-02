/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: battlefield entry helpers — resolveBattlefieldEntryBeforeCommit,
 * createBattlefieldPermanentsFromCards, attachment targeting, addBattlefieldPermanentsToState.
 * Public entry symbols: createBattlefieldPermanentsFromCards, addBattlefieldPermanentsToState,
 * canCardEnterAttachedToTarget, canCardEnterAttachedToPlayer, resolveMoverAttachment.
 */
import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { mergeRetainedCountersForBattlefieldEntry } from '../../shared/src/zoneRetainedCounters';
import {
  type OracleIrBattlefieldEntryContext,
  resolveBattlefieldEntryFromOracleIrContext,
} from './oracleIRExecutorBattlefieldEntryCommit';
import { flattenZoneCardForBattlefield } from './oracleIRExecutorZoneCardIdentity';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { getCardTypeLineLower } from './oracleIRExecutorZoneOpsThisWayParsers';

export type BattlefieldAttachmentTarget = BattlefieldPermanent;

export type BattlefieldEntryCardOverrides = {
  readonly setTypeLine?: string;
  readonly setOracleText?: string;
  readonly loseAllAbilities?: boolean;
};

export function resolveBattlefieldEntryBeforeCommit(
  state: GameState,
  card: unknown,
  controllerId: PlayerID,
  explicit: {
    readonly entersTapped?: boolean;
    readonly entersFaceDown?: boolean;
    readonly withCounters?: Record<string, number>;
  },
  oracleIrEntry?: OracleIrBattlefieldEntryContext,
):
  | {
      readonly kind: 'resolved';
      readonly entersTapped: boolean;
      readonly entersFaceDown: boolean;
      readonly withCounters: Record<string, number>;
    }
  | { readonly kind: 'halted' } {
  const resolved = resolveBattlefieldEntryFromOracleIrContext(state, card, controllerId, explicit, oracleIrEntry);
  if ('halted' in resolved) return { kind: 'halted' };
  return {
    kind: 'resolved',
    entersTapped: resolved.entersTapped,
    entersFaceDown: resolved.entersFaceDown,
    withCounters: resolved.withCounters,
  };
}

export function createBattlefieldPermanentsFromCards(
  moved: readonly any[],
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  entersTapped: boolean | undefined,
  entersFaceDown: boolean | undefined,
  withCounters: Record<string, number> | undefined,
  sourcePrefix: string,
  attachmentTarget?: BattlefieldAttachmentTarget,
  entryOverrides?: BattlefieldEntryCardOverrides,
  faceDownWardCost?: string,
  enchantedPlayerId?: string
): BattlefieldPermanent[] {
  return moved.map((card: any, idx: number) => {
    const cardIdHint = String(card?.id || '').trim();
    const base = cardIdHint ? cardIdHint : `${sourcePrefix}-${idx}`;
    const sourceZone =
      sourcePrefix === 'gy' ? 'graveyard' : sourcePrefix === 'ex' ? 'exile' : sourcePrefix === 'hand' ? 'hand' : sourcePrefix;
    const counters = mergeRetainedCountersForBattlefieldEntry(card, sourceZone, withCounters);
    const faceUpCard = applyBattlefieldEntryCardOverrides(
      flattenZoneCardForBattlefield({
        ...(card || {}),
        zone: 'battlefield',
        enteredFromZone: sourceZone,
      }) as any,
      entryOverrides
    );
    if ('counters' in faceUpCard) delete faceUpCard.counters;
    if ('damageSourceIds' in faceUpCard) delete faceUpCard.damageSourceIds;

    const basePermanent = {
      id: `perm-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      controller: controllerId,
      owner: sourcePlayerId,
      tapped: Boolean(entersTapped),
      summoningSickness: true,
      enteredThisTurn: true,
      counters: counters || {},
      enteredFromZone: sourceZone,
      ...(String(card?.castFromZone || '').trim() ? { castFromZone: String(card.castFromZone).trim().toLowerCase() } : {}),
      ...(attachmentTarget
        ? { attachedTo: attachmentTarget.id }
        : enchantedPlayerId
          ? {
              attachedTo: enchantedPlayerId,
              enchanting: enchantedPlayerId,
              enchantedPlayerId,
            }
          : {}),
      attachments: [],
      modifiers: [],
    } as any;

    if (entersFaceDown) {
      const hiddenCard = {
        id: String(card?.id || base),
        faceDown: true,
        zone: 'battlefield',
        visibility: 'public',
        power: '2',
        toughness: '2',
        ...(faceDownWardCost
          ? {
              wardCost: faceDownWardCost,
              keywords: ['Ward'],
              oracle_text: `Ward ${faceDownWardCost}`,
            }
          : {}),
      } as any;

      return {
        ...basePermanent,
        basePower: 2,
        baseToughness: 2,
        power: 2,
        toughness: 2,
        effectiveTypes: ['Creature'],
        card: hiddenCard,
        faceUpCard,
      } as any;
    }

    const printedPower = parsePrintedPowerToughness(faceUpCard?.power);
    const printedToughness = parsePrintedPowerToughness(faceUpCard?.toughness);
    return {
      ...basePermanent,
      ...(printedPower !== undefined ? { basePower: printedPower, power: printedPower } : {}),
      ...(printedToughness !== undefined ? { baseToughness: printedToughness, toughness: printedToughness } : {}),
      card: faceUpCard,
    } as any;
  });
}

export function getBattlefieldAttachmentTarget(state: GameState, permanentId: string): BattlefieldAttachmentTarget | undefined {
  const wantedId = String(permanentId || '').trim();
  if (!wantedId) return undefined;
  return ((state.battlefield || []) as BattlefieldPermanent[]).find(
    perm => String((perm as any)?.id || '').trim() === wantedId
  );
}

function parsePrintedPowerToughness(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const str = String(raw ?? '').trim();
  if (!str || !/^\d+$/.test(str)) return undefined;
  return Number.parseInt(str, 10);
}

function getCardOracleTextLower(card: any): string {
  return String(card?.oracle_text || card?.card?.oracle_text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase();
}

function applyBattlefieldEntryCardOverrides(card: any, overrides?: BattlefieldEntryCardOverrides): any {
  if (!card || !overrides) return card;

  const nextCard = { ...(card as any) };
  if (overrides.loseAllAbilities) {
    nextCard.oracle_text = '';
    nextCard.keywords = [];
  }
  if (String(overrides.setTypeLine || '').trim()) {
    nextCard.type_line = String(overrides.setTypeLine).trim();
  }
  if (typeof overrides.setOracleText === 'string') {
    nextCard.oracle_text = overrides.setOracleText;
  }
  return nextCard;
}

export function canCardEnterAttachedToTarget(
  card: any,
  controllerId: PlayerID,
  target: BattlefieldAttachmentTarget,
  entryOverrides?: BattlefieldEntryCardOverrides
): boolean {
  if (!card || !target) return false;
  const candidateCard = applyBattlefieldEntryCardOverrides(card, entryOverrides);
  const typeLineLower = getCardTypeLineLower(candidateCard);
  const isAura = typeLineLower.includes('aura');
  const isEquipment = typeLineLower.includes('equipment');
  if (!isAura && !isEquipment) return false;
  if (isEquipment) return hasExecutorClass(target, 'creature');

  const oracleTextLower = getCardOracleTextLower(candidateCard);
  if (/\benchant (?:a )?(?:player|opponent)\b/i.test(oracleTextLower)) return false;
  if (/\benchant creature you control\b/i.test(oracleTextLower)) {
    return hasExecutorClass(target, 'creature') && String((target as any)?.controller || '').trim() === String(controllerId || '').trim();
  }
  if (/\benchant creature\b/i.test(oracleTextLower)) return hasExecutorClass(target, 'creature');
  if (/\benchant land\b/i.test(oracleTextLower)) return hasExecutorClass(target, 'land');
  if (/\benchant artifact\b/i.test(oracleTextLower)) return hasExecutorClass(target, 'artifact');
  if (/\benchant enchantment\b/i.test(oracleTextLower)) return hasExecutorClass(target, 'enchantment');
  if (/\benchant permanent\b/i.test(oracleTextLower)) return hasExecutorClass(target, 'permanent');
  return false;
}

export function canCardEnterAttachedToPlayer(
  card: any,
  controllerId: PlayerID,
  playerId: string,
  entryOverrides?: BattlefieldEntryCardOverrides
): boolean {
  const wantedPlayerId = String(playerId || '').trim();
  if (!card || !wantedPlayerId) return false;
  const candidateCard = applyBattlefieldEntryCardOverrides(card, entryOverrides);
  const typeLineLower = getCardTypeLineLower(candidateCard);
  if (!typeLineLower.includes('aura')) return false;
  const oracleTextLower = getCardOracleTextLower(candidateCard);
  if (/\benchant (?:a )?opponent\b/i.test(oracleTextLower)) {
    return wantedPlayerId !== String(controllerId || '').trim();
  }
  return /\benchant (?:a )?player\b/i.test(oracleTextLower);
}

export function resolveMoverAttachment(
  state: GameState,
  card: any,
  controllerId: PlayerID,
  attachedToId: string | undefined,
  entryOverrides?: BattlefieldEntryCardOverrides,
):
  | { readonly kind: 'ok'; readonly attachmentTarget?: BattlefieldAttachmentTarget; readonly enchantedPlayerId?: string }
  | { readonly kind: 'impossible' } {
  const wanted = String(attachedToId || '').trim();
  if (!wanted) return { kind: 'ok' };
  const attachmentTarget = getBattlefieldAttachmentTarget(state, wanted);
  if (attachmentTarget) {
    if (!canCardEnterAttachedToTarget(card, controllerId, attachmentTarget, entryOverrides)) {
      return { kind: 'impossible' };
    }
    return { kind: 'ok', attachmentTarget };
  }
  const playerExists = ((state.players || []) as any[]).some(
    (player: any) => String(player?.id || '').trim() === wanted,
  );
  if (playerExists && canCardEnterAttachedToPlayer(card, controllerId, wanted, entryOverrides)) {
    return { kind: 'ok', enchantedPlayerId: wanted };
  }
  return { kind: 'impossible' };
}

export function addBattlefieldPermanentsToState(state: GameState, newPermanents: readonly BattlefieldPermanent[]): GameState {
  if (newPermanents.length === 0) return state;

  const attachmentAdds = new Map<string, string[]>();
  for (const permanent of newPermanents) {
    const attachedTo = String((permanent as any)?.attachedTo || '').trim();
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!attachedTo || !permanentId) continue;
    const next = attachmentAdds.get(attachedTo) || [];
    if (!next.includes(permanentId)) next.push(permanentId);
    attachmentAdds.set(attachedTo, next);
  }

  const mergedBattlefield = [...((state.battlefield || []) as BattlefieldPermanent[]), ...newPermanents].map(permanent => {
    const permanentId = String((permanent as any)?.id || '').trim();
    const additions = attachmentAdds.get(permanentId);
    if (!additions || additions.length === 0) return permanent;

    const attachments = Array.isArray((permanent as any)?.attachments) ? [...(permanent as any).attachments] : [];
    for (const addedId of additions) {
      if (!attachments.includes(addedId)) attachments.push(addedId);
    }
    return { ...(permanent as any), attachments } as BattlefieldPermanent;
  });

  return { ...state, battlefield: mergedBattlefield as any } as any;
}
