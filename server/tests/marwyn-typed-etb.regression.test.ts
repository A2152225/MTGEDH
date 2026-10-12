import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { detectETBTriggers } from '../src/state/modules/triggers/etb-detection.js';
import type { PlayerID } from '../../shared/src';

// Issues #50/#51 (game_mv4dicck): Marwyn, the Nurturer got a +1/+1 counter whenever ANY creature
// entered (opponent's Mondrak, non-Elves). A hard-coded table row queued an unfiltered creature_etb.
const MARWYN = "Whenever another Elf you control enters, put a +1/+1 counter on Marwyn.\n{T}: Add an amount of {G} equal to Marwyn's power.";
const a = 'a' as PlayerID;
const b = 'b' as PlayerID;

function setup() {
  const game: any = createInitialGameState(`t_marwyn_${Math.random().toString(36).slice(2, 7)}`);
  game.applyEvent({ type: 'join', playerId: a, name: 'A' });
  game.applyEvent({ type: 'join', playerId: b, name: 'B' });
  game.state.turnPlayer = a;
  game.state.phase = 'precombatMain';
  game.state.step = 'MAIN1';
  game.state.stack = [];
  game.state.battlefield.push({
    id: 'marwyn', controller: a, owner: a, tapped: false, counters: {},
    card: { id: 'marwyn_c', name: 'Marwyn, the Nurturer', type_line: 'Legendary Creature - Elf Druid', oracle_text: MARWYN, power: '1', toughness: '1' },
  });
  return game;
}

function enter(game: any, id: string, controller: PlayerID, typeLine: string, oracle = '') {
  const perm = {
    id, controller, owner: controller, tapped: false, counters: {},
    card: { id: `${id}_c`, name: id, type_line: typeLine, oracle_text: oracle, power: '2', toughness: '2' },
  };
  game.state.battlefield.push(perm);
  triggerETBEffectsForPermanent(game, perm, controller);
  return perm;
}

const marwynTriggers = (game: any) =>
  (game.state.stack || []).filter((item: any) => String(item?.sourceName || item?.cardName || '').startsWith('Marwyn'));

describe('Marwyn, the Nurturer: "another Elf you control enters" (#50/#51)', () => {
  it('detects a filtered, controlled-only trigger', () => {
    const triggers = detectETBTriggers({ name: 'Marwyn, the Nurturer', oracle_text: MARWYN, type_line: 'Legendary Creature - Elf Druid' }, { id: 'm', controller: a });
    expect(triggers).toHaveLength(1);
    expect((triggers[0] as any).requiredTypePhrase).toMatch(/elf/i);
    expect((triggers[0] as any).controlledOnly).toBe(true);
  });

  it('ignores non-Elves and opponents\' Elves; triggers for your Elf once', () => {
    const game = setup();
    enter(game, 'Mondrak', b, 'Legendary Creature - Phyrexian Angel');
    enter(game, 'Bear', a, 'Creature - Bear');
    enter(game, 'OppElf', b, 'Creature - Elf Warrior');
    expect(marwynTriggers(game)).toHaveLength(0);
    enter(game, 'Llanowar', a, 'Creature - Elf Druid');
    expect(marwynTriggers(game)).toHaveLength(1);
  });

  it('counts changelings and Elf tokens, not itself, not opponent tokens', () => {
    const game = setup();
    triggerETBEffectsForPermanent(game, game.state.battlefield[0], a);
    expect(marwynTriggers(game)).toHaveLength(0);
    enter(game, 'Shapeshifter', a, 'Creature - Shapeshifter', 'Changeling (This card is every creature type.)');
    expect(marwynTriggers(game)).toHaveLength(1);
    createToken(game, b, 'Elephant', 1, 6, 6, { colors: ['G'], typeLine: 'Token Creature - Elephant' });
    expect(marwynTriggers(game)).toHaveLength(1);
    createToken(game, a, 'Elf Warrior', 2, 1, 1, { colors: ['G'], typeLine: 'Token Creature - Elf Warrior' });
    expect(marwynTriggers(game)).toHaveLength(3);
  });
});

import { getEffectivePowerForMana } from '../src/state/modules/mana-abilities-handlers/manaAbilityColorRestrictionUtils.js';
describe("Marwyn's power-based mana", () => {
  it('uses current power including +1/+1 counters', () => {
    const game = setup();
    const marwyn = game.state.battlefield[0];
    marwyn.counters = { '+1/+1': 10 };
    expect(getEffectivePowerForMana(marwyn, game.state)).toBe(11);
  });
});
