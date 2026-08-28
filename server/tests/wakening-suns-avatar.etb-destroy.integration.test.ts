import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { detectETBTriggers } from '../src/state/modules/triggers/etb-detection.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const AVATAR_ORACLE =
  'When this creature enters, if you cast it from your hand, destroy all non-Dinosaur creatures.';

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

describe("Wakening Sun's Avatar ETB destroy", () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('parses the isolated ETB effect as a cast-from-hand conditional destroy', () => {
    const steps = collectOracleEffectSteps(
      'if you cast it from your hand, destroy all non-Dinosaur creatures',
      "Wakening Sun's Avatar",
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe('conditional');
    const inner = (steps[0] as { steps?: Array<{ kind?: string; target?: { text?: string } }> })?.steps || [];
    expect(inner[0]?.kind).toBe('destroy');
    expect(String(inner[0]?.target?.text || '')).toMatch(/all non-dinosaur creatures/i);
  });

  it('detects a self-ETB whose effect destroys non-Dinosaur creatures', () => {
    const triggers = detectETBTriggers(
      {
        name: "Wakening Sun's Avatar",
        type_line: 'Creature — Dinosaur Avatar',
        oracle_text: AVATAR_ORACLE,
      },
      { id: 'avatar_1', controller: 'p1' },
    );
    const selfEtb = triggers.filter((trigger) => trigger.triggerType === 'etb');
    expect(selfEtb).toHaveLength(1);
    expect(String(selfEtb[0]?.effect || selfEtb[0]?.description || '')).toMatch(
      /if you cast it from your hand,\s*destroy all non-dinosaur creatures/i,
    );
  });

  it('queues when the Avatar enters after being cast from hand', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const game = createInitialGameState('wakening_sun_queue');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    const avatar = battlefieldPermanent(
      'avatar_1',
      p1,
      {
        name: "Wakening Sun's Avatar",
        type_line: 'Creature — Dinosaur Avatar',
        oracle_text: AVATAR_ORACLE,
        power: '7',
        toughness: '7',
      },
      { castFromHand: true, castSourceZone: 'hand', enteredFromCast: true },
    );
    (game.state as any).battlefield = [avatar];
    (game.state as any).stack = [];

    triggerETBEffectsForPermanent(game as any, avatar, p1, true);

    const queued = ((game.state as any).stack || []).filter(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === "Wakening Sun's Avatar",
    );
    expect(queued).toHaveLength(1);
    expect(String(queued[0]?.effect || queued[0]?.description || '')).toMatch(/destroy all non-dinosaur creatures/i);
  });

  it('does not queue when the Avatar was not cast from hand', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const game = createInitialGameState('wakening_sun_queue_not_hand');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    const avatar = battlefieldPermanent(
      'avatar_1',
      p1,
      {
        name: "Wakening Sun's Avatar",
        type_line: 'Creature — Dinosaur Avatar',
        oracle_text: AVATAR_ORACLE,
        power: '7',
        toughness: '7',
      },
      { castFromHand: false, castSourceZone: 'graveyard', enteredFromCast: false },
    );
    (game.state as any).battlefield = [avatar];
    (game.state as any).stack = [];

    triggerETBEffectsForPermanent(game as any, avatar, p1, true);

    const queued = ((game.state as any).stack || []).filter(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === "Wakening Sun's Avatar",
    );
    expect(queued).toHaveLength(0);
  });

  it('destroys non-Dinosaur creatures and leaves Dinosaurs when cast from hand', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 'wakening_sun_destroy';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const avatar = battlefieldPermanent(
      'avatar_1',
      p1,
      {
        name: "Wakening Sun's Avatar",
        type_line: 'Creature — Dinosaur Avatar',
        oracle_text: AVATAR_ORACLE,
        power: '7',
        toughness: '7',
      },
      { castFromHand: true, castSourceZone: 'hand', enteredFromCast: true },
    );
    (game.state as any).battlefield = [
      avatar,
      battlefieldPermanent('my_elf', p1, {
        name: 'Llanowar Elves',
        type_line: 'Creature — Elf Druid',
        power: '1',
        toughness: '1',
      }),
      battlefieldPermanent('opp_bear', p2, {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        power: '2',
        toughness: '2',
      }),
      battlefieldPermanent('opp_dino', p2, {
        name: 'Ranging Raptors',
        type_line: 'Creature — Dinosaur',
        power: '2',
        toughness: '3',
      }),
    ];
    (game.state as any).zones = {
      [p1]: { graveyard: [], graveyardCount: 0 },
      [p2]: { graveyard: [], graveyardCount: 0 },
    };

    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      game as any,
      p1,
      "Wakening Sun's Avatar",
      'if you cast it from your hand, destroy all non-Dinosaur creatures',
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'avatar_1',
        sourceId: 'avatar_1',
        id: 'avatar_trigger',
        effect: 'if you cast it from your hand, destroy all non-Dinosaur creatures',
        description: 'if you cast it from your hand, destroy all non-Dinosaur creatures',
        triggerType: 'etb',
      },
    );

    const battlefield = ((game.state as any).battlefield || []) as Array<{ id?: string }>;
    const ids = battlefield.map((perm) => String(perm.id || ''));
    expect(ids.sort()).toEqual(['avatar_1', 'opp_dino']);

    const p1Gy = ((game.state as any).zones?.[p1]?.graveyard || []) as Array<{ name?: string }>;
    const p2Gy = ((game.state as any).zones?.[p2]?.graveyard || []) as Array<{ name?: string }>;
    const gyNames = [...p1Gy, ...p2Gy].map((card) => String(card.name || '')).sort();
    expect(gyNames).toEqual(['Grizzly Bears', 'Llanowar Elves']);
  });

  it('does not destroy when the Avatar was not cast from hand', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 'wakening_sun_not_from_hand';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const avatar = battlefieldPermanent(
      'avatar_1',
      p1,
      {
        name: "Wakening Sun's Avatar",
        type_line: 'Creature — Dinosaur Avatar',
        oracle_text: AVATAR_ORACLE,
        power: '7',
        toughness: '7',
      },
      { castFromHand: false, castSourceZone: 'graveyard', enteredFromCast: false },
    );
    (game.state as any).battlefield = [
      avatar,
      battlefieldPermanent('opp_bear', p2, {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        power: '2',
        toughness: '2',
      }),
    ];
    (game.state as any).zones = {
      [p1]: { graveyard: [], graveyardCount: 0 },
      [p2]: { graveyard: [], graveyardCount: 0 },
    };

    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      game as any,
      p1,
      "Wakening Sun's Avatar",
      'if you cast it from your hand, destroy all non-Dinosaur creatures',
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'avatar_1',
        sourceId: 'avatar_1',
        id: 'avatar_trigger',
        effect: 'if you cast it from your hand, destroy all non-Dinosaur creatures',
        description: 'if you cast it from your hand, destroy all non-Dinosaur creatures',
        triggerType: 'etb',
      },
    );

    const battlefield = ((game.state as any).battlefield || []) as Array<{ id?: string }>;
    expect(battlefield.map((perm) => String(perm.id || '')).sort()).toEqual(['avatar_1', 'opp_bear']);
  });
});
