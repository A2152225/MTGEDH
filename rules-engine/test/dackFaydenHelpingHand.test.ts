import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { resolveRevealUntilReferenceAmountForPlayer } from '../src/oracleIRExecutorPlayerUtils';
import { isGoaded } from '../src/actions/combat-handlers/combatGoadHelpers';

const DACK_ORACLE =
  "When Dack Fayden enters, reveal cards from the top of your library until you reveal X creature cards, where X is the number of opponents you have. Put those creature cards onto the battlefield, then shuffle. They're goaded for the rest of the game. For each of those permanents, choose a different opponent. Each opponent gains control of the permanent for which they were chosen.";

function card(id: string, name: string, type_line: string) {
  return { id, name, type_line };
}

function dackState(library: any[]) {
  return {
    players: [
      { id: 'p1', name: 'P1', life: 40, library, hand: [], graveyard: [], exile: [] },
      { id: 'p2', name: 'P2', life: 40, library: [], hand: [], graveyard: [], exile: [] },
      { id: 'p3', name: 'P3', life: 40, library: [], hand: [], graveyard: [], exile: [] },
      { id: 'p4', name: 'P4', life: 40, library: [], hand: [], graveyard: [], exile: [] },
    ],
    battlefield: [
      {
        id: 'dack',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'dack',
          name: 'Dack Fayden, Helping Hand',
          type_line: 'Legendary Creature — Human Advisor',
          oracle_text: DACK_ORACLE,
          power: '4',
          toughness: '6',
        },
      },
    ],
    stack: [],
    zones: {},
    turnPlayer: 'p1',
    turnNumber: 5,
  };
}

describe('Dack Fayden, Helping Hand ETB', () => {
  it('parses reveal / goad forever / distribute-control steps (no unknown goad)', () => {
    const steps = parseOracleTextToIR(DACK_ORACLE, 'Dack Fayden, Helping Hand').abilities[0].steps;
    expect(steps.map((s: any) => s.kind)).toEqual([
      'reveal_top',
      'move_zone',
      'shuffle_library',
      'goad',
      'gain_control',
    ]);
    expect(steps.find((s: any) => s.kind === 'goad')).toMatchObject({
      duration: 'rest_of_game',
      target: { kind: 'raw', text: 'those creatures' },
    });
    expect(steps.find((s: any) => s.kind === 'gain_control')).toMatchObject({
      newController: { kind: 'each_opponent' },
    });
  });

  it('reveals until X creature cards where X is the number of opponents', () => {
    const state = dackState([
      card('l0', 'Shock', 'Instant'),
      card('l1', 'Bear', 'Creature — Bear'),
      card('l2', 'Plains', 'Basic Land — Plains'),
      card('l3', 'Elf', 'Creature — Elf'),
      card('l4', 'Goblin', 'Creature — Goblin'),
      card('l5', 'Extra', 'Sorcery'),
    ]);
    const result = resolveRevealUntilReferenceAmountForPlayer(state as any, 'p1' as any, {
      kind: 'reference_amount',
      raw: 'until you reveal X creature cards, where X is the number of opponents you have',
    } as any, { controllerId: 'p1' } as any);
    // 3 opponents → 3 creatures: Bear, Elf, Goblin; reveals through l4
    expect(result?.count).toBe(5);
    expect(result?.cards.map((c: any) => c.id)).toEqual(['l0', 'l1', 'l2', 'l3', 'l4']);
  });

  it('puts revealed creatures onto the battlefield goaded forever and distributes control 1:1', () => {
    const steps = parseOracleTextToIR(DACK_ORACLE, 'Dack Fayden, Helping Hand').abilities[0].steps;
    const state = dackState([
      card('l0', 'Shock', 'Instant'),
      card('l1', 'Bear', 'Creature — Bear'),
      card('l2', 'Plains', 'Basic Land — Plains'),
      card('l3', 'Elf', 'Creature — Elf'),
      card('l4', 'Goblin', 'Creature — Goblin'),
      card('l5', 'Extra', 'Sorcery'),
    ]);

    const result: any = applyOracleIRStepsToGameState(state as any, steps as any, {
      controllerId: 'p1',
      sourceId: 'dack',
      sourceName: 'Dack Fayden, Helping Hand',
      interactivePlayerChoices: false,
    } as any);

    const battlefield = result.state.battlefield as any[];
    const creatures = battlefield.filter((p) =>
      ['Bear', 'Elf', 'Goblin'].includes(String(p?.card?.name || p?.name || '')),
    );
    expect(creatures).toHaveLength(3);

    for (const creature of creatures) {
      expect(Boolean(creature.goadedBy?.includes('p1'))).toBe(true);
      expect(isGoaded(creature, 5, battlefield)).toBe(true);
      expect(isGoaded(creature, 9999, battlefield)).toBe(true);
    }

    const controllers = creatures.map((c) => String(c.controller)).sort();
    expect(controllers).toEqual(['p2', 'p3', 'p4']);
    expect(creatures.every((c) => c.controller !== 'p1')).toBe(true);

    // Non-creature revealed cards remain in library (after shuffle, just check they are not on BF)
    expect(battlefield.some((p) => String(p?.card?.name) === 'Shock')).toBe(false);
    expect(battlefield.some((p) => String(p?.card?.name) === 'Plains')).toBe(false);
  });
});
