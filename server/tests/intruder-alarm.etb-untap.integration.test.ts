import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { detectETBTriggers } from '../src/state/modules/triggers/etb-detection.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const INTRUDER_ALARM_ORACLE =
  "Creatures don't untap during their controllers' untap steps.\nWhenever a creature enters, untap all creatures.";

function seedGame(gameId: string) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
  return { game, p1, p2 };
}

function battlefieldPermanent(
  id: string,
  controller: string,
  card: Record<string, unknown>,
  extras: Record<string, unknown> = {},
) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: { id: `${id}_card`, ...card },
    ...extras,
  };
}

describe('Intruder Alarm creature ETB untap', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('detects a creature_etb that is not restricted to creatures you control', () => {
    const triggers = detectETBTriggers(
      {
        name: 'Intruder Alarm',
        type_line: 'Enchantment',
        oracle_text: INTRUDER_ALARM_ORACLE,
      },
      { id: 'alarm_1', controller: 'p1' },
    );
    const creatureEtb = triggers.filter((trigger) => trigger.triggerType === 'creature_etb');
    expect(creatureEtb).toHaveLength(1);
    expect(creatureEtb[0]?.controlledOnly).toBeFalsy();
    expect(String(creatureEtb[0]?.effect || creatureEtb[0]?.description || '')).toMatch(/untap all creatures/i);
  });

  it('queues when an opponent creature enters', () => {
    const { game, p1, p2 } = seedGame('intruder_alarm_queue_opponent_etb');
    const alarm = battlefieldPermanent('alarm_1', p1, {
      name: 'Intruder Alarm',
      type_line: 'Enchantment',
      oracle_text: INTRUDER_ALARM_ORACLE,
    });
    const entering = battlefieldPermanent('opp_bear', p2, {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    });
    (game.state as any).battlefield = [alarm, entering];
    (game.state as any).stack = [];

    triggerETBEffectsForPermanent(game as any, entering, p2, true);

    const queued = ((game.state as any).stack || []).filter(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Intruder Alarm',
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]?.controller).toBe(p1);
    expect(queued[0]?.interveningIfSubjectPermanentId).toBe('opp_bear');
    expect(String(queued[0]?.effect || queued[0]?.description || '')).toMatch(/untap all creatures/i);
  });

  it.each([
    ['1', 'IR primary'],
    ['0', 'legacy preface'],
  ])('untaps your tapped creature when an opponent creature enters (%s %s)', (primaryFlag) => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = primaryFlag;
    const { game, p1, p2 } = seedGame(`intruder_alarm_untap_${primaryFlag}`);
    (game.state as any).battlefield = [
      battlefieldPermanent('alarm_1', p1, {
        name: 'Intruder Alarm',
        type_line: 'Enchantment',
        oracle_text: INTRUDER_ALARM_ORACLE,
      }),
      battlefieldPermanent(
        'my_tapped',
        p1,
        {
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
          power: '1',
          toughness: '1',
        },
        { tapped: true },
      ),
      battlefieldPermanent(
        'opp_tapped',
        p2,
        {
          name: 'Goblin Piker',
          type_line: 'Creature — Goblin Warrior',
          oracle_text: '',
          power: '2',
          toughness: '1',
        },
        { tapped: true },
      ),
      battlefieldPermanent(
        'my_land',
        p1,
        { name: 'Forest', type_line: 'Basic Land — Forest' },
        { tapped: true },
      ),
      battlefieldPermanent('opp_bear', p2, {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
      }),
    ];

    ResolutionQueueManager.removeQueue(`intruder_alarm_untap_${primaryFlag}`);

    executeTriggerEffect(game as any, p1, 'Intruder Alarm', 'untap all creatures', {
      type: 'triggered_ability',
      controller: p1,
      source: 'alarm_1',
      sourceId: 'alarm_1',
      id: 'alarm_trigger',
      effect: 'untap all creatures',
      description: 'untap all creatures',
      triggerType: 'creature_etb',
      interveningIfSubjectPermanentId: 'opp_bear',
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(Boolean(battlefield.find((perm: any) => perm.id === 'my_tapped')?.tapped)).toBe(false);
    expect(Boolean(battlefield.find((perm: any) => perm.id === 'opp_tapped')?.tapped)).toBe(false);
    expect(Boolean(battlefield.find((perm: any) => perm.id === 'my_land')?.tapped)).toBe(true);
  });
});
