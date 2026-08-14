import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { evaluateModifyPtWhereX } from '../src/oracleIRExecutorModifyPtWhereEvaluator';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { extractTriggerEffectAfterPrefix } from '../src/triggerEffectTextExtraction';
import { inferSplitLibrarySearchPlan } from '../src/oracleIRSplitLibrarySearch';

function flattenSteps(steps: readonly any[] | undefined): any[] {
  return (steps || []).flatMap((step) => (
    step?.kind === 'conditional' ? flattenSteps(step.steps) : [step]
  ));
}

function findRepeatLandSearch(steps: readonly any[] | undefined): any {
  for (const step of steps || []) {
    if (step?.kind !== 'conditional') continue;
    const cond = String(step.condition?.raw || '');
    const childSearch = (step.steps || []).some((inner: any) => inner.kind === 'search_library');
    const childGrant = (step.steps || []).some((inner: any) => inner.kind === 'grant_static_ability');
    if (
      /opponent controls more lands than you/i.test(cond)
      && childSearch
      && !childGrant
      && (step.steps || []).every((inner: any) => inner.kind === 'search_library')
    ) {
      return step;
    }
    const nested = findRepeatLandSearch(step.steps);
    if (nested) return nested;
  }
  return null;
}

describe('white plains tutors — opponent land comparisons', () => {
  it('parses Claim Jumper search onto the battlefield tapped', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, if an opponent controls more lands than you, you may search your library for a Plains card and put it onto the battlefield tapped. Then if an opponent controls more lands than you, repeat this process once. If you search your library this way, shuffle.',
      'Claim Jumper',
    );
    const triggered = ir.abilities.find((ability) => ability.type === 'triggered');
    const search = flattenSteps(triggered?.steps).find((step: any) => step.kind === 'search_library');

    expect(search).toBeTruthy();
    expect(search.destination).toBe('battlefield');
    expect(search.entersTapped).toBe(true);
  });

  it('expands Claim Jumper repeat-this-process into a second land-conditional search', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, if an opponent controls more lands than you, you may search your library for a Plains card and put it onto the battlefield tapped. Then if an opponent controls more lands than you, repeat this process once. If you search your library this way, shuffle.',
      'Claim Jumper',
    );
    const triggered = ir.abilities.find((ability) => ability.type === 'triggered');
    const searches = flattenSteps(triggered?.steps).filter((step: any) => step.kind === 'search_library');
    expect(searches).toHaveLength(2);
    expect(searches.every((step: any) => step.destination === 'battlefield' && step.entersTapped === true)).toBe(true);

    const repeat = findRepeatLandSearch(triggered?.steps);

    expect(repeat).toBeTruthy();
    expect(String(repeat.condition?.raw || '')).toMatch(/opponent controls more lands than you/i);
    expect(repeat.steps.some((step: any) => step.kind === 'grant_static_ability')).toBe(false);
  });

  it('keeps Boreas Charger as one leaves-the-battlefield trigger with difference-X split search', () => {
    const ir = parseOracleTextToIR(
      'Flying\nWhen this creature leaves the battlefield, choose an opponent who controls more lands than you. Search your library for a number of Plains cards equal to the difference, reveal those cards, put one of them onto the battlefield tapped and the rest into your hand, then shuffle.',
      'Boreas Charger',
    );
    const triggered = ir.abilities.filter((ability) => ability.type === 'triggered');
    expect(triggered).toHaveLength(1);
    expect(`${triggered[0]?.triggerCondition || ''} ${triggered[0]?.text || ''} ${triggered[0]?.effectText || ''}`).toMatch(/leaves the battlefield/i);

    const steps = flattenSteps(triggered[0]?.steps);
    const choose = steps.find((step: any) => step.kind === 'choose_opponent');
    const search = steps.find((step: any) => step.kind === 'search_library');

    expect(choose).toBeTruthy();
    expect(String(choose.raw || '')).toMatch(/who controls more lands than you/i);
    expect(search).toBeTruthy();
    expect(String(search.whereX?.raw || '')).toMatch(/difference/i);
    expect(inferSplitLibrarySearchPlan(String(search.raw || ''))).toEqual({
      splitDestination: true,
      toBattlefield: 1,
      toHand: 'rest',
      entersTapped: true,
    });
  });

  it('attaches whereX for players who control more lands than you', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, search your library for up to X Plains cards, where X is the number of players who control more lands than you. Reveal those cards, put them into your hand, then shuffle.',
      'Oreskos Explorer',
    );
    const triggered = ir.abilities.find((ability) => ability.type === 'triggered');
    const search = (triggered?.steps || []).find((step: any) => step.kind === 'search_library')
      || (triggered?.steps || []).flatMap((step: any) => step.kind === 'conditional' ? step.steps : []).find((step: any) => step.kind === 'search_library');

    expect(search).toBeTruthy();
    expect(search.destination).toBe('hand');
    expect(String(search.whereX?.raw || '')).toMatch(/number of players who control more lands than you/i);
  });

  it('keeps reveal/shuffle continuation on Oreskos Explorer', () => {
    const oracle =
      'When this creature enters, search your library for up to X Plains cards, where X is the number of players who control more lands than you. Reveal those cards, put them into your hand, then shuffle.';
    const prefix = 'When this creature enters, ';
    const effect = extractTriggerEffectAfterPrefix(oracle, prefix.length);
    expect(effect.toLowerCase()).toContain('reveal those cards');
    expect(effect.toLowerCase()).toContain('shuffle');
  });

  it('counts players who control more lands than you', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const state = {
      players: [
        { id: p1, name: 'P1', hand: [], library: [], graveyard: [] },
        { id: p2, name: 'P2', hand: [], library: [], graveyard: [] },
        { id: p3, name: 'P3', hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        { id: 'p1-l1', controller: p1, card: { type_line: 'Basic Land — Plains' } },
        { id: 'p2-l1', controller: p2, card: { type_line: 'Basic Land — Island' } },
        { id: 'p2-l2', controller: p2, card: { type_line: 'Basic Land — Island' } },
        { id: 'p3-l1', controller: p3, card: { type_line: 'Basic Land — Swamp' } },
      ],
    } as GameState;

    const whereX = evaluateModifyPtWhereX(
      state,
      p1,
      'x is the number of players who control more lands than you',
      undefined,
      buildOracleIRExecutionContext({ controllerId: p1, sourceId: 'src' }),
    );
    expect(whereX).toBe(1);
  });

  it('keeps Tithe Plains searches in hand rather than on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'Search your library for a Plains card. If target opponent controls more lands than you, you may search your library for an additional Plains card. Then shuffle.',
      'Tithe',
    );
    const searches = ir.abilities.flatMap((ability) => ability.steps || []).flatMap((step: any) => (
      step.kind === 'conditional' ? step.steps : [step]
    )).filter((step: any) => step.kind === 'search_library');

    expect(searches.length).toBeGreaterThanOrEqual(1);
    expect(searches.every((step: any) => step.destination === 'hand')).toBe(true);
  });

  it('parses Gift of Estates as an opponent-more-lands search to hand', () => {
    const ir = parseOracleTextToIR(
      'If an opponent controls more lands than you, search your library for up to three Plains cards, reveal them, put them into your hand, then shuffle.',
      'Gift of Estates',
    );
    const search = ir.abilities.flatMap((ability) => ability.steps || []).flatMap((step: any) => (
      step.kind === 'conditional' ? step.steps : [step]
    )).find((step: any) => step.kind === 'search_library');

    expect(search).toBeTruthy();
    expect(search.destination).toBe('hand');
    expect(search.maxResults).toBe(3);
  });

  it('counts the land difference for the chosen opponent', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        { id: p1, name: 'P1', hand: [], library: [], graveyard: [] },
        { id: p2, name: 'P2', hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        { id: 'p1-l1', controller: p1, card: { type_line: 'Basic Land — Plains' } },
        { id: 'p1-l2', controller: p1, card: { type_line: 'Basic Land — Plains' } },
        { id: 'p2-l1', controller: p2, card: { type_line: 'Basic Land — Island' } },
        { id: 'p2-l2', controller: p2, card: { type_line: 'Basic Land — Island' } },
        { id: 'p2-l3', controller: p2, card: { type_line: 'Basic Land — Island' } },
        { id: 'p2-l4', controller: p2, card: { type_line: 'Basic Land — Island' } },
        { id: 'p2-l5', controller: p2, card: { type_line: 'Basic Land — Island' } },
      ],
    } as GameState;

    const withOpponent = evaluateModifyPtWhereX(
      state,
      p1,
      'x is the difference',
      undefined,
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'src',
        selectorContext: { targetOpponentId: p2 },
      }),
    );
    expect(withOpponent).toBe(3);

    const withoutOpponent = evaluateModifyPtWhereX(
      state,
      p1,
      'x is the difference',
      undefined,
      buildOracleIRExecutionContext({ controllerId: p1, sourceId: 'src' }),
    );
    expect(withoutOpponent).toBe(0);
  });

  it('shuffles Claim Jumper after the first search even if the repeat is skipped', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, if an opponent controls more lands than you, you may search your library for a Plains card and put it onto the battlefield tapped. Then if an opponent controls more lands than you, repeat this process once. If you search your library this way, shuffle.',
      'Claim Jumper',
    );
    const triggered = ir.abilities.find((ability) => ability.type === 'triggered');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        {
          id: p1,
          name: 'P1',
          hand: [],
          library: [
            { id: 'plains-1', name: 'Plains', type_line: 'Basic Land — Plains' },
            { id: 'plains-2', name: 'Plains', type_line: 'Basic Land — Plains' },
            { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' },
          ],
          graveyard: [],
        },
        { id: p2, name: 'P2', hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        { id: 'p1-l1', controller: p1, card: { type_line: 'Basic Land — Plains' } },
        { id: 'p2-l1', controller: p2, card: { type_line: 'Basic Land — Island' } },
        { id: 'p2-l2', controller: p2, card: { type_line: 'Basic Land — Island' } },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      triggered?.steps || [],
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'src',
        selectorContext: { chosenObjectIds: ['plains-1'] },
      }),
      { allowOptional: true },
    );

    const battlefieldCards = ((result.state as any).battlefield || []).map((perm: any) => (
      String(perm?.card?.id || perm?.id || '')
    ));
    const libraryIds = ((result.state as any).players || [])
      .find((player: any) => player.id === p1)
      ?.library?.map((card: any) => String(card?.id || '')) || [];

    expect(battlefieldCards).toContain('plains-1');
    expect(libraryIds).not.toContain('plains-1');
    expect(libraryIds).toContain('plains-2');
    expect(result.appliedSteps.filter((step) => step.kind === 'search_library')).toHaveLength(1);
    expect(result.appliedSteps.some((step) => step.kind === 'shuffle_library')).toBe(true);
  });
});
