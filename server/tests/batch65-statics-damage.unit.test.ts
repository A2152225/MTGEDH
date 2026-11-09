import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { collectMaxAttackersAgainstPermanent } from '../src/state/modules/staticEffectSpecAttackYouTax.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { overlaySpecsMatchDamage } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamageOracleTemplates.js';
import { parseBatch65DamageSentence } from '../src/state/modules/replacementBatch65DamageReplacements.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2' },
}) as any;

describe('batch65 statics and damage', () => {
  it('Eternal Wanderer max attackers against source', () => {
    const line = 'No more than one creature can attack The Eternal Wanderer each combat.';
    const specs = parseStaticEffectSpecsFromOraclePermanent(P(
      'The Eternal Wanderer',
      line,
      'Legendary Planeswalker — The Wanderer',
    ));
    expect(specs.some((s) => Number((s.grant as any).maxAttackersAgainstSource) === 1)).toBe(true);
    const state = { battlefield: [P('The Eternal Wanderer', line, 'Legendary Planeswalker — The Wanderer')], turnPlayer: 'p2' };
    expect(collectMaxAttackersAgainstPermanent(state as any, 'src').max).toBe(1);
    expect(classifyStaticCensusLine(line, 'The Eternal Wanderer')?.system).toMatch(/max attackers against source|batch65/i);
  });

  it('Mesa Lynx during turns other than yours', () => {
    const line = 'During turns other than yours, this creature gets +0/+2.';
    const lynx = P('Mesa Lynx', line);
    const specs = parseStaticEffectSpecsFromOraclePermanent(lynx);
    expect(specs.some((s) => (s.condition as any)?.kind === 'not_during_source_controller_turn'
      && Number(s.grant.toughness) === 2)).toBe(true);

    const state: any = {
      battlefield: [lynx],
      turnPlayer: 'p2',
      players: [{ id: 'p1' }, { id: 'p2' }],
    };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(lynx, state).toughness).toBeGreaterThanOrEqual(4);

    state.turnPlayer = 'p1';
    syncDerivedContinuousEffects(state);
    // Base 2 toughness while it's your turn (no off-turn bonus).
    expect(getCurrentPowerToughness(lynx, state).toughness).toBe(2);
  });

  it('Skeleton Crew other Skeleton or Pirate anthem', () => {
    const line = "Each other creature you control that's a Skeleton or Pirate gets +1/+1.";
    const specs = parseStaticEffectSpecsFromOraclePermanent(P('Skeleton Crew', line));
    expect(specs.some((s) => s.scope.kind === 'other_creatures_you_control'
      && (s.condition as any)?.kind === 'target_has_any_subtype')).toBe(true);
    expect(classifyStaticCensusLine(line, 'Skeleton Crew')?.system).toMatch(/subtype-or|batch65/i);
  });

  it('Akki red source +1 and Raphael counter-creature double', () => {
    const akki = 'If a red source would deal damage to a player, it deals that much damage plus 1 to that player instead.';
    expect(collectReplacementEffectSpecsFromState({
      battlefield: [P('Tok-Tok, Volcano Born', akki)],
    }).some((s) => String(s.effectId || '').includes('red-source-damage-to-player-plus'))).toBe(true);

    const raphael = 'Double all damage that creatures you control with counters on them would deal.';
    expect(collectReplacementEffectSpecsFromState({
      battlefield: [P('Raphael, the Muscle', raphael)],
    }).some((s) => s.effectId === 'creatures-you-control-with-counters-damage-double')).toBe(true);

    const body = parseBatch65DamageSentence(raphael.toLowerCase().replace(/\.$/, ''))[0];
    const state = {
      battlefield: [
        P('Raphael, the Muscle', raphael),
        { id: 'thug', controller: 'p1', counters: { '+1/+1': 1 }, card: { name: 'Thug', type_line: 'Creature — Human' } },
        { id: 'plain', controller: 'p1', counters: {}, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      ],
    };
    const spec = {
      ...body,
      id: 'src:raph',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: 'Raphael, the Muscle',
    };
    expect(overlaySpecsMatchDamage(spec, {
      damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'thug', isCombatDamage: true,
    }, state)).toBe(true);
    expect(overlaySpecsMatchDamage(spec, {
      damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'plain', isCombatDamage: true,
    }, state)).toBe(false);
  });

  it('Mindskinner / Undead Alchemist census classifiers', () => {
    expect(classifyStaticCensusLine(
      'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards.',
      'The Mindskinner',
    )?.system).toMatch(/mill|Mindskinner|gameStateEffectsMillDamage/i);
    expect(classifyStaticCensusLine(
      'If a Zombie you control would deal combat damage to a player, instead that player mills that many cards.',
      'Undead Alchemist',
    )?.system).toMatch(/mill|gameStateEffectsMillDamage/i);
  });
});
