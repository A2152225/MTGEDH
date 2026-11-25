/**
 * AI builder answers the step validators used to reject (outcome-sweep full_1125 ai_builder_bugs.md):
 * card names, tap/untap targets, revealed-hand discards, Phyrexian activation payment, offered creature
 * types, option counts, counter distribution, "up to 0" searches and empty "choose up to N" modes.
 */
import { describe, expect, it } from 'vitest';
import { ResolutionStepType } from '../src/state/resolution/index.js';
import { cardNameRestrictionAllows, pickCardNameForChoice } from '../src/socket/ai-handlers/aiPlayerCardNameChoiceHandlers.js';
import { permanentMatchesTargetTypeEntry as aiPermanentMatchesTargetTerm } from '../src/socket/permanentTargetTypeFilter.js';
import { chooseAICounterDistributionSelection } from '../src/socket/ai-handlers/aiCounterDistributionChoice.js';
import { chooseAIPhyrexianManaChoiceSelections } from '../src/socket/ai-handlers/aiPhyrexianManaChoice.js';
import { fitAIOptionSelectionCount } from '../src/socket/ai-handlers/aiOptionChoiceHandlers.js';
import { chooseAIModeSelectionsForStep } from '../src/socket/ai-handlers/aiModeChoiceHandlers.js';
import { buildAiTargetSelectionStepResponse } from '../src/socket/resolution-handlers/aiTargetSelectionStepResponses.js';
import { buildAiZoneSelectionStepResponse } from '../src/socket/resolution-handlers/aiZoneSelectionStepResponses.js';
import { buildAiSimpleChoiceStepResponse } from '../src/socket/resolution-handlers/aiSimpleChoiceStepResponses.js';

const perm = (id: string, controller: string, type_line: string, extra: Record<string, any> = {}) => ({
  id, controller, owner: controller, tapped: false, counters: {}, ...extra,
  card: { id: `${id}_card`, name: id, type_line, ...(extra.card || {}) },
});

function board() {
  return [
    perm('own_plains', 'p1', 'Basic Land — Plains', { tapped: true }),
    perm('own_bears', 'p1', 'Creature — Bear', { card: { colors: ['G'], power: '2', toughness: '2' } }),
    perm('opp_giant', 'p2', 'Creature — Giant', { card: { colors: ['R'], power: '3', toughness: '3' } }),
    perm('opp_aura_creature', 'p2', 'Enchantment Creature — Spirit', { card: { colors: ['W'], power: '1', toughness: '1' } }),
  ];
}
const gameWith = (battlefield: any[], extraState: Record<string, any> = {}) => ({
  state: { battlefield, players: [{ id: 'p1' }, { id: 'p2' }], zones: {}, life: { p1: 40, p2: 40 }, ...extraState },
});
const tapStep = (action: string, targetFilter: Record<string, any>, mandatory = true) => ({
  id: 's1', type: ResolutionStepType.TAP_UNTAP_TARGET, playerId: 'p1', sourceId: 'src', mandatory, action, targetCount: 1, targetFilter,
}) as any;
const helpers = { getFilteredValidTargetsForStep: () => [] };

describe('AI card name choice', () => {
  const known: Record<string, string> = { 'Sol Ring': 'Artifact', Forest: 'Basic Land — Forest', 'Grizzly Bears': 'Creature — Bear', 'Command Tower': 'Land' };
  const resolve = (name: string) => (known[name] ? { name, typeLine: known[name] } : undefined);

  it('does not read "nonland" as a land restriction', () => {
    expect(cardNameRestrictionAllows('Basic Land — Forest', 'nonland')).toBe(false);
    expect(cardNameRestrictionAllows('Artifact', 'nonland')).toBe(true);
    expect(cardNameRestrictionAllows('Land', 'land')).toBe(true);
    expect(cardNameRestrictionAllows('Basic Land — Forest', 'other than a basic land')).toBe(false);
    expect(cardNameRestrictionAllows('Creature — Bear', 'other than a basic land')).toBe(true);
  });

  it('skips visible names that are not real cards and honours the restriction', () => {
    expect(pickCardNameForChoice(['Sweep Walker', 'Forest', 'Grizzly Bears'], 'nonland', resolve)).toBe('Grizzly Bears');
    expect(pickCardNameForChoice(['Sweep Walker', 'Forest'], '', resolve)).toBe('Forest');
    expect(pickCardNameForChoice(['Sweep Walker'], 'nonland', resolve)).toBe('Sol Ring');
    expect(pickCardNameForChoice([], 'land', resolve)).toBe('Command Tower');
  });
});

describe('AI tap/untap targets', () => {
  it('uses the shared predicate for "permanent", colours and non- types', () => {
    const [plains, bears, giant, spirit] = board();
    expect(aiPermanentMatchesTargetTerm(plains, 'permanent')).toBe(true);
    expect(aiPermanentMatchesTargetTerm(bears, 'green creature')).toBe(true);
    expect(aiPermanentMatchesTargetTerm(giant, 'green creature')).toBe(false);
    expect(aiPermanentMatchesTargetTerm(spirit, 'nonenchantment creature')).toBe(false);
    expect(aiPermanentMatchesTargetTerm(giant, 'nonenchantment creature')).toBe(true);
    expect(aiPermanentMatchesTargetTerm(giant, 'nonblack creature')).toBe(true);
  });

  it('untaps a tapped permanent you control for "untap another target permanent"', () => {
    const res: any = buildAiTargetSelectionStepResponse(gameWith(board()), 'g', tapStep('untap', { types: ['permanent'], controller: 'you', excludeSource: true }), helpers);
    expect(res.cancelled).toBe(false);
    expect(res.selections).toEqual({ targetIds: ['own_plains'], action: 'untap' });
  });

  it('taps an opponent creature that matches the type words', () => {
    const res: any = buildAiTargetSelectionStepResponse(gameWith(board()), 'g', tapStep('tap', { types: ['nonenchantment creature'] }), helpers);
    expect(res.selections).toEqual({ targetIds: ['opp_giant'], action: 'tap' });
    const green: any = buildAiTargetSelectionStepResponse(gameWith(board()), 'g', tapStep('tap', { types: ['green creature'] }), helpers);
    expect(green.selections.targetIds).toEqual(['own_bears']);
  });

  it('answers a mandatory step instead of cancelling, but may cancel an optional one', () => {
    const mandatory: any = buildAiTargetSelectionStepResponse(gameWith(board()), 'g', tapStep('tap', { types: ['dragon'] }), helpers);
    expect(mandatory.cancelled).toBe(false);
    expect(mandatory.selections.targetIds).toHaveLength(1);
    const optional: any = buildAiTargetSelectionStepResponse(gameWith(board()), 'g', tapStep('tap', { types: ['dragon'] }, false), helpers);
    expect(optional.cancelled).toBe(true);
  });
});

describe('AI zone selections', () => {
  it('discards from the revealed opponent hand the step offers', () => {
    const game = gameWith([], { zones: { p1: { hand: [{ id: 'p1_hand_0', cmc: 1, type_line: 'Instant' }] } } });
    const step = { id: 'd1', type: ResolutionStepType.DISCARD_SELECTION, playerId: 'p1', discardCount: 1, reason: 'effect',
      hand: [{ id: 'p2_hand_1', cmc: 2, type_line: 'Creature — Bear' }, { id: 'p2_hand_2', cmc: 1, type_line: 'Instant' }] } as any;
    const res: any = buildAiZoneSelectionStepResponse(game, step);
    expect(res.selections).toEqual(['p2_hand_1']);
  });

  it('answers "discard any number" (discardCount 0) with no cards instead of one', () => {
    const game = gameWith([], { zones: { p1: { hand: [{ id: 'p1_hand_0', cmc: 1, type_line: 'Instant' }] } } });
    const step = { id: 'd2', type: ResolutionStepType.DISCARD_SELECTION, playerId: 'p1', discardCount: 0, reason: 'effect',
      hand: [{ id: 'p1_hand_0', cmc: 1, type_line: 'Instant' }] } as any;
    expect((buildAiZoneSelectionStepResponse(game, step) as any).selections).toEqual([]);
  });

  it('declines optional prompts whose count cannot be met', () => {
    const discard = { id: 'd3', type: ResolutionStepType.DISCARD_SELECTION, playerId: 'p1', mandatory: false, discardCount: 9999, reason: 'effect', hand: [] } as any;
    expect((buildAiZoneSelectionStepResponse(gameWith([]), discard) as any).cancelled).toBe(true);
    const search = { id: 'l3', type: ResolutionStepType.LIBRARY_SEARCH, playerId: 'p1', mandatory: false, minSelections: 0, maxSelections: 2,
      splitDestination: true, toBattlefield: 1, toHand: 1, availableCards: [] } as any;
    expect((buildAiZoneSelectionStepResponse(gameWith([]), search) as any).cancelled).toBe(true);
  });

  it('names both (empty) piles for a split-destination search that finds nothing', () => {
    const step = { id: 'l2', type: ResolutionStepType.LIBRARY_SEARCH, playerId: 'p1', minSelections: 0, maxSelections: 2,
      splitDestination: true, toBattlefield: 1, toHand: 1, availableCards: [] } as any;
    const res: any = buildAiZoneSelectionStepResponse(gameWith([]), step);
    expect(res.selections).toEqual([]);
    expect(res.splitAssignments).toEqual({ toBattlefield: [], toHand: [] });
  });

  it('selects nothing for an "up to X" search where X is 0', () => {
    const step = { id: 'l1', type: ResolutionStepType.LIBRARY_SEARCH, playerId: 'p1', minSelections: 0, maxSelections: 0,
      availableCards: [{ id: 'c1', name: 'Plains', type_line: 'Basic Land — Plains' }] } as any;
    const res: any = buildAiZoneSelectionStepResponse(gameWith([]), step);
    expect(res.selections).toEqual([]);
    expect(res.cancelled).toBe(false);
  });
});

describe('AI simple choices', () => {
  it('chooses a creature type only from the offered list', () => {
    const step = { id: 'c1', type: ResolutionStepType.CREATURE_TYPE_CHOICE, playerId: 'p1', offeredCreatureTypes: ['Abzan', 'Mardu'] } as any;
    const res: any = buildAiSimpleChoiceStepResponse(gameWith(board()), step);
    expect(['Abzan', 'Mardu']).toContain(res.selections[0]);
  });

  it('fits option answers to minSelections/maxSelections', () => {
    const options = ['a', 'b', 'decline', 'c'].map((id) => ({ id, label: id }));
    expect(fitAIOptionSelectionCount({ options, minSelections: 2, maxSelections: 2 }, { selections: ['b'], cancelled: false }).selections).toEqual(['b', 'a']);
    expect(fitAIOptionSelectionCount({ options, minSelections: 1, maxSelections: 1 }, { selections: ['a', 'b'], cancelled: false }).selections).toEqual(['a']);
    const declined = { selections: ['decline'], cancelled: true };
    expect(fitAIOptionSelectionCount({ options, minSelections: 2 }, declined)).toBe(declined);
  });

  it('answers zero modes for "choose up to N" with no modes instead of cancelling', () => {
    expect(chooseAIModeSelectionsForStep(gameWith([]), 'p1' as any, { modes: [], minModes: 0, maxModes: 2 })).toEqual({ selections: [], cancelled: false });
    expect(chooseAIModeSelectionsForStep(gameWith([]), 'p1' as any, { modes: [] }).cancelled).toBe(true);
  });
});

describe('AI payment and distribution answers', () => {
  it('builds a Phyrexian activation payment array, paying life only when it is not lethal', () => {
    const step = { phyrexianManaChoice: true, parsedCost: { colors: {}, generic: 0 }, phyrexianCosts: [['B', 'LIFE:2']] };
    expect(chooseAIPhyrexianManaChoiceSelections(gameWith([]), 'p1', step)).toEqual([{ index: 0, payWithLife: true }]);
    const lowLife = gameWith([], { life: { p1: 2 } });
    expect(chooseAIPhyrexianManaChoiceSelections(lowLife, 'p1', step)).toEqual([{ index: 0, payWithLife: false }]);
  });

  it('distributes counters as a target-to-amount object on its own permanent', () => {
    const step = { totalAmount: 3, minPerTarget: 1, counterType: '+1/+1', validTargets: [{ id: 'opp_giant' }, { id: 'own_bears' }] };
    expect(chooseAICounterDistributionSelection(gameWith(board()), 'p1', step)).toEqual({ own_bears: 3 });
    const harmful = { ...step, counterType: '-1/-1' };
    expect(chooseAICounterDistributionSelection(gameWith(board()), 'p1', harmful)).toEqual({ opp_giant: 3 });
  });
});
