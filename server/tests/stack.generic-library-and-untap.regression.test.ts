import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('generic stack resolution regressions', () => {
  const gameId = 'stack_generic_library_and_untap_regression';
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('filters mana value 6 or greater library searches for Fierce Empath style triggers', () => {
    const ctx: any = {
      gameId,
      state: {
        players: [{ id: playerId }, { id: opponentId }],
        startingLife: 40,
        life: { [playerId]: 40, [opponentId]: 40 },
        battlefield: [],
        zones: {
          [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
          [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
        },
      },
      libraries: new Map([
        [playerId, [
          {
            id: 'small_creature',
            name: 'Elvish Mystic',
            type_line: 'Creature — Elf Druid',
            oracle_text: '',
            cmc: 1,
          },
          {
            id: 'big_creature',
            name: 'Ancient Brontodon',
            type_line: 'Creature — Dinosaur',
            oracle_text: '',
            cmc: 8,
          },
        ]],
      ]),
    };

    executeTriggerEffect(
      ctx,
      playerId,
      'Fierce Empath',
      'search your library for a creature card with mana value 6 or greater, reveal it, put it into your hand, then shuffle.',
      { sourceName: 'Fierce Empath' }
    );

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((entry: any) => entry?.sourceName === 'Fierce Empath') as any;
    expect(step).toBeDefined();
    expect(step.destination).toBe('hand');
    expect(step.availableCards).toHaveLength(1);
    expect(step.availableCards[0]?.id).toBe('big_creature');
  });

  it('untaps only the controller lands for Bear Umbra style attack triggers', () => {
    const ctx: any = {
      gameId,
      state: {
        players: [{ id: playerId }, { id: opponentId }],
        startingLife: 40,
        life: { [playerId]: 40, [opponentId]: 40 },
        battlefield: [
          {
            id: 'forest_1',
            controller: playerId,
            tapped: true,
            card: { name: 'Forest', type_line: 'Basic Land — Forest' },
          },
          {
            id: 'bear_umbra_target',
            controller: playerId,
            tapped: true,
            card: { name: 'Runeclaw Bear', type_line: 'Creature — Bear' },
          },
          {
            id: 'opponent_forest',
            controller: opponentId,
            tapped: true,
            card: { name: 'Forest', type_line: 'Basic Land — Forest' },
          },
        ],
        zones: {
          [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
          [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
        },
      },
      libraries: new Map(),
    };

    executeTriggerEffect(ctx, playerId, 'Bear Umbra', 'untap all lands you control.', { sourceName: 'Bear Umbra' });

    const battlefield = ctx.state.battlefield as any[];
    expect(battlefield.find((perm) => perm.id === 'forest_1')?.tapped).toBe(false);
    expect(battlefield.find((perm) => perm.id === 'bear_umbra_target')?.tapped).toBe(true);
    expect(battlefield.find((perm) => perm.id === 'opponent_forest')?.tapped).toBe(true);
  });

  it('queues a top-library selection for Loot style activated abilities', () => {
    const ctx: any = {
      gameId,
      state: {
        players: [{ id: playerId }, { id: opponentId }],
        startingLife: 40,
        life: { [playerId]: 40, [opponentId]: 40 },
        battlefield: [
          { id: 'land_1', controller: playerId, tapped: false, card: { name: 'Forest', type_line: 'Basic Land — Forest' } },
          { id: 'land_2', controller: playerId, tapped: false, card: { name: 'Forest', type_line: 'Basic Land — Forest' } },
          { id: 'land_3', controller: playerId, tapped: false, card: { name: 'Forest', type_line: 'Basic Land — Forest' } },
          { id: 'land_4', controller: playerId, tapped: false, card: { name: 'Forest', type_line: 'Basic Land — Forest' } },
        ],
        zones: {
          [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
          [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
        },
      },
      libraries: new Map([
        [playerId, [
          { id: 'eligible_creature', name: 'Craw Wurm', type_line: 'Creature — Wurm', cmc: 4, oracle_text: '', image_uris: { normal: 'wurm.png' } },
          { id: 'too_big_creature', name: 'Ancient Brontodon', type_line: 'Creature — Dinosaur', cmc: 8, oracle_text: '', image_uris: { normal: 'brontodon.png' } },
          { id: 'land_card', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, oracle_text: '', image_uris: { normal: 'forest.png' } },
          { id: 'instant_card', name: 'Giant Growth', type_line: 'Instant', cmc: 1, oracle_text: '', image_uris: { normal: 'growth.png' } },
          { id: 'artifact_card', name: 'Sol Ring', type_line: 'Artifact', cmc: 1, oracle_text: '', image_uris: { normal: 'ring.png' } },
          { id: 'second_land', name: 'Mosswort Bridge', type_line: 'Land', cmc: 0, oracle_text: '', image_uris: { normal: 'bridge.png' } },
        ]],
      ]),
    };

    executeTriggerEffect(
      ctx,
      playerId,
      'Loot, Exuberant Explorer',
      'look at the top six cards of your library. you may reveal a creature card with mana value less than or equal to the number of lands you control from among them and put it onto the battlefield. put the rest on the bottom in a random order.',
      { sourceName: 'Loot, Exuberant Explorer' }
    );

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((entry: any) => entry?.sourceName === 'Loot, Exuberant Explorer') as any;
    expect(step).toBeDefined();
    expect(step.destination).toBe('battlefield');
    expect(step.maxSelections).toBe(1);
    expect(step.availableCards).toHaveLength(1);
    expect(step.availableCards[0]?.id).toBe('eligible_creature');
    expect(step.nonSelectableCards).toHaveLength(5);
    expect(step.remainderDestination).toBe('bottom');
    expect(step.remainderRandomOrder).toBe(true);
  });

  it('grants firebending without front-loading reminder-text mana', () => {
    const ctx: any = {
      gameId,
      state: {
        players: [{ id: playerId }, { id: opponentId }],
        startingLife: 40,
        life: { [playerId]: 40, [opponentId]: 40 },
        battlefield: [
          {
            id: 'target_creature',
            controller: playerId,
            owner: playerId,
            tapped: false,
            temporaryAbilities: [],
            card: {
              name: 'Runeclaw Bear',
              type_line: 'Creature — Bear',
              oracle_text: '',
              power: '2',
              toughness: '2',
            },
          },
        ],
        manaPool: {
          [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
        zones: {
          [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
          [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
        },
      },
      libraries: new Map(),
    };

    executeTriggerEffect(
      ctx,
      playerId,
      'Fire Nation Palace',
      'target creature you control gains firebending 4 until end of turn. (whenever it attacks, add {r}{r}{r}{r}. this mana lasts until end of combat.)',
      {
        sourceName: 'Fire Nation Palace',
        targets: ['target_creature'],
      }
    );

    const targetCreature = (ctx.state.battlefield as any[]).find((perm) => perm.id === 'target_creature');
    expect(ctx.state.manaPool[playerId].red).toBe(0);
    expect(Array.isArray(targetCreature?.temporaryAbilities)).toBe(true);
    expect(targetCreature?.temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ability: 'firebending 4', source: 'Fire Nation Palace', expiresAt: 'end_of_turn' }),
      ])
    );
  });

  it('stacks native and granted firebending attack triggers', () => {
    const ozai: any = {
      id: 'ozai_perm',
      controller: playerId,
      owner: playerId,
      tapped: false,
      temporaryAbilities: [
        {
          ability: 'firebending 4',
          source: 'Fire Nation Palace',
          expiresAt: 'end_of_turn',
          turnApplied: 1,
        },
      ],
      card: {
        id: 'ozai_card',
        name: 'Ozai, the Phoenix King',
        type_line: 'Legendary Creature — Human Noble',
        oracle_text: 'Trample, firebending 4, haste\nIf you would lose unspent mana, that mana becomes red instead.\nOzai has flying and indestructible as long as you have six or more unspent mana.',
        power: '7',
        toughness: '7',
      },
    };

    const ctx: any = {
      state: {
        battlefield: [ozai],
        players: [{ id: playerId }, { id: opponentId }],
      },
    };

    const firebendingTriggers = getAttackTriggersForCreatures(ctx, [ozai], playerId, opponentId)
      .filter((trigger: any) => trigger?.triggerType === 'firebending');

    expect(firebendingTriggers).toHaveLength(2);
    expect(firebendingTriggers.map((trigger: any) => trigger.value)).toEqual([4, 4]);
  });
});