import { describe, it, expect } from 'vitest';
import { reduceGenericManaCost, getGrantedForetellCost, oracleGrantsHandForetell } from '../src/state/modules/foretellGrants';
import { hasCommanderPregameColorChoice, rememberCommanderPregameColor, applyRememberedCommanderPregameColor } from '../src/state/modules/commanderPregameColorChoice';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify';
import { detectTriggerDoublers } from '../src/state/modules/triggers/trigger-doublers';

const GRANT = 'Flying\nEach nonland card in your hand without foretell has foretell. Its foretell cost is equal to its mana cost reduced by {2}.';
const ELESH = 'If a permanent entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.';

describe('round 27 census groups', () => {
  it('reduces generic mana', () => {
    expect(reduceGenericManaCost('{3}{U}', 2)).toBe('{1}{U}');
    expect(reduceGenericManaCost('{1}{U}{U}', 2)).toBe('{U}{U}');
  });
  it('grants foretell to nonland hand cards only', () => {
    expect(oracleGrantsHandForetell(GRANT)).toBeTruthy();
    const state: any = { battlefield: [{ id: 'g', controller: 'p1', card: { name: 'Census Seer', oracle_text: GRANT } }] };
    expect(getGrantedForetellCost(state, 'p1', { name: 'Census Bolt', mana_cost: '{4}{R}', type_line: 'Instant', oracle_text: 'Deal 3.' })).toBe('{2}{R}');
    expect(getGrantedForetellCost(state, 'p1', { name: 'Census Land', mana_cost: '', type_line: 'Land', oracle_text: '' })).toBeFalsy();
    expect(getGrantedForetellCost(state, 'p2', { name: 'Census Bolt', mana_cost: '{4}{R}', type_line: 'Instant', oracle_text: 'Deal 3.' })).toBeFalsy();
  });
  it('remembers a commander pregame colour', () => {
    const card: any = { id: 'cp', name: 'Census Piper', oracle_text: 'If Census Piper is your commander, choose a color before the game begins. Census Piper is the chosen color.' };
    expect(hasCommanderPregameColorChoice(card)).toBe(true);
    const state: any = { battlefield: [], commandZone: { p1: { commanderIds: ['cp'] } } };
    rememberCommanderPregameColor(state, { id: 'x', controller: 'p1', card } as any, 'blue');
    const perm: any = { id: 'y', controller: 'p1', card: { ...card } };
    expect(applyRememberedCommanderPregameColor(state, 'p1', perm)).toBeTruthy();
    expect(perm.chosenColor ?? perm.card.chosenColor).toBe('blue');
  });
  it('detects an Elesh-style doubler', () => {
    const d = detectTriggerDoublers([{ id: 'e', controller: 'p1', card: { name: 'Census Norn', oracle_text: ELESH } }] as any, 'p1');
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((x: any) => !x.unsupportedReason)).toBe(true);
  });
  it('classifies the round 27 families as handled elsewhere', () => {
    const sys = (l: string, n: string) => classifyStaticCensusLine(l, n)?.system;
    expect(sys(ELESH, 'Census Norn')).toMatch(/trigger doubling/);
    expect(sys('Firebending X, where X is Census Student\'s power.', 'Census Student')).toMatch(/firebending/i);
    expect(sys('Firebending X, where X is the number of experience counters you have.', 'Census Zuko')).toMatch(/firebending/i);
    expect(sys('Each nonland card in your hand without foretell has foretell. Its foretell cost is equal to its mana cost reduced by {2}.', 'Census Seer')).toMatch(/foretell/);
    expect(sys('If Census Piper is your commander, choose a color before the game begins. Census Piper is the chosen color.', 'Census Piper')).toMatch(/commander/);
  });
});
