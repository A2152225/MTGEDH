import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function collectUnknowns(value: unknown): unknown[] {
  const unknowns: unknown[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as any).kind === 'unknown') unknowns.push((node as any).raw ?? node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return unknowns;
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const base: any = {
    id: 'oracle-ir-gap-batch-22',
    format: 'commander',
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 20, hand: [], library: [], graveyard: [], exile: [], counters: {} },
      { id: 'p2', name: 'P2', seat: 1, life: 20, hand: [], library: [], graveyard: [], exile: [], counters: {} },
    ],
    turnOrder: ['p1', 'p2'],
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    turn: 1,
    turnNumber: 1,
    phase: 'precombatMain',
    step: 'main',
    stack: [],
    battlefield: [],
    commandZone: {},
    startingLife: 20,
    allowUndos: false,
    turnTimerEnabled: false,
    turnTimerSeconds: 0,
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    spectators: [],
    status: 'inProgress',
  };

  return { ...base, ...overrides } as GameState;
}

describe('Oracle IR gap batch 22 support', () => {
  it('parses and applies Narset dynamic graveyard exile before copying the moved card', () => {
    const text =
      "Whenever Narset attacks, exile target noncreature, nonland card with mana value less than Narset's power from a graveyard and copy it. You may cast the copy without paying its mana cost.";
    const ir = parseOracleTextToIR(text, 'Narset, Enlightened Exile');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(collectUnknowns(ir.abilities)).toEqual([]);
    expect(steps.map(step => step.kind)).toEqual(['move_zone', 'copy_spell']);

    const move = steps[0] as any;
    expect(move.what).toEqual({
      kind: 'raw',
      text: "target noncreature, nonland card with mana value less than this permanent's power from a graveyard",
    });
    expect(steps[1]).toMatchObject({
      kind: 'copy_spell',
      subject: 'last_moved_card',
      withoutPayingManaCost: true,
      optional: true,
    });

    const result = applyOracleIRStepsToGameState(
      makeState({
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 20, hand: [], library: [], graveyard: [], exile: [], counters: {} } as any,
          {
            id: 'p2',
            name: 'P2',
            seat: 1,
            life: 20,
            hand: [],
            library: [],
            graveyard: [
              { id: 'small-spell', owner: 'p2', name: 'Lightning Strike', type_line: 'Instant', mana_value: 2 },
              { id: 'large-spell', owner: 'p2', name: 'Explosive Singularity', type_line: 'Sorcery', mana_value: 10 },
              { id: 'dead-land', owner: 'p2', name: 'Evolving Wilds', type_line: 'Land', mana_value: 0 },
            ],
            exile: [],
            counters: {},
          } as any,
        ],
        battlefield: [
          {
            id: 'narset-permanent',
            controller: 'p1',
            owner: 'p1',
            card: {
              id: 'narset-card',
              name: 'Narset, Enlightened Exile',
              type_line: 'Legendary Creature - Human Monk',
              power: '3',
              toughness: '4',
            },
            basePower: 3,
            baseToughness: 4,
            counters: {},
            modifiers: [],
          } as any,
        ],
      }),
      [move],
      {
        controllerId: 'p1',
        sourceId: 'narset-permanent',
        sourceName: 'Narset, Enlightened Exile',
        targetPermanentId: 'small-spell',
        selectorContext: { chosenObjectIds: ['small-spell'] },
      }
    );

    const opponent = result.state.players.find(player => player.id === 'p2') as any;
    expect(opponent.graveyard.map((card: any) => card.id)).toEqual(['large-spell', 'dead-land']);
    expect(opponent.exile.map((card: any) => card.id)).toEqual(['small-spell']);
  });

  it('normalizes leading queue labels for graveyard move-zone clauses', () => {
    const ownerHand = parseOracleTextToIR(
      "\u2014 Return target creature card from a graveyard to its owner's hand.",
      'Another Night in Vegas'
    );
    const repose = parseOracleTextToIR(
      '\u2022 Gentle Repose \u2014 Exile target card from a graveyard.',
      'Dawnbringer Cleric'
    );
    const emblem = parseOracleTextToIR(
      '\u22127: You get an emblem with "At the beginning of combat on your turn, put target creature card from a graveyard onto the battlefield under your control',
      'Liliana, Waker of the Dead'
    );

    expect(collectUnknowns([ownerHand, repose, emblem])).toEqual([]);
    expect(ownerHand.abilities[0]?.steps[0]).toMatchObject({ kind: 'move_zone', to: 'hand' });
    expect(repose.abilities[0]?.steps[0]).toMatchObject({ kind: 'move_zone', to: 'exile' });
    expect(emblem.abilities[0]?.steps[0]).toMatchObject({ kind: 'create_emblem' });
  });

  it('drops Dredge reminder text without adding a second graveyard return step', () => {
    const text =
      'When this creature dies, put target creature card from your graveyard on top of your library. Dredge 4 (If you would draw a card, you may mill four cards instead. If you do, return this card from your graveyard to your hand.)';
    const ir = parseOracleTextToIR(text, 'Golgari Thug');
    const steps = ir.abilities.flatMap(ability => ability.steps ?? []);

    expect(collectUnknowns(ir.abilities)).toEqual([]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'target creature card from your graveyard' },
      to: 'library',
    });
  });
});
