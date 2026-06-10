import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyRemoveCounterStep } from '../src/oracleIRExecutorBattlefieldStepHandlers.js';
import { trySpecialExileStep } from '../src/oracleIRExecutorSpecialTargetHandlers.js';
import { parseMoveZoneUpToCountTotalMvFromYourGraveyard } from '../src/oracleIRExecutorZoneOps.js';
import type { GameState } from '../../shared/src/index.js';

describe('oracle IR gap batch 44', () => {
  it('repairs jailbreak opponent graveyard return with controller override', () => {
    const text =
      "Return target permanent card in an opponent's graveyard to the battlefield under their control.";
    const ir = parseOracleTextToIR(text, 'Jailbreak');
    const move = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'move_zone') as any;
    expect(move?.what?.text).toBe('target permanent card from target opponent\'s graveyard');
    expect(move?.battlefieldController?.kind).toBe('owner_of_moved_cards');
  });

  it('parses witness the future target-player graveyard shuffle', () => {
    const text =
      'Target player shuffles up to four target cards from their graveyard into their library.';
    const ir = parseOracleTextToIR(text, 'Witness the Future');
    const move = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'move_zone') as any;
    expect(move?.to).toBe('library');
    expect(move?.what?.text).toMatch(/up to four target cards from target player's graveyard/i);
  });

  it('parses eventide shadow among-battlefield counter removal', () => {
    const text =
      'Remove any number of counters from among permanents on the battlefield. You draw cards and lose life equal to the number of counters removed this way.';
    const ir = parseOracleTextToIR(text, "Eventide's Shadow");
    const remove = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'remove_counter') as any;
    expect(remove?.counter).toBe('any');
    expect(remove?.target?.text).toBe('among permanents on the battlefield');
    const draw = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'draw') as any;
    expect(draw?.amount?.raw).toBe('that many');
  });

  it('executes eventide counter removal and tracks removed count', () => {
    const step = {
      kind: 'remove_counter' as const,
      amount: { kind: 'any_number' as const },
      counter: 'any',
      target: { kind: 'raw' as const, text: 'among permanents on the battlefield' },
      raw: 'Remove any number of counters from among permanents on the battlefield',
    };
    const state = {
      battlefield: [
        {
          id: 'bf-1',
          type_line: 'Creature — Spirit',
          controller: 'p1',
          counters: { '+1/+1': 2, shield: 1 },
        },
      ],
      players: [{ id: 'p1', life: 40 }],
    } as unknown as GameState;
    const result = applyRemoveCounterStep(state, step, { controllerId: 'p1' });
    expect(result.applied).toBe(true);
    expect((result as any).count).toBe(3);
  });

  it('splits ugin +1 exile and look steps', () => {
    const text =
      'Exile the top card of your library face down and look at it. Create a 2/2 colorless Spirit creature token.';
    const ir = parseOracleTextToIR(text, 'Ugin, the Ineffable');
    const kinds = ir.abilities.flatMap((a) => a.steps).map((s) => s.kind);
    expect(kinds).toContain('exile');
    expect(kinds).toContain('look_top');
    const exile = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'exile') as any;
    expect(exile?.target?.text).toBe('the top card of your library');
  });

  it('executes ugin top-card face-down exile', () => {
    const step = {
      kind: 'exile' as const,
      target: { kind: 'raw' as const, text: 'the top card of your library' },
      raw: 'Exile the top card of your library face down',
    };
    const state = {
      players: [
        {
          id: 'p1',
          library: [{ id: 'lib-1', name: 'Top Card', type_line: 'Instant', cmc: 2 }],
          exile: [],
        },
      ],
      battlefield: [],
    } as unknown as GameState;
    const result = trySpecialExileStep(state, step, { controllerId: 'p1' });
    expect(result?.applied).toBe(true);
  });

  it('repairs war in heaven saga III into total-mv graveyard return', () => {
    const text =
      'III — Choose up to three target creature cards with total mana value 8 or less in your graveyard. Return each of them to the battlefield with a necrodermis counter on it.';
    const ir = parseOracleTextToIR(text, 'The War in Heaven');
    const choose = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'choose_target_creature');
    expect(choose).toBeUndefined();
    const move = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'move_zone') as any;
    expect(move?.what?.text).toMatch(/up to three creature cards with total mana value 8 or less from your graveyard/i);
    expect(
      parseMoveZoneUpToCountTotalMvFromYourGraveyard({ kind: 'raw', text: move.what.text })
    ).toEqual({ maxCount: 3, totalManaValueLte: 8, cardType: 'creature' });
  });
});
