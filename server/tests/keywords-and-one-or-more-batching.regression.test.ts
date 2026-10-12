import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import { createToken, movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { runWithSimultaneousEntryBatch } from '../src/state/modules/triggers/simultaneousEntryBatch.js';
import { hasEffectiveAbility } from '../src/socket/combat-handlers/combatLegalityGates.js';
import type { PlayerID } from '../../shared/src';

const a = 'a' as PlayerID;

function setup(oracle: string) {
  const game: any = createInitialGameState(`t_batch_${Math.random().toString(36).slice(2, 7)}`);
  game.applyEvent({ type: 'join', playerId: a, name: 'A' });
  game.applyEvent({ type: 'join', playerId: 'b' as PlayerID, name: 'B' });
  game.state.turnPlayer = a;
  game.state.phase = 'precombatMain';
  game.state.step = 'MAIN1';
  game.state.stack = [];
  game.state.battlefield.push({ id: 'src', controller: a, owner: a, tapped: false, counters: {}, card: { id: 'src_c', name: 'Watcher', type_line: 'Enchantment', oracle_text: oracle } });
  return game;
}
const watcherTriggers = (game: any) => (game.state.stack || []).filter((s: any) => s?.sourceName === 'Watcher');
const soldier = { colors: ['W'], typeLine: 'Token Creature - Soldier' };
function bear(id: string) {
  return { id, controller: a, owner: a, tapped: false, counters: {}, card: { id: `${id}_c`, name: id, type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' } };
}

describe('"one or more" triggers fire once per simultaneous batch', () => {
  it.each([
    'Whenever one or more tokens you control enter, draw a card.',
    'Whenever one or more other creatures you control enter, you gain 1 life.',
    'Whenever one or more creature tokens you control enter, scry 1.',
  ])('%s: three tokens at once -> one trigger', (oracle) => {
    const game = setup(oracle);
    createToken(game, a, 'Soldier', 3, 1, 1, soldier);
    expect(watcherTriggers(game)).toHaveLength(1);
  });

  it('plain "another creature enters" still fires per creature', () => {
    const game = setup('Whenever another creature you control enters, you gain 1 life.');
    createToken(game, a, 'Soldier', 3, 1, 1, soldier);
    expect(watcherTriggers(game)).toHaveLength(3);
  });

  it('mass reanimation in one batch -> one trigger; separate entries -> one each', () => {
    const game = setup('Whenever one or more other creatures you control enter, you gain 1 life.');
    runWithSimultaneousEntryBatch(() => {
      for (const id of ['r1', 'r2', 'r3']) {
        const p = bear(id);
        game.state.battlefield.push(p);
        triggerETBEffectsForPermanent(game, p, a);
      }
    });
    expect(watcherTriggers(game)).toHaveLength(1);
    for (const id of ['s1', 's2']) {
      const p = bear(id);
      game.state.battlefield.push(p);
      triggerETBEffectsForPermanent(game, p, a);
    }
    expect(watcherTriggers(game)).toHaveLength(3);
  });

  it('"one or more other creatures you control die": fires (was never matched) and once per board wipe', () => {
    const game = setup('Whenever one or more other creatures you control die, draw a card.');
    for (const id of ['x1', 'x2', 'x3']) game.state.battlefield.push(bear(id));
    runWithSimultaneousEntryBatch(() => {
      for (const id of ['x1', 'x2', 'x3']) movePermanentToGraveyard(game, id, true);
    });
    expect(watcherTriggers(game)).toHaveLength(1);
  });

  it('plain "another creature you control dies" fires per creature in a wipe', () => {
    const game = setup('Whenever another creature you control dies, draw a card.');
    for (const id of ['x1', 'x2', 'x3']) game.state.battlefield.push(bear(id));
    runWithSimultaneousEntryBatch(() => {
      for (const id of ['x1', 'x2', 'x3']) movePermanentToGraveyard(game, id, true);
    });
    expect(watcherTriggers(game)).toHaveLength(3);
  });
});

describe('server block legality uses accurate keywords', () => {
  const ground = { id: 'g', controller: 'b', card: { name: 'Archer', type_line: 'Creature - Elf Archer', oracle_text: '{T}: This creature deals 1 damage to target creature with flying.' } };
  const lord = { id: 'l', controller: 'b', card: { name: 'Lord', type_line: 'Creature - Bird', oracle_text: 'Other creatures you control have flying.', keywords: ['Flying'] } };
  it('"target creature with flying" is not flying; a lord grants others, not itself', () => {
    expect(hasEffectiveAbility(ground, 'flying', [ground], 'b').hasAbility).toBe(false);
    expect(hasEffectiveAbility(ground, 'flying', [ground, lord], 'b').hasAbility).toBe(true);
    expect(hasEffectiveAbility(lord, 'flying', [ground, lord], 'b').hasAbility).toBe(false);
  });
  it('equipment grants and "loses flying" removals', () => {
    const host = { id: 'h', controller: 'b', attachedEquipment: ['e'], card: { name: 'Host', type_line: 'Creature - Human', oracle_text: '' } };
    const equip = { id: 'e', controller: 'b', attachedTo: 'h', card: { name: 'Wings', type_line: 'Artifact - Equipment', oracle_text: 'Equipped creature has flying.\nEquip {1}' } };
    expect(hasEffectiveAbility(host, 'flying', [host, equip], 'b').hasAbility).toBe(true);
    const angel = { id: 'an', controller: 'b', card: { name: 'Angel', type_line: 'Creature - Angel', oracle_text: 'Flying', keywords: ['Flying'] } };
    const sphere = { id: 's', controller: 'a', card: { name: 'Sphere', type_line: 'Enchantment', oracle_text: 'All creatures lose flying.' } };
    expect(hasEffectiveAbility(angel, 'flying', [angel, sphere], 'b').hasAbility).toBe(false);
  });
});
