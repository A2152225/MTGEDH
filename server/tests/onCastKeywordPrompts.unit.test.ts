import { describe, it, expect } from 'vitest';
import {
  buildCasualtyPaymentStep,
  buildConspirePaymentStep,
  buildDemonstrateChoiceStep,
  creaturesSharingColorWithSpell,
  hasConspire,
  hasDemonstrate,
  isCasualtyLegalSacrifice,
  parseDemonstrateOpponentChoice,
  readCasualtyValue,
  shouldCopyForOnCastKeyword,
  stampOnCastKeywordFlags,
} from '../src/state/modules/onCastKeywordPrompts.js';

const shock = { name: 'Shock', mana_cost: '{R}', oracle_text: 'Shock deals 2 damage.', colors: ['R'] };
const grantedShock = { ...shock, grantedCasualty: 2, grantedDemonstrate: true, grantedConspire: true };
const printedCasualty = { name: 'Deadly Dispute', oracle_text: 'Casualty 2 (As you cast this spell, you may sacrifice a creature with power 2 or greater. When you do, copy this spell.)' };
const printedDemonstrate = { name: 'Creative Technique', oracle_text: 'Demonstrate (When you cast this spell, you may copy it. If you do, choose an opponent to also copy it.)' };
const printedConspire = { name: 'Gleeful Sabotage', oracle_text: 'Conspire (As you cast this spell, you may tap two untapped creatures you control that share a color with it. When you do, copy it.)' };

describe('printed or granted casualty / demonstrate / conspire', () => {
  it('reads printed casualty N and grantedCasualty, taking the higher when both apply', () => {
    expect(readCasualtyValue(printedCasualty)).toBe(2);
    expect(readCasualtyValue(grantedShock)).toBe(2);
    expect(readCasualtyValue({ ...printedCasualty, grantedCasualty: 4 })).toBe(4);
    expect(readCasualtyValue(shock)).toBeNull();
  });

  it('detects printed and granted demonstrate and conspire', () => {
    expect(hasDemonstrate(printedDemonstrate)).toBe(true);
    expect(hasDemonstrate(grantedShock)).toBe(true);
    expect(hasDemonstrate(shock)).toBe(false);
    expect(hasConspire(printedConspire)).toBe(true);
    expect(hasConspire(grantedShock)).toBe(true);
    expect(hasConspire(shock)).toBe(false);
  });

  it('legal casualty sacrifices are your creatures of power N or greater', () => {
    const bear = { id: 'b', controller: 'p1', card: { type_line: 'Creature — Bear', power: '2' }, power: 2 };
    const cub = { id: 'c', controller: 'p1', card: { type_line: 'Creature — Bear', power: '1' }, power: 1 };
    const opp = { id: 'o', controller: 'p2', card: { type_line: 'Creature — Ogre', power: '6' }, power: 6 };
    expect(isCasualtyLegalSacrifice(bear, 'p1', 2)).toBe(true);
    expect(isCasualtyLegalSacrifice(cub, 'p1', 2)).toBe(false);
    expect(isCasualtyLegalSacrifice(opp, 'p1', 2)).toBe(false);
  });

  it('conspire offers untapped creatures that share a color with the spell', () => {
    const red = { id: 'r', controller: 'p1', tapped: false, card: { type_line: 'Creature — Goblin', colors: ['R'], mana_cost: '{R}' } };
    const blue = { id: 'u', controller: 'p1', tapped: false, card: { type_line: 'Creature — Merfolk', colors: ['U'], mana_cost: '{U}' } };
    const tappedRed = { id: 't', controller: 'p1', tapped: true, card: { type_line: 'Creature — Goblin', colors: ['R'], mana_cost: '{R}' } };
    expect(creaturesSharingColorWithSpell([red, blue, tappedRed], 'p1', shock).map((p: any) => p.id)).toEqual(['r']);
  });

  it('builds an optional sacrifice prompt the existing additional-cost modal can render', () => {
    const step = buildCasualtyPaymentStep({
      playerId: 'p1',
      cardId: 'spell_1',
      cardName: 'Shock',
      casualtyValue: 2,
      availableTargets: [{ id: 'bear_1', name: 'Bear' }],
    });
    expect(step.type).toBe('additional_cost_payment');
    expect(step.costType).toBe('sacrifice');
    expect(step.additionalCostKeyword).toBe('casualty');
    expect(step.mandatory).toBe(false);
    expect(step.amount).toBe(1);
    expect(String(step.description)).toMatch(/Casualty 2/);
  });

  it('builds an optional conspire tap prompt and a demonstrate option_choice', () => {
    const conspire = buildConspirePaymentStep({
      playerId: 'p1',
      cardId: 'spell_1',
      cardName: 'Shock',
      availableTargets: [{ id: 'g1', name: 'Goblin' }, { id: 'g2', name: 'Goblin' }],
    });
    expect(conspire.type).toBe('additional_cost_payment');
    expect(conspire.costType).toBe('conspire');
    expect(conspire.amount).toBe(2);
    expect(conspire.mandatory).toBe(false);

    const demo = buildDemonstrateChoiceStep({
      playerId: 'p1',
      cardId: 'spell_1',
      cardName: 'Shock',
      opponents: [{ id: 'p2', name: 'P2' }, { id: 'p3', name: 'P3' }],
    });
    expect(demo.type).toBe('option_choice');
    expect(demo.demonstratePrompt).toBe(true);
    expect((demo.options as any[]).map((o) => o.id)).toEqual(['opponent:p2', 'opponent:p3', 'decline']);
    expect(parseDemonstrateOpponentChoice('opponent:p2')).toBe('p2');
    expect(parseDemonstrateOpponentChoice('decline')).toBeNull();
  });

  it('stamps paid flags that shouldCopyForOnCastKeyword reads', () => {
    const item: any = { card: { name: 'Shock' } };
    stampOnCastKeywordFlags(item, { casualtyPaid: true, casualtyResolved: true });
    expect(item.casualtyPaid).toBe(true);
    expect(item.card.casualtyPaid).toBe(true);
    expect(shouldCopyForOnCastKeyword(item)).toMatchObject({ casualty: true, conspire: false, demonstrate: false });
  });
});
