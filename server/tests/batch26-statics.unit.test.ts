import { describe, expect, it } from 'vitest';
import { applyOptionalDrawStepSkipLifeToState } from '../../rules-engine/src/optionalDrawStepSkipLife.js';
import { buildAIActivatedAbilityResolverCandidates } from '../src/socket/ai-handlers/aiActivatedAbilityResolver.js';
import { chooseAIOptionSelectionsForStep } from '../src/socket/ai-handlers/aiOptionChoiceHandlers.js';
import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates.js';
import { isCardDrawProhibited } from '../src/state/modules/playersCantDrawCards.js';

function perm(id: string, name: string, type: string, oracle: string, controller = 'p1', extra: any = {}): any {
  return { id, controller, owner: controller, tapped: false, counters: {}, ...extra, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, keywords: extra.keywords || [] } };
}
const FASTING = "At the beginning of your upkeep, put a hunger counter on Fasting. Then destroy Fasting if it has five or more hunger counters on it.\nIf you would begin your turn while Fasting is on the battlefield, you may skip that turn's draw step instead. If you do, you gain 2 life.";

describe('batch26 rules-engine Fasting draw-skip life', () => {
  it('grants life once for the skipped draw step', () => {
    const fasting = perm('fa', 'Fasting', 'Enchantment', "you may skip that step instead. If you do, you gain 2 life.", 'p1', { optionalDrawStepSkipTurn: 4 });
    const state: any = { turnNumber: 4, battlefield: [fasting], players: [{ id: 'p1', life: 20 }], life: { p1: 20 } };
    const r = applyOptionalDrawStepSkipLifeToState(state, 'p1');
    expect(r.gained).toBe(2);
    expect(r.state.players[0].life).toBe(22);
    expect(r.state.life.p1).toBe(22);
    expect(state.players[0].life).toBe(20);
    const again = applyOptionalDrawStepSkipLifeToState(r.state, 'p1');
    expect(again.gained).toBe(0);
    expect(again.state.players[0].life).toBe(22);
  });
  it('does nothing when the skip was not chosen this turn', () => {
    const fasting = perm('fa', 'Fasting', 'Enchantment', FASTING, 'p1', { optionalDrawStepSkipTurn: 3 });
    const state: any = { turnNumber: 4, battlefield: [fasting], players: [{ id: 'p1', life: 20 }], life: { p1: 20 } };
    expect(applyOptionalDrawStepSkipLifeToState(state, 'p1').gained).toBe(0);
  });
});

describe('batch26 AI crew candidates', () => {
  it('offers granted crew for a Vehicle without its own crew and the cheaper of own/granted', () => {
    const kotori = perm('k', 'Kotori, Pilot Prodigy', 'Legendary Creature - Human Pilot', 'Vehicles you control have crew 2.', 'p1');
    const bare = perm('v1', 'Odd Vehicle', 'Artifact - Vehicle', 'Flying', 'p1');
    const pricey = perm('v2', 'Big Vehicle', 'Artifact - Vehicle', 'Trample\nCrew 5', 'p1');
    const bf = [kotori, bare, pricey];
    expect(buildAIActivatedAbilityResolverCandidates(bare, bf).find((c) => c.id.endsWith('-crew-0'))?.effect).toBe('crew 2');
    expect(buildAIActivatedAbilityResolverCandidates(pricey, bf).find((c) => c.id.endsWith('-crew-0'))?.effect).toBe('crew 2');
    expect(buildAIActivatedAbilityResolverCandidates(bare, [bare]).some((c) => c.id.endsWith('-crew-0'))).toBe(false);
    expect(buildAIActivatedAbilityResolverCandidates(pricey, [pricey]).find((c) => c.id.endsWith('-crew-0'))?.effect).toBe('crew 5');
  });
});

describe('batch26 AI opponent-library draw replacement', () => {
  it('returns the first option id as a string array', () => {
    const r = chooseAIOptionSelectionsForStep({ state: {} }, 'p1' as any, { opponentLibraryDrawReplacement: true, options: [{ id: 'yes' }, { id: 'no' }] });
    expect(r.cancelled).toBe(false);
    expect(r.selections).toEqual(['yes']);
  });
});

describe('batch26 block restrictions', () => {
  const beebles = perm('bb', 'Bouncing Beebles', 'Creature - Beeble', "Bouncing Beebles can't be blocked as long as defending player controls an artifact.", 'p1', { attacking: 'p2' });
  const bear = perm('g', 'Bear', 'Creature - Bear', '', 'p2');
  const relic = perm('a', 'Relic', 'Artifact', '', 'p2');
  it('unblockable only while the defending player controls an artifact', () => {
    expect(canBlockAttacker(bear, beebles, [beebles, bear], 'p2').canBlock).toBe(true);
    expect(canBlockAttacker(bear, beebles, [beebles, bear, relic], 'p2').canBlock).toBe(false);
  });
  it('Dragon Hunter blocks flying Dragons only', () => {
    const hunter = perm('h', 'Dragon Hunter', 'Creature - Human Warrior', 'Protection from Dragons\nDragon Hunter can block Dragons as though it had reach.', 'p2');
    const dragon = perm('d', 'Shivan Dragon', 'Creature - Dragon', 'Flying', 'p1', { attacking: 'p2', keywords: ['Flying'] });
    const bird = perm('b', 'Bird', 'Creature - Bird', 'Flying', 'p1', { attacking: 'p2', keywords: ['Flying'] });
    expect(canBlockAttacker(hunter, dragon, [hunter, dragon], 'p2').canBlock).toBe(true);
    expect(canBlockAttacker(hunter, bird, [hunter, bird], 'p2').canBlock).toBe(false);
  });
});

describe('batch26 players can\u2019t draw cards', () => {
  it('Omen Machine stops everyone, opponent-only text spares its controller', () => {
    expect(isCardDrawProhibited({ battlefield: [perm('o', 'Omen Machine', 'Artifact', "Players can't draw cards.")] }, 'p1')).toBe(true);
    const opp = { battlefield: [perm('x', 'Lock', 'Enchantment', "Your opponents can't draw cards.", 'p1')] };
    expect(isCardDrawProhibited(opp, 'p1')).toBe(false);
    expect(isCardDrawProhibited(opp, 'p2')).toBe(true);
  });
});
