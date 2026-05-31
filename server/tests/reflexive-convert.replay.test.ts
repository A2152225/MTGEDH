import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('reflexive convert replay semantics', () => {
  it('replays Ratchet conversion and restores its follow-up stack item', () => {
    const game = createInitialGameState('t_reflexive_convert_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const frontOracle = 'Whenever you gain life, you may convert Ratchet. When you do, return target artifact card with mana value less than or equal to the amount of life you gained this turn from your graveyard to the battlefield tapped.';
    const backOracle = 'Living metal. Whenever one or more nontoken artifacts you control are put into a graveyard from the battlefield, convert Ratchet.';

    (game.state as any).battlefield = [
      {
        id: 'ratchet_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        transformed: false,
        counters: {},
        card: {
          id: 'ratchet_card',
          name: 'Ratchet, Field Medic',
          layout: 'transform',
          type_line: 'Legendary Artifact Creature - Robot',
          oracle_text: frontOracle,
          power: '2',
          toughness: '4',
          card_faces: [
            {
              name: 'Ratchet, Field Medic',
              type_line: 'Legendary Artifact Creature - Robot',
              oracle_text: frontOracle,
              power: '2',
              toughness: '4',
            },
            {
              name: 'Ratchet, Rescue Racer',
              type_line: 'Legendary Artifact - Vehicle',
              oracle_text: backOracle,
              power: '1',
              toughness: '4',
            },
          ],
        },
      },
    ];
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'reflexiveConvertResolve',
      playerId: p1,
      sourceId: 'ratchet_perm',
      sourceName: 'Ratchet, Field Medic',
      converted: true,
      fromFaceIndex: 0,
      faceIndex: 1,
      triggerId: 'trigger_reflexive_convert_1',
    } as any);

    const ratchet = ((game.state as any).battlefield || [])[0];
    expect(ratchet.transformed).toBe(true);
    expect(ratchet.card.name).toBe('Ratchet, Rescue Racer');
    expect(ratchet.card.type_line).toBe('Legendary Artifact - Vehicle');

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'trigger_reflexive_convert_1',
      sourceId: 'ratchet_perm',
      permanentId: 'ratchet_perm',
      sourceName: 'Ratchet, Field Medic',
      controllerId: p1,
      description: 'return target artifact card with mana value less than or equal to the amount of life you gained this turn from your graveyard to the battlefield tapped',
      effect: 'return target artifact card with mana value less than or equal to the amount of life you gained this turn from your graveyard to the battlefield tapped',
      triggerType: 'reflexive_convert',
      mandatory: true,
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      targetGraveyardScope: 'your',
      targetFilterTypes: ['artifact'],
      targetFilterMaxManaValue: 3,
      battlefieldTapped: true,
      sourcePermanentSnapshot: {
        id: 'ratchet_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Ratchet, Field Medic',
          type_line: 'Legendary Artifact Creature - Robot',
          oracle_text: frontOracle,
        },
      },
      effectData: {
        converted: true,
        convertedFromFaceIndex: 0,
        convertedToFaceIndex: 1,
      },
    } as any);

    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      id: 'trigger_reflexive_convert_1',
      source: 'ratchet_perm',
      permanentId: 'ratchet_perm',
      sourceName: 'Ratchet, Field Medic',
      triggerType: 'reflexive_convert',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      targetFilterTypes: ['artifact'],
      targetFilterMaxManaValue: 3,
      battlefieldTapped: true,
      sourcePermanentSnapshot: {
        id: 'ratchet_perm',
        controller: p1,
        owner: p1,
        card: { name: 'Ratchet, Field Medic' },
      },
    });
  });
});
