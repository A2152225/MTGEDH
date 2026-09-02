import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { getPlayableLandCandidates } from '../src/state/modules/can-respond-handlers/canRespondPlayableLands.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { applyOpponentLibraryDrawReplacementChoice } from '../src/state/modules/zones.js';
import { getPlayableExileCardsForPlayer } from '../src/state/modules/playable-from-exile.js';
import {
  applyCurrentExiledWithSourcePlayLook,
  viewerCanExamineExiledCard,
} from '../src/state/modules/impulse-exile-utils.js';

const SHARED_FATE_ORACLE =
  "If a player would draw a card, that player exiles the top card of one of their opponents' libraries face down instead.\nEach player may look at cards they exiled with this enchantment, and they may play lands and cast spells from among those cards.";

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function setupSharedFateGame(gameId: string, opponentCount: number) {
  ResolutionQueueManager.clearAllSteps(gameId);
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  addPlayer(game, p1, 'P1');

  const opponents: PlayerID[] = [];
  for (let index = 0; index < opponentCount; index += 1) {
    const id = `p${index + 2}` as PlayerID;
    addPlayer(game, id, `P${index + 2}`);
    opponents.push(id);
    const library = [
      {
        id: `${id}_top`,
        name: index === 0 ? 'Lightning Bolt' : 'Forest',
        type_line: index === 0 ? 'Instant' : 'Basic Land — Forest',
        mana_cost: index === 0 ? '{R}' : '',
        oracle_text: index === 0 ? 'Lightning Bolt deals 3 damage to any target.' : '{T}: Add {G}.',
        zone: 'library',
      },
    ];
    game.libraries.set(id, library.map((card) => ({ ...card })));
    (game.state as any).zones[id] = {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      libraryCount: 1,
    };
  }

  (game.state as any).turnNumber = 3;
  (game.state as any).phase = 'main';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = p1;
  (game.state as any).activePlayer = p1;
  (game.state as any).priority = p1;
  (game.state as any).manaPool = {
    [p1]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
  };
  (game.state as any).zones[p1] = {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
    libraryCount: 0,
  };
  (game.state as any).battlefield = [{
    id: 'shared_fate_1',
    controller: p1,
    card: {
      name: 'Shared Fate',
      type_line: 'Enchantment',
      oracle_text: SHARED_FATE_ORACLE,
    },
  }];

  return { game, gameId, p1, opponents };
}

describe('Shared Fate opponent-library draw replacement', () => {
  it('exiles the only opponent\'s top card face down instead of drawing in a two-player game', () => {
    const { game, p1, opponents } = setupSharedFateGame('t_shared_fate_two_player', 1);
    const opponentId = opponents[0];

    const drawn = game.drawCards(p1, 1);
    expect(drawn).toEqual([]);
    expect((game.state as any).zones[p1].hand).toEqual([]);
    expect(game.libraries.get(opponentId)).toEqual([]);

    const exiled = ((game.state as any).zones[opponentId].exile || [])[0];
    expect(exiled?.id).toBe(`${opponentId}_top`);
    expect(exiled?.faceDown).toBe(true);
    expect(exiled?.exiledBy).toBe(p1);
    expect(exiled?.exiledWithSourceId).toBe('shared_fate_1');
    expect(exiled?.canBePlayedBy).toBe(p1);
    expect(viewerCanExamineExiledCard(exiled, p1)).toBe(true);
    expect(viewerCanExamineExiledCard(exiled, opponentId)).toBe(false);

    const ctx = { state: game.state, libraries: game.libraries } as any;
    const spells = getCastableSpellCandidates(ctx, p1, {
      mode: 'main',
      allowUnknownCostFallback: false,
    });
    expect(spells.some((entry: any) => String(entry?.card?.id || '') === `${opponentId}_top`)).toBe(true);
    expect(getPlayableExileCardsForPlayer(game.state, opponentId).some((card: any) => String(card?.id || '') === `${opponentId}_top`)).toBe(false);

    const drawerView = game.viewFor!(p1);
    const ownerView = game.viewFor!(opponentId);
    const drawerExile = ((drawerView.zones as any)?.[opponentId]?.exile || [])[0];
    const ownerExile = ((ownerView.zones as any)?.[opponentId]?.exile || [])[0];
    expect(drawerExile).toMatchObject({ id: `${opponentId}_top`, name: 'Lightning Bolt', known: true, faceDown: true });
    expect(ownerExile).toMatchObject({ id: `${opponentId}_top`, faceDown: true, known: false });
    expect(ownerExile?.name).toBeUndefined();
    expect(ownerExile?.oracle_text).toBeUndefined();
  });

  it('queues an opponent choice when more than one opponent has a library', () => {
    const { game, gameId, p1, opponents } = setupSharedFateGame('t_shared_fate_multi_opponent', 2);

    const drawn = game.drawCards(p1, 1);
    expect(drawn).toEqual([]);
    expect((game.state as any).zones[opponents[0]].exile || []).toEqual([]);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      opponentLibraryDrawReplacement: true,
    });
    expect((steps[0] as any).options.map((option: any) => option.id).sort()).toEqual([...opponents].sort());

    applyOpponentLibraryDrawReplacementChoice(game as any, {
      playerId: p1,
      opponentId: opponents[1],
      remainingDrawCountAfterChoice: 0,
      sourcePermanentId: 'shared_fate_1',
      sourceName: 'Shared Fate',
    });

    expect(((game.state as any).zones[opponents[1]].exile || [])[0]?.id).toBe(`${opponents[1]}_top`);
    expect((game.state as any).zones[opponents[0]].exile || []).toEqual([]);

    const ctx = { state: game.state, libraries: game.libraries } as any;
    const lands = getPlayableLandCandidates(ctx, p1);
    expect(lands.some((entry: any) => String(entry?.card?.id || '') === `${opponents[1]}_top`)).toBe(true);
  });

  it('hides the face-down card from everyone except the player whose draw was replaced', () => {
    const { game, p1, opponents } = setupSharedFateGame('t_shared_fate_look_only_drawer', 2);
    applyOpponentLibraryDrawReplacementChoice(game as any, {
      playerId: p1,
      opponentId: opponents[0],
      remainingDrawCountAfterChoice: 0,
      sourcePermanentId: 'shared_fate_1',
      sourceName: 'Shared Fate',
    });

    const ownerId = opponents[0];
    const otherId = opponents[1];
    const drawerView = game.viewFor!(p1);
    const ownerView = game.viewFor!(ownerId);
    const otherView = game.viewFor!(otherId);
    const drawerExile = ((drawerView.zones as any)?.[ownerId]?.exile || [])[0];
    const ownerExile = ((ownerView.zones as any)?.[ownerId]?.exile || [])[0];
    const otherExile = ((otherView.zones as any)?.[ownerId]?.exile || [])[0];

    expect(drawerExile?.name).toBe('Lightning Bolt');
    expect(drawerExile?.known).toBe(true);
    expect(ownerExile?.known).toBe(false);
    expect(ownerExile?.name).toBeUndefined();
    expect(otherExile?.known).toBe(false);
    expect(otherExile?.name).toBeUndefined();
  });

  it('stops look and play when that Shared Fate instance leaves, even if another is recast', () => {
    const { game, p1, opponents } = setupSharedFateGame('t_shared_fate_instance_key', 1);
    const opponentId = opponents[0];
    game.drawCards(p1, 1);

    const ctx = { state: game.state, libraries: game.libraries } as any;
    const cardId = `${opponentId}_top`;
    expect(getCastableSpellCandidates(ctx, p1, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).some((entry: any) => String(entry?.card?.id || '') === cardId)).toBe(true);

    (game.state as any).battlefield = [];
    const afterLeave = applyCurrentExiledWithSourcePlayLook(
      ((game.state as any).zones[opponentId].exile || [])[0],
      (game.state as any).battlefield,
    );
    expect(viewerCanExamineExiledCard(afterLeave, p1)).toBe(false);
    expect(game.viewFor!(p1).zones?.[opponentId]?.exile?.[0]?.known).toBe(false);
    expect(game.viewFor!(p1).zones?.[opponentId]?.exile?.[0]?.name).toBeUndefined();
    expect(getCastableSpellCandidates(ctx, p1, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).some((entry: any) => String(entry?.card?.id || '') === cardId)).toBe(false);

    (game.state as any).battlefield = [{
      id: 'shared_fate_2',
      controller: p1,
      card: {
        name: 'Shared Fate',
        type_line: 'Enchantment',
        oracle_text: SHARED_FATE_ORACLE,
      },
    }];
    expect(getCastableSpellCandidates(ctx, p1, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).some((entry: any) => String(entry?.card?.id || '') === cardId)).toBe(false);
    expect(game.viewFor!(p1).zones?.[opponentId]?.exile?.[0]?.known).toBe(false);
  });
});
