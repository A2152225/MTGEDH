import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import {
  detectAttackTriggers,
  getAttackTriggersForCreatures,
} from '../src/state/modules/triggers/combat.js';
import { checkPermanentEntersTapped } from '../src/state/modules/triggerPermanentEntersTapped.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';

// Oracle from oracle-cards.jsonl
const COMBAT_CALLIGRAPHER_ORACLE =
  "Flying\nInklings can't attack you or planeswalkers you control.\nWhenever a player attacks one of your opponents, that attacking player creates a tapped 2/1 white and black Inkling creature token with flying that's attacking that opponent.";

const HATEFUL_EIDOLON_ORACLE =
  'Lifelink\nWhenever an enchanted creature dies, draw a card for each Aura you controlled that was attached to it.';

function calligrapherPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Combat Calligrapher',
      type_line: 'Creature — Bird Cleric',
      oracle_text: COMBAT_CALLIGRAPHER_ORACLE,
      power: '3',
      toughness: '3',
    },
  };
}

function creaturePermanent(id: string, controller: string, attacking?: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: true,
    attacking: attacking || undefined,
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

describe('Combat Calligrapher — whenever a player attacks one of your opponents', () => {
  it('detects a player_attacks_your_opponent trigger', () => {
    const triggers = detectAttackTriggers(
      {
        name: 'Combat Calligrapher',
        type_line: 'Creature — Bird Cleric',
        oracle_text: COMBAT_CALLIGRAPHER_ORACLE,
      },
      { id: 'calligrapher_1', controller: 'p1' },
    );
    const found = triggers.find((trigger) => trigger.triggerType === 'player_attacks_your_opponent');
    expect(found).toBeDefined();
    expect(String(found?.effect || '').toLowerCase()).toContain('inkling');
    expect(String(found?.effect || '').toLowerCase()).toContain('tapped');
  });

  it('queues once when its controller attacks an opponent, even if Calligrapher itself does not attack', () => {
    const g = createInitialGameState('t_calligrapher_controller_attacks');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const calligrapher = calligrapherPermanent('calligrapher_1', p1);
    const attacker = creaturePermanent('bear_1', p1, p2);
    (g.state.battlefield as any).push(calligrapher, attacker);

    const triggers = getAttackTriggersForCreatures(
      { state: g.state, bumpSeq: () => undefined } as any,
      [attacker],
      p1,
      p2,
    );
    const found = triggers.filter(
      (trigger) => trigger.cardName === 'Combat Calligrapher' && trigger.triggerType === 'player_attacks_your_opponent',
    );
    expect(found).toHaveLength(1);
    expect((found[0] as any)?.value?.attackingPlayerId).toBe(p1);
    expect((found[0] as any)?.value?.defendingPlayerId).toBe(p2);
  });

  it('does not queue when a player attacks the Calligrapher controller', () => {
    const g = createInitialGameState('t_calligrapher_attacked');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const calligrapher = calligrapherPermanent('calligrapher_1', p1);
    const attacker = creaturePermanent('bear_1', p2, p1);
    (g.state.battlefield as any).push(calligrapher, attacker);

    const triggers = getAttackTriggersForCreatures(
      { state: g.state, bumpSeq: () => undefined } as any,
      [attacker],
      p2,
      p1,
    );
    expect(
      triggers.some(
        (trigger) => trigger.cardName === 'Combat Calligrapher' && trigger.triggerType === 'player_attacks_your_opponent',
      ),
    ).toBe(false);
  });

  it('creates a tapped Inkling attacking that opponent for the attacking player', () => {
    const ir = parseOracleTextToIR(COMBAT_CALLIGRAPHER_ORACLE, 'Combat Calligrapher');
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);
    const create = steps.find((step) => step.kind === 'create_token') as Extract<
      (typeof steps)[number],
      { kind: 'create_token' }
    > | undefined;
    expect(create).toBeDefined();
    expect(create?.entersTapped).toBe(true);
    expect((create as any)?.attacking).toBe('defending_player');

    const state = {
      players: [
        { id: 'p1', life: 40, hand: [], graveyard: [], exile: [], library: [] },
        { id: 'p2', life: 40, hand: [], graveyard: [], exile: [], library: [] },
      ],
      battlefield: [calligrapherPermanent('calligrapher_1', 'p1')],
      stack: [],
    };

    const result = applyOracleIRStepsToGameState(
      state as any,
      [create!],
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'calligrapher_1',
        sourceName: 'Combat Calligrapher',
        attackingPlayerId: 'p1' as PlayerID,
        targetPlayerId: 'p1' as PlayerID,
        targetOpponentId: 'p2' as PlayerID,
        selectorContext: {
          targetPlayerId: 'p1',
          targetOpponentId: 'p2',
          attackingPlayerId: 'p1',
        },
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: false },
    );

    const token = ((result.state.battlefield as any[]) || []).find((perm) => perm?.isToken === true);
    expect(token).toBeTruthy();
    expect(token.controller).toBe('p1');
    expect(token.tapped).toBe(true);
    expect(String(token.attacking || '')).toBe('p2');
    expect(String(token.card?.name || token.name || '')).toMatch(/inkling/i);
  });
});

describe('Hateful Eidolon battlefield entry', () => {
  it('does not enter tapped from its own oracle text', () => {
    const card = {
      name: 'Hateful Eidolon',
      type_line: 'Enchantment Creature — Spirit',
      oracle_text: HATEFUL_EIDOLON_ORACLE,
      power: '1',
      toughness: '2',
    };
    expect(checkPermanentEntersTapped([], 'p1', card)).toBe(false);
  });

  it('does not enter tapped because Combat Calligrapher is on the battlefield', () => {
    const eidolon = {
      name: 'Hateful Eidolon',
      type_line: 'Enchantment Creature — Spirit',
      oracle_text: HATEFUL_EIDOLON_ORACLE,
      power: '1',
      toughness: '2',
    };
    const battlefield = [calligrapherPermanent('calligrapher_1', 'p2')];
    expect(checkPermanentEntersTapped(battlefield, 'p1', eidolon)).toBe(false);
  });
});
