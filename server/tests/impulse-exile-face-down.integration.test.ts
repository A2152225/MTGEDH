import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { canAct, canRespond, getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';

describe('impulse exile face-down integration', () => {
  const gontiEffect =
    "look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.";

  const grimoireEffect =
    "exile the top three cards of target opponent's library face down.";

  function setupTwoPlayerGame(gameId: string) {
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).turnNumber = 3;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 2, red: 0, green: 0, colorless: 0 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 1 },
    };

    const opponentLibrary = [
      {
        id: 'gonti_opponent_top_1',
        name: 'Lightning Bolt',
        type_line: 'Instant',
        mana_cost: '{R}',
        colors: ['R'],
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        zone: 'library',
      },
    ];
    (game.state as any).zones[p2].library = opponentLibrary.map((card) => ({ ...card }));
    game.libraries.set(p2, opponentLibrary.map((card) => ({ ...card })));

    return { game, p1, p2 };
  }

  it('Gonti-style impulse exile marks face-down play permission with flexible mana and durable timing', () => {
    const { game, p1, p2 } = setupTwoPlayerGame('gonti_impulse_exile_face_down');

    executeTriggerEffect(game as any, p1, 'Gonti, Night Minister', gontiEffect, {
      type: 'triggered_ability',
      controller: p1,
      source: 'gonti_perm',
      permanentId: 'gonti_perm',
      targetPlayer: p2,
      damagedPlayerId: p2,
      id: 'gonti_trigger',
    });

    const opponentZones = (game.state as any).zones?.[p2];
    const exiledCard = (opponentZones?.exile || []).find(
      (card: any) => String(card?.id || '') === 'gonti_opponent_top_1',
    );
    expect(exiledCard).toBeDefined();
    expect(exiledCard?.faceDown).toBe(true);
    expect(exiledCard?.canBePlayedBy).toBe(p1);
    expect(exiledCard?.spendManaAsThoughAnyType).toBe(true);
    expect(exiledCard?.playableUntilTurn).toBe(Number.MAX_SAFE_INTEGER);
    expect((game.state as any).playableFromExile?.[p1]?.gonti_opponent_top_1).toBe(Number.MAX_SAFE_INTEGER);

    const ctx = { state: game.state, libraries: game.libraries } as any;
    const exileCandidate = getCastableSpellCandidates(ctx, p1, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'gonti_opponent_top_1');
    expect(exileCandidate).toEqual(expect.objectContaining({
      sourceZone: 'exile',
      castMethod: 'playable_from_exile',
      manaCost: '{R}',
    }));
    expect(canAct(ctx, p1)).toBe(true);
    expect(canRespond(ctx, p1)).toBe(true);

    const controllerView = game.viewFor!(p1);
    const opponentView = game.viewFor!(p2);
    const controllerExile = (controllerView.zones?.[p2]?.exile || []).find(
      (card: any) => String(card?.id || '') === 'gonti_opponent_top_1',
    );
    const opponentExile = (opponentView.zones?.[p2]?.exile || []).find(
      (card: any) => String(card?.id || '') === 'gonti_opponent_top_1',
    );
    expect(controllerExile?.known).toBe(true);
    expect(controllerExile?.name).toBe('Lightning Bolt');
    expect(opponentExile?.known).toBe(false);
    expect(opponentExile?.name).toBeUndefined();
  });

  it('Grimoire Thief-style exile_top marks face-down cards examinable by the caster without play permission', () => {
    const gameId = 'grimoire_thief_face_down_exile';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const libraryCards = ['grimoire_top_1', 'grimoire_top_2', 'grimoire_top_3'].map((id, index) => ({
      id,
      name: `Hidden Card ${index + 1}`,
      type_line: 'Instant',
      mana_cost: '{1}',
      zone: 'library',
    }));
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 3 },
    };
    (game.state as any).zones[p2].library = libraryCards.map((card) => ({ ...card }));
    game.libraries.set(p2, libraryCards.map((card) => ({ ...card })));

    executeTriggerEffect(game as any, p1, 'Grimoire Thief', grimoireEffect, {
      type: 'triggered_ability',
      controller: p1,
      source: 'grimoire_perm',
      permanentId: 'grimoire_perm',
      targets: [p2],
      targetPlayer: p2,
      id: 'grimoire_trigger',
    });

    const exiled = ((game.state as any).zones?.[p2]?.exile || []) as any[];
    expect(exiled).toHaveLength(3);
    for (const card of exiled) {
      expect(card.faceDown).toBe(true);
      expect(card.canBeExaminedBy).toEqual([p1]);
      expect(card.canBePlayedBy).toBeUndefined();
    }
    expect((game.state as any).playableFromExile?.[p1]).toBeUndefined();

    const ctx = { state: game.state, libraries: game.libraries } as any;
    expect(getCastableSpellCandidates(ctx, p1).some((candidate) => candidate.card?.id?.startsWith('grimoire_top_'))).toBe(false);
  });
});
