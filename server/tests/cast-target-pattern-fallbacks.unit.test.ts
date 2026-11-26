import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  augmentCastTargetRequirements,
  permanentMatchesCastTargetPatternExtras,
  splitMultiTargetClause,
} from '../src/socket/game-actions-handlers/castSpellTargetPatternFallbacks.js';
import { restrictModalModesToLegalTargets } from '../src/socket/game-actions-handlers/castModalModeTargetAvailability.js';
import {
  buildSpellTargetListFromRequirements,
  buildSpellTargetSelectionClauses,
} from '../src/socket/game-actions-handlers/gameActionsSpellTargetSelection.js';
import { resolveCastSpellParsedTargeting } from '../src/socket/game-actions-handlers/gameActionsCastSpellParsedTargeting.js';
import { extractModalModesForSpellCast } from '../src/utils/oraclePromptContext.js';

const EMPTY = { needsTargets: false, targetTypes: [], minTargets: 0, maxTargets: 0 };
const perm = (id: string, controller: string, typeLine: string, colors: string[], power = '2', extra: any = {}) => ({
  id, controller, owner: controller, card: { id: `${id}_c`, name: id, type_line: typeLine, colors, power, toughness: power, oracle_text: '' }, ...extra,
});
const game: any = {
  state: {
    players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
    turnPlayer: 'p1', phase: 'precombatMain', stack: [],
    battlefield: [
      perm('my_bear', 'p1', 'Creature — Bear', ['G']),
      perm('opp_bear', 'p2', 'Creature — Bear', ['G']),
      perm('opp_big', 'p2', 'Creature — Giant', ['W'], '5'),
      perm('opp_gold', 'p2', 'Creature — Elf', ['B', 'G'], '1', { enteredThisTurn: true }),
      perm('opp_plains', 'p2', 'Basic Land — Plains', []),
      perm('opp_tundra', 'p2', 'Land — Plains Island', []),
      perm('opp_vehicle', 'p2', 'Artifact — Vehicle', [], '3'),
    ],
    zones: { p1: { hand: [], graveyard: [], library: [] }, p2: { hand: [], graveyard: [], library: [] } },
  },
};
const ids = (list: any[]) => list.map((entry) => entry.id).sort();

describe('cast target pattern fallbacks', () => {
  // Production default is IR-primary cast targeting; vitest.setup's beforeEach pins it off.
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  beforeEach(() => { process.env.ORACLE_IR_SPELL_PRIMARY = '1'; });
  afterAll(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
  });

  it('collects divided-damage and "each of one or two" targets', () => {
    const arc: any = augmentCastTargetRequirements('Arc Lightning deals 3 damage divided as you choose among one, two, or three targets.', EMPTY);
    expect(arc).toMatchObject({ needsTargets: true, targetTypes: ['any'], minTargets: 1, maxTargets: 3, dividedDamageTotal: 3 });
    const storm: any = augmentCastTargetRequirements('Storm of Steel deals 2 damage to each of one or two targets.', EMPTY);
    expect(storm).toMatchObject({ targetTypes: ['any'], minTargets: 1, maxTargets: 2 });
  });

  it('keeps adjective, subtype and entered-this-turn filters', () => {
    const verse: any = augmentCastTargetRequirements('Exile target monocolored permanent.', EMPTY);
    expect(ids(buildSpellTargetListFromRequirements(game, 'p1', verse))).toEqual(['my_bear', 'opp_bear', 'opp_big']);
    const cradle: any = augmentCastTargetRequirements('Destroy target nonblack creature that entered this turn.', EMPTY);
    expect(cradle.targetRestriction?.type).toBe('entered_this_turn');
    expect(ids(buildSpellTargetListFromRequirements(game, 'p1', cradle))).toEqual([]);
    const charm: any = augmentCastTargetRequirements('destroy target nonbasic land.', EMPTY);
    expect(ids(buildSpellTargetListFromRequirements(game, 'p1', charm))).toEqual(['opp_tundra']);
    const vehicle: any = augmentCastTargetRequirements('destroy target vehicle.', EMPTY);
    expect(ids(buildSpellTargetListFromRequirements(game, 'p1', vehicle))).toEqual(['opp_vehicle']);
  });

  it('applies a creature-only stat clause from a type list (Make Your Move)', () => {
    const { targetReqs } = resolveCastSpellParsedTargeting({
      cardName: 'Make Your Move',
      oracleText: 'Destroy target artifact, enchantment, or creature with power 4 or greater.',
      gameState: game.state,
      controllerId: 'p1',
    });
    expect(ids(buildSpellTargetListFromRequirements(game, 'p1', targetReqs))).toEqual(['opp_big', 'opp_vehicle']);
    expect(permanentMatchesCastTargetPatternExtras(game.state.battlefield[1], targetReqs)).toBe(false);
  });

  it('splits two-target fight and "and target" clauses generically', () => {
    expect(splitMultiTargetClause("Target creature you control fights target creature you don't control"))
      .toEqual(['Target creature you control', "target creature you don't control"]);
    expect(splitMultiTargetClause('Destroy target Plains and target white creature'))
      .toEqual(['target Plains', 'target white creature']);
    expect(splitMultiTargetClause('Target creature deals damage equal to its power to target creature')).toEqual(['Target creature', 'target creature']);
    const clauses = buildSpellTargetSelectionClauses(game, 'p1', 'Hunt the Hunter',
      'Target green creature you control gets +2/+2 until end of turn. It fights target green creature an opponent controls.');
    expect(clauses.map((clause) => ids(clause.validTargetList))).toEqual([['my_bear'], ['opp_bear', 'opp_gold']]);
    const brawl = buildSpellTargetSelectionClauses(game, 'p1', 'Titanic Brawl', "Target creature you control fights target creature you don't control.");
    expect(brawl.map((clause) => ids(clause.validTargetList))).toEqual([['my_bear'], ['opp_bear', 'opp_big', 'opp_gold']]);
  });

  it('offers only modal modes whose targets exist (CR 700.2a)', () => {
    const oracle = 'Choose one —\n• Destroy target Island.\n• Create three 1/1 green Saproling creature tokens.';
    const info = extractModalModesForSpellCast(oracle, 'Test Charm');
    expect(info?.options.length).toBe(2);
    const restricted = restrictModalModesToLegalTargets(info, { ...game.state, battlefield: game.state.battlefield.filter((p: any) => p.id !== 'opp_tundra') }, 'p1', oracle, 'Test Charm');
    expect(restricted?.options.length).toBe(1);
    expect(restrictModalModesToLegalTargets(info, game.state, 'p1', oracle, 'Test Charm')?.options.length).toBe(2);
  });
});
