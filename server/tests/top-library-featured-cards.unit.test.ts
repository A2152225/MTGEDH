import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import {
  canCastFromTop,
  canLookAtTopOfLibrary,
  canPlayLandsFromTop,
  getLibraryTopCardFromState,
} from '../src/state/modules/game-state-effects.js';
import { getManaAbilitiesForPermanent } from '../src/state/modules/mana-abilities.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import { calculateAllPTBonusesWithSources } from '../src/state/utils.js';

describe('featured top-of-library cards', () => {
  const p1 = 'p1' as PlayerID;

  function setupBaseGame(library: any[], battlefield: any[]) {
    const game = createInitialGameState('top_library_featured_cards_test');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).turnNumber = 4;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = battlefield;
    game.libraries.set(p1, library.map((card) => ({ ...card })));
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: library.map((card) => ({ ...card })),
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: library.length,
      },
    };

    return game;
  }

  it('Emperor Mihail II allows casting Merfolk spells but not other spells from the top', () => {
    const mihailOracle =
      'You may look at the top card of your library any time.\n'
      + 'You may cast Merfolk spells from the top of your library.\n'
      + 'Whenever you cast a Merfolk spell, you may pay {1}. If you do, create a 1/1 blue Merfolk creature token.';

    const game = setupBaseGame(
      [
        {
          id: 'top_merfolk',
          name: 'Merfolk Looter',
          type_line: 'Creature — Merfolk Rogue',
          mana_cost: '{1}{U}',
          colors: ['U'],
        },
        {
          id: 'second_card',
          name: 'Cancel',
          type_line: 'Instant',
          mana_cost: '{1}{U}{U}',
          colors: ['U'],
        },
      ],
      [{
        id: 'mihail_perm',
        controller: p1,
        owner: p1,
        card: {
          id: 'mihail_card',
          name: 'Emperor Mihail II',
          type_line: 'Legendary Creature — Merfolk Noble',
          oracle_text: mihailOracle,
        },
      }],
    );

    const ctx = game as any;
    expect(canLookAtTopOfLibrary(ctx, p1).sources).toContain('Emperor Mihail II');

    const merfolkPermission = canCastFromTop(ctx, p1, {
      type_line: 'Creature — Merfolk Rogue',
      colors: ['U'],
    });
    expect(merfolkPermission.canCast).toBe(true);

    const instantPermission = canCastFromTop(ctx, p1, {
      type_line: 'Instant',
      colors: ['U'],
    });
    expect(instantPermission.canCast).toBe(false);

    const candidates = getCastableSpellCandidates(ctx, p1, { mode: 'main' });
    expect(candidates.some((entry) => entry.sourceZone === 'library' && entry.castCard?.name === 'Merfolk Looter')).toBe(true);
    expect(candidates.some((entry) => entry.sourceZone === 'library' && entry.castCard?.name === 'Cancel')).toBe(false);

    const triggers = detectSpellCastTriggers(
      (game.state as any).battlefield[0].card,
      (game.state as any).battlefield[0],
    );
    expect(triggers.some((trigger) =>
      trigger.tribalType === 'merfolk'
      && trigger.createsToken === true
      && trigger.mandatory === false,
    )).toBe(true);
  });

  it('Oracle of Mul Daya allows playing lands from the top and reveals the top card', () => {
    const oracleText =
      'You may play an additional land on each of your turns.\n'
      + 'Play with the top card of your library revealed.\n'
      + 'You may play lands from the top of your library.';

    const game = setupBaseGame(
      [{
        id: 'top_forest',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.',
      }],
      [{
        id: 'oracle_perm',
        controller: p1,
        owner: p1,
        card: {
          id: 'oracle_card',
          name: 'Oracle of Mul Daya',
          type_line: 'Creature — Elf Shaman',
          oracle_text: oracleText,
        },
      }],
    );

    const ctx = game as any;
    expect(canLookAtTopOfLibrary(ctx, p1).canLook).toBe(true);
    expect(canPlayLandsFromTop(ctx, p1, { type_line: 'Basic Land — Forest' }).canPlay).toBe(true);

    const view = game.viewFor!(p1);
    expect(view.zones?.[p1]?.libraryTop?.name).toBe('Forest');
  });

  it('Realmwalker allows casting matching creature spells but not other spells from the top', () => {
    const realmwalkerOracle =
      'As this creature enters, choose a creature type.\n'
      + 'You may look at the top card of your library any time.\n'
      + 'You may cast creature spells of the chosen type from the top of your library.';

    const game = setupBaseGame(
      [
        {
          id: 'top_elf',
          name: 'Elvish Mystic',
          type_line: 'Creature — Elf Druid',
          mana_cost: '{G}',
          colors: ['G'],
        },
        {
          id: 'second_cancel',
          name: 'Cancel',
          type_line: 'Instant',
          mana_cost: '{1}{U}{U}',
          colors: ['U'],
        },
      ],
      [{
        id: 'realmwalker_perm',
        controller: p1,
        owner: p1,
        chosenCreatureType: 'Elf',
        card: {
          id: 'realmwalker_card',
          name: 'Realmwalker',
          type_line: 'Creature — Elf Shaman',
          oracle_text: realmwalkerOracle,
        },
      }],
    );

    const ctx = game as any;
    (ctx.state as any).manaPool[p1].green = 5;
    expect(canLookAtTopOfLibrary(ctx, p1).sources).toContain('Realmwalker');
    expect(canCastFromTop(ctx, p1, { type_line: 'Creature — Elf Druid', colors: ['G'] }).canCast).toBe(true);
    expect(canCastFromTop(ctx, p1, { type_line: 'Instant', colors: ['U'] }).canCast).toBe(false);

    const candidates = getCastableSpellCandidates(ctx, p1, { mode: 'main' });
    expect(candidates.some((entry) => entry.sourceZone === 'library' && entry.castCard?.name === 'Elvish Mystic')).toBe(true);
    expect(candidates.some((entry) => entry.sourceZone === 'library' && entry.castCard?.name === 'Cancel')).toBe(false);
  });

  it('Ulvenwald Channelers gains +3/+3 when the top card is a creature and taps for two mana when it is a land', () => {
    const channelersOracle =
      'Play with the top card of your library revealed.\n'
      + 'As long as the top card of your library is a creature card, this creature gets +3/+3.\n'
      + 'As long as the top card of your library is a land card, this creature has "{T}: Add two mana of any one color."';

    const channelersPermanent = {
      id: 'channelers_perm',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'channelers_card',
        name: 'Ulvenwald Channelers',
        type_line: 'Creature — Elf Druid Shaman',
        power: '2',
        toughness: '2',
        oracle_text: channelersOracle,
      },
    };

    const creatureTopGame = setupBaseGame(
      [{
        id: 'top_bear',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        power: '2',
        toughness: '2',
      }],
      [channelersPermanent],
    );

    const creatureBonuses = calculateAllPTBonusesWithSources(
      channelersPermanent,
      creatureTopGame.state,
    );
    expect(creatureBonuses.power).toBe(3);
    expect(creatureBonuses.toughness).toBe(3);

    const landTopGame = setupBaseGame(
      [{
        id: 'top_island',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '{T}: Add {U}.',
      }],
      [channelersPermanent],
    );

    const landBonuses = calculateAllPTBonusesWithSources(
      channelersPermanent,
      landTopGame.state,
    );
    expect(landBonuses.power).toBe(0);
    expect(landBonuses.toughness).toBe(0);

    const manaAbilities = getManaAbilitiesForPermanent(
      landTopGame.state,
      channelersPermanent,
      p1,
    );
    const conditionalAbility = manaAbilities.find((ability) => ability.id === 'top_land_conditional_any_color');
    expect(conditionalAbility).toBeDefined();
    expect(conditionalAbility?.amount).toBe(2);
    expect(conditionalAbility?.produces).toEqual(expect.arrayContaining(['W', 'U', 'B', 'R', 'G']));

    expect(getLibraryTopCardFromState(creatureTopGame.state, p1)?.name).toBe('Grizzly Bears');
    expect(getLibraryTopCardFromState(landTopGame.state, p1)?.name).toBe('Island');
  });
});
