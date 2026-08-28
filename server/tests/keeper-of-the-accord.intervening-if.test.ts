import { describe, it, expect } from 'vitest';
import type { GameContext } from '../src/state/context';
import { detectEndStepTriggers, getEndStepTriggers } from '../src/state/modules/triggers/turn-phases.js';

const KEEPER_ORACLE =
  "At the beginning of each opponent's end step, if that player controls more creatures than you, create a 1/1 white Soldier creature token.\nAt the beginning of each opponent's end step, if that player controls more lands than you, you may search your library for a basic Plains card, put it onto the battlefield tapped, then shuffle.";

function perm(id: string, controller: string, card: Record<string, unknown>) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: { id: `${id}_card`, ...card },
  };
}

function creature(id: string, controller: string) {
  return perm(id, controller, { name: 'Creature', type_line: 'Creature', oracle_text: '' });
}

function land(id: string, controller: string) {
  return perm(id, controller, { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' });
}

function keeperPermanent(controller: string) {
  return perm('keeper_1', controller, {
    name: 'Keeper of the Accord',
    type_line: 'Creature — Human Soldier',
    oracle_text: KEEPER_ORACLE,
  });
}

function makeCtx(battlefield: any[]) {
  const state = {
    seq: 1,
    stack: [],
    battlefield,
    players: [{ id: 'p1' }, { id: 'p2' }],
  };
  return { state } as unknown as GameContext;
}

function keeperEffects(triggers: Array<{ effect?: string; description?: string }>): string[] {
  return triggers.map((trigger) => String(trigger.effect || trigger.description || '').toLowerCase());
}

describe('Keeper of the Accord — intervening-if end step', () => {
  it('detects two separate opponent-end-step abilities from oracle text', () => {
    const source = keeperPermanent('p1');
    const detected = detectEndStepTriggers(source.card, source);
    expect(detected).toHaveLength(2);
    expect(detected.every((trigger) => trigger.triggersOnOpponentEndStep)).toBe(true);

    const effects = keeperEffects(detected);
    expect(effects.some((effect) => effect.includes('more creatures than you'))).toBe(true);
    expect(effects.some((effect) => effect.includes('more lands than you'))).toBe(true);
    expect(effects.some((effect) => effect.includes('create a 1/1 white soldier'))).toBe(true);
    expect(effects.join(' ')).not.toMatch(/create a 1\/1 white soldier token if opponent controls more creatures/i);
  });

  it('does not queue on the controller\'s end step', () => {
    const source = keeperPermanent('p1');
    const ctx = makeCtx([
      source,
      creature('p1_c1', 'p1'),
      land('p1_l1', 'p1'),
      creature('p2_c1', 'p2'),
      land('p2_l1', 'p2'),
    ]);
    expect(getEndStepTriggers(ctx, 'p1')).toHaveLength(0);
  });

  it('does not create-soldier when you already control more creatures than that opponent', () => {
    const source = keeperPermanent('p1');
    const ctx = makeCtx([
      source,
      creature('p1_c1', 'p1'),
      creature('p1_c2', 'p1'),
      creature('p1_c3', 'p1'),
      creature('p1_c4', 'p1'),
      creature('p1_c5', 'p1'),
      creature('p2_c1', 'p2'),
      land('p1_l1', 'p1'),
      land('p1_l2', 'p1'),
      land('p2_l1', 'p2'),
      land('p2_l2', 'p2'),
    ]);

    const queued = getEndStepTriggers(ctx, 'p2');
    const effects = keeperEffects(queued);
    expect(effects.some((effect) => effect.includes('more creatures than you'))).toBe(false);
    expect(effects.some((effect) => effect.includes('soldier'))).toBe(false);
  });

  it('queues the soldier ability only when that opponent controls more creatures', () => {
    const source = keeperPermanent('p1');
    const ctx = makeCtx([
      source,
      creature('p2_c1', 'p2'),
      creature('p2_c2', 'p2'),
      creature('p2_c3', 'p2'),
      land('p1_l1', 'p1'),
      land('p2_l1', 'p2'),
    ]);

    const queued = getEndStepTriggers(ctx, 'p2');
    const effects = keeperEffects(queued);
    expect(effects.some((effect) => effect.includes('more creatures than you'))).toBe(true);
    expect(effects.some((effect) => effect.includes('soldier'))).toBe(true);
  });

  it('queues the plains-search ability independently of creature counts', () => {
    const source = keeperPermanent('p1');
    const ctx = makeCtx([
      source,
      creature('p1_c1', 'p1'),
      creature('p1_c2', 'p1'),
      creature('p1_c3', 'p1'),
      creature('p2_c1', 'p2'),
      land('p1_l1', 'p1'),
      land('p2_l1', 'p2'),
      land('p2_l2', 'p2'),
    ]);

    const queued = getEndStepTriggers(ctx, 'p2');
    const effects = keeperEffects(queued);
    expect(effects.some((effect) => effect.includes('more creatures than you'))).toBe(false);
    expect(effects.some((effect) => effect.includes('more lands than you'))).toBe(true);
    expect(effects.some((effect) => effect.includes('plains'))).toBe(true);
  });
});
