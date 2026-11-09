import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { collectOraclePatternTokenReplacementSpecsFromState } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecTokenOracleTemplates.js';
import { collectDiesExileReplacementSpecsFromState } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecZoneChangeDiesExileTemplates.js';

const P = (name: string, oracle: string, type = 'Creature \u2014 Test') => ({
  id: 'src', controller: 'p1', owner: 'p1',
  card: { name, oracle_text: oracle, type_line: type },
}) as any;

describe('batch59 long-tail statics and replacements', () => {
  it('Freewind Equenaut grants quoted tap ability while enchanted', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(P(
      'Freewind Equenaut',
      'Flying\nAs long as this creature is enchanted, it has "{T}: This creature deals 2 damage to target attacking or blocking creature."',
      'Creature \u2014 Human Archer',
    ));
    const self = specs.find((s) => s.scope?.kind === 'self' && (s.condition as any)?.kind === 'target_is_enchanted');
    expect(self).toBeTruthy();
    expect((self?.grant?.abilities || []).some((a) => /deals 2 damage/i.test(a))).toBe(true);
  });

  it('Jaheira grants quoted mana ability to tokens you control', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(P(
      'Jaheira, Friend of the Forest',
      'Tokens you control have "{T}: Add {G}."\nChoose a Background',
      'Legendary Creature \u2014 Human Elf Druid',
    ));
    const lord = specs.find((s) => s.scope?.qualifier?.token === true);
    expect(lord).toBeTruthy();
    expect((lord?.grant?.abilities || []).some((a) => /add \{g\}/i.test(a))).toBe(true);
  });

  it('Senator Peacock makes artifacts into Clues with quoted sacrifice', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(P(
      'Senator Peacock',
      'Artifacts you control are Clues in addition to their other types and have "{2}, Sacrifice this artifact: Draw a card."',
      'Legendary Creature \u2014 Human Advisor',
    ));
    const type = specs.find((s) => (s.grant?.typeAdditions || []).some((t) => /^Clue$/i.test(t)));
    expect(type).toBeTruthy();
    expect((type?.grant?.abilities || []).some((a) => /sacrifice this artifact/i.test(a))).toBe(true);
  });

  it('Syndicate Infiltrator uses mana-values-among-graveyard condition', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(P(
      'Syndicate Infiltrator',
      'Flying\nAs long as there are five or more mana values among cards in your graveyard, this creature gets +2/+2.',
      'Creature \u2014 Vampire Wizard',
    ));
    expect(specs.some((s) => (s.condition as any)?.kind === 'controller_graveyard_mana_values_at_least'
      && Number((s.condition as any)?.count) === 5
      && Number(s.grant?.power) === 2)).toBe(true);
  });

  it('classifies Master / Doctor / Barrier / Hydra / Shadow / Magitek / Case as OTHER', () => {
    expect(classifyStaticCensusLine(
      "Triggered abilities you control can't cause you to sacrifice or exile creature tokens you control.",
      'The Master, Multiplied',
    )?.system).toMatch(/tokenSacrificeExileLock|triggered abilities/i);
    expect(classifyStaticCensusLine(
      'You may have The Fourteenth Doctor enter as a copy of a Doctor card in your graveyard that was put there from your library this turn. If you do, it gains haste until end of turn.',
      'The Fourteenth Doctor',
    )?.system).toMatch(/asEntersCopyChoice|Doctor/i);
    expect(classifyStaticCensusLine(
      'You may have this creature enter as a copy of any Ally creature on the battlefield.',
      'Jwari Shapeshifter',
    )?.system).toMatch(/asEntersCopyChoice|clone/i);
    expect(classifyStaticCensusLine(
      'Each player may attack only the nearest opponent in the last chosen direction and planeswalkers controlled by that opponent.',
      'Mystic Barrier',
    )?.system).toMatch(/mysticBarrier|nearest opponent/i);
    expect(classifyStaticCensusLine(
      '{TK}{TK}{TK}{TK} \u2014 Whenever this creature attacks, you gain 3 life and draw a card.',
      'Playable Delusionary Hydra',
    )?.system).toMatch(/sticker/i);
    expect(classifyStaticCensusLine(
      'Each spell you cast has split second if mana from an artifact was spent to cast it.',
      'Shadow the Hedgehog',
    )?.system).toMatch(/split second|shadowSplitSecond/i);
    expect(classifyStaticCensusLine(
      'A Test of Your Reflexes! \u2014 When this Equipment enters, you may attach it to target creature you control. If you do, that creature gains first strike until end of turn and must be blocked this turn if able.',
      'Magitek Scythe',
    )?.system).toMatch(/when enters|equipment ETB|trigger/i);
    expect(classifyStaticCensusLine(
      "You've gained 5 or more life this turn.",
      'Case of the Uneaten Feast',
    )?.system).toMatch(/caseSolve|life this turn/i);
  });

  it('Peregrin Took doubles with an extra Food token', () => {
    const took = {
      id: 'pt', controller: 'p1',
      card: {
        name: 'Peregrin Took',
        oracle_text: 'If one or more tokens would be created under your control, those tokens plus an additional Food token are created instead.',
      },
    };
    const specs = collectOraclePatternTokenReplacementSpecsFromState({ battlefield: [took] });
    expect(specs.some((s) => String(s.effectId).includes('extra-food'))).toBe(true);
  });

  it('Ravenloft Adventurer exiles dying opponent creatures with a hit counter', () => {
    const rav = {
      id: 'ra', controller: 'p1',
      card: {
        name: 'Ravenloft Adventurer',
        oracle_text: 'If a creature an opponent controls would die, instead exile it and put a hit counter on it.',
      },
    };
    const specs = collectDiesExileReplacementSpecsFromState({ battlefield: [rav] });
    expect(specs.some((s) => String(s.effectId).includes('hit-counter'))).toBe(true);
  });
});
