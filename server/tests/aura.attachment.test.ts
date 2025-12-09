import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';

describe('Aura Attachment System', () => {
  describe('Aura attachment when resolving from stack', () => {
    it('should attach aura to target creature when resolving', () => {
      const g = createInitialGameState('aura_attach');
      
      const p1 = 'p1' as PlayerID;
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Create creature on battlefield
      const targetCreature = {
        id: 'creature_1',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
        mana_cost: '{1}{G}',
        color_identity: ['G'],
      };
      
      g.state.battlefield.push({
        id: 'creature_1',
        controller: p1,
        card: targetCreature as any,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
      });
      
      // Create Bear Umbra on stack targeting the creature
      const bearUmbra = {
        id: 'bear_umbra_1',
        name: 'Bear Umbra',
        type_line: 'Enchantment — Aura',
        oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2 and has "Whenever this creature attacks, untap all lands you control."',
        mana_cost: '{2}{G}{G}',
        color_identity: ['G'],
      };
      
      g.state.stack = [{
        id: 'stack_1',
        type: 'spell',
        controller: p1,
        card: bearUmbra as any,
        targets: ['creature_1'], // Targeting the creature
      }];
      
      // Resolve the aura from stack
      g.resolveTopOfStack();
      
      // Find the aura permanent on battlefield
      const auraPerm = g.state.battlefield.find((p: any) => p.card?.name === 'Bear Umbra');
      const creaturePerm = g.state.battlefield.find((p: any) => p.id === 'creature_1');
      
      expect(auraPerm).toBeDefined();
      expect(creaturePerm).toBeDefined();
      
      // Verify aura is attached to creature
      expect((auraPerm as any).attachedTo).toBe('creature_1');
      expect((creaturePerm as any).attachedAuras).toContain((auraPerm as any).id);
      
      // Verify creature gets +2/+2 bonus
      const view = g.viewFor(p1);
      const viewCreature = view.battlefield.find((p: any) => p.id === 'creature_1');
      expect(viewCreature?.effectivePower).toBe(4); // 2 + 2
      expect(viewCreature?.effectiveToughness).toBe(4); // 2 + 2
    });
  });
  
  describe('Aura state-based actions', () => {
    it('should move unattached aura to graveyard as state-based action', () => {
      const g = createInitialGameState('aura_sba');
      
      const p1 = 'p1' as PlayerID;
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Create an aura on battlefield with no attachment
      const aura = {
        id: 'aura_1',
        name: 'Pacifism',
        type_line: 'Enchantment — Aura',
        oracle_text: 'Enchant creature\nEnchanted creature can\'t attack or block.',
        mana_cost: '{1}{W}',
        color_identity: ['W'],
      };
      
      g.state.battlefield.push({
        id: 'aura_1',
        controller: p1,
        owner: p1,
        card: aura as any,
        tapped: false,
        // No attachedTo - should be destroyed by SBA
      });
      
      // Initialize zones for graveyard
      g.state.zones = g.state.zones || {};
      g.state.zones[p1] = {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      };
      
      // Run state-based actions
      g.runSBA();
      
      // Aura should be destroyed and moved to graveyard
      const auraOnBattlefield = g.state.battlefield.find((p: any) => p.id === 'aura_1');
      expect(auraOnBattlefield).toBeUndefined();
      
      const graveyard = g.state.zones?.[p1]?.graveyard || [];
      const auraInGraveyard = graveyard.find((c: any) => c.name === 'Pacifism');
      expect(auraInGraveyard).toBeDefined();
    });
    
    it('should not destroy aura when attached to a creature', () => {
      const g = createInitialGameState('aura_attached_sba');
      
      const p1 = 'p1' as PlayerID;
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Create creature and attached aura
      g.state.battlefield.push({
        id: 'creature_1',
        controller: p1,
        card: { 
          id: 'creature_1', 
          name: 'Grizzly Bears', 
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        } as any,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        attachedAuras: ['aura_1'],
      });
      
      g.state.battlefield.push({
        id: 'aura_1',
        controller: p1,
        owner: p1,
        card: { 
          id: 'aura_1', 
          name: 'Pacifism', 
          type_line: 'Enchantment — Aura',
          oracle_text: 'Enchant creature\nEnchanted creature can\'t attack or block.',
        } as any,
        tapped: false,
        attachedTo: 'creature_1', // Properly attached
      });
      
      // Initialize zones for graveyard
      g.state.zones = g.state.zones || {};
      g.state.zones[p1] = {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      };
      
      // Run state-based actions
      g.runSBA();
      
      // Aura should still be on battlefield (not destroyed)
      const auraOnBattlefield = g.state.battlefield.find((p: any) => p.id === 'aura_1');
      expect(auraOnBattlefield).toBeDefined();
      expect((auraOnBattlefield as any).attachedTo).toBe('creature_1');
      
      const graveyard = g.state.zones?.[p1]?.graveyard || [];
      expect(graveyard.length).toBe(0);
    });
    
    it('should not destroy enchantment creature when unattached', () => {
      const g = createInitialGameState('enchantment_creature_sba');
      
      const p1 = 'p1' as PlayerID;
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Create an enchantment creature (like bestow creatures)
      // Use 2/2 stats so it doesn't die from toughness SBA
      g.state.battlefield.push({
        id: 'eidolon_1',
        controller: p1,
        owner: p1,
        card: { 
          id: 'eidolon_1', 
          name: 'Eidolon of Countless Battles', 
          type_line: 'Enchantment Creature — Spirit',
          oracle_text: 'Bestow {2}{W}{W}\nEidolon of Countless Battles gets +1/+1 for each creature you control.',
          power: '2',
          toughness: '2',
        } as any,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        // No attachedTo - but it's a creature so should NOT be destroyed
      });
      
      // Initialize zones
      g.state.zones = g.state.zones || {};
      g.state.zones[p1] = {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      };
      
      // Run state-based actions
      g.runSBA();
      
      // Enchantment creature should still be on battlefield
      const creatureOnBattlefield = g.state.battlefield.find((p: any) => p.id === 'eidolon_1');
      expect(creatureOnBattlefield).toBeDefined();
      
      const graveyard = g.state.zones?.[p1]?.graveyard || [];
      expect(graveyard.length).toBe(0);
    });
    
    it('should destroy aura when attached creature dies', () => {
      const g = createInitialGameState('aura_creature_dies');
      
      const p1 = 'p1' as PlayerID;
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Create creature and attached aura
      g.state.battlefield.push({
        id: 'creature_1',
        controller: p1,
        owner: p1,
        card: { 
          id: 'creature_1', 
          name: 'Grizzly Bears', 
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        } as any,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        attachedAuras: ['aura_1'],
      });
      
      g.state.battlefield.push({
        id: 'aura_1',
        controller: p1,
        owner: p1,
        card: { 
          id: 'aura_1', 
          name: 'Rancor', 
          type_line: 'Enchantment — Aura',
          oracle_text: 'Enchant creature\nEnchanted creature gets +2/+0 and has trample.',
        } as any,
        tapped: false,
        attachedTo: 'creature_1',
      });
      
      // Initialize zones
      g.state.zones = g.state.zones || {};
      g.state.zones[p1] = {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      };
      
      // Remove the creature (simulate death)
      const creatureIndex = g.state.battlefield.findIndex((p: any) => p.id === 'creature_1');
      const removedCreature = g.state.battlefield.splice(creatureIndex, 1)[0];
      g.state.zones[p1].graveyard.push({ ...(removedCreature as any).card, zone: 'graveyard' });
      
      // Run state-based actions - aura should be destroyed because target is gone
      g.runSBA();
      
      // Aura should be destroyed
      const auraOnBattlefield = g.state.battlefield.find((p: any) => p.id === 'aura_1');
      expect(auraOnBattlefield).toBeUndefined();
      
      const graveyard = g.state.zones?.[p1]?.graveyard || [];
      const auraInGraveyard = graveyard.find((c: any) => c.name === 'Rancor');
      expect(auraInGraveyard).toBeDefined();
    });
  });
});
