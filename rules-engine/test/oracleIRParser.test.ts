import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

describe('Oracle IR Parser', () => {
  it('parses ordered draw/then-discard into IR steps', () => {
    const text = 'Draw two cards. Then discard a card.';
    const ir = parseOracleTextToIR(text);

    expect(ir.abilities.length).toBeGreaterThanOrEqual(1);
    const steps = ir.abilities[0].steps;
    expect(steps.length).toBeGreaterThanOrEqual(2);

    expect(steps[0].kind).toBe('draw');
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 2 });

    expect(steps[1].kind).toBe('discard');
    expect((steps[1] as any).amount).toEqual({ kind: 'number', value: 1 });
    expect((steps[1] as any).sequence).toBe('then');
  });

  it('parses token creation into IR steps', () => {
    const text = 'Draw a card. Create a 1/1 white Soldier creature token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps.map(s => s.kind)).toContain('draw');
    expect(steps.map(s => s.kind)).toContain('create_token');

    const tokenStep = steps.find(s => s.kind === 'create_token') as any;
    expect(tokenStep.amount).toEqual({ kind: 'number', value: 1 });
    expect(tokenStep.token).toContain('1/1');
    expect(tokenStep.token.toLowerCase()).toContain('soldier');
  });

  it('parses multi-token creation in a single clause into multiple steps', () => {
    const text = 'Create two Treasure tokens and a Clue token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(2);
    expect(creates[0].amount).toEqual({ kind: 'number', value: 2 });
    expect(String(creates[0].token || '').toLowerCase()).toContain('treasure');
    expect(creates[1].amount).toEqual({ kind: 'number', value: 1 });
    expect(String(creates[1].token || '').toLowerCase()).toContain('clue');
  });

  it('preserves who selector for multi-token create clauses', () => {
    const text = 'Each opponent creates a Treasure token and a Food token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(2);
    expect(creates[0].who).toEqual({ kind: 'each_opponent' });
    expect(creates[1].who).toEqual({ kind: 'each_opponent' });
  });

  it('parses comma-separated multi-token creation lists', () => {
    const text = 'Create a Treasure token, a Food token, and a Clue token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const creates = steps.filter(s => s.kind === 'create_token') as any[];

    expect(creates).toHaveLength(3);
    expect(creates.map(c => c.amount)).toEqual([
      { kind: 'number', value: 1 },
      { kind: 'number', value: 1 },
      { kind: 'number', value: 1 },
    ]);
    const tokens = creates.map(c => String(c.token || '').toLowerCase());
    expect(tokens.join(' ')).toContain('treasure');
    expect(tokens.join(' ')).toContain('food');
    expect(tokens.join(' ')).toContain('clue');
  });

  it('preserves who selector for comma-separated multi-token create clauses', () => {
    const text = 'Each opponent creates two Treasure tokens, a Clue token, and a Food token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const creates = steps.filter(s => s.kind === 'create_token') as any[];

    expect(creates).toHaveLength(3);
    expect(creates[0].who).toEqual({ kind: 'each_opponent' });
    expect(creates[1].who).toEqual({ kind: 'each_opponent' });
    expect(creates[2].who).toEqual({ kind: 'each_opponent' });
    expect(creates[0].amount).toEqual({ kind: 'number', value: 2 });
  });

  it('parses create-token enters-tapped modifier', () => {
    const text = 'Create a tapped Treasure token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.entersTapped).toBe(true);
    expect(String(create.token || '').toLowerCase()).toContain('treasure');
  });

  it('parses create-token enters-tapped when "tapped" appears after token', () => {
    const text = 'Create a Treasure token tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.entersTapped).toBe(true);
    expect(String(create.token || '').toLowerCase()).toContain('treasure');
  });

  it('parses per-segment enters-tapped in multi-token clauses', () => {
    const text = 'Create a Treasure token tapped and a Clue token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(2);
    expect(String(creates[0].token || '').toLowerCase()).toContain('treasure');
    expect(creates[0].entersTapped).toBe(true);
    expect(String(creates[1].token || '').toLowerCase()).toContain('clue');
    expect(Boolean(creates[1].entersTapped)).toBe(false);
  });

  it('parses create-token with-counters modifier', () => {
    const text = 'Create a 1/1 white Soldier creature token with two +1/+1 counters on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
    expect(String(create.token || '').toLowerCase()).toContain('soldier');
  });

  it('parses exile and return/move zone clauses', () => {
    const text = 'Exile target creature. Return it to the battlefield under your control at the beginning of the next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('exile');
    expect((steps[0] as any).target?.text?.toLowerCase?.() || '').toContain('target');

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
  });

  it('parses mill clauses into IR steps', () => {
    const text = 'Each opponent mills two cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const mill = steps.find(s => s.kind === 'mill') as any;
    expect(mill).toBeTruthy();
    expect(mill.who).toEqual({ kind: 'each_opponent' });
    expect(mill.amount).toEqual({ kind: 'number', value: 2 });
  });

  it('parses scry and surveil clauses into IR steps', () => {
    const text = 'Scry 2. Then surveil 1.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const scry = steps.find(s => s.kind === 'scry') as any;
    expect(scry).toBeTruthy();
    expect(scry.who).toEqual({ kind: 'you' });
    expect(scry.amount).toEqual({ kind: 'number', value: 2 });

    const surveil = steps.find(s => s.kind === 'surveil') as any;
    expect(surveil).toBeTruthy();
    expect(surveil.who).toEqual({ kind: 'you' });
    expect(surveil.amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses deterministic add mana clauses into IR steps', () => {
    const text = 'Add {R}{R}{R}.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const addMana = steps.find(s => s.kind === 'add_mana') as any;
    expect(addMana).toBeTruthy();
    expect(addMana.who).toEqual({ kind: 'you' });
    expect(addMana.mana).toBe('{R}{R}{R}');
  });

  it('parses impulse exile-top with this-turn permission', () => {
    const text = 'Exile the top card of your library. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission', () => {
    const text = 'Exile the top card of your library. Until the end of your next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses conditional impulse (nonland cast this turn)', () => {
    const text = "Exile the top card of your library. If it's a nonland card, you may cast it this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'type', type: 'nonland' });
  });

  it('parses conditional impulse (red cast until end of next turn)', () => {
    const text = "Exile the top card of your library. If it's red, you may cast it until the end of your next turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'color', color: 'R' });
  });

  it('parses conditional impulse variant (that card is red)', () => {
    const text = "Exile the top card of your library. If that card is red, you may cast it this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'color', color: 'R' });
  });

  it('parses conditional impulse variant (the exiled card is a nonland card)', () => {
    const text = "Exile the top card of your library. If the exiled card is a nonland card, you may cast that card this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'type', type: 'nonland' });
  });

  it("parses conditional impulse plural variant (they're nonland cards)", () => {
    const text = "Exile the top two cards of your library. If they're nonland cards, you may cast them this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'type', type: 'nonland' });
  });

  it('marks "You may" clauses as optional', () => {
    const text = 'You may draw a card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('draw');
    expect((steps[0] as any).optional).toBe(true);
  });
});
