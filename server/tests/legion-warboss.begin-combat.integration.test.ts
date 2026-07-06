import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { detectBeginningOfCombatTriggers } from '../src/state/modules/triggered-abilities.js';
import { ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';
import type { PlayerID } from '../../shared/src';

function setupToMain1(g: ReturnType<typeof createInitialGameState>, p1: PlayerID, p2: PlayerID) {
  g.applyEvent({ type: 'nextTurn' });

  const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
    id: `card_${i}`,
    name: `Test Card ${i}`,
    type_line: 'Creature',
    oracle_text: '',
  }));

  g.importDeckResolved(p1, sampleDeck);
  g.importDeckResolved(p2, sampleDeck.map((card) => ({ ...card, id: `p2_${card.id}` })));

  g.applyEvent({ type: 'nextStep' });
  g.applyEvent({ type: 'nextStep' });
  g.applyEvent({ type: 'nextStep' });
}

describe('Legion Warboss beginning-of-combat (dynamic oracle detection)', () => {
  let previousTriggerPrimary: string | undefined;

  beforeAll(async () => {
    await initDb();
    ensureLocalCardLookupIndexSync();
  });

  beforeEach(() => {
    previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  afterEach(() => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
  });

  it('detects begin-combat trigger from oracle without KNOWN table shorthand', () => {
    const card = {
      name: 'Legion Warboss',
      oracle_text:
        'Mentor\nAt the beginning of combat on your turn, create a 1/1 red Goblin creature token. That token gains haste until end of turn and attacks this combat if able.',
    };
    const permanent = { id: 'warboss_1', controller: 'p1' };

    const triggers = detectBeginningOfCombatTriggers(card, permanent);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect.toLowerCase()).toContain('create a 1/1 red goblin creature token');
    expect(triggers[0].createsToken).toBe(true);
  });

  it('creates a Goblin token under ORACLE_IR_TRIGGER_PRIMARY', () => {
    const g = createInitialGameState('legion_warboss_begin_combat');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const activePlayer = g.state.turnPlayer as PlayerID;

    (g.state.battlefield as any[]).push({
      id: 'warboss_perm',
      controller: activePlayer,
      owner: activePlayer,
      tapped: false,
      summoningSickness: false,
      basePower: 2,
      baseToughness: 2,
      card: {
        id: 'warboss_card',
        name: 'Legion Warboss',
        type_line: 'Creature — Goblin',
        oracle_text:
          'Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)\nAt the beginning of combat on your turn, create a 1/1 red Goblin creature token. That token gains haste until end of turn and attacks this combat if able.',
        power: '2',
        toughness: '2',
      },
    });

    g.applyEvent({ type: 'nextStep' });

    const tokenCountBefore = (g.state.battlefield as any[]).filter((p) => p?.isToken).length;

    const stack = (g.state as any).stack || [];
    expect(stack.some((item: any) => item.type === 'triggered_ability' && item.source === 'warboss_perm')).toBe(true);

    resolveTopOfStack(g as any);

    const goblinTokens = (g.state.battlefield as any[]).filter(
      (permanent) =>
        permanent?.isToken === true &&
        String(permanent.card?.type_line || '').toLowerCase().includes('goblin'),
    );
    expect(goblinTokens.length).toBeGreaterThan(tokenCountBefore);
    const created = goblinTokens[goblinTokens.length - 1];
    expect(created.summoningSickness).toBe(false);
  });
});
