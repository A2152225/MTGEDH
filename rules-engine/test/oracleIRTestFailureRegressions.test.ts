import { RulesEngineAdapter } from '../src/RulesEngineAdapter';
import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

function makeState(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'game1',
    format: 'commander',
    players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] }],
    startingLife: 40,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [],
    commandZone: {},
    phase: 'combat',
    active: true,
    ...overrides,
  };
}

function creature(id: string, controller: string, tapped: boolean): any {
  return {
    id,
    controller,
    owner: controller,
    tapped,
    card: { id: `${id}-card`, name: id, type_line: 'Creature - Human', power: '2', toughness: '2' },
  };
}

const graveyardReturnText = "Return target creature card from a graveyard to its owner's hand.";

describe('oracle IR regressions for the long-standing failures', () => {
  it('untaps every other creature you control (Ahn-Crop Champion exert reward) and leaves the source, opponents and non-creatures alone', () => {
    const steps = parseOracleTextToIR('Untap all other creatures you control.', 'Ahn-Crop Champion').abilities[0]?.steps ?? [];
    const start = makeState({
      battlefield: [
        creature('champion', 'p1', true),
        creature('support-a', 'p1', true),
        creature('support-b', 'p1', true),
        creature('opponent-bear', 'p2', true),
        {
          id: 'tapped-rock',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          card: { id: 'tapped-rock-card', name: 'Rock', type_line: 'Artifact' },
        },
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'champion' });
    const tappedById = Object.fromEntries((result.state.battlefield as any[]).map(perm => [perm.id, perm.tapped]));

    expect(result.appliedSteps.map(step => step.kind)).toEqual(['tap_or_untap']);
    expect(tappedById).toEqual({
      champion: true,
      'support-a': false,
      'support-b': false,
      'opponent-bear': true,
      'tapped-rock': true,
    });
    expect(result.log.some(line => /no permanents to tap\/untap/i.test(line))).toBe(false);
  });

  it('does not auto-pick the only card in a graveyard for "target ... from a graveyard" when nothing was targeted', () => {
    const steps = parseOracleTextToIR(graveyardReturnText, 'Test').abilities[0]?.steps ?? [];
    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] },
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'g1', name: 'Grizzly Bears', type_line: 'Creature - Bear' }],
          exile: [],
        },
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p2.hand).toHaveLength(0);
    expect(p2.graveyard.map((card: any) => card.id)).toEqual(['g1']);
    expect(result.appliedSteps.some(step => step.kind === 'move_zone')).toBe(false);
    expect(result.skippedSteps.some(step => step.kind === 'move_zone')).toBe(true);
  });

  it('still returns the graveyard card when the caller did bind it as the target', () => {
    const steps = parseOracleTextToIR(graveyardReturnText, 'Test').abilities[0]?.steps ?? [];
    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] },
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'g1', name: 'Grizzly Bears', type_line: 'Creature - Bear' }],
          exile: [],
        },
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', targetPermanentId: 'g1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p2.hand.map((card: any) => card.id)).toEqual(['g1']);
    expect(p2.graveyard).toHaveLength(0);
  });

  it('counts a moved card once when damage equals "that card\'s mana value" (no double counting from runtime + context)', () => {
    const ir = parseOracleTextToIR(
      "Return target instant or sorcery card from your graveyard to your hand. Volcanic Vision deals damage equal to that card's mana value to each creature your opponents control. Exile Volcanic Vision.",
      'Volcanic Vision',
    );
    const bear = (id: string): any => ({
      id,
      ownerId: 'p2',
      controller: 'p2',
      name: id,
      cardType: 'Creature',
      type_line: 'Creature - Bear',
      power: 5,
      toughness: 5,
      tapped: false,
      summoningSick: false,
      counters: {},
    });
    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'mortars', name: 'Mizzium Mortars', type_line: 'Sorcery', mana_cost: '{1}{R}{R}' }],
          exile: [],
        },
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] },
      ],
      stack: [{ id: 'vision-spell', type: 'spell', controller: 'p1', card: { id: 'vision-card', name: 'Volcanic Vision', type_line: 'Sorcery' } }],
      battlefield: [bear('bear-a'), bear('bear-b')],
    });

    const result = applyOracleIRStepsToGameState(start, ir.abilities[0]?.steps ?? [], {
      controllerId: 'p1',
      sourceId: 'vision-spell',
      targetPermanentId: 'mortars',
    });

    expect((result.state.battlefield as any[]).map(perm => perm.damageMarked)).toEqual([3, 3]);
  });

  it('resolves "counter that spell" as a logged no-op once the spell has left the stack', () => {
    const steps = parseOracleTextToIR('Sacrifice this enchantment and counter that spell.', 'Hesitation').abilities[0]?.steps ?? [];
    const start = makeState({
      battlefield: [
        { id: 'hesitation', controller: 'p1', owner: 'p1', card: { id: 'hesitation-card', name: 'Hesitation', type_line: 'Enchantment' } },
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'hesitation', sourceName: 'Hesitation' });

    expect(result.appliedSteps.map(step => step.kind)).toEqual(['sacrifice', 'counter_spell']);
    expect(result.skippedSteps).toHaveLength(0);
    expect(result.state.battlefield).toHaveLength(0);
  });

  it('keeps the Reinforce keyword ability whole (discard cost + add_counter) but strips its reminder from a spell', () => {
    const bare = parseOracleTextToIR(
      'Reinforce 2-{1}{W} ({1}{W}, Discard this card: Put two +1/+1 counters on target creature.)',
      'Burrenton Bombardier',
    );
    expect(bare.abilities).toHaveLength(1);
    expect(bare.abilities[0]?.steps.map(step => step.kind)).toEqual(['add_counter']);

    const spell = parseOracleTextToIR(
      'Destroy target creature with flying. Reinforce 2-{2}{G} ({2}{G}, Discard this card: Put two +1/+1 counters on target creature.)',
      'Fowl Strike',
    );
    const spellSteps = spell.abilities.filter(ability => ability.type === 'spell').flatMap(ability => ability.steps);
    expect(spellSteps.map(step => step.kind)).toEqual(['destroy']);
  });

  it('lowers the Yet Another Night in Vegas menu row and a bare "8: text" row to metadata instead of unknown steps', () => {
    for (const [name, text] of [
      ['Yet Another Night in Vegas', '- All modes reset and can be chosen again'],
      ['Sorin, Vampire Lord', '-8: Until end of turn, each Vampire you control gains "{T}: Gain control of target creature."'],
    ] as const) {
      const steps = parseOracleTextToIR(text, name).abilities.flatMap(ability => ability.steps);
      expect(steps.filter(step => step.kind === 'unknown'), name).toEqual([]);
    }
  });

  it('keeps copy-spell executor state acyclic and serialisable (a cycle here would overflow the stack on serialisation)', () => {
    const steps = parseOracleTextToIR(
      'Exile target instant or sorcery card from a graveyard and copy it. You may cast the copy without paying its mana cost.',
      'Psionic Ritual',
    ).abilities[0]?.steps ?? [];
    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] },
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'target', name: 'Divination', type_line: 'Sorcery', oracle_text: 'Draw two cards.' }],
          exile: [],
        },
      ],
    });

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      { controllerId: 'p1', sourceId: 'ritual', targetPermanentId: 'target' },
      { allowOptional: true },
    );

    expect(() => JSON.stringify(result.state)).not.toThrow();
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.exile.map((card: any) => card.id)).toEqual(['target-copy-1']);
  });

  describe('Martial Coup ("Create X ... tokens. If X is 5 or more, destroy all other creatures.")', () => {
    const coupSteps = () =>
      parseOracleTextToIR(
        'Create X 1/1 white Soldier creature tokens. If X is 5 or more, destroy all other creatures.',
        'Martial Coup',
      ).abilities[0]?.steps ?? [];
    const board = () =>
      makeState({
        battlefield: [
          creature('mine', 'p1', false),
          creature('theirs', 'p2', false),
          { ...creature('old-soldier', 'p2', false), isToken: true },
          {
            ...creature('indestructible-one', 'p2', false),
            card: { id: 'ind-card', name: 'Darksteel Colossus', type_line: 'Creature - Golem', oracle_text: 'Indestructible', power: '11', toughness: '11' },
          },
        ],
      });

    it('X=4 creates four Soldiers and leaves the rest of the board alone', () => {
      const result = applyOracleIRStepsToGameState(board(), coupSteps(), { controllerId: 'p1', sourceId: 'coup', sourceName: 'Martial Coup', xValue: 4 });
      const bf = result.state.battlefield as any[];
      expect(result.appliedSteps.map(step => step.kind)).toEqual(['create_token']);
      expect(bf.filter(perm => perm.isToken && perm.id !== 'old-soldier')).toHaveLength(4);
      expect(bf.map(perm => perm.id)).toEqual(expect.arrayContaining(['mine', 'theirs', 'old-soldier', 'indestructible-one']));
    });

    it('X=5 creates five Soldiers, then destroys all other creatures: the new Soldiers and indestructible creatures survive, older tokens do not', () => {
      const result = applyOracleIRStepsToGameState(board(), coupSteps(), { controllerId: 'p1', sourceId: 'coup', sourceName: 'Martial Coup', xValue: 5 });
      const bf = result.state.battlefield as any[];
      expect(result.appliedSteps.map(step => step.kind)).toEqual(['create_token', 'destroy']);
      const ids = bf.map(perm => perm.id);
      expect(ids).not.toContain('mine');
      expect(ids).not.toContain('theirs');
      expect(ids).not.toContain('old-soldier');
      expect(ids).toContain('indestructible-one');
      expect(bf.filter(perm => perm.isToken)).toHaveLength(5);
    });

    it('uses the announced X, not the mana actually spent (X=7 still makes seven Soldiers)', () => {
      const result = applyOracleIRStepsToGameState(board(), coupSteps(), { controllerId: 'p1', sourceId: 'coup', sourceName: 'Martial Coup', xValue: 7 });
      expect((result.state.battlefield as any[]).filter(perm => perm.isToken)).toHaveLength(7);
    });
  });

  describe('RulesBridge post-payment validation of an X spell (Martial Coup {X}{W}{W})', () => {
    const makeAdapter = () => {
      const adapter = new RulesEngineAdapter();
      adapter.initializeGame('coup-game', {
        id: 'coup-game', format: 'commander', life: {}, turnPlayer: 'p1', priority: 'p1', active: true,
        players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], library: [], graveyard: [], battlefield: [], exile: [], commandZone: [], counters: {}, hasLost: false,
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } }],
        turnOrder: ['p1'], activePlayerIndex: 0, priorityPlayerIndex: 0, turn: 1, phase: 'precombatMain', step: 'main', stack: [], battlefield: [],
        commandZone: {}, startingLife: 40, allowUndos: false, turnTimerEnabled: false, turnTimerSeconds: 0, createdAt: 0, lastActionAt: 0, spectators: [], status: 'inProgress',
      } as any);
      return adapter;
    };
    const cast = { type: 'castSpell', playerId: 'p1', cardName: 'Martial Coup', manaCost: '{X}{W}{W}', xValue: 5 } as any;

    it('still rejects an unpaid cast when the pool is empty', () => {
      const validation = makeAdapter().validateAction('coup-game', cast);
      expect(validation.legal).toBe(false);
      expect(validation.reason).toContain('white mana');
    });

    it('does not re-check the (already emptied) pool when the server says mana was already paid', () => {
      const validation = makeAdapter().validateAction('coup-game', { ...cast, manaAlreadyPaid: true });
      expect(validation.legal).toBe(true);
    });
  });
});