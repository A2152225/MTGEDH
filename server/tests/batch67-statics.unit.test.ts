import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { computeStaticMaxHandSize } from '../src/state/modules/handSizeStaticModifiers.js';
import { getGrantedCastFromGraveyardKeywordInfo } from '../src/state/modules/graveyard-permissions.js';
import { applyStateBasedActions } from '../src/rules-engine/index.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2' },
}) as any;

describe('batch67 statics', () => {
  it('Depthshaker Titan each artifact creature has keywords', () => {
    const line = 'Each artifact creature you control has melee, trample, and haste.';
    const titan = P('Depthshaker Titan', line, 'Artifact Creature — Robot');
    const specs = parseStaticEffectSpecsFromOraclePermanent(titan);
    expect(specs.some((s) => (s.condition as any)?.kind === 'target_has_type'
      && (s.condition as any)?.cardType === 'artifact'
      && Array.isArray(s.grant.abilities)
      && s.grant.abilities!.includes('trample')
      && s.grant.abilities!.includes('haste'))).toBe(true);

    const artifactCreature = {
      id: 'myr', controller: 'p1',
      card: { name: 'Myr', type_line: 'Artifact Creature — Myr', oracle_text: '', power: '1', toughness: '1' },
    };
    const state: any = { battlefield: [titan, artifactCreature], turnPlayer: 'p1', players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    const grants = getContinuousGrantedAbilitiesForPermanent(artifactCreature as any, state);
    expect(grants).toEqual(expect.arrayContaining(['melee', 'trample', 'haste']));
    expect(classifyStaticCensusLine(line, 'Depthshaker Titan')?.system).toMatch(/card-type|typedAndKeyword|batch67/i);
  });

  it('Marrow-Gnawer all Rats have fear', () => {
    const line = 'All Rats have fear.';
    const marrow = P('Marrow-Gnawer', line, 'Legendary Creature — Rat Rogue');
    const rat = {
      id: 'rat', controller: 'p2',
      card: { name: 'Rat Colony', type_line: 'Creature — Rat', oracle_text: '', power: '2', toughness: '1' },
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(marrow);
    expect(specs.some((s) => s.scope.kind === 'all_creatures_of_type'
      && (s.scope as any).creatureType === 'rat'
      && s.grant.abilities?.includes('fear'))).toBe(true);

    const state: any = { battlefield: [marrow, rat], turnPlayer: 'p1', players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(rat as any, state)).toContain('fear');
    expect(classifyStaticCensusLine(line, 'Marrow-Gnawer')?.system).toMatch(/creature-type|typedAndKeyword|batch67/i);
  });

  it("In Bolas's Clutches makes enchanted permanent legendary", () => {
    const line = 'Enchanted permanent is legendary.';
    const host = {
      id: 'host', controller: 'p1', power: 2, toughness: 2,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' },
    };
    const aura = {
      ...P("In Bolas's Clutches", line, 'Legendary Enchantment — Aura'),
      attachedTo: 'host',
      id: 'aura',
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(aura);
    expect(specs.some((s) => s.sourcePermanentId === 'host'
      && Array.isArray(s.grant.typeAdditions)
      && s.grant.typeAdditions!.includes('Legendary'))).toBe(true);

    const twin = {
      id: 'twin', controller: 'p1', power: 2, toughness: 2,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' },
    };
    const twinAura = {
      ...P("In Bolas's Clutches", line, 'Legendary Enchantment — Aura'),
      attachedTo: 'twin',
      id: 'aura2',
    };
    const state: any = {
      battlefield: [host, aura, twin, twinAura],
      players: [{ id: 'p1' }],
      life: { p1: 40 },
    };
    syncDerivedContinuousEffects(state);
    expect((host as any).continuousTypeAdditions || []).toEqual(expect.arrayContaining(['Legendary']));
    const sba = applyStateBasedActions(state);
    expect(sba.legendRuleViolations || []).toEqual(expect.arrayContaining(['host', 'twin']));
    expect(classifyStaticCensusLine(line, "In Bolas's Clutches")?.system).toMatch(/legendary|attachedExtras|batch67/i);
  });

  it('War Historian indestructible after attacking a battle', () => {
    const line = 'This creature has indestructible as long as it attacked a battle this turn.';
    const historian = {
      ...P('War Historian', line, 'Creature — Human Monk'),
      attackedBattleThisTurn: true,
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(historian);
    expect(specs.some((s) => (s.condition as any)?.kind === 'target_attacked_battle_this_turn'
      && s.grant.abilities?.includes('indestructible'))).toBe(true);

    const state: any = { battlefield: [historian], turnPlayer: 'p1', players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(historian as any, state)).toContain('indestructible');
    expect(classifyStaticCensusLine(line, 'War Historian')?.system).toMatch(/battle|conditionalSelf|batch67/i);
  });

  it('crime this turn self grants', () => {
    const line = "This creature gets +2/+0 as long as you've committed a crime this turn.";
    const creature = P('Slickshot Vault-Buster', line);
    const specs = parseStaticEffectSpecsFromOraclePermanent(creature);
    expect(specs.some((s) => (s.condition as any)?.kind === 'source_controller_committed_crime_this_turn'
      && s.grant.power === 2)).toBe(true);

    const state: any = {
      battlefield: [creature],
      turnPlayer: 'p1',
      players: [{ id: 'p1' }],
      committedCrimeThisTurn: { p1: true },
    };
    syncDerivedContinuousEffects(state);
    // power grant is continuous; abilities path unused — assert classifier + condition parse
    expect(classifyStaticCensusLine(line, 'Slickshot Vault-Buster')?.system).toMatch(/crime|conditionalSelf|batch67/i);
  });

  it('Midnight Oil hand size equals hour counters', () => {
    const oil = {
      ...P('Midnight Oil', 'Your maximum hand size is equal to the number of hour counters on this enchantment.', 'Enchantment'),
      counters: { hour: 4 },
    };
    expect(computeStaticMaxHandSize([oil], 'p1')).toBe(4);
    expect(classifyStaticCensusLine(
      'Your maximum hand size is equal to the number of hour counters on this enchantment.',
      'Midnight Oil',
    )?.system).toMatch(/hand size|handSize|batch67/i);
  });

  it('Underworld Breach escape grant is live via graveyard-permissions', () => {
    const line = "Each nonland card in your graveyard has escape. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard.";
    const breach = P('Underworld Breach', line, 'Enchantment');
    const bolt = {
      id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}',
    };
    const ctx: any = {
      state: {
        battlefield: [breach],
        zones: { p1: { graveyard: [bolt] } },
        players: [{ id: 'p1' }],
        turnPlayer: 'p1',
      },
    };
    const info = getGrantedCastFromGraveyardKeywordInfo(ctx, 'p1', bolt, 'escape');
    expect(info.hasIt).toBe(true);
    expect(info.cost).toBe('{R}');
    expect(info.additionalExileCount).toBe(3);
    expect(classifyStaticCensusLine(line, 'Underworld Breach')?.system).toMatch(/escape|graveyard-permissions|batch67/i);
  });

  it('Retriever Phoenix / Visit / Companion classifiers', () => {
    expect(classifyStaticCensusLine(
      'As long as this card is in your graveyard, if you would learn, you may instead return this card to the battlefield.',
      'Retriever Phoenix',
    )?.system).toMatch(/learn|Retriever|batch67/i);
    expect(classifyStaticCensusLine('Visit — Draw a card.', 'Balloon Stand')?.system).toMatch(/Visit|Attraction/i);
    expect(classifyStaticCensusLine(
      'Companion — Each nonland card in your starting deck has a different name.',
      'Lurrus of the Dream-Den',
    )?.system).toMatch(/[Cc]ompanion/);
  });
});
