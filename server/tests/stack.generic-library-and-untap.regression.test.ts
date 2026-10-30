import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('generic stack resolution regressions', () => {
  const gameId = 'stack_generic_library_and_untap_regression';
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  describe('library search via oracle IR', () => {
    beforeEach(() => {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
      delete process.env.ORACLE_IR_TRIGGER_LEGACY;
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
          {
            id: 'medium_creature',
            name: 'Colossal Dreadmaw',
            type_line: 'Creature — Dinosaur',
            oracle_text: '',
            cmc: 6,
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
    expect(step.availableCards).toHaveLength(2);
    expect(step.availableCards.map((card: any) => card.id).sort()).toEqual(['big_creature', 'medium_creature']);
  });

  it('filters optional Fierce Empath ETB searches with you may prefix', () => {
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
          {
            id: 'medium_creature',
            name: 'Colossal Dreadmaw',
            type_line: 'Creature — Dinosaur',
            oracle_text: '',
            cmc: 6,
          },
        ]],
      ]),
    };

    executeTriggerEffect(
      ctx,
      playerId,
      'Fierce Empath',
      'you may search your library for a creature card with mana value 6 or greater, reveal it, put it into your hand, then shuffle.',
      { sourceName: 'Fierce Empath' },
    );

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((entry: any) => entry?.sourceName === 'Fierce Empath') as any;
    expect(step).toBeDefined();
    expect(step.destination).toBe('hand');
    expect(step.mandatory).toBe(false);
    expect(step.filter).toEqual(expect.objectContaining({ minCmc: 6, types: ['creature'] }));
    expect(step.availableCards).toHaveLength(2);
    expect(step.availableCards.map((card: any) => card.id).sort()).toEqual(['big_creature', 'medium_creature']);
  });
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
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
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
    expect(step.availableCards).toHaveLength(6);
    expect(step.availableCards.map((card: any) => card.id)).toContain('eligible_creature');
    expect(step.nonSelectableCards).toHaveLength(5);
    expect(step.nonSelectableCards.map((card: any) => card.id)).not.toContain('eligible_creature');
    expect(step.remainderDestination).toBe('bottom');
    expect(step.remainderRandomOrder).toBe(true);
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
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

  it('grants palace firebending only to the chosen attacker, and later spells do not copy it', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    try {
    const palaceText = 'target creature you control gains firebending 4 until end of turn. (whenever it attacks, add {r}{r}{r}{r}. this mana lasts until end of combat.)';
    const library = [
      { id: 'c1', name: 'Mountain' },
      { id: 'c2', name: 'Mountain' },
      { id: 'c3', name: 'Mountain' },
      { id: 'c4', name: 'Mountain' },
    ];
    const emptyPool = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    const baeloth: any = {
      id: 'baeloth',
      controller: playerId,
      owner: playerId,
      tapped: false,
      temporaryAbilities: [],
      temporaryEffects: [],
      card: {
        name: 'Baeloth Barrityl, Entertainer',
        type_line: 'Legendary Creature — Elf Shaman',
        oracle_text: 'Choose a Background',
        power: '2',
        toughness: '5',
      },
    };
    const ozai: any = {
      id: 'ozai',
      controller: playerId,
      owner: playerId,
      tapped: false,
      temporaryAbilities: [],
      temporaryEffects: [],
      card: {
        name: 'Ozai, the Phoenix King',
        type_line: 'Legendary Creature — Human Noble',
        oracle_text: 'Trample, firebending 4, haste\nIf you would lose unspent mana, that mana becomes red instead.\nOzai has flying and indestructible as long as you have six or more unspent mana.',
        power: '7',
        toughness: '7',
      },
    };
    const ctx: any = {
      gameId,
      state: {
        turnNumber: 41,
        players: [{ id: playerId }, { id: opponentId }],
        startingLife: 40,
        life: { [playerId]: 40, [opponentId]: 40 },
        battlefield: [baeloth, ozai],
        manaPool: { [playerId]: { ...emptyPool } },
        zones: {
          [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: library },
          [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [] },
        },
      },
      libraries: new Map([[playerId, library.slice()]]),
    };

    executeTriggerEffect(ctx, playerId, 'Fire Nation Palace', palaceText, {
      sourceName: 'Fire Nation Palace',
      targets: ['baeloth'],
    });

    const firebendingOn = (id: string) =>
      ((ctx.state.battlefield as any[]).find((perm) => perm.id === id)?.temporaryAbilities || [])
        .filter((entry: any) => /firebending\s+4/i.test(String(entry?.ability || '')));

    expect(firebendingOn('baeloth')).toEqual([
      expect.objectContaining({ ability: 'firebending 4', source: 'Fire Nation Palace' }),
    ]);
    expect(firebendingOn('ozai')).toEqual([]);

    executeTriggerEffect(ctx, playerId, 'Kozilek, Butcher of Truth', 'draw four cards', {
      sourceName: 'Kozilek, Butcher of Truth',
      targets: [],
    });

    expect(firebendingOn('baeloth')).toEqual([
      expect.objectContaining({ ability: 'firebending 4', source: 'Fire Nation Palace' }),
    ]);
    expect(firebendingOn('ozai')).toEqual([]);

    const attackers = (ctx.state.battlefield as any[]).filter((perm) => perm.id === 'baeloth' || perm.id === 'ozai');
    const firebendingTriggers = getAttackTriggersForCreatures(ctx, attackers, playerId, opponentId)
      .filter((trigger: any) => trigger?.triggerType === 'firebending');
    expect(firebendingTriggers).toHaveLength(2);
    for (const trigger of firebendingTriggers) {
      executeTriggerEffect(ctx, playerId, trigger.cardName, trigger.effect, trigger);
    }
    expect(ctx.state.manaPool[playerId].red).toBe(8);
    } finally {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    }
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
    expect(firebendingTriggers.map((trigger: any) => trigger.value?.amount ?? trigger.value)).toEqual([4, 4]);
  });
});