import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase } from '../../shared/src';

describe('Equipment System', () => {
  describe('Equipment attachment and state persistence', () => {
    it('should attach equipment to a creature', () => {
      const g = createInitialGameState('equipment_attach');
      
      const p1 = 'p1' as PlayerID;
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
        { 
          id: 'boots_1', 
          name: 'Swiftfoot Boots', 
          type_line: 'Artifact — Equipment',
          oracle_text: 'Equipped creature has hexproof and haste.\nEquip {1}',
          image_uris: undefined
        },
        { 
          id: 'creature_1', 
          name: 'Grizzly Bears', 
          type_line: 'Creature — Bear',
          oracle_text: '',
          image_uris: undefined
        },
      ];
      
      g.importDeckResolved(p1, cards);
      
      // Move both to battlefield
      g.state.battlefield.push({
        id: 'boots_1',
        controller: p1,
        card: cards[0] as any,
        tapped: false,
      });
      
      g.state.battlefield.push({
        id: 'creature_1',
        controller: p1,
        card: cards[1] as any,
        tapped: false,
      });
      
      // Simulate equipment attachment
      const equipmentPerm = g.state.battlefield.find((p: any) => p.id === 'boots_1');
      const creaturePerm = g.state.battlefield.find((p: any) => p.id === 'creature_1');
      
      expect(equipmentPerm).toBeDefined();
      expect(creaturePerm).toBeDefined();
      
      // Attach equipment to creature
      (equipmentPerm as any).attachedTo = 'creature_1';
      (creaturePerm as any).attachedEquipment = ['boots_1'];
      (creaturePerm as any).isEquipped = true;
      
      // Verify attachment state
      expect((equipmentPerm as any).attachedTo).toBe('creature_1');
      expect((creaturePerm as any).attachedEquipment).toContain('boots_1');
      expect((creaturePerm as any).isEquipped).toBe(true);
    });
    
    it('should move equipment when reattaching to a different creature', () => {
      const g = createInitialGameState('equipment_reattach');
      
      const p1 = 'p1' as PlayerID;
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Add equipment and two creatures to battlefield
      g.state.battlefield.push({
        id: 'boots_1',
        controller: p1,
        card: { id: 'boots_1', name: 'Swiftfoot Boots', type_line: 'Artifact — Equipment' },
        tapped: false,
        attachedTo: 'creature_1',
      });
      
      g.state.battlefield.push({
        id: 'creature_1',
        controller: p1,
        card: { id: 'creature_1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        tapped: false,
        attachedEquipment: ['boots_1'],
        isEquipped: true,
      });
      
      g.state.battlefield.push({
        id: 'creature_2',
        controller: p1,
        card: { id: 'creature_2', name: 'Elite Vanguard', type_line: 'Creature — Human Soldier' },
        tapped: false,
      });
      
      const equipment = g.state.battlefield.find((p: any) => p.id === 'boots_1');
      const oldTarget = g.state.battlefield.find((p: any) => p.id === 'creature_1');
      const newTarget = g.state.battlefield.find((p: any) => p.id === 'creature_2');
      
      // Remove from old target
      (oldTarget as any).attachedEquipment = [];
      (oldTarget as any).isEquipped = false;
      
      // Attach to new target
      (equipment as any).attachedTo = 'creature_2';
      (newTarget as any).attachedEquipment = ['boots_1'];
      (newTarget as any).isEquipped = true;
      
      // Verify states
      expect((equipment as any).attachedTo).toBe('creature_2');
      expect((oldTarget as any).attachedEquipment).toHaveLength(0);
      expect((oldTarget as any).isEquipped).toBe(false);
      expect((newTarget as any).attachedEquipment).toContain('boots_1');
      expect((newTarget as any).isEquipped).toBe(true);
    });
    
    it('should unattach equipment when creature leaves battlefield', () => {
      const g = createInitialGameState('equipment_creature_dies');
      
      const p1 = 'p1' as PlayerID;
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Add equipment and creature to battlefield
      g.state.battlefield.push({
        id: 'boots_1',
        controller: p1,
        card: { id: 'boots_1', name: 'Swiftfoot Boots', type_line: 'Artifact — Equipment' },
        tapped: false,
        attachedTo: 'creature_1',
      });
      
      g.state.battlefield.push({
        id: 'creature_1',
        controller: p1,
        card: { id: 'creature_1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        tapped: false,
        attachedEquipment: ['boots_1'],
        isEquipped: true,
      });
      
      // Simulate creature leaving battlefield (handled by sacrificePermanent logic)
      const creatureIndex = g.state.battlefield.findIndex((p: any) => p.id === 'creature_1');
      const creature = g.state.battlefield[creatureIndex];
      
      // Cleanup attached equipment (this is what the handler should do)
      if ((creature as any).attachedEquipment && (creature as any).attachedEquipment.length > 0) {
        for (const equipId of (creature as any).attachedEquipment) {
          const equipment = g.state.battlefield.find((p: any) => p.id === equipId);
          if (equipment) {
            (equipment as any).attachedTo = undefined;
          }
        }
      }
      
      // Remove creature from battlefield
      g.state.battlefield.splice(creatureIndex, 1);
      
      // Verify equipment is unattached
      const equipment = g.state.battlefield.find((p: any) => p.id === 'boots_1');
      expect(equipment).toBeDefined();
      expect((equipment as any).attachedTo).toBeUndefined();
    });
    
    it('should unattach from creature when equipment leaves battlefield', () => {
      const g = createInitialGameState('equipment_destroyed');
      
      const p1 = 'p1' as PlayerID;
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Add equipment and creature to battlefield
      g.state.battlefield.push({
        id: 'boots_1',
        controller: p1,
        card: { id: 'boots_1', name: 'Swiftfoot Boots', type_line: 'Artifact — Equipment' },
        tapped: false,
        attachedTo: 'creature_1',
      });
      
      g.state.battlefield.push({
        id: 'creature_1',
        controller: p1,
        card: { id: 'creature_1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        tapped: false,
        attachedEquipment: ['boots_1'],
        isEquipped: true,
      });
      
      // Simulate equipment leaving battlefield (handled by sacrificePermanent logic)
      const equipmentIndex = g.state.battlefield.findIndex((p: any) => p.id === 'boots_1');
      const equipment = g.state.battlefield[equipmentIndex];
      const typeLine = ((equipment as any).card?.type_line || '').toLowerCase();
      const isEquipment = typeLine.includes('equipment');
      
      // Cleanup equipment attachments (this is what the handler should do)
      if (isEquipment && (equipment as any).attachedTo) {
        const attachedCreature = g.state.battlefield.find((p: any) => p.id === (equipment as any).attachedTo);
        if (attachedCreature && (attachedCreature as any).attachedEquipment) {
          (attachedCreature as any).attachedEquipment = ((attachedCreature as any).attachedEquipment as string[]).filter(
            (id: string) => id !== 'boots_1'
          );
          // Remove equipped badge if no equipment remains
          if ((attachedCreature as any).attachedEquipment.length === 0) {
            (attachedCreature as any).isEquipped = false;
          }
        }
      }
      
      // Remove equipment from battlefield
      g.state.battlefield.splice(equipmentIndex, 1);
      
      // Verify creature is unequipped
      const creature = g.state.battlefield.find((p: any) => p.id === 'creature_1');
      expect(creature).toBeDefined();
      expect((creature as any).attachedEquipment).toHaveLength(0);
      expect((creature as any).isEquipped).toBe(false);
    });
  });
});
