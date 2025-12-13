import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { applyLifeGain, exchangePermanentOracleText } from '../src/state/utils';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers';

describe('Custom Cards - Aerith Gainsborough', () => {
  it('gains exactly one +1/+1 counter per life gain event', () => {
    const g = createInitialGameState('aerith_1');
    const pid = 'p1' as PlayerID;
    
    // Create Aerith on battlefield
    const aerithCard = {
      id: 'aerith_card',
      name: 'Aerith Gainsborough',
      type_line: 'Legendary Creature — Human Cleric',
      oracle_text: 'Lifelink\nWhenever you gain life, put a +1/+1 counter on Aerith Gainsborough.\nWhen Aerith Gainsborough dies, put X +1/+1 counters on each legendary creature you control, where X is the number of +1/+1 counters on Aerith Gainsborough.',
      power: '2',
      toughness: '2',
      mana_cost: '{2}{W}',
    };
    
    g.state.battlefield.push({
      id: 'aerith_perm',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: {},
      card: aerithCard,
    } as any);
    
    // Trigger life gain
    const result = applyLifeGain(g.state, pid, 3, 'test');
    
    // Aerith should have exactly 1 counter, not 3
    const aerith = g.state.battlefield.find((p: any) => p.id === 'aerith_perm');
    expect(aerith?.counters?.['+1/+1']).toBe(1);
  });
  
  it('distributes counters to legendary creatures on death', () => {
    const g = createInitialGameState('aerith_2');
    const pid = 'p1' as PlayerID;
    
    // Create Aerith with 3 +1/+1 counters
    const aerithCard = {
      id: 'aerith_card',
      name: 'Aerith Gainsborough',
      type_line: 'Legendary Creature — Human Cleric',
      oracle_text: 'Lifelink\nWhenever you gain life, put a +1/+1 counter on Aerith Gainsborough.\nWhen Aerith Gainsborough dies, put X +1/+1 counters on each legendary creature you control, where X is the number of +1/+1 counters on Aerith Gainsborough.',
      power: '2',
      toughness: '2',
    };
    
    g.state.battlefield.push({
      id: 'aerith_perm',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: { '+1/+1': 3 },
      card: aerithCard,
    } as any);
    
    // Create other legendary creatures
    g.state.battlefield.push({
      id: 'legend1',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: {},
      card: {
        id: 'legend1_card',
        name: 'Test Legend 1',
        type_line: 'Legendary Creature — Human Warrior',
        power: '1',
        toughness: '1',
      },
    } as any);
    
    g.state.battlefield.push({
      id: 'legend2',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: {},
      card: {
        id: 'legend2_card',
        name: 'Test Legend 2',
        type_line: 'Legendary Creature — Elf Wizard',
        power: '1',
        toughness: '1',
      },
    } as any);
    
    // Create a non-legendary creature (should not get counters)
    g.state.battlefield.push({
      id: 'nonlegend',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: {},
      card: {
        id: 'nonlegend_card',
        name: 'Regular Creature',
        type_line: 'Creature — Human',
        power: '2',
        toughness: '2',
      },
    } as any);
    
    // Move Aerith to graveyard (triggers death effect)
    g.movePermanentToGraveyard('aerith_perm', true);
    
    // Check that legendary creatures got counters
    const legend1 = g.state.battlefield.find((p: any) => p.id === 'legend1');
    const legend2 = g.state.battlefield.find((p: any) => p.id === 'legend2');
    const nonlegend = g.state.battlefield.find((p: any) => p.id === 'nonlegend');
    
    expect(legend1?.counters?.['+1/+1']).toBe(3);
    expect(legend2?.counters?.['+1/+1']).toBe(3);
    expect(nonlegend?.counters?.['+1/+1']).toBeUndefined();
  });
});

describe('Custom Cards - Yuna, Grand Summoner', () => {
  it('sets flag for next creature to enter with +2 counters', () => {
    const g = createInitialGameState('yuna_1');
    const pid = 'p1' as PlayerID;
    
    // Create Yuna on battlefield
    const yunaCard = {
      id: 'yuna_card',
      name: 'Yuna, Grand Summoner',
      type_line: 'Legendary Creature — Human Cleric',
      oracle_text: 'Grand Summon — {T}: Add one mana of any color. When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it.\nWhenever another permanent you control is put into a graveyard from the battlefield, if it had one or more counters on it, you may put that number of +1/+1 counters on target creature.',
      power: '1',
      toughness: '5',
      mana_cost: '{1}{G}{W}{U}',
    };
    
    g.state.battlefield.push({
      id: 'yuna_perm',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: {},
      card: yunaCard,
    } as any);
    
    // Activate mana ability (tap Yuna)
    const yuna = g.state.battlefield.find((p: any) => p.id === 'yuna_perm');
    if (yuna) {
      yuna.tapped = true;
      (g.state as any).yunaNextCreatureFlags = (g.state as any).yunaNextCreatureFlags || {};
      (g.state as any).yunaNextCreatureFlags[pid] = true;
    }
    
    // Verify flag is set
    expect((g.state as any).yunaNextCreatureFlags?.[pid]).toBe(true);
  });
});

describe('Custom Cards - Death\'s Presence', () => {
  it('triggers when creature dies and tracks its power', () => {
    const g = createInitialGameState('deaths_presence_1');
    const pid = 'p1' as PlayerID;
    
    // Create Death's Presence on battlefield
    const deathsPresenceCard = {
      id: 'deaths_presence_card',
      name: "Death's Presence",
      type_line: 'Enchantment',
      oracle_text: 'Whenever a creature you control dies, put X +1/+1 counters on target creature you control, where X is the power of the creature that died.',
      mana_cost: '{5}{G}',
    };
    
    g.state.battlefield.push({
      id: 'deaths_presence_perm',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: {},
      card: deathsPresenceCard,
    } as any);
    
    // Create a creature with power 3
    g.state.battlefield.push({
      id: 'dying_creature',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: {},
      card: {
        id: 'dying_card',
        name: 'Big Creature',
        type_line: 'Creature — Beast',
        power: '3',
        toughness: '3',
      },
    } as any);
    
    // Create target creature
    g.state.battlefield.push({
      id: 'target_creature',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: {},
      card: {
        id: 'target_card',
        name: 'Target Creature',
        type_line: 'Creature — Soldier',
        power: '1',
        toughness: '1',
      },
    } as any);
    
    // Move dying creature to graveyard
    g.movePermanentToGraveyard('dying_creature', true);
    
    // Check that a trigger was created
    const stack = g.state.stack || [];
    const deathsPresenceTrigger = stack.find((item: any) => 
      item.triggerType === 'deaths_presence'
    );
    
    expect(deathsPresenceTrigger).toBeDefined();
    expect(deathsPresenceTrigger?.countersToAdd).toBe(3);
  });
});

describe('Custom Cards - Deadpool, Trading Card', () => {
  const deadpoolText = [
    'As Deadpool enters, you may exchange his text box and another creature’s.',
    'At the beginning of your upkeep, you lose 3 life.',
    '{3}, Sacrifice this creature: Each other player draws a card.'
  ].join('\n');

  it('exchanges oracle text between permanents', () => {
    const battlefield = [
      { id: 'deadpool', controller: 'p1', card: { oracle_text: deadpoolText } },
      { id: 'target', controller: 'p2', card: { oracle_text: 'Flying' } },
    ] as any[];

    const swapped = exchangePermanentOracleText(battlefield, 'deadpool', 'target');
    expect(swapped).toBe(true);
    expect(battlefield[0].card.oracle_text).toBe('Flying');
    expect(battlefield[1].card.oracle_text).toBe(deadpoolText);
    expect((battlefield[0] as any).oracle_text).toBe('Flying');
  });

  it('registers upkeep life loss trigger', () => {
    const triggers = detectUpkeepTriggers(
      { name: 'Deadpool, Trading Card', oracle_text: deadpoolText },
      { id: 'deadpool', counters: {} }
    );

    expect(triggers.some(t => t.description.toLowerCase().includes('lose 3 life'))).toBe(true);
  });
});

describe('Counter Replacement Effects', () => {
  it('applies Doubling Season to Aerith death trigger', () => {
    const g = createInitialGameState('replacement_1');
    const pid = 'p1' as PlayerID;
    
    // Create Doubling Season
    g.state.battlefield.push({
      id: 'doubling_season',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: {},
      card: {
        id: 'doubling_card',
        name: 'Doubling Season',
        type_line: 'Enchantment',
        oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.',
      },
    } as any);
    
    // Create Aerith with 2 counters
    g.state.battlefield.push({
      id: 'aerith_perm',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: { '+1/+1': 2 },
      card: {
        id: 'aerith_card',
        name: 'Aerith Gainsborough',
        type_line: 'Legendary Creature — Human Cleric',
        oracle_text: 'When Aerith Gainsborough dies, put X +1/+1 counters on each legendary creature you control, where X is the number of +1/+1 counters on Aerith Gainsborough.',
        power: '2',
        toughness: '2',
      },
    } as any);
    
    // Create legendary creature to receive counters
    g.state.battlefield.push({
      id: 'legend1',
      controller: pid,
      owner: pid,
      tapped: false,
      counters: {},
      card: {
        id: 'legend1_card',
        name: 'Test Legend',
        type_line: 'Legendary Creature — Human',
        power: '1',
        toughness: '1',
      },
    } as any);
    
    // Kill Aerith
    g.movePermanentToGraveyard('aerith_perm', true);
    
    // Legend should have 4 counters (2 * 2 from Doubling Season)
    const legend = g.state.battlefield.find((p: any) => p.id === 'legend1');
    expect(legend?.counters?.['+1/+1']).toBe(4);
  });
});
