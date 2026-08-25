/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: battlefield entry helpers — resolveBattlefieldEntryBeforeCommit,
 * createBattlefieldPermanentsFromCards, attachment targeting, addBattlefieldPermanentsToState.
 * Public entry symbols: createBattlefieldPermanentsFromCards, addBattlefieldPermanentsToState.
 */
import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { mergeRetainedCountersForBattlefieldEntry } from '../../shared/src/zoneRetainedCounters';
import {
  type OracleIrBattlefieldEntryContext,
  resolveBattlefieldEntryFromOracleIrContext,
} from './oracleIRExecutorBattlefieldEntryCommit';
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
  faceDownWardCost?: string
): BattlefieldPermanent[] {
  return moved.map((card: any, idx: number) => {
    const cardIdHint = String(card?.id || '').trim();
    const base = cardIdHint ? cardIdHint : `${sourcePrefix}-${idx}`;
    const sourceZone =
      sourcePrefix === 'gy' ? 'graveyard' : sourcePrefix === 'ex' ? 'exile' : sourcePrefix === 'hand' ? 'hand' : sourcePrefix;
    const counters = mergeRetainedCountersForBattlefieldEntry(card, sourceZone, withCounters);
    const faceUpCard = applyBattlefieldEntryCardOverrides(
      { ...(card || {}), zone: 'battlefield', enteredFromZone: sourceZone } as any,
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
      counters: counters || {},
      enteredFromZone: sourceZone,
      ...(String(card?.castFromZone || '').trim() ? { castFromZone: String(card.castFromZone).trim().toLowerCase() } : {}),
      ...(attachmentTarget ? { attachedTo: attachmentTarget.id } : {}),
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

    return {
      ...basePermanent,
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
  if (!hasExecutorClass(target, 'creature')) return false;

  if (isEquipment) return true;

  const oracleTextLower = getCardOracleTextLower(candidateCard);
  if (!/\benchant creature\b/i.test(oracleTextLower)) return false;
  if (/\benchant creature you control\b/i.test(oracleTextLower) && target.controller !== controllerId) return false;
  return true;
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
