import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { collectAttackYouTaxForDefender } from '../src/state/modules/staticEffectSpecAttackYouTax.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch80 statics', () => {
  it('Watchdog untapped attacking-you + Winter equipment + Rielle GY', () => {
    const dog = P(
      'Watchdog',
      'As long as this creature is untapped, all creatures attacking you get -1/-0.',
      'Creature — Dog',
      { tapped: false },
      { power: '1', toughness: '2' },
    );
    const attacker = {
      id: 'a', controller: 'p2', attacking: 'p1', isAttacking: true,
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '3', toughness: '3' },
    };
    const dState: any = { battlefield: [dog, attacker], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' };
    syncDerivedContinuousEffects(dState);
    expect(getCurrentPowerToughness(attacker as any, dState)?.power).toBe(2);

    const winter = P(
      'Winter Soldier, Icy Assassin',
      'Winter Soldier gets +2/+0 for each Equipment attached to him.',
      'Creature — Human Soldier',
      {},
      { power: '2', toughness: '2' },
    );
    const eq1 = {
      id: 'e1', controller: 'p1', attachedTo: 'src',
      card: { name: 'FakeEquipA', type_line: 'Artifact — Equipment', oracle_text: '' },
    };
    const eq2 = {
      id: 'e2', controller: 'p1', attachedTo: 'src',
      card: { name: 'FakeEquipB', type_line: 'Artifact — Equipment', oracle_text: '' },
    };
    const wState: any = { battlefield: [winter, eq1, eq2], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(wState);
    expect(getCurrentPowerToughness(winter as any, wState)?.power).toBe(6);

    const rielle = P(
      'Rielle, the Everwise',
      'Rielle gets +1/+0 for each instant and sorcery card in your graveyard.',
      'Legendary Creature — Human Wizard',
      {},
      { power: '0', toughness: '3' },
    );
    const rState: any = {
      battlefield: [rielle],
      players: [{ id: 'p1' }],
      zones: {
        p1: {
          graveyard: [
            { type_line: 'Instant' },
            { type_line: 'Sorcery' },
            { type_line: 'Creature — Bear' },
          ],
        },
      },
    };
    syncDerivedContinuousEffects(rState);
    expect(getCurrentPowerToughness(rielle as any, rState)?.power).toBe(2);
  });

  it('Warden exile + Woolly snow + Konda legendary + Okoye tokens + Dáin tax', () => {
    const warden = P(
      'Warden of the Beyond',
      'This creature gets +2/+2 as long as an opponent owns a card in exile.',
      'Creature — Angel',
      {},
      { power: '2', toughness: '2' },
    );
    const wState: any = {
      battlefield: [warden],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: { p1: { exile: [] }, p2: { exile: [{ name: 'Bolt', owner: 'p2', type_line: 'Instant' }] } },
    };
    syncDerivedContinuousEffects(wState);
    expect(getCurrentPowerToughness(warden as any, wState)?.power).toBe(4);

    const woolly = P(
      'Woolly Mammoths',
      'This creature has trample as long as you control a snow land.',
    );
    const snow = {
      id: 's', controller: 'p1',
      card: { name: 'Snow-Covered Forest', type_line: 'Basic Snow Land — Forest' },
    };
    const woState: any = { battlefield: [woolly, snow], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(woState);
    expect(getContinuousGrantedAbilitiesForPermanent(woolly as any, woState)).toContain('trample');

    const konda = P(
      "Konda's Hatamoto",
      'As long as you control a legendary Samurai, this creature gets +1/+2 and has vigilance.',
      'Creature — Human Samurai',
      {},
      { power: '1', toughness: '2' },
    );
    const leg = {
      id: 'l', controller: 'p1',
      card: { name: 'Hero', type_line: 'Legendary Creature — Human Samurai', power: '2', toughness: '2' },
    };
    const kState: any = { battlefield: [konda, leg], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(kState);
    expect(getCurrentPowerToughness(konda as any, kState)?.power).toBe(2);
    expect(getContinuousGrantedAbilitiesForPermanent(konda as any, kState)).toContain('vigilance');

    const okoye = P('Okoye, Dora Milaje Leader', 'Attacking creature tokens you control have first strike.');
    const tok = {
      id: 't', controller: 'p1', isToken: true, attacking: 'p2', isAttacking: true,
      card: { name: 'Soldier', type_line: 'Creature — Soldier Token', power: '1', toughness: '1' },
    };
    const oState: any = { battlefield: [okoye, tok], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(oState);
    expect(getContinuousGrantedAbilitiesForPermanent(tok as any, oState)).toContain('first strike');

    const dain = P(
      'Dáin, Lord of the Iron Hills',
      "As long as you have an enduring story, creatures can't attack you unless their controller pays {1} for each of those creatures.",
    );
    const dState: any = {
      battlefield: [dain],
      players: [{ id: 'p1' }, { id: 'p2' }],
      enduringStory: { p1: true },
    };
    syncDerivedContinuousEffects(dState);
    expect(collectAttackYouTaxForDefender(dState, 'p1').cost).toBeGreaterThanOrEqual(1);
  });

  it('Hive Tyrant counters + Hazoret max speed + Aura/Shanna + classifiers', () => {
    const hive = P(
      'Winged Hive Tyrant',
      'The Will of the Hive Mind — Other creatures you control with counters on them have flying and haste.',
    );
    const other = {
      id: 'o', controller: 'p1', counters: { '+1/+1': 1 },
      card: { name: 'Bug', type_line: 'Creature — Insect', power: '1', toughness: '1' },
    };
    const hState: any = { battlefield: [hive, other], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(hState);
    expect(getContinuousGrantedAbilitiesForPermanent(other as any, hState)).toEqual(
      expect.arrayContaining(['flying', 'haste']),
    );

    const haz = P(
      'Hazoret, Godseeker',
      "Hazoret can't attack or block unless you have max speed.",
      'Legendary Creature — God',
    );
    const specs = parseStaticEffectSpecsFromOraclePermanent(haz);
    expect(specs.some((s) => s.conditionNegated && s.condition?.kind === 'controller_speed_at_least')).toBe(true);

    const curse = P(
      "Teferi's Curse",
      'Enchanted permanent has phasing.',
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    const host = {
      id: 'h', controller: 'p1',
      card: { name: 'Rock', type_line: 'Artifact', power: undefined, toughness: undefined },
    };
    const cState: any = { battlefield: [curse, host], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(cState);
    expect(getContinuousGrantedAbilitiesForPermanent(host as any, cState)).toContain('phasing');

    const shanna = P(
      "Shanna, Sisay's Legacy",
      "Shanna can't be the target of abilities your opponents control.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(shanna).some(
      (s) => (s.grant.abilities || []).some((a) => /abilities your opponents control/i.test(String(a))),
    )).toBe(true);

    const lines: Array<[string, string]> = [
      ['As long as this creature is untapped, all creatures attacking you get -1/-0.', 'Watchdog'],
      ['Winter Soldier gets +2/+0 for each Equipment attached to him.', 'Winter Soldier, Icy Assassin'],
      ['Rielle gets +1/+0 for each instant and sorcery card in your graveyard.', 'Rielle, the Everwise'],
      ['This creature gets +2/+2 as long as an opponent owns a card in exile.', 'Warden of the Beyond'],
      ['This creature has trample as long as you control a snow land.', 'Woolly Mammoths'],
      ['As long as you control a legendary Samurai, this creature gets +1/+2 and has vigilance.', "Konda's Hatamoto"],
      ['Attacking creature tokens you control have first strike.', 'Okoye, Dora Milaje Leader'],
      ["As long as you have an enduring story, creatures can't attack you unless their controller pays {1} for each of those creatures.", 'Dáin, Lord of the Iron Hills'],
      ['The Will of the Hive Mind — Other creatures you control with counters on them have flying and haste.', 'Winged Hive Tyrant'],
      ["Hazoret can't attack or block unless you have max speed.", 'Hazoret, Godseeker'],
      ['Enchanted permanent has phasing.', "Teferi's Curse"],
      ["Shanna can't be the target of abilities your opponents control.", "Shanna, Sisay's Legacy"],
      ['Zurgo attacks each combat if able.', 'Zurgo Helmsmasher'],
      ["You can't cast permanent spells.", 'Codie, Vociferous Codex'],
      ['Cast this spell only if a creature died this turn.', 'Grim Wanderer'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
