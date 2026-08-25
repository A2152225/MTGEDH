/**
 * Extracted from dungeon-effects.ts: applyAutomaticDungeonRoomTokenEffects
 * plus exclusive helper buildDungeonRoomTokenPayloads.
 * Cluster moved: buildDungeonRoomTokenPayloads, applyAutomaticDungeonRoomTokenEffects.
 * Public: applyAutomaticDungeonRoomTokenEffects
 *
 * Leaf must not import dungeon-effects.ts or dungeon-effects-handlers/index.ts.
 */

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';
import type { DungeonProgressState } from '../dungeons.js';
import { createToken } from '../counters_tokens.js';
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from '../durable-permissions.js';
import type { DungeonRoomExecuteEffectPayload } from './dungeonRoomCardHelpers.js';
import {
  cloneZoneCards,
  getLibraryCards,
  getTopLibraryCards,
  setPendingDungeonRoomCardIds,
  shuffleCardsInPlace,
} from './dungeonRoomCardHelpers.js';

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
      const grantedCardIds: string[] = [];
      for (const card of exiledCards) {
        const grantedCardId = String(card?.id || '').trim();
        if (!grantedCardId) continue;
        playableEntry[grantedCardId] = true;
        grantedCardIds.push(grantedCardId);
      }
      if (grantedCardIds.length > 0) {
        upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
          playerId,
          cardIds: grantedCardIds,
          action: 'play',
          duration: 'static',
          turnApplied: Number(stateAny.turnNumber || 0),
          sourceName: String(progress.currentRoomName || 'Runestone Caverns'),
          sourceText: 'Exile the top two cards of your library. You may play them.',
        }));
      }

      return [{
        effectType: 'dungeonExileCards',
        controllerId: String(playerId),
        exiledCards: cloneZoneCards(exiledCards),
        remainingLibraryIds: cloneZoneCards(library).map((card: any) => String(card?.id || '')).filter(Boolean),
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
        remainingLibraryIds: cloneZoneCards(library).map((card: any) => String(card?.id || '')).filter(Boolean),
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
        remainingLibraryIds: cloneZoneCards(library).map((card: any) => String(card?.id || '')).filter(Boolean),
      }];
    }

    default:
      return [];
  }

  return buildDungeonRoomTokenPayloads(ctx, playerId, createdTokenIds);
}

