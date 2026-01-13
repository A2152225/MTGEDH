import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { categorizeSpell, evaluateTargeting, resolveSpell, type SpellSpec } from '../src/rules-engine/targeting';

describe('Targeting artifacts and enchantments', () => {
  it('categorizes "destroy target artifact or enchantment" correctly', () => {
    // Nature's Claim: "Destroy target artifact or enchantment. Its controller gains 4 life."
    const spec = categorizeSpell("Nature's Claim", "Destroy target artifact or enchantment. Its controller gains 4 life.");
    expect(spec).toBeDefined();
    expect(spec?.op).toBe('DESTROY_TARGET');
    expect(spec?.multiFilter).toEqual(['ARTIFACT', 'ENCHANTMENT']);
  });

  it('evaluates targets for artifact or enchantment spells', () => {
    const g = createInitialGameState('artifact_enchant_test');
    const pid = 'p1' as PlayerID;
    
    // Manually add permanents to battlefield
    g.state.battlefield = [
      {
        id: 'artifact1',
        controller: pid,
        card: {
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        } as any,
      } as any,
      {
        id: 'enchantment1',
        controller: pid,
        card: {
          name: 'Rhystic Study',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        } as any,
      } as any,
      {
        id: 'creature1',
        controller: pid,
        card: {
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
          power: '1',
          toughness: '1',
        } as any,
      } as any,
      {
        id: 'artifact_creature1',
        controller: pid,
        card: {
          name: 'Solemn Simulacrum',
          type_line: 'Artifact Creature — Golem',
          oracle_text: 'When Solemn Simulacrum enters the battlefield, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
          power: '2',
          toughness: '2',
        } as any,
      } as any,
    ];
    
    // Test Nature's Claim targeting
    const spec: SpellSpec = {
      op: 'DESTROY_TARGET',
      filter: 'ARTIFACT',
      multiFilter: ['ARTIFACT', 'ENCHANTMENT'],
      minTargets: 1,
      maxTargets: 1,
    };
    
    const targets = evaluateTargeting(g.state, pid, spec);
    
    // Should include: artifact1, enchantment1, artifact_creature1
    // Should NOT include: creature1 (non-artifact, non-enchantment creature)
    expect(targets.length).toBe(3);
    expect(targets.some(t => t.id === 'artifact1')).toBe(true);
    expect(targets.some(t => t.id === 'enchantment1')).toBe(true);
    expect(targets.some(t => t.id === 'artifact_creature1')).toBe(true);
    expect(targets.some(t => t.id === 'creature1')).toBe(false);
  });

  it('evaluates targets for single artifact spells', () => {
    const g = createInitialGameState('artifact_test');
    const pid = 'p1' as PlayerID;
    
    g.state.battlefield = [
      {
        id: 'artifact1',
        controller: pid,
        card: {
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        } as any,
      } as any,
      {
        id: 'enchantment1',
        controller: pid,
        card: {
          name: 'Rhystic Study',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        } as any,
      } as any,
    ];
    
    // Test targeting only artifacts
    const spec: SpellSpec = {
      op: 'DESTROY_TARGET',
      filter: 'ARTIFACT',
      minTargets: 1,
      maxTargets: 1,
    };
    
    const targets = evaluateTargeting(g.state, pid, spec);
    
    // Should include only: artifact1
    expect(targets.length).toBe(1);
    expect(targets.some(t => t.id === 'artifact1')).toBe(true);
    expect(targets.some(t => t.id === 'enchantment1')).toBe(false);
  });

  it('evaluates targets for single enchantment spells', () => {
    const g = createInitialGameState('enchantment_test');
    const pid = 'p1' as PlayerID;
    
    g.state.battlefield = [
      {
        id: 'artifact1',
        controller: pid,
        card: {
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        } as any,
      } as any,
      {
        id: 'enchantment1',
        controller: pid,
        card: {
          name: 'Rhystic Study',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        } as any,
      } as any,
    ];
    
    // Test targeting only enchantments
    const spec: SpellSpec = {
      op: 'DESTROY_TARGET',
      filter: 'ENCHANTMENT',
      minTargets: 1,
      maxTargets: 1,
    };
    
    const targets = evaluateTargeting(g.state, pid, spec);
    
    // Should include only: enchantment1
    expect(targets.length).toBe(1);
    expect(targets.some(t => t.id === 'artifact1')).toBe(false);
    expect(targets.some(t => t.id === 'enchantment1')).toBe(true);
  });

  it('resolves destroy all artifacts', () => {
    const g = createInitialGameState('destroy_all_artifacts');
    const pid = 'p1' as PlayerID;
    
    g.state.battlefield = [
      {
        id: 'artifact1',
        controller: pid,
        card: {
          name: 'Sol Ring',
          type_line: 'Artifact',
        } as any,
      } as any,
      {
        id: 'artifact2',
        controller: pid,
        card: {
          name: 'Mana Vault',
          type_line: 'Artifact',
        } as any,
      } as any,
      {
        id: 'enchantment1',
        controller: pid,
        card: {
          name: 'Rhystic Study',
          type_line: 'Enchantment',
        } as any,
      } as any,
    ];
    
    const spec: SpellSpec = {
      op: 'DESTROY_ALL',
      filter: 'ARTIFACT',
      minTargets: 0,
      maxTargets: 0,
    };
    
    const effects = resolveSpell(spec, [], g.state, pid);
    
    // Should destroy both artifacts but not the enchantment
    expect(effects.length).toBe(2);
    expect(effects.some(e => e.kind === 'DestroyPermanent' && e.id === 'artifact1')).toBe(true);
    expect(effects.some(e => e.kind === 'DestroyPermanent' && e.id === 'artifact2')).toBe(true);
  });
});
