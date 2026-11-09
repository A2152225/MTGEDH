import { describe, expect, it } from 'vitest';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { parseBatch64DamageSentence, damageSourceIsAnySpell } from '../src/state/modules/replacementBatch64DamageReplacements.js';
import { overlaySpecsMatchDamage } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamageOracleTemplates.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { setResolvingSpellSource } from '../src/state/modules/replacementResolvingSpellSource.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type },
}) as any;

function specsFor(oracle: string, name = 'Test', type = 'Creature', extra: Record<string, unknown> = {}) {
  return collectReplacementEffectSpecsFromState({ battlefield: [P(name, oracle, type, extra)] });
}

describe('batch64 damage replacements', () => {
  it('Rem Karolus spell prevent + plus-1', () => {
    const prevent = 'If a spell would deal damage to you or another permanent you control, prevent that damage.';
    const plus = 'If a spell would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.';
    const specs = specsFor(`${prevent}\n${plus}`, 'Rem Karolus, Stalwart Slayer');
    expect(specs.some((s) => s.effectId === 'spell-damage-to-you-or-another-prevent')).toBe(true);
    expect(specs.some((s) => String(s.effectId || '').includes('spell-damage-to-opponent-plus'))).toBe(true);
    expect(classifyStaticCensusLine(prevent, 'Rem Karolus')?.system).toMatch(/spell damage|Batch64/i);
    expect(classifyStaticCensusLine(plus, 'Rem Karolus')?.system).toMatch(/spell damage|Batch64/i);
  });

  it('Plated Pegasus / Sulfuric Vapors / Reidane / Thor', () => {
    expect(specsFor(
      'If a spell would deal damage to a permanent or player, prevent 1 damage that spell would deal to that permanent or player.',
      'Plated Pegasus',
    ).some((s) => String(s.effectId || '').includes('spell-damage-prevent'))).toBe(true);

    expect(specsFor(
      'If a red spell would deal damage to a permanent or player, it deals that much damage plus 1 to that permanent or player instead.',
      'Sulfuric Vapors',
      'Enchantment',
    ).some((s) => String(s.effectId || '').includes('red-spell-damage-plus'))).toBe(true);

    expect(specsFor(
      'If a source an opponent controls would deal damage to you or a permanent you control, prevent 1 of that damage.',
      'Reidane, God of the Worthy',
    ).some((s) => String(s.effectId || '').includes('opponent-source-damage-to-you-prevent'))).toBe(true);

    expect(specsFor(
      "If another source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.",
      "Thor, Asgard's Avenger",
    ).some((s) => String(s.effectId || '').includes('another-source-you-control-damage'))).toBe(true);
  });

  it('Curse of Bloodletting / Sawhorn / Kuja', () => {
    expect(specsFor(
      'If a source would deal damage to enchanted player, it deals double that damage to that player instead.',
      'Curse of Bloodletting',
      'Enchantment — Aura Curse',
    ).some((s) => s.effectId === 'enchanted-player-damage-double')).toBe(true);

    expect(specsFor(
      'If a source would deal damage to the chosen player or a permanent they control, it deals double that damage instead.',
      'Sawhorn Nemesis',
    ).some((s) => s.effectId === 'chosen-player-damage-double')).toBe(true);

    expect(specsFor(
      'Flare Star — If a Wizard you control would deal damage to a permanent or player, it deals double that damage instead.',
      'Kuja, Genome Sorcerer',
    ).some((s) => s.effectId === 'wizard-you-control-damage-double')).toBe(true);
  });

  it('Diamond Weapon ability-word prevent + Purity/Capridor noncombat', () => {
    const diamond = specsFor(
      'Immune — Prevent all combat damage that would be dealt to Diamond Weapon.',
      'Diamond Weapon',
      'Legendary Artifact Creature — Elemental',
    );
    expect(diamond.some((s) => s.effectId === 'prevent-combat-damage-to-self')).toBe(true);
    expect(classifyStaticCensusLine(
      'Immune — Prevent all combat damage that would be dealt to Diamond Weapon.',
      'Diamond Weapon',
    )?.system).toMatch(/prevent combat|Batch64|prevention/i);

    const purity = specsFor(
      'If noncombat damage would be dealt to you, prevent that damage. You gain life equal to the damage prevented this way.',
      'Purity',
      'Creature — Elemental Incarnation',
    );
    expect(purity.some((s) => s.effectId === 'prevent-noncombat-damage-to-you')).toBe(true);

    const capridor = specsFor(
      'If noncombat damage would be dealt to this creature, prevent that damage. Put a +1/+1 counter on this creature for each 1 damage prevented this way.',
      'Stormwild Capridor',
    );
    expect(capridor.some((s) => s.effectId === 'prevent-noncombat-damage-to-self')).toBe(true);
  });

  it('live match: Rem prevent and Sulfuric color gate', () => {
    const preventBody = parseBatch64DamageSentence(
      'if a spell would deal damage to you or another permanent you control, prevent that damage',
    )[0];
    const state: any = {
      battlefield: [P('Rem Karolus, Stalwart Slayer', 'If a spell would deal damage to you or another permanent you control, prevent that damage.')],
      stack: [],
    };
    setResolvingSpellSource(state, {
      id: 'spell-1',
      cardId: 'bolt-card',
      card: { name: 'Lightning Bolt', type_line: 'Instant', colors: ['R'] },
      targets: ['p1'],
    });
    const spec = {
      ...preventBody,
      id: 'src:spell-damage-to-you-or-another-prevent',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: 'Rem Karolus, Stalwart Slayer',
    };
    expect(damageSourceIsAnySpell(state, 'spell-1')).toBe(true);
    expect(overlaySpecsMatchDamage(spec, {
      damageDealer: 'p2',
      damageReceiver: 'p1',
      damageSourcePermanentId: 'spell-1',
      isCombatDamage: false,
    }, state)).toBe(true);
    // Damage to Rem himself is "another permanent" excluded.
    expect(overlaySpecsMatchDamage(spec, {
      damageDealer: 'p2',
      damageReceiver: 'p1',
      damageSourcePermanentId: 'spell-1',
      targetPermanentId: 'src',
      isCombatDamage: false,
    }, state)).toBe(false);

    const sulf = parseBatch64DamageSentence(
      'if a red spell would deal damage to a permanent or player, it deals that much damage plus 1 to that permanent or player instead',
    )[0];
    const sulfSpec = {
      ...sulf,
      id: 'src:red-spell',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: 'Sulfuric Vapors',
    };
    expect(overlaySpecsMatchDamage(sulfSpec, {
      damageDealer: 'p2',
      damageReceiver: 'p1',
      damageSourcePermanentId: 'spell-1',
      isCombatDamage: false,
    }, state)).toBe(true);

    setResolvingSpellSource(state, {
      id: 'spell-2',
      cardId: 'counter-card',
      card: { name: 'Counterspell', type_line: 'Instant', colors: ['U'] },
      targets: [],
    });
    expect(overlaySpecsMatchDamage(sulfSpec, {
      damageDealer: 'p2',
      damageReceiver: 'p1',
      damageSourcePermanentId: 'spell-2',
      isCombatDamage: false,
    }, state)).toBe(false);
  });

  it('Curse / Sawhorn / Kuja / Thor match gates', () => {
    const curseBody = parseBatch64DamageSentence(
      'if a source would deal damage to enchanted player, it deals double that damage to that player instead',
    )[0];
    const curseState = {
      battlefield: [{
        ...P('Curse of Bloodletting', 'If a source would deal damage to enchanted player, it deals double that damage to that player instead.', 'Enchantment — Aura Curse'),
        attachedTo: 'p2',
      }],
    };
    const curseSpec = {
      ...curseBody,
      id: 'src:curse',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: 'Curse of Bloodletting',
    };
    expect(overlaySpecsMatchDamage(curseSpec, {
      damageDealer: 'p3', damageReceiver: 'p2', isCombatDamage: true,
    }, curseState)).toBe(true);
    expect(overlaySpecsMatchDamage(curseSpec, {
      damageDealer: 'p3', damageReceiver: 'p1', isCombatDamage: true,
    }, curseState)).toBe(false);

    const sawBody = parseBatch64DamageSentence(
      'if a source would deal damage to the chosen player or a permanent they control, it deals double that damage instead',
    )[0];
    const sawState = {
      battlefield: [
        { ...P('Sawhorn Nemesis', 'If a source would deal damage to the chosen player or a permanent they control, it deals double that damage instead.'), chosenPlayer: 'p2' },
        { id: 'foe', controller: 'p2', card: { name: 'Bear', type_line: 'Creature — Bear' } },
      ],
    };
    const sawSpec = {
      ...sawBody,
      id: 'src:saw',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: 'Sawhorn Nemesis',
    };
    expect(overlaySpecsMatchDamage(sawSpec, {
      damageDealer: 'p1', damageReceiver: 'p2', isCombatDamage: true,
    }, sawState)).toBe(true);
    expect(overlaySpecsMatchDamage(sawSpec, {
      damageDealer: 'p1', damageReceiver: 'p2', targetPermanentId: 'foe', isCombatDamage: true,
    }, sawState)).toBe(true);

    const kujaBody = parseBatch64DamageSentence(
      'if a wizard you control would deal damage to a permanent or player, it deals double that damage instead',
    )[0];
    const kujaState = {
      battlefield: [
        P('Kuja, Genome Sorcerer', 'Flare Star — If a Wizard you control would deal damage to a permanent or player, it deals double that damage instead.'),
        { id: 'wiz', controller: 'p1', card: { name: 'Apprentice', type_line: 'Creature — Human Wizard' } },
        { id: 'beast', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear' } },
      ],
    };
    const kujaSpec = {
      ...kujaBody,
      id: 'src:kuja',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: 'Kuja, Genome Sorcerer',
    };
    expect(overlaySpecsMatchDamage(kujaSpec, {
      damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'wiz', isCombatDamage: false,
    }, kujaState)).toBe(true);
    expect(overlaySpecsMatchDamage(kujaSpec, {
      damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'beast', isCombatDamage: false,
    }, kujaState)).toBe(false);

    const thorBody = parseBatch64DamageSentence(
      'if another source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead',
    )[0];
    const thorState = {
      battlefield: [
        P("Thor, Asgard's Avenger", 'If another source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.'),
        { id: 'ally', controller: 'p1', card: { name: 'Bolt Bot', type_line: 'Creature — Construct' } },
      ],
    };
    const thorSpec = {
      ...thorBody,
      id: 'src:thor',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: "Thor, Asgard's Avenger",
    };
    expect(overlaySpecsMatchDamage(thorSpec, {
      damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'ally', isCombatDamage: false,
    }, thorState)).toBe(true);
    expect(overlaySpecsMatchDamage(thorSpec, {
      damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'src', isCombatDamage: false,
    }, thorState)).toBe(false);
  });
});
