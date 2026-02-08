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

  it('normalizes "each of your opponents" into an each_opponent selector', () => {
    const text = 'Each of your opponents draws a card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('draw');
    expect((steps[0] as any).who).toEqual({ kind: 'each_opponent' });
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 1 });
  });

  it('normalizes "your opponents" into an each_opponent selector', () => {
    const text = 'Your opponents mill a card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('mill');
    expect((steps[0] as any).who).toEqual({ kind: 'each_opponent' });
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses exile_top for each of your opponents' libraries", () => {
    const text = "Exile the top card of each of your opponents' libraries.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses exile_top for each opponent’s library (curly apostrophe)', () => {
    const text = 'Exile the top card of each opponent’s library.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses exile_top for each opponent's library (straight apostrophe)", () => {
    const text = "Exile the top card of each opponent's library.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses exile_top for 'put the top card of each opponent's library into exile'", () => {
    const text = "Put the top card of each opponent's library into exile.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses exile_top for 'each player puts the top two cards of their library into exile'", () => {
    const text = 'Each player puts the top two cards of their library into exile.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_player' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 2 });
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

  it('parses create-token with "an additional" counter wording', () => {
    const text = 'Create a Treasure token with an additional +1/+1 counter on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ '+1/+1': 1 });
  });

  it('applies follow-up "enters tapped" clauses to the previous create-token step', () => {
    const text = 'Create a Treasure token. It enters tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(1);
    expect(creates[0].entersTapped).toBe(true);

    // The follow-up clause should not appear as an unknown step.
    const unknowns = steps.filter(s => s.kind === 'unknown') as any[];
    expect(unknowns.some(u => String(u.raw || '').toLowerCase().includes('enters tapped'))).toBe(false);
  });

  it('applies follow-up "those tokens enter tapped" to multi-token creation', () => {
    const text = 'Create a Treasure token and a Clue token. Those tokens enter tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(2);
    expect(String(creates[0].token || '').toLowerCase()).toContain('treasure');
    expect(String(creates[1].token || '').toLowerCase()).toContain('clue');
    expect(creates[0].entersTapped).toBe(true);
    expect(creates[1].entersTapped).toBe(true);
  });

  it('applies follow-up "they enter tapped" (Bloomburrow-style) to the previous create-token step(s)', () => {
    const text = 'Create two Treasure tokens. They enter tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(1);
    expect(creates[0].entersTapped).toBe(true);

    // The follow-up clause should not appear as an unknown step.
    const unknowns = steps.filter(s => s.kind === 'unknown') as any[];
    expect(unknowns.some(u => String(u.raw || '').toLowerCase().includes('they enter tapped'))).toBe(false);
  });

  it('applies follow-up "they enter tapped" to multi-token creation', () => {
    const text = 'Create a Treasure token and a Clue token. They enter tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(2);
    expect(String(creates[0].token || '').toLowerCase()).toContain('treasure');
    expect(String(creates[1].token || '').toLowerCase()).toContain('clue');
    expect(creates[0].entersTapped).toBe(true);
    expect(creates[1].entersTapped).toBe(true);
  });

  it('applies follow-up plural "they enter with counters" wording', () => {
    const text = 'Create two Treasure tokens. They enter with two +1/+1 counters on them.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
  });

  it('supports combined plural follow-up modifiers (tapped and with counters)', () => {
    const text = 'Create two Treasure tokens. They enter tapped and with two +1/+1 counters on them.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.entersTapped).toBe(true);
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
  });

  it('supports semicolon + lowercase follow-up wording (they enter tapped)', () => {
    const text = 'Create two Treasure tokens; they enter tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.amount).toEqual({ kind: 'number', value: 2 });
    expect(create.entersTapped).toBe(true);
  });

  it('supports plural follow-up with singular counter wording (a shield counter)', () => {
    const text = 'Create two Treasure tokens. They enter with a shield counter on them.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ shield: 1 });
  });

  it('applies follow-up "enters with counters" clauses to the previous create-token step', () => {
    const text = 'Create a Treasure token. It enters with two +1/+1 counters on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
  });

  it('applies follow-up "enters with an additional" counter wording', () => {
    const text = 'Create a Treasure token. It enters with an additional +1/+1 counter on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ '+1/+1': 1 });
  });

  it('supports follow-up "enter the battlefield" phrasing for tapped + counters', () => {
    const text = 'Create a Treasure token. It enters the battlefield tapped and with two +1/+1 counters on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.entersTapped).toBe(true);
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
  });

  it('supports follow-up counters then tapped order', () => {
    const text = 'Create a Treasure token. It enters with two +1/+1 counters on it and tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.entersTapped).toBe(true);
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
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

  it('parses standalone exile-top (no permission clause) into exile_top step', () => {
    const text = 'Exile the top card of your library.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const step = steps.find(s => s.kind === 'exile_top') as any;
    expect(step).toBeTruthy();
    expect(step.who).toEqual({ kind: 'you' });
    expect(step.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses standalone exile-top for each player's library", () => {
    const text = "Exile the top two cards of each player's library.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const step = steps.find(s => s.kind === 'exile_top') as any;
    expect(step).toBeTruthy();
    expect(step.who).toEqual({ kind: 'each_player' });
    expect(step.amount).toEqual({ kind: 'number', value: 2 });
  });

  it('parses exile_top from triggered ability effect text', () => {
    const text = "Whenever Etali attacks, exile the top card of each player's library.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];
    expect(ability.type).toBe('triggered');
    expect(ability.triggerCondition).toBe('Etali attacks');

    const step = ability.steps.find(s => s.kind === 'exile_top') as any;
    expect(step).toBeTruthy();
    expect(step.who).toEqual({ kind: 'each_player' });
    expect(step.amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses exile_top from replacement effect (instead pattern)', () => {
    const text = 'If you would draw a card, exile the top two cards of your library instead.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];
    expect(ability.type).toBe('replacement');

    const step = ability.steps.find(s => s.kind === 'exile_top') as any;
    expect(step).toBeTruthy();
    expect(step.who).toEqual({ kind: 'you' });
    expect(step.amount).toEqual({ kind: 'number', value: 2 });
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

  it('parses impulse exile-top with until-end-of-turn (suffix form) permission', () => {
    const text = 'Exile the top three cards of your library. You may play those cards until end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with this-turn permission referencing the exiled card', () => {
    const text = 'Exile the top card of your library. You may play the exiled card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission is granted to "they" (target player)', () => {
    const text = 'Target player exiles the top card of their library. They may play it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission is granted to "that player" (target player)', () => {
    const text = 'Target player exiles the top card of their library. That player may cast it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission is granted to "that opponent" (target opponent)', () => {
    const text = 'Target opponent exiles the top card of their library. That opponent may play it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('upgrades target-opponent exile_top into impulse when deterministic text intervenes', () => {
    const text =
      'Target opponent exiles the top card of their library. You gain 2 life. Until end of turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('upgrades face-down look+exile into impulse when deterministic text intervenes', () => {
    const text =
      "Look at the top card of target opponent's library, then exile it face down. You gain 2 life. Until end of turn, you may play that card.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with cast-that-spell permission', () => {
    const text = 'Exile the top card of your library. You may cast that spell this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when the exiled card is castable with no explicit duration', () => {
    const text = 'Exile the top card of your library. You may cast that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with an inline X definition clause', () => {
    const text =
      'Exile the top X cards of your library, where X is one plus the mana value of the sacrificed artifact. You may play those cards this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'x' });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with an intervening look clause', () => {
    const text =
      'Exile the top card of your library. You may look at that card for as long as it remains exiled. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with a look-any-time clause intervening', () => {
    const text = 'Exile the top card of your library. You may look at that card any time. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with a parenthetical look-any-time reminder intervening', () => {
    const text = 'Exile the top card of your library. (You may look at it any time.) You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it("parses impulse exile-top from each of those opponents' libraries as an unsupported selector", () => {
    const text =
      "Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'unknown', raw: "each of those opponents'" });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with during-resolution cast-from-among (Etali-style)', () => {
    const text =
      "Whenever Etali attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];
    expect(ability.type).toBe('triggered');
    expect(ability.triggerCondition).toBe('Etali attacks');

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with look + spend-mana reminders intervening', () => {
    const text =
      'Exile the top card of your library. You may look at that card any time. You may spend mana as though it were mana of any color to cast it. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with look + spend-mana + choose-one intervening', () => {
    const text =
      'Exile the top two cards of your library. You may look at those cards any time. You may spend mana as though it were mana of any color to cast them. Choose one of them. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when a deterministic clause intervenes before the permission window', () => {
    const text =
      'Exile the top card of your library. You gain life equal to that card’s mana value. Until end of turn, you may cast that card and you may spend mana as though it were mana of any color to cast it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');

    const hasInterveningClause = steps.some(s => String((s as any).raw || '').toLowerCase().includes('gain life'));
    expect(hasInterveningClause).toBe(true);
  });

  it("parses impulse exile-top for each player's library", () => {
    const text = "Exile the top card of each player's library. You may play those cards this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with mana-spend reminder suffix', () => {
    const text =
      "Exile the top card of each player's library. Until the end of your next turn, you may play those cards, and mana of any type can be spent to cast those spells.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it("parses impulse exile-top for each player's library referencing the exiled cards", () => {
    const text = "Exile the top card of each player's library. You may play the exiled cards this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it("parses impulse exile-top for each player's library referencing the exiled spells", () => {
    const text = "Exile the top card of each player's library. You may cast the exiled spells this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-top for each opponent's library", () => {
    const text = "Exile the top two cards of each opponent's library. Until end of turn, you may cast them.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-top when a target opponent exiles the top card of their library", () => {
    const text = "Target opponent exiles the top card of their library. Until end of turn, you may play that card.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with intervening "Choose one of them" clause', () => {
    const text =
      'Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "If you do," prefix and then-split choose clause', () => {
    const text = 'If you do, exile the top two cards of your library, then choose one of them. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top for target opponent library with intervening choose clause', () => {
    const text =
      "Exile the top three cards of target opponent's library. Choose one of them. Until the end of your next turn, you may play that card.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
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

  it('parses impulse exile-top with next-turn permission (missing "the")', () => {
    const text = 'Exile the top card of your library. Until end of your next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (no "your")', () => {
    const text = 'Exile the top card of your library. Until the end of next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (end of the next turn)', () => {
    const text = 'Exile the top card of your library. Until end of the next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with leading until-end-of-turn for those cards', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with leading until-the-end-of-turn for those cards', () => {
    const text = 'Exile the top two cards of your library. Until the end of turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with leading until-end-of-your-next-turn for those cards', () => {
    const text = 'Exile the top two cards of your library. Until the end of your next turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (trailing until, missing "the")', () => {
    const text = 'Exile the top card of your library. You may play that card until end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (trailing until, no "your")', () => {
    const text = 'Exile the top card of your library. You may play that card until end of next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (trailing until, end of the next turn)', () => {
    const text = 'Exile the top card of your library. You may play that card until end of the next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with until-your-next-turn permission', () => {
    const text = 'Exile the top two cards of your library. Until your next turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-end-step permission (leading)', () => {
    const text = 'Exile the top card of your library. Until your next end step, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-end-step permission (trailing)', () => {
    const text = 'Exile the top card of your library. You may play it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with in-clause mana-spend reminder', () => {
    const text =
      'Exile the top card of your library. Until end of turn, you may play that card and you may spend mana as though it were mana of any color to cast it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with cast-spells-from-among-them permission', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may cast spells from among them.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-a-spell-from-among-those-cards until-end-of-turn permission', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may cast a spell from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-a-spell-from-among-those-cards until-end-of-your-next-turn permission', () => {
    const text =
      'Exile the top two cards of your library. Until the end of your next turn, you may cast a spell from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with play-lands-and-cast-spells-from-among-those-cards permission', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may play lands and cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with play-lands-and-cast-spells from among those cards until end of your next turn', () => {
    const text =
      'Exile the top two cards of your library. Until the end of your next turn, you may play lands and cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with trailing play-lands-and-cast-spells from among those cards until end of your next turn', () => {
    const text =
      'Exile the top two cards of your library. You may play lands and cast spells from among those cards until end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with cast-spells-from-among-those-exiled-cards permission', () => {
    const text =
      "Exile the top card of each player's library. Until end of turn, you may cast spells from among those exiled cards.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission says cast spells from among the exiled cards', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may cast spells from among the exiled cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission says cast spells from among the cards exiled this way', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may cast spells from among the cards exiled this way.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission says cast spells from among those cards', () => {
    const text = 'Exile the top two cards of your library. Until the end of turn, you may cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission says cast spells from among those cards exiled this way', () => {
    const text =
      'Exile the top two cards of your library. Until end of turn, you may cast spells from among those cards exiled this way.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-spells-from-among-them this-turn permission', () => {
    const text = 'Exile the top two cards of your library. You may cast spells from among them this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-a-spell-from-among-them this-turn permission', () => {
    const text = 'Exile the top two cards of your library. You may cast a spell from among them this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-spells-from-among-those-exiled-cards this-turn permission', () => {
    const text =
      'Exile the top card of your library. You may cast spells from among those exiled cards this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-spells-from-among-them until end of turn permission', () => {
    const text = 'Exile the top two cards of your library. You may cast spells from among them until end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-spells-from-among-those-exiled-cards until end of turn permission', () => {
    const text =
      'Exile the top card of your library. You may cast spells from among those exiled cards until the end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with in-clause spend-mana reminder after play permission', () => {
    const text =
      "Exile the top card of each player's library. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with each-player next-end-step permission', () => {
    const text =
      'Each player exiles the top card of their library. Until your next end step, each player may play the card they exiled this way.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with each-opponent subject-order clause', () => {
    const text =
      'Each opponent exiles the top two cards of their library. Until end of turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when among-clause restricts to an artifact spell (this turn)', () => {
    const text =
      'Exile the top five cards of your library. You may cast an artifact spell from among them this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 5 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause restricts to instant or sorcery (until end of next turn)', () => {
    const text =
      'Exile the top five cards of your library. Until the end of your next turn, you may cast an instant or sorcery spell from among those exiled cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 5 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with until-the-beginning-of-your-next-upkeep duration', () => {
    const text = 'Exile the top card of your library. Until the beginning of your next upkeep, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with immediate cast permission and follow-up if-you-dont clause (Chandra-style)', () => {
    const text = "Exile the top card of your library. You may cast that card. If you don't, it deals 2 damage to each opponent.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with immediate cast-it permission (no explicit duration)', () => {
    const text = "Exile the top card of your library. You may cast it. If you don't, create a Treasure token.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with immediate cast-it without-paying-mana-cost permission plus trailing if restriction', () => {
    const text =
      "Exile the top card of your library. You may cast it without paying its mana cost if it's a spell with mana value 2 or less. If you don't, put it into your graveyard.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with up-to-two limit in permission clause', () => {
    const text =
      'Exile the top three cards of your library. You may play up to two of those cards until the end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with one-of limit in permission clause', () => {
    const text = 'Exile the top two cards of your library. You may play one of those cards this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with one-of limit in cast permission clause', () => {
    const text = 'Exile the top two cards of your library. You may cast one of those cards this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with "you may play them until the end of your next turn" wording', () => {
    const text = 'Exile the top card of your library. You may play them until the end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "you may play those cards this turn" wording', () => {
    const text = 'Exile the top two cards of your library. You may play those cards this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "you may play it this turn" wording', () => {
    const text = 'Exile the top card of your library. You may play it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "you may play them this turn" wording', () => {
    const text = 'Exile the top three cards of your library. You may play them this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "you may play them until end of turn" wording', () => {
    const text = 'Exile the top two cards of your library. You may play them until end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until your next turn, you may play those cards" wording', () => {
    const text = 'Exile the top card of each player\'s library. Until your next turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "you may cast it this turn" wording', () => {
    const text = 'Exile the top card of your library. You may cast it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top referencing cards exiled this way', () => {
    const text = 'Exile the top card of your library. You may play cards exiled this way until the end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top referencing the card exiled this way', () => {
    const text = 'Exile the top card of your library. You may play the card exiled this way until the end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with a without-paying-mana-cost suffix', () => {
    const text = 'Exile the top card of your library. You may cast it this turn without paying its mana cost.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with without-paying-that-spell\'s-mana-cost suffix', () => {
    const text = "Exile the top card of your library. You may cast that spell this turn without paying that spell's mana cost.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with without-paying-that-spell’s-mana-cost suffix (curly apostrophe)', () => {
    const text = 'Exile the top card of your library. You may cast that spell this turn without paying that spell’s mana cost.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with without-paying-those-spells\'-mana-costs suffix', () => {
    const text = "Exile the top two cards of your library. You may cast those spells this turn without paying those spells' mana costs.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause says until the end of this turn', () => {
    const text = 'Exile the top two cards of your library. You may cast spells from among those cards until the end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause is leading until the end of this turn', () => {
    const text = 'Exile the top two cards of your library. Until the end of this turn, you may cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause says play lands and cast spells until the end of this turn', () => {
    const text =
      'Exile the top two cards of your library. You may play lands and cast spells from among those cards until the end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when among-clause is leading until the end of this turn for play lands and cast spells', () => {
    const text =
      'Exile the top two cards of your library. Until the end of this turn, you may play lands and cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when among-clause says cast spells through end of turn', () => {
    const text = 'Exile the top two cards of your library. You may cast spells from among those cards through end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause is leading through the end of this turn (cast spells)', () => {
    const text = 'Exile the top two cards of your library. Through the end of this turn, you may cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause says play lands and cast spells through the end of turn', () => {
    const text =
      'Exile the top two cards of your library. You may play lands and cast spells from among those cards through the end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when among-clause is leading through end of this turn (play lands and cast spells)', () => {
    const text =
      'Exile the top two cards of your library. Through end of this turn, you may play lands and cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission is during your next turn', () => {
    const text = 'Exile the top card of your library. During your next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when next-turn permission has a trailing if restriction', () => {
    const text = 'Exile the top card of your library. Until your next turn, you may cast it if it\'s an instant or sorcery spell.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when leading remains-exiled permission has a trailing if restriction', () => {
    const text = 'Exile the top card of your library. For as long as it remains exiled, you may cast it if it\'s a creature spell.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with remains-exiled permission', () => {
    const text = 'Exile the top card of your library. You may play that card for as long as it remains exiled.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "as long as" remains-exiled permission', () => {
    const text = 'Exile the top card of your library. You may play that card as long as it remains exiled.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when remains-exiled permission is leading (and has a trailing if restriction)', () => {
    const text = 'Exile the top card of your library. For as long as that card remains exiled, you may play it if you control a Kavu.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of the turn" phrasing', () => {
    const text = 'Exile the top card of your library. Until the end of the turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of this turn" phrasing', () => {
    const text = 'Exile the top card of your library. Until the end of this turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of that turn" phrasing', () => {
    const text = 'Exile the top card of your library. Until the end of that turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of that turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card until the end of that turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of this turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card until the end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through end of turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through end of this turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through end of next turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through end of next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through the end of turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through the end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through the end of this turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through the end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through the end of next turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through the end of next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
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

  it('parses conditional impulse with an unmodeled predicate by ignoring the condition', () => {
    const text = "Exile the top card of your library. If it's a Goblin creature card, you may cast that card until the end of your next turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toBeUndefined();
  });

  it('marks "You may" clauses as optional', () => {
    const text = 'You may draw a card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('draw');
    expect((steps[0] as any).optional).toBe(true);
  });

  it('parses face-down exile with combined look-and-play permission', () => {
    const text =
      'Exile the top card of your library face down. You may look at and play that card this turn.';

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const impulse = steps.find((s) => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();

    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it('parses face-down exile with combined look-and-play remains-exiled permission', () => {
    const text =
      "Exile the top card of each opponent's library face down. You may look at and play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses target-opponent face-down impulse with remains-exiled permission', () => {
    const text =
      "Exile the top two cards of target opponent's library face down. You may look at and play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses look-then-exile face-down impulse (your library)', () => {
    const text =
      'Look at the top card of your library, then exile it face down. You may play it for as long as it remains exiled.';

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses look-then-exile face-down impulse (that player's library)", () => {
    const text =
      "Look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses look-then-exile face-down impulse (their library)", () => {
    const text =
      'Look at the top card of their library, then exile it face down. For as long as it remains exiled, you may play it.';

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses combined look+exile face-down impulse (each opponent)', () => {
    const text =
      "Look at the top card of each opponent's library and exile those cards face down. You may play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses combined look+exile face-down impulse (target opponent, top two)', () => {
    const text =
      "Look at the top two cards of target opponent's library and exile those cards face down. You may play those cards for as long as they remain exiled, and mana of any type can be spent to cast them.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses combined look+exile face-down impulse when look clause is prefixed by 'then' (that player's library)", () => {
    const text =
      "Create a Treasure token, then look at the top card of that player's library and exile it face down. You may cast that card for as long as it remains exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('cast');
  });
});
