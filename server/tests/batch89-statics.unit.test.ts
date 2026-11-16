import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { parseBatch89DamageSentence } from '../src/state/modules/replacementBatch89DamageReplacements.js';
import { overlaySpecsMatchDamage } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamageOracleTemplates.js';
import { getGrantedCascadeCountForCast } from '../src/state/modules/cascadeCastGrants.js';
import { castRestrictionTailViolation } from '../src/state/modules/castRestrictionTailFamilies.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

function specsFor(oracle: string, name = 'Test', type = 'Creature', extra: Record<string, unknown> = {}) {
  return collectReplacementEffectSpecsFromState({ battlefield: [P(name, oracle, type, extra)] });
}

describe('batch89 statics and damage replacements', () => {
  it('Muckslinger + Halvar + Frank + Toby + Graaz + Tempest Djinn', () => {
    const muck = P(
      'The Muckslinger Gang',
      "Each other creature you control gets +3/+3 as long as it's not attacking or blocking.",
    );
    const idle = {
      id: 'idle', controller: 'p1',
      card: { name: 'Idle', type_line: 'Creature', power: '2', toughness: '2' },
    };
    const swinging = {
      id: 'sw', controller: 'p1', attacking: 'p2',
      card: { name: 'Swinging', type_line: 'Creature', power: '2', toughness: '2' },
    };
    const mState: any = { battlefield: [muck, idle, swinging], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(mState);
    expect(getCurrentPowerToughness(idle as any, mState)?.power).toBe(5);
    expect(getCurrentPowerToughness(swinging as any, mState)?.power).toBe(2);

    const halvar = P(
      'Halvar, God of Battle',
      'Creatures you control that are enchanted or equipped have double strike.',
    );
    const equipped = {
      id: 'eqh', controller: 'p1',
      card: { name: 'Bearer', type_line: 'Creature', power: '2', toughness: '2' },
    };
    const sword = {
      id: 'eq', controller: 'p1', attachedTo: 'eqh',
      card: { name: 'Sword', type_line: 'Artifact — Equipment', oracle_text: 'Equipped creature gets +1/+1.' },
    };
    const plain = {
      id: 'pl', controller: 'p1',
      card: { name: 'Plain', type_line: 'Creature', power: '2', toughness: '2' },
    };
    const hState: any = { battlefield: [halvar, equipped, sword, plain], players: [{ id: 'p1' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(hState);
    expect(getContinuousGrantedAbilitiesForPermanent(equipped as any, hState)).toContain('double strike');
    expect(getContinuousGrantedAbilitiesForPermanent(plain as any, hState)).not.toContain('double strike');

    const frank = P(
      'Agent Frank Horrigan',
      'Agent Frank Horrigan has indestructible as long as it attacked this turn.',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(frank).some(
      (s) => s.condition?.kind === 'target_attacked_this_turn' && (s.grant.abilities || []).includes('indestructible'),
    )).toBe(true);
    const fReady = { ...frank, attackedThisTurn: true };
    const fState: any = { battlefield: [fReady], players: [{ id: 'p1' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(fState);
    expect(getContinuousGrantedAbilitiesForPermanent(fReady as any, fState)).toContain('indestructible');

    const toby = P(
      'Toby, Beastie Befriender',
      'As long as you control four or more creature tokens, creature tokens you control have flying.',
    );
    const tokens = [1, 2, 3, 4].map((n) => ({
      id: `t${n}`, controller: 'p1', isToken: true,
      card: { name: `Beast ${n}`, type_line: 'Creature — Beast', power: '4', toughness: '4' },
    }));
    const tState: any = { battlefield: [toby, ...tokens], players: [{ id: 'p1' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(tState);
    expect(getContinuousGrantedAbilitiesForPermanent(tokens[0] as any, tState)).toContain('flying');
    const shortState: any = { battlefield: [toby, tokens[0], tokens[1], tokens[2]], players: [{ id: 'p1' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(shortState);
    expect(getContinuousGrantedAbilitiesForPermanent(tokens[0] as any, shortState) || []).not.toContain('flying');

    const graaz = P(
      'Graaz, Unstoppable Juggernaut',
      'Juggernauts you control attack each combat if able.\nJuggernauts you control can\'t be blocked by Walls.\nOther creatures you control have base power and toughness 5/3 and are Juggernauts in addition to their other creature types.',
    );
    const gSpecs = parseStaticEffectSpecsFromOraclePermanent(graaz);
    expect(gSpecs.some((s) => (s.grant.abilities || []).includes('attacks each combat if able'))).toBe(true);
    expect(gSpecs.some((s) => (s.grant.abilities || []).some((a) => /can't be blocked by Walls/i.test(a)))).toBe(true);
    const other = {
      id: 'ot', controller: 'p1',
      card: { name: 'Bearer', type_line: 'Creature — Human', power: '1', toughness: '1' },
    };
    const gState: any = { battlefield: [graaz, other], players: [{ id: 'p1' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(gState);
    expect(getCurrentPowerToughness(other as any, gState)?.power).toBe(5);
    expect(getCurrentPowerToughness(other as any, gState)?.toughness).toBe(3);

    const djinn = P(
      'Tempest Djinn',
      'This creature gets +1/+0 for each basic Island you control.',
      'Creature — Djinn',
      {},
      { power: '0', toughness: '4' },
    );
    const island = {
      id: 'i1', controller: 'p1',
      card: { name: 'Island', type_line: 'Basic Land — Island' },
    };
    const nonbasic = {
      id: 'nb', controller: 'p1',
      card: { name: 'Steam Vents', type_line: 'Land — Island Mountain' },
    };
    const dState: any = { battlefield: [djinn, island, nonbasic], players: [{ id: 'p1' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(dState);
    expect(getCurrentPowerToughness(djinn as any, dState)?.power).toBe(1);
  });

  it('Maelstrom Nexus cascade + Drannith + Brisela restrictions', () => {
    const nexus = P('Maelstrom Nexus', 'The first spell you cast each turn has cascade.', 'Enchantment');
    expect(getGrantedCascadeCountForCast(
      { battlefield: [nexus], spellsCastThisTurn: [] }, 'p1', { type_line: 'Instant' },
      { isFirstSpellCastThisTurn: true },
    )).toBeGreaterThan(0);
    expect(getGrantedCascadeCountForCast(
      { battlefield: [nexus], spellsCastThisTurn: [{ casterId: 'p1' }] }, 'p1', { type_line: 'Instant' },
      { isFirstSpellCastThisTurn: false },
    )).toBe(0);

    const drannith = P(
      'Drannith Magistrate',
      "Your opponents can't cast spells from anywhere other than their hands.",
    );
    expect(castRestrictionTailViolation(
      { battlefield: [drannith], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' },
      'p2', { name: 'Bolt', type_line: 'Instant', cmc: 1 }, 'graveyard',
    )).toBeTruthy();
    expect(castRestrictionTailViolation(
      { battlefield: [drannith], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' },
      'p2', { name: 'Bolt', type_line: 'Instant', cmc: 1 }, 'hand',
    )).toBeNull();

    const brisela = P(
      'Brisela, Voice of Nightmares',
      "Your opponents can't cast spells with mana value 3 or less.",
    );
    expect(castRestrictionTailViolation(
      { battlefield: [brisela], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' },
      'p2', { name: 'Bolt', type_line: 'Instant', cmc: 1 }, 'hand',
    )).toBeTruthy();
    expect(castRestrictionTailViolation(
      { battlefield: [brisela], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' },
      'p2', { name: 'Wrath', type_line: 'Sorcery', cmc: 4 }, 'hand',
    )).toBeNull();
  });

  it('damage replacements: Duo, Bearer, Swath, Tor, Ghosts, Unicorn, Djeru, Disciples, Obosh, Flail', () => {
    expect(specsFor(
      'If a source would deal damage to an opponent, it deals double that damage to that player instead.',
      'Fiendish Duo',
    ).some((s) => s.effectId === 'damage-to-opponent-double')).toBe(true);

    expect(specsFor(
      'If a Giant source you control would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.',
      'Calamity Bearer',
    ).some((s) => String(s.effectId || '').includes('type-source-you-control-damage-double'))).toBe(true);

    expect(specsFor(
      'If an instant or sorcery source you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead.',
      "Pyromancer's Swath",
      'Enchantment',
    ).some((s) => String(s.effectId || '').includes('instant-sorcery-source-damage-plus-2'))).toBe(true);

    expect(specsFor(
      'If another source you control would deal noncombat damage to a permanent or player, it deals that much damage plus 1 to that permanent or player instead.',
      'Tor Wauki the Younger',
    ).some((s) => String(s.effectId || '').includes('another-source-you-control-noncombat-plus'))).toBe(true);

    expect(specsFor(
      'If a source would deal damage to a permanent or player, it deals half that damage, rounded down, to that permanent or player instead.',
      'Ghosts of the Innocent',
    ).some((s) => s.effectId === 'all-damage-halve')).toBe(true);

    expect(specsFor(
      'If a spell would deal damage to a permanent or player, it deals that much damage minus 1 to that permanent or player instead.',
      'Benevolent Unicorn',
    ).some((s) => String(s.effectId || '').includes('spell-damage-minus-1'))).toBe(true);

    expect(specsFor(
      'If a source would deal damage to a planeswalker you control, prevent 1 of that damage.',
      'Djeru, With Eyes Open',
    ).some((s) => String(s.effectId || '').includes('damage-to-planeswalker-you-control-prevent-1'))).toBe(true);

    expect(specsFor(
      'If a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much damage plus 2 instead.',
      'Disciples of the Inferno',
    ).some((s) => String(s.effectId || '').includes('noncreature-source-to-creature-battle-or-opponent-plus-2'))).toBe(true);

    expect(specsFor(
      'If a source you control with an odd mana value would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.',
      'Obosh, the Preypiercer',
    ).some((s) => s.effectId === 'odd-mana-value-source-you-control-damage-double')).toBe(true);

    const flail = specsFor(
      'If equipped creature would deal combat damage, it deals double that damage instead.\nIf another creature would deal combat damage to equipped creature, it deals double that damage to equipped creature instead.',
      "Inquisitor's Flail",
      'Artifact — Equipment',
    );
    expect(flail.some((s) => s.effectId === 'equipped-creature-combat-damage-double')).toBe(true);
    expect(flail.some((s) => s.effectId === 'combat-damage-to-equipped-creature-double')).toBe(true);
  });

  it('live match: Fiendish Duo, Obosh, Flail, Disciples', () => {
    const duoBody = parseBatch89DamageSentence(
      'if a source would deal damage to an opponent, it deals double that damage to that player instead',
    )[0];
    const duoSpec = {
      ...duoBody,
      id: 'src:damage-to-opponent-double',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: 'Fiendish Duo',
    };
    const duoState: any = { battlefield: [P('Fiendish Duo', 'If a source would deal damage to an opponent, it deals double that damage to that player instead.')], players: [{ id: 'p1' }, { id: 'p2' }] };
    expect(overlaySpecsMatchDamage(duoSpec, {
      damageDealer: 'p2',
      damageReceiver: 'p2',
      isCombatDamage: true,
    }, duoState)).toBe(true);
    expect(overlaySpecsMatchDamage(duoSpec, {
      damageDealer: 'p2',
      damageReceiver: 'p1',
      isCombatDamage: true,
    }, duoState)).toBe(false);

    const oboshBody = parseBatch89DamageSentence(
      'if a source you control with an odd mana value would deal damage to a permanent or player, it deals double that damage to that permanent or player instead',
    )[0];
    const odd = {
      id: 'odd', controller: 'p1',
      card: { name: 'Bolt Beast', type_line: 'Creature', cmc: 3 },
    };
    const even = {
      id: 'even', controller: 'p1',
      card: { name: 'Even Beast', type_line: 'Creature', cmc: 2 },
    };
    const oState: any = {
      battlefield: [
        P('Obosh, the Preypiercer', 'If a source you control with an odd mana value would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.'),
        odd,
        even,
      ],
    };
    const oboshSpec = {
      ...oboshBody,
      id: 'src:odd-mana-value-source-you-control-damage-double',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: 'Obosh, the Preypiercer',
    };
    expect(overlaySpecsMatchDamage(oboshSpec, {
      damageDealer: 'p1',
      damageReceiver: 'p2',
      damageSourcePermanentId: 'odd',
    }, oState)).toBe(true);
    expect(overlaySpecsMatchDamage(oboshSpec, {
      damageDealer: 'p1',
      damageReceiver: 'p2',
      damageSourcePermanentId: 'even',
    }, oState)).toBe(false);

    const flailBody = parseBatch89DamageSentence(
      'if equipped creature would deal combat damage, it deals double that damage instead',
    )[0];
    const host = {
      id: 'host', controller: 'p1',
      card: { name: 'Bearer', type_line: 'Creature' },
    };
    const flail = P(
      "Inquisitor's Flail",
      'If equipped creature would deal combat damage, it deals double that damage instead.',
      'Artifact — Equipment',
      { attachedTo: 'host' },
    );
    const fState: any = { battlefield: [flail, host] };
    const flailSpec = {
      ...flailBody,
      id: 'src:equipped-creature-combat-damage-double',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: "Inquisitor's Flail",
    };
    expect(overlaySpecsMatchDamage(flailSpec, {
      damageDealer: 'p1',
      damageReceiver: 'p2',
      damageSourcePermanentId: 'host',
      isCombatDamage: true,
    }, fState)).toBe(true);
    expect(overlaySpecsMatchDamage(flailSpec, {
      damageDealer: 'p1',
      damageReceiver: 'p2',
      damageSourcePermanentId: 'src',
      isCombatDamage: true,
    }, fState)).toBe(false);

    const discBody = parseBatch89DamageSentence(
      'if a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much damage plus 2 instead',
    )[0];
    const discSpec = {
      ...discBody,
      id: 'src:noncreature-plus',
      sourcePermanentId: 'src',
      sourceController: 'p1',
      sourceName: 'Disciples of the Inferno',
    };
    const artifact = {
      id: 'art', controller: 'p1',
      card: { name: 'Cannon', type_line: 'Artifact', cmc: 3 },
    };
    const critter = {
      id: 'cr', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', cmc: 2 },
    };
    const dState: any = {
      battlefield: [
        P('Disciples of the Inferno', 'If a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much damage plus 2 instead.'),
        artifact,
        critter,
      ],
    };
    expect(overlaySpecsMatchDamage(discSpec, {
      damageDealer: 'p1',
      damageReceiver: 'p2',
      damageSourcePermanentId: 'art',
    }, dState)).toBe(true);
    expect(overlaySpecsMatchDamage(discSpec, {
      damageDealer: 'p1',
      damageReceiver: 'p2',
      damageSourcePermanentId: 'cr',
    }, dState)).toBe(false);
  });

  it('classifiers cover B89 families', () => {
    const lines: Array<[string, string]> = [
      ["Each other creature you control gets +3/+3 as long as it's not attacking or blocking.", 'The Muckslinger Gang'],
      ['Creatures you control that are enchanted or equipped have double strike.', 'Halvar, God of Battle'],
      ['Agent Frank Horrigan has indestructible as long as it attacked this turn.', 'Agent Frank Horrigan'],
      ['As long as you control four or more creature tokens, creature tokens you control have flying.', 'Toby, Beastie Befriender'],
      ['Juggernauts you control attack each combat if able.', 'Graaz, Unstoppable Juggernaut'],
      ["Juggernauts you control can't be blocked by Walls.", 'Graaz, Unstoppable Juggernaut'],
      ['Other creatures you control have base power and toughness 5/3 and are Juggernauts in addition to their other creature types.', 'Graaz, Unstoppable Juggernaut'],
      ['This creature gets +1/+0 for each basic Island you control.', 'Tempest Djinn'],
      ['The first spell you cast each turn has cascade.', 'Maelstrom Nexus'],
      ["Your opponents can't cast spells from anywhere other than their hands.", 'Drannith Magistrate'],
      ["Your opponents can't cast spells with mana value 3 or less.", 'Brisela, Voice of Nightmares'],
      ['If a source would deal damage to an opponent, it deals double that damage to that player instead.', 'Fiendish Duo'],
      ['If a Giant source you control would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.', 'Calamity Bearer'],
      ['If an instant or sorcery source you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead.', "Pyromancer's Swath"],
      ['If another source you control would deal noncombat damage to a permanent or player, it deals that much damage plus 1 to that permanent or player instead.', 'Tor Wauki the Younger'],
      ['If a source would deal damage to a permanent or player, it deals half that damage, rounded down, to that permanent or player instead.', 'Ghosts of the Innocent'],
      ['If a spell would deal damage to a permanent or player, it deals that much damage minus 1 to that permanent or player instead.', 'Benevolent Unicorn'],
      ['If a source would deal damage to a planeswalker you control, prevent 1 of that damage.', 'Djeru, With Eyes Open'],
      ['If a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much damage plus 2 instead.', 'Disciples of the Inferno'],
      ['If a source you control with an odd mana value would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.', 'Obosh, the Preypiercer'],
      ['If equipped creature would deal combat damage, it deals double that damage instead.', "Inquisitor's Flail"],
      ['If another creature would deal combat damage to equipped creature, it deals double that damage to equipped creature instead.', "Inquisitor's Flail"],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
