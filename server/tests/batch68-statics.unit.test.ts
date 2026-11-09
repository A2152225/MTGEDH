import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { isBlockedByColorSourceTargetingRestriction } from '../src/rules-engine/targeting-handlers/colorSourceTargetingRestriction.js';
import { cardHasGrantedOffBattlefieldFlash } from '../src/state/modules/offBattlefieldFlashGrants.js';
import { spellHasGrantedStorm } from '../src/state/modules/stormCastGrants.js';
import { detectStormAbility } from '../src/state/modules/triggers/spell-cast.js';
import { getPermanentProtections } from '../src/state/modules/combat-mechanics.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2' },
}) as any;

describe('batch68 statics', () => {
  it('Sardian Cliffstomper mountain where-x pump on your turn', () => {
    const line = "As long as it's your turn and you control four or more Mountains, this creature gets +X/+0, where X is the number of Mountains you control.";
    const cliff = P('Sardian Cliffstomper', line);
    const specs = parseStaticEffectSpecsFromOraclePermanent(cliff);
    expect(specs.some((s) => Array.isArray(s.conditions)
      && s.conditions!.some((c) => c.kind === 'during_source_controller_turn')
      && s.conditions!.some((c) => c.kind === 'source_controller_controls_matching' && (c as any).cardType === 'mountain' && (c as any).count === 4)
      && (s.grant as any).countBasis === 'controller_lands_of_subtype')).toBe(true);

    const mountains = [1, 2, 3, 4].map((n) => ({
      id: `m${n}`, controller: 'p1',
      card: { name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.' },
    }));
    const state: any = {
      battlefield: [cliff, ...mountains],
      turnPlayer: 'p1',
      players: [{ id: 'p1' }],
    };
    syncDerivedContinuousEffects(state);
    const pt = getCurrentPowerToughness(cliff, state);
    expect(pt?.power).toBe(6); // 2 base + 4 mountains
    expect(classifyStaticCensusLine(line, 'Sardian Cliffstomper')?.system).toMatch(/mountains|batch68/i);
  });

  it('Earnest Fellowship protection from own colors', () => {
    const line = 'Each creature has protection from its colors.';
    const fellowship = P('Earnest Fellowship', line, 'Enchantment');
    const red = {
      id: 'gob', controller: 'p1',
      card: { name: 'Goblin', type_line: 'Creature — Goblin', oracle_text: '', power: '1', toughness: '1', colors: ['R'] },
    };
    expect(parseStaticEffectSpecsFromOraclePermanent(fellowship).some(
      (s) => (s.grant as any).protectionFromOwnColors === true,
    )).toBe(true);

    const state: any = { battlefield: [fellowship, red], turnPlayer: 'p1', players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(red as any, state)).toContain('protection from red');
    expect(getPermanentProtections(red, state)).toContain('red');
    expect(classifyStaticCensusLine(line, 'Earnest Fellowship')?.system).toMatch(/protection|batch68/i);
  });

  it('Sludge Monster slime non-horror base P/T', () => {
    const line = 'Non-Horror creatures with slime counters on them lose all abilities and have base power and toughness 2/2.';
    const sludge = P('Sludge Monster', line, 'Creature — Horror');
    const victim = {
      id: 'bear', controller: 'p2', power: 5, toughness: 5, counters: { slime: 1 },
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: 'Trample', power: '5', toughness: '5' },
    };
    expect(parseStaticEffectSpecsFromOraclePermanent(sludge).some(
      (s) => s.grant.setPower === 2 && s.grant.setToughness === 2,
    )).toBe(true);

    const state: any = { battlefield: [sludge, victim], turnPlayer: 'p1', players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(state);
    const pt = getCurrentPowerToughness(victim as any, state);
    expect(pt?.power).toBe(2);
    expect(pt?.toughness).toBe(2);
    expect(classifyStaticCensusLine(line, 'Sludge Monster')?.system).toMatch(/slime|batch68/i);
  });

  it("Gaea's Revenge nongreen targeting restriction", () => {
    const line = "This creature can't be the target of nongreen spells or abilities from nongreen sources.";
    const gaea = P("Gaea's Revenge", line, 'Creature — Elemental');
    const state: any = {
      battlefield: [gaea],
      stack: [{ id: 'bolt', card: { name: 'Lightning Bolt', type_line: 'Instant', colors: ['R'], mana_cost: '{R}' } }],
      players: [{ id: 'p1' }],
    };
    expect(isBlockedByColorSourceTargetingRestriction(gaea, state, 'bolt')).toBe(true);

    state.stack = [{ id: 'giant', card: { name: 'Giant Growth', type_line: 'Instant', colors: ['G'], mana_cost: '{G}' } }];
    expect(isBlockedByColorSourceTargetingRestriction(gaea, state, 'giant')).toBe(false);
    expect(classifyStaticCensusLine(line, "Gaea's Revenge")?.system).toMatch(/nongreen|colorSource|batch68/i);
  });

  it('Teferi off-battlefield flash grant', () => {
    const line = "Creature cards you own that aren't on the battlefield have flash.";
    const teferi = P('Teferi, Mage of Zhalfir', line, 'Legendary Creature — Human Wizard');
    const bear = { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', owner: 'p1' };
    const state: any = { battlefield: [teferi], players: [{ id: 'p1' }] };
    expect(cardHasGrantedOffBattlefieldFlash(state, 'p1', bear)).toBe(true);
    expect(cardHasGrantedOffBattlefieldFlash(state, 'p1', { ...bear, type_line: 'Instant' })).toBe(false);
    expect(classifyStaticCensusLine(line, 'Teferi, Mage of Zhalfir')?.system).toMatch(/flash|offBattlefield|batch68/i);
  });

  it('Prismari storm grant', () => {
    const line = 'Instant and sorcery spells you cast have storm.';
    const prismari = P('Prismari, the Inspiration', line, 'Legendary Creature — Elder Dragon');
    const bolt = { name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.' };
    const state: any = { battlefield: [prismari], players: [{ id: 'p1' }] };
    expect(spellHasGrantedStorm(state, 'p1', bolt)).toBe(true);
    expect(detectStormAbility(bolt, state, 'p1')).toBe(true);
    expect(detectStormAbility(bolt)).toBe(false);
    expect(classifyStaticCensusLine(line, 'Prismari, the Inspiration')?.system).toMatch(/storm|batch68/i);
  });

  it('Case to-solve and bang ability-word classifiers', () => {
    expect(classifyStaticCensusLine(
      'To solve — You control seven or more lands.',
      'Case of the Locked Hothouse',
    )?.system).toMatch(/[Cc]ase|to-solve|caseSolve/i);
    expect(classifyStaticCensusLine(
      'Tunnel Snakes Rule! — Whenever Butch DeLoria attacks, it gets +1/+1 until end of turn for each other Rogue and/or Snake you control.',
      'Butch DeLoria, Tunnel Snake',
    )?.system).toMatch(/bang|ability-word|trigger/i);
    expect(classifyStaticCensusLine(
      "Each Vampire creature card you own that isn't on the battlefield has madness. The madness cost is equal to its mana cost.",
      'Falkenrath Gorger',
    )?.system).toMatch(/madness|Falkenrath|batch68/i);
  });
});
