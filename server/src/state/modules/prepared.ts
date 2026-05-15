import { uid } from '../utils.js';

import { cleanupCardLeavingExile } from './playable-from-exile.js';
import { stampPermanentControlEntryForEcho } from './upkeep-triggers.js';

function getCardFaces(card: any): any[] {
  return Array.isArray(card?.card_faces) ? card.card_faces : [];
}

function getPreparedFrontFace(card: any): any | null {
  const faces = getCardFaces(card);
  return faces.length >= 1 ? faces[0] : null;
}

export function getPreparedSpellFace(card: any): any | null {
  const layout = String(card?.layout || '').toLowerCase();
  const faces = getCardFaces(card);
  if (layout !== 'prepare' || faces.length < 2) {
    return null;
  }
  return faces[1] || null;
}

export function cardEntersPrepared(card: any): boolean {
  const frontFace = getPreparedFrontFace(card);
  const oracleText = String(frontFace?.oracle_text || card?.oracle_text || '')
    .replace(/[’]/g, "'")
    .toLowerCase();
  return /\benters prepared\b/.test(oracleText);
}

export function canPermanentBePrepared(permanent: any): boolean {
  const sourceCard = permanent?.card || permanent;
  return Boolean(sourceCard && getPreparedSpellFace(sourceCard));
}

function getPreparedCopyId(permanent: any): string {
  return String(
    permanent?.preparedExileCopyCardId ||
    permanent?.card?.preparedExileCopyCardId ||
    '',
  ).trim();
}

function isPermanentPrepared(permanent: any): boolean {
  return Boolean(
    permanent?.prepared === true ||
    permanent?.isPrepared === true ||
    permanent?.card?.prepared === true ||
    permanent?.card?.isPrepared === true,
  );
}

function findPreparedCopyInExileZones(state: any, copyId: string): {
  controllerId: string;
  exile: any[];
  index: number;
  copy: any;
} | null {
  if (!state?.zones || !copyId) {
    return null;
  }

  for (const [controllerId, zone] of Object.entries(state.zones)) {
    const exile = Array.isArray((zone as any)?.exile) ? (zone as any).exile : [];
    const index = exile.findIndex((card: any) => String(card?.id || '').trim() === copyId);
    if (index !== -1) {
      return {
        controllerId,
        exile,
        index,
        copy: exile[index],
      };
    }
  }

  return null;
}

function ensurePlayerExileZone(state: any, playerId: string): any[] {
  state.zones = state.zones || {};
  state.zones[playerId] = state.zones[playerId] || {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };

  const zone = state.zones[playerId];
  zone.exile = Array.isArray(zone.exile) ? zone.exile : [];
  zone.exileCount = zone.exile.length;
  return zone.exile;
}

function buildPreparedCopyCard(permanent: any): any | null {
  const sourceCard = permanent?.card || {};
  const spellFace = getPreparedSpellFace(sourceCard);
  if (!spellFace) {
    return null;
  }

  const controller = String(permanent?.controller || permanent?.owner || '').trim();
  if (!controller) {
    return null;
  }

  const copyId = uid('prepared_copy');
  const copyCard: any = {
    ...sourceCard,
    id: copyId,
    name: spellFace.name || sourceCard.name,
    mana_cost: spellFace.mana_cost || '',
    type_line: spellFace.type_line || sourceCard.type_line,
    oracle_text: spellFace.oracle_text || '',
    colors: Array.isArray(spellFace.colors) ? spellFace.colors : (Array.isArray(sourceCard.colors) ? sourceCard.colors : []),
    color_identity: Array.isArray(spellFace.color_identity)
      ? spellFace.color_identity
      : (Array.isArray(sourceCard.color_identity) ? sourceCard.color_identity : []),
    image_uris: spellFace.image_uris || sourceCard.image_uris,
    zone: 'exile',
    isCopy: true,
    copiedFromCardId: String(sourceCard.id || permanent?.id || '').trim(),
    preparedGeneratedCopy: true,
    preparedSourcePermanentId: String(permanent?.id || '').trim(),
    preparedSourceCardId: String(sourceCard.id || '').trim(),
    canBePlayedBy: controller,
    playableUntilTurn: true,
    ceaseOnResolution: true,
    ceaseOnCounter: true,
    owner: sourceCard.owner || permanent?.owner || controller,
  };

  delete copyCard.card_faces;
  delete copyCard.layout;
  delete copyCard.power;
  delete copyCard.toughness;
  delete copyCard.loyalty;

  return copyCard;
}

export function findPreparedSourcePermanentForCard(state: any, exiledCard: any): any | null {
  const sourcePermanentId = String(exiledCard?.preparedSourcePermanentId || '').trim();
  if (!sourcePermanentId) {
    return null;
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.find((permanent: any) => String(permanent?.id || '') === sourcePermanentId) || null;
}

export function isPreparedCopyActive(state: any, exiledCard: any, playerId?: string): boolean {
  const sourcePermanent = findPreparedSourcePermanentForCard(state, exiledCard);
  if (!sourcePermanent) {
    return false;
  }

  const preparedFlag =
    sourcePermanent?.prepared === true ||
    sourcePermanent?.isPrepared === true ||
    sourcePermanent?.card?.prepared === true ||
    sourcePermanent?.card?.isPrepared === true;
  if (!preparedFlag) {
    return false;
  }

  if (String(sourcePermanent?.preparedExileCopyCardId || '').trim() !== String(exiledCard?.id || '').trim()) {
    return false;
  }

  if (playerId && String(sourcePermanent?.controller || sourcePermanent?.owner || '') !== String(playerId)) {
    return false;
  }

  return true;
}

export function syncPreparedPermanentAfterControlChange(
  state: any,
  permanent: any,
  previousControllerId?: string,
): any | null {
  if (!state || !permanent) {
    return null;
  }

  const newController = String(permanent?.controller || permanent?.owner || '').trim();
  const oldController = String(previousControllerId || '').trim();
  const copyId = getPreparedCopyId(permanent);
  const prepared = isPermanentPrepared(permanent);

  stampPermanentControlEntryForEcho(state, permanent, newController);

  if (!newController || (!prepared && !copyId) || !canPermanentBePrepared(permanent)) {
    return null;
  }

  permanent.card = permanent.card || {};
  if (copyId) {
    permanent.preparedExileCopyCardId = copyId;
    permanent.card.preparedExileCopyCardId = copyId;
  }

  let preparedCopy: any | null = null;
  if (copyId && oldController && oldController !== newController) {
    const oldExile = ensurePlayerExileZone(state, oldController);
    const oldIndex = oldExile.findIndex((card: any) => String(card?.id || '').trim() === copyId);
    if (oldIndex !== -1) {
      [preparedCopy] = oldExile.splice(oldIndex, 1);
      state.zones[oldController].exileCount = oldExile.length;
    }
  }

  if (!preparedCopy && copyId) {
    const located = findPreparedCopyInExileZones(state, copyId);
    if (located) {
      preparedCopy = located.copy;
      if (located.controllerId !== newController) {
        located.exile.splice(located.index, 1);
        state.zones[located.controllerId].exileCount = located.exile.length;
      }
    }
  }

  if (!prepared) {
    return null;
  }

  if (!preparedCopy) {
    return setPermanentPrepared(state, permanent);
  }

  const targetExile = ensurePlayerExileZone(state, newController);
  preparedCopy.zone = 'exile';
  preparedCopy.canBePlayedBy = newController;
  preparedCopy.playableUntilTurn = true;
  preparedCopy.preparedSourcePermanentId = String(permanent?.id || '').trim();
  preparedCopy.preparedSourceCardId = String(permanent?.card?.id || preparedCopy?.preparedSourceCardId || '').trim();

  if (!targetExile.some((card: any) => String(card?.id || '').trim() === String(preparedCopy?.id || '').trim())) {
    targetExile.push(preparedCopy);
  }
  state.zones[newController].exileCount = targetExile.length;

  permanent.prepared = true;
  permanent.isPrepared = true;
  permanent.preparedExileCopyCardId = preparedCopy.id;
  permanent.card.prepared = true;
  permanent.card.isPrepared = true;
  permanent.card.preparedExileCopyCardId = preparedCopy.id;

  return preparedCopy;
}

export function setPermanentPrepared(state: any, permanent: any): any | null {
  if (!state || !permanent || !canPermanentBePrepared(permanent)) {
    return null;
  }

  const controller = String(permanent?.controller || permanent?.owner || '').trim();
  if (!controller) {
    return null;
  }

  const exile = ensurePlayerExileZone(state, controller);
  const existingCopyId = String(permanent?.preparedExileCopyCardId || '').trim();
  const existingCopy = existingCopyId
    ? exile.find((card: any) => String(card?.id || '') === existingCopyId)
    : null;

  permanent.prepared = true;
  permanent.isPrepared = true;
  permanent.card = permanent.card || {};
  permanent.card.prepared = true;
  permanent.card.isPrepared = true;

  if (existingCopy) {
    existingCopy.canBePlayedBy = controller;
    existingCopy.playableUntilTurn = true;
    existingCopy.preparedSourcePermanentId = String(permanent?.id || '').trim();
    permanent.preparedExileCopyCardId = existingCopy.id;
    permanent.card.preparedExileCopyCardId = existingCopy.id;
    return existingCopy;
  }

  const preparedCopy = buildPreparedCopyCard(permanent);
  if (!preparedCopy) {
    return null;
  }

  exile.push(preparedCopy);
  state.zones[controller].exileCount = exile.length;
  permanent.preparedExileCopyCardId = preparedCopy.id;
  permanent.card.preparedExileCopyCardId = preparedCopy.id;
  return preparedCopy;
}

export function clearPreparedPermanent(
  state: any,
  permanent: any,
  options?: { preserveExileCardId?: string },
): void {
  if (!state || !permanent) {
    return;
  }

  const controller = String(permanent?.controller || permanent?.owner || '').trim();
  const copyId = String(permanent?.preparedExileCopyCardId || '').trim();
  const preserveExileCardId = String(options?.preserveExileCardId || '').trim();

  if (controller && copyId) {
    const exile = ensurePlayerExileZone(state, controller);
    const exileIndex = exile.findIndex((card: any) => {
      const exileCardId = String(card?.id || '').trim();
      return exileCardId === copyId && exileCardId !== preserveExileCardId;
    });

    if (exileIndex !== -1) {
      const [removedCopy] = exile.splice(exileIndex, 1);
      state.zones[controller].exileCount = exile.length;
      cleanupCardLeavingExile(state, removedCopy);
    }
  }

  permanent.prepared = false;
  if ('isPrepared' in permanent) {
    delete permanent.isPrepared;
  }
  if ('preparedExileCopyCardId' in permanent) {
    delete permanent.preparedExileCopyCardId;
  }

  if (permanent?.card && typeof permanent.card === 'object') {
    permanent.card.prepared = false;
    if ('isPrepared' in permanent.card) {
      delete permanent.card.isPrepared;
    }
    if ('preparedExileCopyCardId' in permanent.card) {
      delete permanent.card.preparedExileCopyCardId;
    }
  }
}