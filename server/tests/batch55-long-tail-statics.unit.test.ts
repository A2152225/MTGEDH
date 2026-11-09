import { describe, expect, it } from 'vitest';
import { collectDamageSideEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamageSideEffectTemplates.js';
import { applyDamageSideEffectReplacements } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsDamageSideEffects.js';
import { getDefenderControlsUnblockableReason } from '../../shared/src/combatDefenderControlsUnblockable.js';
import { hasZoneRetainedCountersAbility, buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters.js';
import { collectStaticEffectSpecsFromState } from '../src/state/modules/staticEffectSpec.js';
import { collectAttackerSelfAttackTax } from '../../shared/src/combatAttackerSelfTax.js';
import { getExploreActionCount } from '../src/state/modules/keywordActionRepetition.js';

describe('batch55 long-tail statics and replacements', () => {
  it('Soul-Scar Mage replaces noncombat damage with -1/-1 counters', () => {
    const mage = {
      id: 'ssm', controller: 'p1',
      card: {
        name: 'Soul-Scar Mage',
        oracle_text: 'Prowess\nIf a source you control would deal noncombat damage to a creature an opponent controls, put that many -1/-1 counters on that creature instead.',
        type_line: 'Creature — Human Wizard',
      },
    };
    const bolt = {
      id: 'src', controller: 'p1',
      card: { name: 'Shock', type_line: 'Instant', oracle_text: '' },
    };
    const prey = {
      id: 'prey', controller: 'p2',
      card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
      counters: {},
    };
    const state: any = { battlefield: [mage, bolt, prey], players: [{ id: 'p1' }, { id: 'p2' }] };
    const specs = collectDamageSideEffectSpecsFromState(state);
    expect(specs.some((s) => s.effectId === 'damage-becomes-counters-on-opponent-creature' || (s.metadata && (s.metadata as any).onOpponentCreature === true))).toBe(true);
    const ctx = { state } as any;
    const result = applyDamageSideEffectReplacements(ctx, 2, 'p1', 'p2', 'src', 'prey', false);
    expect(result?.amount).toBe(0);
    expect(Number(prey.counters['-1/-1'] || 0)).toBe(2);
  });

  it('Soul-Scar Mage does not replace combat damage', () => {
    const mage = {
      id: 'ssm', controller: 'p1',
      card: {
        name: 'Soul-Scar Mage',
        oracle_text: 'If a source you control would deal noncombat damage to a creature an opponent controls, put that many -1/-1 counters on that creature instead.',
        type_line: 'Creature — Human Wizard',
      },
    };
    const prey = {
      id: 'prey', controller: 'p2',
      card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
      counters: {},
    };
    const state: any = { battlefield: [mage, prey], players: [{ id: 'p1' }, { id: 'p2' }] };
    const result = applyDamageSideEffectReplacements({ state } as any, 3, 'p1', 'p2', 'ssm', 'prey', true);
    expect(result).toBeNull();
    expect(Number(prey.counters['-1/-1'] || 0)).toBe(0);
  });

  it('Tanglewalker makes controlled creatures unblockable vs artifact lands', () => {
    const walker = {
      id: 'tw', controller: 'p1',
      card: {
        name: 'Tanglewalker',
        type_line: 'Creature — Dryad',
        oracle_text: 'Each creature you control can\'t be blocked as long as defending player controls an artifact land.',
      },
    };
    const attacker = {
      id: 'atk', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const artLand = {
      id: 'al', controller: 'p2',
      card: { name: 'Darksteel Citadel', type_line: 'Artifact Land', oracle_text: '' },
    };
    const bf = [walker, attacker, artLand];
    expect(getDefenderControlsUnblockableReason(attacker, 'p2', bf)).toMatch(/artifact land/i);
    expect(getDefenderControlsUnblockableReason(attacker, 'p2', [walker, attacker])).toBeUndefined();
  });

  it('Me, the Immortal retains counters into exile/graveyard/command', () => {
    const me = {
      name: 'Me, the Immortal',
      oracle_text: 'Counters remain on Me as it moves to any zone other than a player\'s hand or library.',
      counters: { '+1/+1': 2, menace: 1 },
    };
    expect(hasZoneRetainedCountersAbility(me)).toBe(true);
    const exiled = buildZoneObjectWithRetainedCounters(me, me, 'exile');
    expect(exiled.counters).toEqual({ '+1/+1': 2, menace: 1 });
    const hand = buildZoneObjectWithRetainedCounters(me, me, 'hand');
    expect(hand.counters).toBeUndefined();
  });

  it('Cowed by Wisdom still taxes enchanted attacker via existing self-tax', () => {
    const host = { id: 'h', controller: 'p2', card: { name: 'Host', type_line: 'Creature — Bear', oracle_text: '' } };
    const aura = {
      id: 'a', controller: 'p1', attachedTo: 'h',
      card: {
        name: 'Cowed by Wisdom',
        type_line: 'Enchantment — Aura',
        oracle_text: 'Enchant creature\nEnchanted creature can\'t attack or block unless its controller pays {1} for each card in your hand.',
      },
    };
    const tax = collectAttackerSelfAttackTax(host, [host, aura], {
      players: [{ id: 'p1', handCount: 3 }, { id: 'p2', handCount: 0 }],
    });
    expect(tax.cost).toBe(3);
    expect(tax.sources.join(' ')).toMatch(/Cowed/i);
  });

  it('Topography Tracker doubles explore actions', () => {
    const tracker = {
      id: 'tt', controller: 'p1',
      card: {
        name: 'Topography Tracker',
        oracle_text: 'If a creature you control would explore, instead it explores, then it explores again.',
      },
    };
    expect(getExploreActionCount([tracker], 'p1')).toBe(2);
  });

  it('Storm, Windrider parses attack-you prohibit and cant-block-you-control for flying', () => {
    const storm = {
      id: 'sw', controller: 'p1',
      card: {
        name: 'Storm, Windrider',
        type_line: 'Legendary Creature — Human Mutant Hero',
        oracle_text: 'Flying\nCreatures with flying can\'t attack you or block creatures you control.\nWhenever you cast a spell that targets one or more creatures, those creatures gain flying until end of turn.',
      },
    };
    const state: any = { players: [{ id: 'p1' }, { id: 'p2' }], battlefield: [storm], zones: {} };
    const specs = collectStaticEffectSpecsFromState(state);
    const mine = specs.filter((s: any) => s.sourcePermanentId === 'sw');
    expect(mine.some((s: any) => s.grant?.attackYouProhibited === true)).toBe(true);
    expect(mine.some((s: any) => s.grant?.cantBlockCreaturesYouControl === true)).toBe(true);
  });
});
