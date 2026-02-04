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

  it('marks "You may" clauses as optional', () => {
    const text = 'You may draw a card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('draw');
    expect((steps[0] as any).optional).toBe(true);
  });
});
