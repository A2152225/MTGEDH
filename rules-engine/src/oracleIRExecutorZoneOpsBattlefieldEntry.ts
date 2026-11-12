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
import { assimilatedTypeLine } from './trekCountBases';
import { applyBackFaceCharacteristicsToCard, resolveEnterFaceForCard } from './enterBattlefieldTransformedOrConverted';

export type BattlefieldAttachmentTarget = BattlefieldPermanent;

export type BattlefieldEntryCardOverrides = {
  readonly setTypeLine?: string;
  readonly setOracleText?: string;
  readonly loseAllAbilities?: boolean;
  /** Assimilate: Borg artifact creature, other creature types lost. */
  readonly assimilate?: boolean;
};

export type RejectedBattlefieldEntry = {
  readonly card: any;
  readonly ownerId: string;
  readonly sourceZone: string;
  readonly outcome: 'stay_in_zone' | 'graveyard';
  readonly sourceIndex?: number;
};

export type CreatedBattlefieldPermanents = BattlefieldPermanent[] & {
  readonly rejected: readonly RejectedBattlefieldEntry[];
};

export function emptyCreatedBattlefieldPermanents(): CreatedBattlefieldPermanents {
  return Object.assign([] as BattlefieldPermanent[], { rejected: [] as RejectedBattlefieldEntry[] });
}

export function appendCreatedBattlefieldPermanents(
  target: CreatedBattlefieldPermanents,
  created: CreatedBattlefieldPermanents,
): CreatedBattlefieldPermanents {
  target.push(...created);
  return Object.assign(target, {
    rejected: [...(target.rejected || []), ...(created.rejected || [])],
  });
}

export function stampCardZoneRemoval(card: any, sourceZone: string, sourceIndex?: number): any {
  if (!card || typeof card !== 'object') return card;
  const index = Number(sourceIndex);
  return {
    ...card,
    sourceZone,
    enteredFromZone: sourceZone,
    ...(Number.isFinite(index) && index >= 0 ? { sourceIndex: index } : {}),
  };
}

export function findCardIndexInZoneArray(list: readonly any[] | undefined, cardOrId: unknown): number {
  const wanted = typeof cardOrId === 'string' || typeof cardOrId === 'number'
    ? String(cardOrId).trim()
    : String((cardOrId as any)?.id || (cardOrId as any)?.cardId || '').trim();
  if (!wanted || !Array.isArray(list)) return -1;
  return list.findIndex((entry) => String(entry?.id || entry?.cardId || '').trim() === wanted);
}

export function stampCardUsingZoneIndex(card: any, list: readonly any[] | undefined, sourceZone: string): any {
  return stampCardZoneRemoval(card, sourceZone, findCardIndexInZoneArray(list, card));
}

export function stampCardsUsingZoneIndex(
  cards: readonly any[],
  list: readonly any[] | undefined,
  sourceZone: string,
): any[] {
  return (Array.isArray(cards) ? cards : []).map((card) => stampCardUsingZoneIndex(card, list, sourceZone));
}

export function takeAndStampCardFromZoneArray(
  list: any[] | undefined,
  cardOrId: unknown,
  sourceZone: string,
): any | undefined {
  if (!Array.isArray(list)) return undefined;
  const index = findCardIndexInZoneArray(list, cardOrId);
  if (index < 0) return undefined;
  const [removed] = list.splice(index, 1);
  return stampCardZoneRemoval(removed, sourceZone, index);
}

function readStampedSourceIndex(card: any): number | undefined {
  const index = Number(card?.sourceIndex);
  return Number.isFinite(index) && index >= 0 ? index : undefined;
}

export function mapBattlefieldEntrySourceZone(sourcePrefix: string): string {
  const prefix = String(sourcePrefix || '').trim().toLowerCase();
  if (prefix === 'gy' || prefix === 'graveyard') return 'graveyard';
  if (prefix === 'ex' || prefix === 'exile') return 'exile';
  if (prefix === 'hand') return 'hand';
  if (prefix === 'library') return 'library';
  if (prefix === 'command' || prefix === 'command_zone' || prefix === 'commandzone') return 'command';
  if (prefix === 'stack') return 'stack';
  if (prefix === 'attraction' || prefix === 'contraption') return prefix;
  return prefix || 'unknown';
}

export function restoreZoneForRejectedBattlefieldEntry(entry: RejectedBattlefieldEntry): string {
  if (entry.outcome === 'graveyard' && (entry.sourceZone === 'stack' || entry.sourceZone === 'unknown' || !entry.sourceZone)) {
    return 'graveyard';
  }
  return entry.sourceZone && entry.sourceZone !== 'unknown' ? entry.sourceZone : 'graveyard';
}

export function resolveBattlefieldEntryBeforeCommit(
  state: GameState,
  card: unknown,
  controllerId: PlayerID,
  explicit: {
    readonly entersTapped?: boolean;
    readonly entersFaceDown?: boolean;
    readonly withCounters?: Record<string, number>;
    readonly entersTransformed?: boolean;
  },
  oracleIrEntry?: OracleIrBattlefieldEntryContext,
):
  | {
      readonly kind: 'resolved';
      readonly entersTapped: boolean;
      readonly entersFaceDown: boolean;
      readonly withCounters: Record<string, number>;
      readonly entersTransformed: boolean;
    }
  | { readonly kind: 'halted' } {
  const resolved = resolveBattlefieldEntryFromOracleIrContext(state, card, controllerId, explicit, oracleIrEntry);
  if ('halted' in resolved) return { kind: 'halted' };
  return {
    kind: 'resolved',
    entersTapped: resolved.entersTapped,
    entersFaceDown: resolved.entersFaceDown,
    withCounters: resolved.withCounters,
    entersTransformed: Boolean(resolved.entersTransformed || explicit.entersTransformed),
  };
}

export function createBattlefieldPermanentsFromCards(
  moved: readonly any[],
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  entersTapped: boolean | undefined,
  entersFaceDown: boolean | undefined,
  withCounters: Record<string, number> | undefined,
  entersTransformed: boolean | undefined,
  sourcePrefix: string,
  attachmentTarget?: BattlefieldAttachmentTarget,
  entryOverrides?: BattlefieldEntryCardOverrides,
  faceDownWardCost?: string,
  enchantedPlayerId?: string
): CreatedBattlefieldPermanents {
  const permanents: BattlefieldPermanent[] = [];
  const rejected: RejectedBattlefieldEntry[] = [];
  moved.forEach((card: any, idx: number) => {
    const cardIdHint = String(card?.id || '').trim();
    const base = cardIdHint ? cardIdHint : `${sourcePrefix}-${idx}`;
    const sourceZone = mapBattlefieldEntrySourceZone(sourcePrefix);
    const counters = mergeRetainedCountersForBattlefieldEntry(card, sourceZone, withCounters);
    let faceUpCard = applyBattlefieldEntryCardOverrides(
      flattenZoneCardForBattlefield({
        ...(card || {}),
        zone: 'battlefield',
        enteredFromZone: sourceZone,
      }) as any,
      entryOverrides
    );
    if ('counters' in faceUpCard) delete faceUpCard.counters;
    if ('damageSourceIds' in faceUpCard) delete faceUpCard.damageSourceIds;
    const wantsTransformed = Boolean(entersTransformed || card?.entersTransformed || card?.entersBattlefieldTransformed || card?.entersConverted || card?.entersBattlefieldConverted);
    const enterFace = resolveEnterFaceForCard(faceUpCard, {
      sourceZone: sourceZone === 'stack' ? 'stack' : 'other',
      extra: card,
      intent: wantsTransformed ? (card?.entersConverted === true || card?.entersBattlefieldConverted === true ? 'converted' : 'transformed') : undefined,
    });
    if (enterFace.outcome === 'stay_in_zone' || enterFace.outcome === 'graveyard') {
      rejected.push({
        card,
        ownerId: String(card?.owner || card?.ownerId || sourcePlayerId || '').trim() || String(sourcePlayerId),
        sourceZone,
        outcome: enterFace.outcome,
        sourceIndex: readStampedSourceIndex(card),
      });
      return;
    }
    if (enterFace.outcome === 'enter_back_face') {
      faceUpCard = applyBackFaceCharacteristicsToCard(faceUpCard);
    }

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
        isFaceDownStub: true,
        zone: 'battlefield',
        visibility: 'public',
        name: '',
        displayName: 'Face-down creature',
        type_line: 'Creature',
        power: '2',
        toughness: '2',
        ...(faceDownWardCost
          ? {
              wardCost: faceDownWardCost,
              keywords: ['Ward'],
              oracle_text: `Ward ${faceDownWardCost}`,
            }
          : { oracle_text: '' }),
      } as any;

      const facedownPermanent = {
        ...basePermanent,
        isFaceDown: true,
        basePower: 2,
        baseToughness: 2,
        power: 2,
        toughness: 2,
        effectiveTypes: ['Creature'],
        card: hiddenCard,
        faceUpCard,
      } as any;
      if (enterFace.outcome === 'enter_back_face') facedownPermanent.transformed = true;
      permanents.push(facedownPermanent);
      return;
    }

    const printedPower = parsePrintedPowerToughness(faceUpCard?.power);
    const printedToughness = parsePrintedPowerToughness(faceUpCard?.toughness);
    const faceUpPermanent = {
      ...basePermanent,
      ...(printedPower !== undefined ? { basePower: printedPower, power: printedPower } : {}),
      ...(printedToughness !== undefined ? { baseToughness: printedToughness, toughness: printedToughness } : {}),
      card: faceUpCard,
    } as any;
    if (enterFace.outcome === 'enter_back_face') faceUpPermanent.transformed = true;
    permanents.push(faceUpPermanent);
  });
  return Object.assign(permanents, { rejected });
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
  if (overrides.assimilate) {
    if (!nextCard.assimilatedPrintedTypeLine) nextCard.assimilatedPrintedTypeLine = String(nextCard.type_line || '');
    nextCard.type_line = assimilatedTypeLine(String(nextCard.type_line || ''));
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

export function restoreRejectedBattlefieldEntries(
  state: GameState,
  rejected: readonly RejectedBattlefieldEntry[] | undefined,
): GameState {
  if (!rejected || rejected.length === 0) return state;
  let next: any = state;
  for (const entry of rejected) {
    const zoneName = restoreZoneForRejectedBattlefieldEntry(entry);
    const cardId = String(entry.card?.id || '').trim();
    const ownerId = String(entry.ownerId || entry.card?.owner || entry.card?.ownerId || '').trim();
    const card = { ...(entry.card || {}), zone: zoneName };
    next = restoreCardToOwnerZone(next, ownerId, zoneName, card, cardId, entry.sourceIndex);
  }
  return next as GameState;
}

function zoneArrayHasCard(list: unknown, cardId: string): boolean {
  if (!cardId || !Array.isArray(list)) return false;
  return list.some((entry: any) => String(entry?.id || '').trim() === cardId);
}

function withCardInZoneArray(list: unknown, card: any, cardId: string, preferUnshift: boolean, sourceIndex?: number): any[] {
  const arr = Array.isArray(list) ? [...list] : [];
  if (cardId && zoneArrayHasCard(arr, cardId)) return arr;
  if (Number.isFinite(sourceIndex) && (sourceIndex as number) >= 0) {
    const idx = Math.min(Math.max(0, sourceIndex as number), arr.length);
    arr.splice(idx, 0, card);
    return arr;
  }
  if (preferUnshift) arr.unshift(card);
  else arr.push(card);
  return arr;
}

function restoreCardToOwnerZone(state: any, ownerId: string, zoneName: string, card: any, cardId: string, sourceIndex?: number): any {
  if (!ownerId || !zoneName || zoneName === 'unknown') return state;
  let next = state;
  if (Array.isArray(next.players)) {
    const players = next.players.map((player: any) => {
      if (String(player?.id || '').trim() !== ownerId) return player;
      return withPlayerZoneCard(player, zoneName, card, cardId, sourceIndex);
    });
    next = { ...next, players };
  }
  if (next.zones && typeof next.zones === 'object') {
    const zones = { ...next.zones };
    const ownerZones = { ...(zones[ownerId] || {}) };
    zones[ownerId] = withPlayerZoneCard(ownerZones, zoneName, card, cardId, sourceIndex);
    next = { ...next, zones };
  }
  if (zoneName === 'library' && next.libraries && typeof next.libraries.get === 'function' && typeof next.libraries.set === 'function') {
    const current = next.libraries.get(ownerId);
    if (!zoneArrayHasCard(current, cardId)) {
      next.libraries.set(ownerId, withCardInZoneArray(current, card, cardId, true, sourceIndex));
    }
  }
  return next;
}

function withPlayerZoneCard(owner: any, zoneName: string, card: any, cardId: string, sourceIndex?: number): any {
  const preferUnshift = zoneName === 'library';
  if (zoneName === 'command' || zoneName === 'command_zone') {
    const command = withCardInZoneArray(owner.command ?? owner.commandZone, card, cardId, false, sourceIndex);
    return { ...owner, command: command, commandZone: command, commandCount: command.length };
  }
  const list = withCardInZoneArray(owner[zoneName], card, cardId, preferUnshift, sourceIndex);
  const countKey = zoneName + 'Count';
  const nextOwner = { ...owner };
  nextOwner[zoneName] = list;
  nextOwner[countKey] = list.length;
  return nextOwner;
}

export function addBattlefieldPermanentsToState(state: GameState, newPermanents: readonly BattlefieldPermanent[]): GameState {
  const rejected = Array.isArray((newPermanents as CreatedBattlefieldPermanents | undefined)?.rejected)
    ? (newPermanents as CreatedBattlefieldPermanents).rejected
    : [];
  if (newPermanents.length === 0) return restoreRejectedBattlefieldEntries(state, rejected);

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

  return restoreRejectedBattlefieldEntries(
    { ...state, battlefield: mergedBattlefield as any } as any,
    rejected,
  );
}
