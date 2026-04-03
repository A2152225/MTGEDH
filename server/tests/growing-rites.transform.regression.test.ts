import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { finalizePlayedLand } from '../src/socket/game-actions.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import { getEndStepTriggers } from '../src/state/modules/triggers/turn-phases.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
  } as any;
}

describe('Growing Rites of Itlimoc regressions', () => {
  const gameId = 'growing_rites_regression';
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

  it('queues its ETB library search from the live library map and preserves the creature filter', () => {
    ResolutionQueueManager.removeQueue(gameId);

    const growingRitesCard = {
      id: 'growing_rites_card',
      name: 'Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun',
      type_line: 'Legendary Enchantment // Legendary Land',
      layout: 'transform',
      card_faces: [
        {
          name: 'Growing Rites of Itlimoc',
          type_line: 'Legendary Enchantment',
          oracle_text: 'When Growing Rites of Itlimoc enters the battlefield, look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.\nAt the beginning of your end step, if you control four or more creatures, transform Growing Rites of Itlimoc.',
        },
        {
          name: 'Itlimoc, Cradle of the Sun',
          type_line: 'Legendary Land',
          oracle_text: '(Transforms from Growing Rites of Itlimoc.)\n{T}: Add {G}.',
        },
      ],
    };

    const game: any = {
      state: {
        zones: {
          [playerId]: {
            hand: [],
            handCount: 0,
            graveyard: [],
            graveyardCount: 0,
            libraryCount: 5,
          },
        },
        battlefield: [
          {
            id: 'growing_rites_perm',
            controller: playerId,
            owner: playerId,
            tapped: false,
            transformed: false,
            card: growingRitesCard,
          },
        ],
      },
      libraries: new Map([
        [playerId, [
          { id: 'creature_1', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', oracle_text: '', image_uris: { normal: 'elves.png' } },
          { id: 'land_1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest.png' } },
          { id: 'creature_2', name: 'Elvish Mystic', type_line: 'Creature — Elf Druid', oracle_text: '', image_uris: { normal: 'mystic.png' } },
          { id: 'instant_1', name: 'Giant Growth', type_line: 'Instant', oracle_text: '', image_uris: { normal: 'growth.png' } },
          { id: 'artifact_1', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '', image_uris: { normal: 'ring.png' } },
        ]],
      ]),
      seq: 0,
      bumpSeq: () => {
        game.seq += 1;
      },
    };

    finalizePlayedLand(createNoopIo(), game, gameId, playerId, 'growing_rites_card', growingRitesCard, 'hand');

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);
    const searchStep = steps.find((step: any) => step?.sourceName === 'Growing Rites of Itlimoc') as any;

    expect(searchStep).toBeDefined();
    expect(searchStep.filter).toEqual({ types: ['creature'] });
    expect(searchStep.availableCards.map((card: any) => card.id)).toEqual([
      'creature_1',
      'land_1',
      'creature_2',
      'instant_1',
    ]);
  });

  it('detects the front-face end-step trigger and transforms on resolution', () => {
    const growingRitesPermanent = {
      id: 'growing_rites_perm',
      controller: playerId,
      owner: playerId,
      tapped: false,
      transformed: false,
      card: {
        id: 'growing_rites_card',
        name: 'Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun',
        type_line: 'Legendary Enchantment // Legendary Land',
        layout: 'transform',
        card_faces: [
          {
            name: 'Growing Rites of Itlimoc',
            type_line: 'Legendary Enchantment',
            oracle_text: 'When Growing Rites of Itlimoc enters the battlefield, look at the top four cards of your library.\nAt the beginning of your end step, if you control four or more creatures, transform Growing Rites of Itlimoc.',
          },
          {
            name: 'Itlimoc, Cradle of the Sun',
            type_line: 'Legendary Land',
            oracle_text: '(Transforms from Growing Rites of Itlimoc.)\n{T}: Add {G} for each creature you control.',
          },
        ],
      },
    };

    const ctx: any = {
      gameId,
      state: {
        players: [{ id: playerId }, { id: opponentId }],
        turnPlayer: playerId,
        phase: 'ending',
        step: 'END',
        startingLife: 40,
        life: { [playerId]: 40, [opponentId]: 40 },
        battlefield: [
          growingRitesPermanent,
          { id: 'creature_1', controller: playerId, card: { name: 'Elf 1', type_line: 'Creature — Elf' } },
          { id: 'creature_2', controller: playerId, card: { name: 'Elf 2', type_line: 'Creature — Elf' } },
          { id: 'creature_3', controller: playerId, card: { name: 'Elf 3', type_line: 'Creature — Elf' } },
          { id: 'creature_4', controller: playerId, card: { name: 'Elf 4', type_line: 'Creature — Elf' } },
        ],
        zones: {
          [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
          [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
        },
      },
      libraries: new Map(),
      bumpSeq: () => undefined,
    };

    const triggers = getEndStepTriggers(ctx, playerId);
    const growingRitesTrigger = triggers.find((trigger: any) => trigger.cardName === 'Growing Rites of Itlimoc');

    expect(growingRitesTrigger).toBeTruthy();
    expect(String(growingRitesTrigger?.description || '').toLowerCase()).toContain('transform growing rites of itlimoc');

    executeTriggerEffect(
      ctx,
      playerId,
      'Growing Rites of Itlimoc',
      String(growingRitesTrigger?.description || ''),
      { sourceName: 'Growing Rites of Itlimoc', permanentId: 'growing_rites_perm' },
    );

    expect(growingRitesPermanent.transformed).toBe(true);
    expect(growingRitesPermanent.card.name).toBe('Itlimoc, Cradle of the Sun');
    expect(growingRitesPermanent.card.type_line).toBe('Legendary Land');
  });
});