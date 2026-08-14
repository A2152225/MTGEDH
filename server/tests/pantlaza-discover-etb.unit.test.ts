import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { recordDoThisOnlyOnceEachTurnOnAccept } from '../src/state/modules/triggerDoThisOnlyOnceEachTurn.js';

// Oracle from oracle-cards.jsonl (Pantlaza, Sun-Favored)
const PANTLAZA_ORACLE =
  "Whenever Pantlaza or another Dinosaur you control enters, you may discover X, where X is that creature's toughness. Do this only once each turn. (Exile cards from the top of your library until you exile a nonland card with that mana value or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)";

function pantlazaPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Pantlaza, Sun-Favored',
      type_line: 'Legendary Creature — Dinosaur',
      oracle_text: PANTLAZA_ORACLE,
      power: '4',
      toughness: '4',
    },
  };
}

function dinosaurPermanent(id: string, controller: string, toughness = '6') {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Ghalta, Primal Hunger',
      type_line: 'Legendary Creature — Elder Dinosaur',
      oracle_text: '',
      power: '12',
      toughness,
    },
  };
}

function bearPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
  };
}

describe('Pantlaza, Sun-Favored discover ETB', () => {
  it('detects named-or-another dinosaur ETB with toughness-bound discover', () => {
    const triggers = detectETBTriggers(
      {
        name: 'Pantlaza, Sun-Favored',
        type_line: 'Legendary Creature — Dinosaur',
        oracle_text: PANTLAZA_ORACLE,
      },
      { id: 'pantlaza_1', controller: 'p1' },
    );

    const named = triggers.find((t) => t.triggerType === 'named_or_another_typed_etb');
    expect(named).toBeDefined();
    expect(String((named as any)?.requiredTypePhrase || '')).toMatch(/dinosaur/i);
    expect((named as any)?.doThisOnlyOnceEachTurn).toBe(true);
    expect(String(named?.effect || '')).toMatch(/discover x/i);
    expect(String(named?.effect || '')).toMatch(/that creature's toughness/i);
    expect(named?.mandatory).toBe(false);
  });

  it('queues on Pantlaza entering and binds X to his toughness', () => {
    const g = createInitialGameState('t_pantlaza_self_etb');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    (g.state.battlefield as any).push(pantlaza);

    queueSelfETBTriggersForPermanent(g as any, pantlaza, p1);
    const stacked = ((g.state.stack || []) as any[]).find(
      (s) => s?.sourceName === 'Pantlaza, Sun-Favored' && s?.triggerType === 'named_or_another_typed_etb',
    );
    expect(stacked).toBeTruthy();
    expect(stacked?.xValue).toBe(4);
    expect(stacked?.interveningIfSubjectPermanentId).toBe(pantlaza.id);
    expect(stacked?.doThisOnlyOnceEachTurn).toBe(true);
  });

  it('queues when another dinosaur you control enters, using that creature\'s toughness', () => {
    const g = createInitialGameState('t_pantlaza_other_dino');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    const ghalta = dinosaurPermanent('ghalta_1', p1, '12');
    (g.state.battlefield as any).push(pantlaza, ghalta);

    triggerETBEffectsForPermanent(g as any, ghalta, p1);
    const stacked = ((g.state.stack || []) as any[]).find(
      (s) => s?.sourceName === 'Pantlaza, Sun-Favored' && s?.triggerType === 'named_or_another_typed_etb',
    );
    expect(stacked).toBeTruthy();
    expect(stacked?.xValue).toBe(12);
    expect(stacked?.interveningIfSubjectPermanentId).toBe(ghalta.id);
  });

  it('does not queue for a non-dinosaur entering', () => {
    const g = createInitialGameState('t_pantlaza_bear');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    const bear = bearPermanent('bear_1', p1);
    (g.state.battlefield as any).push(pantlaza, bear);

    triggerETBEffectsForPermanent(g as any, bear, p1);
    expect(
      ((g.state.stack || []) as any[]).some(
        (s) => s?.sourceName === 'Pantlaza, Sun-Favored' && s?.triggerType === 'named_or_another_typed_etb',
      ),
    ).toBe(false);
  });

  it('does not queue again after the optional discover is accepted this turn', () => {
    const g = createInitialGameState('t_pantlaza_once');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    (g.state.battlefield as any).push(pantlaza);
    queueSelfETBTriggersForPermanent(g as any, pantlaza, p1);
    const first = ((g.state.stack || []) as any[]).find(
      (s) => s?.sourceName === 'Pantlaza, Sun-Favored',
    );
    expect(first).toBeTruthy();

    recordDoThisOnlyOnceEachTurnOnAccept(g.state, first);
    g.state.stack = [] as any;

    const ghalta = dinosaurPermanent('ghalta_1', p1);
    (g.state.battlefield as any).push(ghalta);
    triggerETBEffectsForPermanent(g as any, ghalta, p1);
    expect(
      ((g.state.stack || []) as any[]).some(
        (s) => s?.sourceName === 'Pantlaza, Sun-Favored' && s?.triggerType === 'named_or_another_typed_etb',
      ),
    ).toBe(false);
  });
});
