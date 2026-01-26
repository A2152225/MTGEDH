import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: named zone / counters / battlefield-count batch', () => {
  it('handles shorthand name matching for named tapped/untapped', () => {
    const g = createInitialGameState('t_if_named_tapped');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    (g.state.battlefield as any[]).push({
      id: 'perm_kalamax',
      controller: p1,
      owner: p1,
      tapped: true,
      card: { id: 'kalamax', name: 'Kalamax, the Stormsire', type_line: 'Legendary Creature — Elemental Dinosaur', oracle_text: '' },
    });

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if Kalamax is tapped')).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if Kalamax is untapped')).toBe(false);
  });

  it('handles generic "it" keyword/counter templates conservatively', () => {
    const g = createInitialGameState('t_if_it_keyword');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const permNoInfo = { id: 'p_noinfo', controller: p1, owner: p1, card: { id: 'c', name: 'Blank', type_line: 'Creature', oracle_text: '' } };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if it doesn't have first strike", permNoInfo as any)).toBe(null);

    const permFirstStrike = {
      id: 'p_fs',
      controller: p1,
      owner: p1,
      card: { id: 'c2', name: 'Striker', type_line: 'Creature', oracle_text: 'First strike' },
    };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if it doesn't have first strike", permFirstStrike as any)).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it has first strike', permFirstStrike as any)).toBe(true);

    const permMutate = {
      id: 'p_mut',
      controller: p1,
      owner: p1,
      card: { id: 'cm', name: 'Mutator', type_line: 'Creature', oracle_text: 'Mutate {1}{G}' },
    };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it has mutate', permMutate as any)).toBe(true);

    const permNoIndCounter = { id: 'p_ind0', controller: p1, owner: p1, counters: { indestructible: 0 }, card: { id: 'c3', name: 'X', type_line: 'Creature', oracle_text: '' } };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if it doesn't have an indestructible counter on it", permNoIndCounter as any)).toBe(true);

    const permHasIndCounter = { id: 'p_ind1', controller: p1, owner: p1, counters: { Indestructible: 1 }, card: { id: 'c4', name: 'Y', type_line: 'Creature', oracle_text: '' } };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if it doesn't have an indestructible counter on it", permHasIndCounter as any)).toBe(false);

    const permQuest = { id: 'p_q', controller: p1, owner: p1, counters: { Quest: 4 }, card: { id: 'c5', name: 'Z', type_line: 'Creature', oracle_text: '' } };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it has four or more quest counters on it', permQuest as any)).toBe(true);

    const permPlusOne0 = { id: 'p_+0', controller: p1, owner: p1, counters: { '+1/+1': 0 }, card: { id: 'c6', name: 'C', type_line: 'Creature', oracle_text: '' } };
    const permPlusOne1 = { id: 'p_+1', controller: p1, owner: p1, counters: { '+1/+1': 1 }, card: { id: 'c7', name: 'D', type_line: 'Creature', oracle_text: '' } };
    const permPlusOne3 = { id: 'p_+3', controller: p1, owner: p1, counters: { '+1/+1': 3 }, card: { id: 'c8', name: 'E', type_line: 'Creature', oracle_text: '' } };
    const permPlusOne4 = { id: 'p_+4', controller: p1, owner: p1, counters: { '+1/+1': 4 }, card: { id: 'c9', name: 'F', type_line: 'Creature', oracle_text: '' } };

    expect(evaluateInterveningIfClause(g as any, String(p1), "if this creature doesn't have a +1/+1 counter on it", permPlusOne0 as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), "if this creature doesn't have a +1/+1 counter on it", permPlusOne1 as any)).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature has one or more +1/+1 counters on it', permPlusOne1 as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature has fewer than three +1/+1 counters on it', permPlusOne1 as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature has fewer than three +1/+1 counters on it', permPlusOne3 as any)).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it has fewer than four +1/+1 counters on it', permPlusOne3 as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it has fewer than four +1/+1 counters on it', permPlusOne4 as any)).toBe(false);

    const permMinusOne0 = { id: 'p_-0', controller: p1, owner: p1, counters: { '-1/-1': 0 }, card: { id: 'c10', name: 'G', type_line: 'Creature', oracle_text: '' } };
    const permMinusOne2 = { id: 'p_-2', controller: p1, owner: p1, counters: { '-1/-1': 2 }, card: { id: 'c11', name: 'H', type_line: 'Creature', oracle_text: '' } };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it had no -1/-1 counters on it', permMinusOne0 as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it had no -1/-1 counters on it', permMinusOne2 as any)).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it had one or more -1/-1 counters on it', permMinusOne2 as any)).toBe(true);

    const permEgg = { id: 'p_egg', controller: p1, owner: p1, counters: { Egg: 1 }, card: { id: 'c12', name: 'Egged', type_line: 'Creature', oracle_text: '' } };
    const permRevival = { id: 'p_rev', controller: p1, owner: p1, counters: { revival: 1 }, card: { id: 'c13', name: 'Revived', type_line: 'Creature', oracle_text: '' } };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it has an egg counter on it', permEgg as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it had a revival counter on it', permRevival as any)).toBe(true);

    const permNoCountersObj = { id: 'p_noc', controller: p1, owner: p1, card: { id: 'c14', name: 'NoCounters', type_line: 'Creature', oracle_text: '' } };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it has an egg counter on it', permNoCountersObj as any)).toBe(null);
  });

  it('evaluates "if it was historic" via type line', () => {
    const g = createInitialGameState('t_if_historic');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const legendary = { id: 'p_leg', controller: p1, owner: p1, card: { id: 'cl', name: 'Legend', type_line: 'Legendary Creature — Human', oracle_text: '' } };
    const saga = { id: 'p_saga', controller: p1, owner: p1, card: { id: 'cs', name: 'Saga', type_line: 'Enchantment — Saga', oracle_text: '' } };
    const normal = { id: 'p_norm', controller: p1, owner: p1, card: { id: 'cn', name: 'Normal', type_line: 'Creature — Human', oracle_text: '' } };

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it was historic', legendary as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it was historic', saga as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it was historic', normal as any)).toBe(false);
  });

  it('evaluates battlefield-count templates', () => {
    const g = createInitialGameState('t_if_bf_count');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    (g.state.battlefield as any[]).push(
      { id: 'c1', controller: p1, owner: p1, card: { id: 'c1c', name: 'A', type_line: 'Creature', oracle_text: '' } },
      { id: 'c2', controller: p2, owner: p2, card: { id: 'c2c', name: 'B', type_line: 'Creature', oracle_text: '' } },
      { id: 'c3', controller: p2, owner: p2, card: { id: 'c3c', name: 'C', type_line: 'Creature', oracle_text: '' } },
      { id: 'c4', controller: p1, owner: p1, card: { id: 'c4c', name: 'D', type_line: 'Creature', oracle_text: '' } }
    );

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if there are four or more creatures on the battlefield')).toBe(true);

    // Seven lands requires explicit land permanents.
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if there are seven or more lands on the battlefield')).toBe(false);
  });

  it('evaluates "another creature is on the battlefield" using sourcePermanent id', () => {
    const g = createInitialGameState('t_if_another_creature');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    const src = { id: 'src_creature', controller: p1, owner: p1, card: { id: 'sc', name: 'Src', type_line: 'Creature', oracle_text: '' } };
    (g.state.battlefield as any[]).push(src);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if another creature is on the battlefield', src as any)).toBe(false);

    (g.state.battlefield as any[]).push({ id: 'other', controller: p2, owner: p2, card: { id: 'oc', name: 'Other', type_line: 'Creature', oracle_text: '' } });
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if another creature is on the battlefield', src as any)).toBe(true);
  });

  it('evaluates command-zone-only and command-zone-or-battlefield clauses for commanders (shorthand Oracle name)', () => {
    const g = createInitialGameState('t_if_commander_zone');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    // Set commander with full name; clause uses shorthand "Oloro".
    g.setCommander(p1, ['Oloro, Ageless Ascetic'], ['cmd_oloro'] as any, ['W', 'U', 'B'] as any);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if Oloro is in the command zone')).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if Oloro is in the command zone or on the battlefield')).toBe(true);

    // Simulate commander being cast (removes from inCommandZone).
    g.castCommander(p1, 'cmd_oloro');
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if Oloro is in the command zone')).toBe(false);
  });

  it('evaluates named graveyard-or-battlefield and named exiled clauses', () => {
    const g = createInitialGameState('t_if_named_zones');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    // Graveyard: Firemane Angel
    (g.state.zones as any)[p1].graveyard.push({ id: 'fa1', name: 'Firemane Angel', type_line: 'Creature — Angel', oracle_text: '' });
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if Firemane Angel is in your graveyard or on the battlefield')).toBe(true);

    // Exile: Cosima (in opponent exile)
    (g.state.zones as any)[p2].exile = [{ id: 'cos1', name: 'Cosima, God of the Voyage', type_line: 'Legendary Creature — God', oracle_text: '' }];
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if Cosima is exiled')).toBe(true);
  });

  it('evaluates "this creature has N or fewer <counter> counters on it" (e.g. judgment counters)', () => {
    const g = createInitialGameState('t_if_counter_or_fewer');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const src = {
      id: 'src',
      controller: p1,
      owner: p1,
      counters: { Judgment: 2 },
      card: { id: 'c', name: 'Faithbound Judge', type_line: 'Creature — Spirit', oracle_text: '' },
    };

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature has two or fewer judgment counters on it', src as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature has one or fewer judgment counters on it', src as any)).toBe(false);

    // Case-insensitive counter names
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature has two or fewer Judgment counters on it', src as any)).toBe(true);

    // Extended subjects
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this permanent has two or fewer judgment counters on it', src as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if it has two or fewer judgment counters on it', src as any)).toBe(true);
  });
});
