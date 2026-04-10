import type { PlayerID } from "../../../../shared/src/index.js";
import type { GameContext } from "../context.js";
import type { DungeonProgressState } from "./dungeons.js";
import { triggerLifeGainEffects } from "../utils.js";
import { processLifeChange } from "./game-state-effects.js";
import { createToken } from "./counters_tokens.js";
import { updateCounters } from "./counters_tokens.js";
import { applyGoadToCreature } from "./goad-effects.js";
import { drawCards } from "./zones.js";
import { ResolutionStepType, type CreateResolutionStepConfig } from "../resolution/index.js";

export type DungeonRoomExecuteEffectPayload = {
  effectType: 'createToken';
  controllerId: string;
  tokenData: {
    id: string;
    name: string;
    typeLine: string;
    power?: number;
    toughness?: number;
    colors: string[];
    abilities: string[];
    hasHaste: boolean;
  };
} | {
  effectType: 'dungeonExileCards';
  controllerId: string;
  exiledCards: any[];
  libraryAfter: any[];
  grantPlayableFromExile: boolean;
} | {
  effectType: 'dungeonDrawCards';
  controllerId: string;
  drawnCards: any[];
  libraryAfter: any[];
} | {
  effectType: 'dungeonSetLibrary';
  controllerId: string;
  libraryAfter: any[];
};

function cloneZoneCards(cards: any[]): any[] {
  return (Array.isArray(cards) ? cards : []).map((card: any) => ({ ...card }));
}

function getLibraryCards(ctx: GameContext, playerId: PlayerID): any[] {
  const library = (ctx as any)?.libraries?.get?.(playerId);
  return Array.isArray(library) ? library : [];
}

function getTopLibraryCards(ctx: GameContext, playerId: PlayerID, count: number): any[] {
  return cloneZoneCards(getLibraryCards(ctx, playerId).slice(0, Math.max(0, Number(count || 0))));
}

function getPendingDungeonRoomCardChoiceKey(playerId: PlayerID, roomKey: string, sourceId?: string): string {
  return `${String(playerId || '').trim()}:${String(roomKey || '').trim()}:${String(sourceId || '').trim()}`;
}

function setPendingDungeonRoomCardIds(
  ctx: GameContext,
  playerId: PlayerID,
  roomKey: string,
  sourceId: string | undefined,
  cardIds: string[],
): void {
  const stateAny = ctx.state as any;
  stateAny.pendingDungeonRoomCardIds = stateAny.pendingDungeonRoomCardIds || {};
  stateAny.pendingDungeonRoomCardIds[getPendingDungeonRoomCardChoiceKey(playerId, roomKey, sourceId)] = cardIds;
}

function getPendingDungeonRoomCardIds(
  ctx: GameContext,
  playerId: PlayerID,
  roomKey: string,
  sourceId?: string,
): string[] {
  const stateAny = ctx.state as any;
  const pending = stateAny.pendingDungeonRoomCardIds || {};
  const exact = pending[getPendingDungeonRoomCardChoiceKey(playerId, roomKey, sourceId)];
  if (Array.isArray(exact)) {
    return exact.map((cardId: any) => String(cardId || '')).filter(Boolean);
  }

  if (sourceId) {
    const fallback = pending[getPendingDungeonRoomCardChoiceKey(playerId, roomKey, undefined)];
    if (Array.isArray(fallback)) {
      return fallback.map((cardId: any) => String(cardId || '')).filter(Boolean);
    }
  }

  return [];
}

function getLibraryCardChoiceEntries(cards: any[]): Array<{
  id: string;
  label: string;
  description: string;
  imageUrl?: string;
}> {
  return (Array.isArray(cards) ? cards : [])
    .filter((card: any) => card && String(card.id || '').trim())
    .map((card: any) => ({
      id: String(card.id),
      label: String(card.name || 'Card'),
      description: String(card.type_line || ''),
      imageUrl: card.image_uris?.small || card.image_uris?.normal,
    }));
}

function shuffleCardsInPlace(cards: any[], rng?: (() => number) | undefined): void {
  const random = typeof rng === 'function' ? rng : Math.random;
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
}

function buildScryCards(ctx: GameContext, playerId: PlayerID, count: number): any[] {
  const library = (ctx as any)?.libraries?.get?.(playerId) || [];
  if (!Array.isArray(library)) return [];

  const actualCount = Math.min(Math.max(0, Number(count || 0)), library.length);
  if (actualCount <= 0) return [];

  return library.slice(0, actualCount).map((card: any) => ({
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    imageUrl: card.image_uris?.normal,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
  }));
}

function buildLibrarySearchAvailableCards(ctx: GameContext, playerId: PlayerID): any[] {
  const library = (ctx as any)?.libraries?.get?.(playerId) || [];
  if (!Array.isArray(library)) return [];

  return library.map((card: any) => ({
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
  }));
}

function applyLifeChange(ctx: GameContext, playerId: PlayerID, amount: number, isGain: boolean): number {
  const numericAmount = Math.max(0, Number(amount || 0));
  if (!playerId || numericAmount <= 0) return 0;

  const { finalAmount } = processLifeChange(ctx as any, playerId, numericAmount, isGain);
  if (finalAmount === 0) return 0;

  const stateAny = (ctx.state as any) || {};
  const players = Array.isArray(stateAny.players) ? stateAny.players : [];
  const player = players.find((candidate: any) => String(candidate?.id || '') === String(playerId));
  const startingLife = Number(stateAny.startingLife ?? 40) || 40;

  stateAny.life = stateAny.life || {};
  (ctx as any).life = (ctx as any).life || {};

  const current = stateAny.life[playerId] ?? (ctx as any).life[playerId] ?? player?.life ?? startingLife;
  const next = isGain ? current + finalAmount : current - Math.abs(finalAmount);

  stateAny.life[playerId] = next;
  (ctx as any).life[playerId] = next;
  if (player) player.life = next;

  if (isGain) {
    try {
      stateAny.lifeGainedThisTurn = stateAny.lifeGainedThisTurn || {};
      stateAny.lifeGainedThisTurn[String(playerId)] =
        (stateAny.lifeGainedThisTurn[String(playerId)] || 0) + finalAmount;
    } catch {}
    try {
      triggerLifeGainEffects((ctx as any).state, playerId, finalAmount);
    } catch {}
  } else {
    try {
      stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
      stateAny.lifeLostThisTurn[String(playerId)] =
        (stateAny.lifeLostThisTurn[String(playerId)] || 0) + Math.abs(finalAmount);
    } catch {}
    try {
      stateAny.damageTakenThisTurnByPlayer = stateAny.damageTakenThisTurnByPlayer || {};
      stateAny.damageTakenThisTurnByPlayer[String(playerId)] =
        (stateAny.damageTakenThisTurnByPlayer[String(playerId)] || 0) + Math.abs(finalAmount);
    } catch {}
  }

  if (typeof ctx.bumpSeq === 'function') {
    ctx.bumpSeq();
  }

  return finalAmount;
}

function getActivePlayers(ctx: GameContext): PlayerID[] {
  const players = Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [];
  return players
    .filter((player: any) => player && player.spectator !== true && player.hasLost !== true && String(player.id || '').trim())
    .map((player: any) => String(player.id) as PlayerID);
}

function getHandChoiceEntries(ctx: GameContext, playerId: PlayerID): any[] {
  const hand = ((ctx.state as any)?.zones?.[playerId]?.hand || []) as any[];
  if (!Array.isArray(hand)) return [];

  return hand.map((card: any) => ({
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
  }));
}

function getSacrificeTargetEntries(
  ctx: GameContext,
  playerId: PlayerID,
  allowedTypes: string[],
): Array<{
  id: string;
  label: string;
  description: string;
  imageUrl?: string;
}> {
  const allowed = allowedTypes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return [];

  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
  return battlefield
    .filter((permanent: any) => permanent && String(permanent.controller || '') === String(playerId))
    .filter((permanent: any) => {
      const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
      return allowed.some((allowedType) => typeLine.includes(allowedType));
    })
    .map((permanent: any) => ({
      id: String(permanent.id),
      label: String(permanent.card?.name || 'Permanent'),
      description: String(permanent.card?.type_line || 'permanent'),
      imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
    }));
}

function getSandfallSacrificeTargetEntries(ctx: GameContext, playerId: PlayerID) {
  return getSacrificeTargetEntries(ctx, playerId, ['creature', 'artifact', 'land']);
}

function getActivePlayerChoiceEntries(ctx: GameContext, choosingPlayerId: PlayerID): Array<{
  id: string;
  name: string;
  life: number;
  libraryCount: number;
  isOpponent: boolean;
  isSelf: boolean;
}> {
  const players = Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [];
  const stateLife = (ctx.state as any)?.life || {};
  const zones = (ctx.state as any)?.zones || {};

  return players
    .filter((player: any) => player && player.spectator !== true && String(player.id || '').trim())
    .map((player: any) => {
      const playerId = String(player.id);
      return {
        id: playerId,
        name: String(player.name || playerId),
        life: Number(stateLife[playerId] ?? player.life ?? 40) || 40,
        libraryCount: Number((zones[playerId] as any)?.libraryCount ?? 0) || 0,
        isOpponent: playerId !== String(choosingPlayerId),
        isSelf: playerId === String(choosingPlayerId),
      };
    });
}

function getCreatureTargetEntries(ctx: GameContext): Array<{
  id: string;
  label: string;
  description: string;
  imageUrl?: string;
}> {
  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
  const players = Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [];

  return battlefield
    .filter((permanent: any) => {
      const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
      return permanent && String(permanent.id || '').trim() && typeLine.includes('creature');
    })
    .map((permanent: any) => {
      const controllerId = String(permanent.controller || '');
      const controller = players.find((player: any) => String(player?.id || '') === controllerId);
      const controllerName = String(controller?.name || controllerId || '').trim();
      const typeLine = String(permanent.card?.type_line || 'creature').trim();

      return {
        id: String(permanent.id),
        label: String(permanent.card?.name || 'Creature'),
        description: controllerName ? `${typeLine} controlled by ${controllerName}` : typeLine,
        imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
      };
    });
}

function buildDungeonRoomTokenPayloads(
  ctx: GameContext,
  controllerId: PlayerID,
  createdTokenIds: string[],
): DungeonRoomExecuteEffectPayload[] {
  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];

  return createdTokenIds
    .map((tokenId) => battlefield.find((permanent: any) => String(permanent?.id || '') === String(tokenId)))
    .filter((permanent: any) => permanent && permanent.isToken)
    .map((permanent: any) => {
      const keywords = Array.isArray(permanent.card?.keywords) ? [...permanent.card.keywords] : [];
      const rawPower = permanent.basePower ?? permanent.card?.power;
      const rawToughness = permanent.baseToughness ?? permanent.card?.toughness;
      const power = Number.isFinite(Number(rawPower)) ? Number(rawPower) : undefined;
      const toughness = Number.isFinite(Number(rawToughness)) ? Number(rawToughness) : undefined;

      return {
        effectType: 'createToken',
        controllerId: String(controllerId),
        tokenData: {
          id: String(permanent.id),
          name: String(permanent.card?.name || 'Token'),
          typeLine: String(permanent.card?.type_line || 'Token'),
          ...(power != null ? { power } : {}),
          ...(toughness != null ? { toughness } : {}),
          colors: Array.isArray(permanent.card?.colors) ? [...permanent.card.colors] : [],
          abilities: keywords,
          hasHaste: keywords.some((keyword: any) => String(keyword || '').toLowerCase() === 'haste'),
        },
      };
    });
}

export function applyAutomaticDungeonRoomTokenEffects(
  ctx: GameContext,
  playerId: PlayerID,
  progress: DungeonProgressState | null,
): DungeonRoomExecuteEffectPayload[] {
  if (!progress || !playerId) return [];

  const stateAny = ctx.state as any;
  const zones = stateAny.zones = stateAny.zones || {};
  const playerZones = zones[playerId] = zones[playerId] || {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
    libraryCount: 0,
  };
  const roomKey = `${String(progress.dungeonId || '').trim().toLowerCase()}:${String(progress.currentRoomId || '').trim().toLowerCase()}`;
  let createdTokenIds: string[] = [];

  switch (roomKey) {
    case 'lost_mine:goblin_lair':
      createdTokenIds = createToken(ctx, playerId, 'Goblin', 1, 1, 1, {
        colors: ['R'],
        typeLine: 'Token Creature — Goblin',
      });
      break;

    case 'lost_mine:mine_tunnels':
    case 'mad_mage:goblin_bazaar':
    case 'undercity:stash':
      createdTokenIds = createToken(ctx, playerId, 'Treasure', 1, undefined, undefined, {
        colors: [],
        typeLine: 'Token Artifact — Treasure',
        abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
        isArtifact: true,
      });
      break;

    case 'mad_mage:muirals_graveyard':
      createdTokenIds = createToken(ctx, playerId, 'Skeleton', 2, 1, 1, {
        colors: ['B'],
        typeLine: 'Token Creature — Skeleton',
      });
      break;

    case 'undercity:catacombs':
      createdTokenIds = createToken(ctx, playerId, 'Skeleton', 1, 4, 1, {
        colors: ['B'],
        typeLine: 'Token Creature — Skeleton',
        abilities: ['Menace'],
      });
      break;

    case 'tomb:cradle_of_the_death_god':
      createdTokenIds = createToken(ctx, playerId, 'The Atropal', 1, 4, 4, {
        colors: ['B'],
        typeLine: 'Token Legendary Creature — God Horror',
        abilities: ['Deathtouch'],
      });
      break;

    case 'mad_mage:runestone_caverns': {
      const library = getLibraryCards(ctx, playerId);
      if (library.length === 0) {
        return [];
      }

      const exiledCards = cloneZoneCards(library.splice(0, Math.min(2, library.length))).map((card: any) => ({
        ...card,
        zone: 'exile',
        canBePlayedBy: playerId,
      }));
      playerZones.exile = Array.isArray(playerZones.exile) ? playerZones.exile : [];
      playerZones.exile.push(...exiledCards);
      playerZones.exileCount = playerZones.exile.length;
      playerZones.libraryCount = library.length;
      (ctx as any)?.libraries?.set?.(playerId, library);

      stateAny.playableFromExile = stateAny.playableFromExile || {};
      const playableEntry = (stateAny.playableFromExile[playerId] = stateAny.playableFromExile[playerId] || {});
      for (const card of exiledCards) {
        playableEntry[String(card.id)] = true;
      }

      return [{
        effectType: 'dungeonExileCards',
        controllerId: String(playerId),
        exiledCards: cloneZoneCards(exiledCards),
        libraryAfter: cloneZoneCards(library).map((card: any) => ({ ...card, zone: 'library' })),
        grantPlayableFromExile: true,
      }];
    }

    case 'mad_mage:mad_wizards_lair': {
      const library = getLibraryCards(ctx, playerId);
      if (library.length === 0) {
        return [];
      }

      const drawnCards = cloneZoneCards(library.splice(0, Math.min(3, library.length))).map((card: any) => ({ ...card, zone: 'hand' }));
      playerZones.hand = Array.isArray(playerZones.hand) ? playerZones.hand : [];
      playerZones.hand.push(...drawnCards);
      playerZones.handCount = playerZones.hand.length;
      playerZones.libraryCount = library.length;
      (ctx as any)?.libraries?.set?.(playerId, library);

      setPendingDungeonRoomCardIds(
        ctx,
        playerId,
        roomKey,
        undefined,
        drawnCards.map((card: any) => String(card.id || '')).filter(Boolean),
      );

      return [{
        effectType: 'dungeonDrawCards',
        controllerId: String(playerId),
        drawnCards: cloneZoneCards(drawnCards),
        libraryAfter: cloneZoneCards(library).map((card: any) => ({ ...card, zone: 'library' })),
      }];
    }

    case 'undercity:throne_of_the_dead_three': {
      const revealedCards = getTopLibraryCards(ctx, playerId, 10);
      if (revealedCards.length === 0) {
        return [];
      }

      const hasCreatureChoice = revealedCards.some((card: any) => String(card.type_line || '').toLowerCase().includes('creature'));
      if (hasCreatureChoice) {
        return [];
      }

      const library = getLibraryCards(ctx, playerId);
      shuffleCardsInPlace(library, typeof (ctx as any).rng === 'function' ? (ctx as any).rng.bind(ctx) : undefined);
      playerZones.libraryCount = library.length;
      (ctx as any)?.libraries?.set?.(playerId, library);

      return [{
        effectType: 'dungeonSetLibrary',
        controllerId: String(playerId),
        libraryAfter: cloneZoneCards(library).map((card: any) => ({ ...card, zone: 'library' })),
      }];
    }

    default:
      return [];
  }

  return buildDungeonRoomTokenPayloads(ctx, playerId, createdTokenIds);
}

export function applyDungeonTargetCreatureEffect(
  ctx: GameContext,
  targetPermanentId: string,
  choosingPlayerId: PlayerID,
  effectData:
    | {
        dungeonId?: string;
        roomId?: string;
        amount?: number;
        counterType?: string;
        powerDelta?: number;
        toughnessDelta?: number;
        grantText?: string;
        sourceName?: string;
      }
    | null
    | undefined,
): boolean {
  if (!targetPermanentId || !choosingPlayerId || !effectData) return false;

  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
  const targetIndex = battlefield.findIndex((permanent: any) => String(permanent?.id || '') === String(targetPermanentId));
  if (targetIndex < 0) return false;

  const targetPermanent = battlefield[targetIndex] as any;
  const typeLine = String(targetPermanent?.card?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return false;

  const roomKey = `${String(effectData.dungeonId || '').trim().toLowerCase()}:${String(effectData.roomId || '').trim().toLowerCase()}`;
  switch (roomKey) {
    case 'lost_mine:storeroom':
    case 'undercity:forge': {
      const defaultAmount = roomKey === 'lost_mine:storeroom' ? 1 : 2;
      const amount = Math.max(0, Number(effectData.amount || defaultAmount));
      const counterType = String(effectData.counterType || '+1/+1').trim() || '+1/+1';
      if (amount <= 0) return false;

      if (typeof (ctx as any).updateCounters === 'function') {
        (ctx as any).updateCounters(targetPermanentId, { [counterType]: amount });
        return true;
      }

      updateCounters(ctx, targetPermanentId, { [counterType]: amount });
      return true;
    }

    case 'lost_mine:fungi_cavern': {
      const powerDelta = Number(effectData.powerDelta ?? -4);
      const toughnessDelta = Number(effectData.toughnessDelta ?? 0);
      const sourceName = String(effectData.sourceName || 'Fungi Cavern').trim() || 'Fungi Cavern';
      const stateAny = ctx.state as any;

      targetPermanent.untilNextTurnPtMods = Array.isArray(targetPermanent.untilNextTurnPtMods)
        ? targetPermanent.untilNextTurnPtMods
        : [];
      targetPermanent.untilNextTurnPtMods.push({
        power: powerDelta,
        toughness: toughnessDelta,
        controllerId: choosingPlayerId,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: 'pt_mod',
      });

      if (typeof ctx.bumpSeq === 'function') {
        ctx.bumpSeq();
      }
      return true;
    }

    case 'mad_mage:twisted_caverns': {
      const sourceName = String(effectData.sourceName || 'Twisted Caverns').trim() || 'Twisted Caverns';
      const grantText = String(effectData.grantText || "This creature can't attack (until your next turn)").trim();
      const stateAny = ctx.state as any;

      targetPermanent.grantedAbilities = Array.isArray(targetPermanent.grantedAbilities)
        ? targetPermanent.grantedAbilities
        : [];
      if (!targetPermanent.grantedAbilities.includes(grantText)) {
        targetPermanent.grantedAbilities.push(grantText);
      }

      targetPermanent.untilNextTurnGrants = Array.isArray(targetPermanent.untilNextTurnGrants)
        ? targetPermanent.untilNextTurnGrants
        : [];
      targetPermanent.untilNextTurnGrants.push({
        controllerId: choosingPlayerId,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: [grantText],
        sourceName,
        kind: 'cant_attack',
      });

      if (typeof ctx.bumpSeq === 'function') {
        ctx.bumpSeq();
      }
      return true;
    }

    case 'undercity:arena': {
      const currentTurn = Number(((ctx.state as any)?.turnNumber ?? 0)) || 0;
      const expiryTurn = currentTurn + 1;
      battlefield[targetIndex] = applyGoadToCreature(targetPermanent as any, choosingPlayerId, expiryTurn) as any;
      if (typeof ctx.bumpSeq === 'function') {
        ctx.bumpSeq();
      }
      return true;
    }

    default:
      return false;
  }
}

export function applyDungeonTargetPlayerEffect(
  ctx: GameContext,
  targetPlayerId: PlayerID,
  effectData: { dungeonId?: string; roomId?: string; amount?: number } | null | undefined,
): boolean {
  if (!targetPlayerId || !effectData) return false;

  const roomKey = `${String(effectData.dungeonId || '').trim().toLowerCase()}:${String(effectData.roomId || '').trim().toLowerCase()}`;
  switch (roomKey) {
     case 'undercity:trap':
    case 'tomb:veils_of_fear':
    case 'tomb:sandfall_cell': {
      const defaultAmount = roomKey === 'undercity:trap' ? 5 : 2;
      const amount = Math.max(0, Number(effectData.amount || defaultAmount));
      if (amount <= 0) return false;
      applyLifeChange(ctx, targetPlayerId, amount, false);
      return true;
    }

    default:
      return false;
  }
}

export function applyAutomaticDungeonRoomEffect(
  ctx: GameContext,
  playerId: PlayerID,
  progress: DungeonProgressState | null,
): boolean {
  if (!progress) return false;

  const roomKey = `${String(progress.dungeonId || '').trim().toLowerCase()}:${String(progress.currentRoomId || '').trim().toLowerCase()}`;
  switch (roomKey) {
    case 'lost_mine:dark_pool': {
      for (const opponentId of getActivePlayers(ctx)) {
        if (String(opponentId) === String(playerId)) continue;
        applyLifeChange(ctx, opponentId, 1, false);
      }
      applyLifeChange(ctx, playerId, 1, true);
      return true;
    }

    case 'lost_mine:temple_of_dumathoin':
    case 'undercity:archives': {
      drawCards(ctx, playerId, 1);
      return true;
    }

    case 'mad_mage:yawning_portal': {
      applyLifeChange(ctx, playerId, 1, true);
      return true;
    }

    case 'tomb:trapped_entry': {
      for (const affectedPlayerId of getActivePlayers(ctx)) {
        applyLifeChange(ctx, affectedPlayerId, 1, false);
      }
      return true;
    }

    case 'tomb:veils_of_fear': {
      let applied = false;
      for (const affectedPlayerId of getActivePlayers(ctx)) {
        if (getHandChoiceEntries(ctx, affectedPlayerId).length > 0) continue;
        applyLifeChange(ctx, affectedPlayerId, 2, false);
        applied = true;
      }
      return applied;
    }

    case 'tomb:sandfall_cell': {
      let applied = false;
      for (const affectedPlayerId of getActivePlayers(ctx)) {
        if (getSandfallSacrificeTargetEntries(ctx, affectedPlayerId).length > 0) continue;
        applyLifeChange(ctx, affectedPlayerId, 2, false);
        applied = true;
      }
      return applied;
    }

    default:
      return false;
  }
}

export function buildDungeonRoomPenaltyFollowUpStep(
  ctx: GameContext,
  playerId: PlayerID,
  effectData:
    | {
        dungeonId?: string;
        roomId?: string;
        amount?: number;
        paymentType?: 'discard' | 'sacrifice';
        sourceName?: string;
      }
    | null
    | undefined,
  sourceId?: string,
): CreateResolutionStepConfig | null {
  if (!effectData || !playerId) return null;

  const dungeonId = String(effectData.dungeonId || '').trim();
  const roomId = String(effectData.roomId || '').trim();
  const sourceName = String(effectData.sourceName || 'Dungeon').trim() || 'Dungeon';
  const amount = Math.max(0, Number(effectData.amount || 0));
  const paymentType = effectData.paymentType;

  if (paymentType === 'discard') {
    const hand = getHandChoiceEntries(ctx, playerId);
    if (hand.length === 0) return null;

    return {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId,
      description: `${sourceName}: Discard a card or lose ${amount} life`,
      mandatory: true,
      sourceId: String(sourceId || '').trim() || undefined,
      sourceName,
      discardCount: 1,
      hand,
      dungeonRoomPayment: {
        dungeonId,
        roomId,
        paymentType: 'discard',
        amount,
        sourceName,
      },
    } as any;
  }

  if (paymentType === 'sacrifice') {
    const validTargets = getSandfallSacrificeTargetEntries(ctx, playerId);
    if (validTargets.length === 0) return null;

    return {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId,
      description: `${sourceName}: Sacrifice a creature, artifact, or land or lose ${amount} life`,
      mandatory: true,
      sourceId: String(sourceId || '').trim() || undefined,
      sourceName,
      validTargets,
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'creature, artifact, or land you control',
      dungeonRoomPayment: {
        dungeonId,
        roomId,
        paymentType: 'sacrifice',
        amount,
        sourceName,
      },
    } as any;
  }

  return null;
}

export function buildDungeonRoomPromptSteps(
  ctx: GameContext,
  playerId: PlayerID,
  progress: DungeonProgressState | null,
  sourceId?: string,
): CreateResolutionStepConfig[] {
  if (!progress) return [];

  const roomKey = `${String(progress.dungeonId || '').trim().toLowerCase()}:${String(progress.currentRoomId || '').trim().toLowerCase()}`;

  switch (roomKey) {
    case 'mad_mage:mad_wizards_lair': {
      const drawnCardIds = getPendingDungeonRoomCardIds(ctx, playerId, roomKey, sourceId);
      const spellOptions = getSpellChoiceEntriesFromHand(ctx, playerId, drawnCardIds);
      if (spellOptions.length === 0) {
        return [];
      }

      return [{
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - You may cast one of the revealed cards without paying its mana cost`,
        mandatory: false,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        options: [
          ...spellOptions,
          { id: 'decline', label: 'Decline', description: 'Keep all three cards in hand' },
        ],
        minSelections: 1,
        maxSelections: 1,
        priority: 0,
        dungeonRoomFreeCastFromHandChoice: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
          sourceName: progress.currentRoomName,
          drawnCardIds,
        },
      } as any];
    }

    case 'tomb:veils_of_fear': {
      return getActivePlayers(ctx)
        .filter((affectedPlayerId) => getHandChoiceEntries(ctx, affectedPlayerId).length > 0)
        .map((affectedPlayerId) => ({
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: affectedPlayerId,
          description: `${progress.dungeonName}: ${progress.currentRoomName} - Lose 2 life unless you discard a card`,
          mandatory: true,
          sourceId: String(sourceId || '').trim() || undefined,
          sourceName: progress.currentRoomName,
          options: [
            { id: 'discard_card', label: 'Discard a card' },
            { id: 'lose_life', label: 'Lose 2 life' },
          ],
          minSelections: 1,
          maxSelections: 1,
          priority: 0,
          dungeonRoomPenaltyChoice: {
            dungeonId: progress.dungeonId,
            roomId: progress.currentRoomId,
            amount: 2,
            paymentType: 'discard',
            sourceName: progress.currentRoomName,
          },
        } as any));
    }

    case 'tomb:sandfall_cell': {
      return getActivePlayers(ctx)
        .filter((affectedPlayerId) => getSandfallSacrificeTargetEntries(ctx, affectedPlayerId).length > 0)
        .map((affectedPlayerId) => ({
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: affectedPlayerId,
          description: `${progress.dungeonName}: ${progress.currentRoomName} - Lose 2 life unless you sacrifice a creature, artifact, or land`,
          mandatory: true,
          sourceId: String(sourceId || '').trim() || undefined,
          sourceName: progress.currentRoomName,
          options: [
            { id: 'sacrifice_permanent', label: 'Sacrifice a creature, artifact, or land' },
            { id: 'lose_life', label: 'Lose 2 life' },
          ],
          minSelections: 1,
          maxSelections: 1,
          priority: 0,
          dungeonRoomPenaltyChoice: {
            dungeonId: progress.dungeonId,
            roomId: progress.currentRoomId,
            amount: 2,
            paymentType: 'sacrifice',
            sourceName: progress.currentRoomName,
          },
        } as any));
    }

    case 'tomb:oubliette': {
      const steps: CreateResolutionStepConfig[] = [];
      const hand = getHandChoiceEntries(ctx, playerId);
      if (hand.length > 0) {
        steps.push({
          type: ResolutionStepType.DISCARD_SELECTION,
          playerId,
          description: `${progress.dungeonName}: ${progress.currentRoomName} - Discard a card`,
          mandatory: true,
          sourceId: String(sourceId || '').trim() || undefined,
          sourceName: progress.currentRoomName,
          discardCount: 1,
          hand,
          priority: 0,
          dungeonRoomPayment: {
            dungeonId: progress.dungeonId,
            roomId: progress.currentRoomId,
            paymentType: 'discard',
            sourceName: progress.currentRoomName,
          },
        } as any);
      }

      const creatureTargets = getSacrificeTargetEntries(ctx, playerId, ['creature']);
      if (creatureTargets.length > 0) {
        steps.push({
          type: ResolutionStepType.TARGET_SELECTION,
          playerId,
          description: `${progress.dungeonName}: ${progress.currentRoomName} - Sacrifice a creature`,
          mandatory: true,
          sourceId: String(sourceId || '').trim() || undefined,
          sourceName: progress.currentRoomName,
          validTargets: creatureTargets,
          targetTypes: ['permanent'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',
          priority: 1,
          dungeonRoomPayment: {
            dungeonId: progress.dungeonId,
            roomId: progress.currentRoomId,
            paymentType: 'sacrifice',
            sourceName: progress.currentRoomName,
          },
        } as any);
      }

      const artifactTargets = getSacrificeTargetEntries(ctx, playerId, ['artifact']);
      if (artifactTargets.length > 0) {
        steps.push({
          type: ResolutionStepType.TARGET_SELECTION,
          playerId,
          description: `${progress.dungeonName}: ${progress.currentRoomName} - Sacrifice an artifact`,
          mandatory: true,
          sourceId: String(sourceId || '').trim() || undefined,
          sourceName: progress.currentRoomName,
          validTargets: artifactTargets,
          targetTypes: ['permanent'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'artifact you control',
          priority: 2,
          dungeonRoomPayment: {
            dungeonId: progress.dungeonId,
            roomId: progress.currentRoomId,
            paymentType: 'sacrifice',
            sourceName: progress.currentRoomName,
          },
        } as any);
      }

      const landTargets = getSacrificeTargetEntries(ctx, playerId, ['land']);
      if (landTargets.length > 0) {
        steps.push({
          type: ResolutionStepType.TARGET_SELECTION,
          playerId,
          description: `${progress.dungeonName}: ${progress.currentRoomName} - Sacrifice a land`,
          mandatory: true,
          sourceId: String(sourceId || '').trim() || undefined,
          sourceName: progress.currentRoomName,
          validTargets: landTargets,
          targetTypes: ['permanent'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'land you control',
          priority: 3,
          dungeonRoomPayment: {
            dungeonId: progress.dungeonId,
            roomId: progress.currentRoomId,
            paymentType: 'sacrifice',
            sourceName: progress.currentRoomName,
          },
        } as any);
      }

      return steps;
    }

    case 'undercity:throne_of_the_dead_three': {
      const revealedCards = getTopLibraryCards(ctx, playerId, 10);
      const creatureCards = revealedCards.filter((card: any) => String(card.type_line || '').toLowerCase().includes('creature'));
      const options = getLibraryCardChoiceEntries(creatureCards);
      if (options.length === 0) {
        return [];
      }

      return [{
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Choose a creature card to put onto the battlefield`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        options,
        minSelections: 1,
        maxSelections: 1,
        priority: 0,
        dungeonRoomThroneChoice: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
          sourceName: progress.currentRoomName,
          revealedCards: cloneZoneCards(revealedCards),
        },
      } as any];
    }

    default: {
      const promptStep = buildDungeonRoomPromptStep(ctx, playerId, progress, sourceId);
      return promptStep ? [promptStep] : [];
    }
  }
}

export function buildDungeonRoomPromptStep(
  ctx: GameContext,
  playerId: PlayerID,
  progress: DungeonProgressState | null,
  sourceId?: string,
): CreateResolutionStepConfig | null {
  if (!progress) return null;

  const roomKey = `${String(progress.dungeonId || '').trim().toLowerCase()}:${String(progress.currentRoomId || '').trim().toLowerCase()}`;
  let scryCount = 0;

  switch (roomKey) {
    case 'lost_mine:storeroom': {
      const validTargets = getCreatureTargetEntries(ctx);
      if (validTargets.length === 0) return null;

      return {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Choose target creature`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
          amount: 1,
          counterType: '+1/+1',
          sourceName: progress.currentRoomName,
        },
      } as any;
    }

    case 'lost_mine:fungi_cavern': {
      const validTargets = getCreatureTargetEntries(ctx);
      if (validTargets.length === 0) return null;

      return {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Choose target creature`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
          powerDelta: -4,
          toughnessDelta: 0,
          sourceName: progress.currentRoomName,
        },
      } as any;
    }

    case 'mad_mage:twisted_caverns': {
      const validTargets = getCreatureTargetEntries(ctx);
      if (validTargets.length === 0) return null;

      return {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Choose target creature`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
          grantText: "This creature can't attack (until your next turn)",
          sourceName: progress.currentRoomName,
        },
      } as any;
    }

    case 'undercity:forge': {
      const validTargets = getCreatureTargetEntries(ctx);
      if (validTargets.length === 0) return null;

      return {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Choose target creature`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
          amount: 2,
          counterType: '+1/+1',
          sourceName: progress.currentRoomName,
        },
      } as any;
    }

    case 'undercity:arena': {
      const validTargets = getCreatureTargetEntries(ctx);
      if (validTargets.length === 0) return null;

      return {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Choose target creature`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
          sourceName: progress.currentRoomName,
        },
      } as any;
    }

    case 'undercity:trap': {
      const players = getActivePlayerChoiceEntries(ctx, playerId);
      if (players.length === 0) return null;

      return {
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Choose target player`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        players,
        dungeonTargetPlayerEffect: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
          amount: 5,
        },
      } as any;
    }

    case 'undercity:secret_entrance': {
      const availableCards = buildLibrarySearchAvailableCards(ctx, playerId).filter((card: any) => {
        const typeLine = String(card?.type_line || '').toLowerCase();
        return typeLine.includes('basic') && typeLine.includes('land');
      });
      if (availableCards.length === 0) return null;

      return {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Search your library for a basic land card`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        searchCriteria: 'a basic land card',
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        availableCards,
        remainderDestination: 'shuffle',
        remainderRandomOrder: true,
        filter: { allTypes: ['basic', 'land'] },
        persistLibrarySearchResolve: true,
        persistLibrarySearchResolveReason: 'dungeon_room',
      } as any;
    }

    case 'lost_mine:cave_entrance':
    case 'mad_mage:dungeon_level':
      scryCount = 1;
      break;
    case 'mad_mage:lost_level':
    case 'undercity:lost_well':
      scryCount = 2;
      break;
    case 'mad_mage:deep_mines':
      scryCount = 3;
      break;
    default:
      return null;
  }

  const cards = buildScryCards(ctx, playerId, scryCount);
  if (cards.length === 0) return null;

  return {
    type: ResolutionStepType.SCRY,
    playerId,
    description: `${progress.dungeonName}: ${progress.currentRoomName} - Scry ${cards.length}`,
    mandatory: true,
    sourceId: String(sourceId || '').trim() || undefined,
    sourceName: progress.currentRoomName,
    scryCount: cards.length,
    cards,
  } as any;
}

function getSpellChoiceEntriesFromHand(ctx: GameContext, playerId: PlayerID, cardIds: string[]): Array<{
  id: string;
  label: string;
  description: string;
  imageUrl?: string;
}> {
  const allowedIds = new Set((Array.isArray(cardIds) ? cardIds : []).map((cardId: any) => String(cardId || '')).filter(Boolean));
  if (allowedIds.size === 0) return [];

  const hand = ((ctx.state as any)?.zones?.[playerId]?.hand || []) as any[];
  return hand
    .filter((card: any) => card && allowedIds.has(String(card.id || '')))
    .filter((card: any) => !String(card.type_line || '').toLowerCase().includes('land'))
    .map((card: any) => ({
      id: String(card.id),
      label: String(card.name || 'Spell'),
      description: String(card.type_line || ''),
      imageUrl: card.image_uris?.small || card.image_uris?.normal,
    }));
}