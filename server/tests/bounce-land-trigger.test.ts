import { describe, it, expect } from 'vitest';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities';

describe('Bounce Land ETB Trigger Detection', () => {
  it('should detect bounce land ETB trigger from oracle text', () => {
    // Azorius Chancery oracle text
    const card = {
      id: 'azorius_chancery_1',
      name: 'Azorius Chancery',
      type_line: 'Land',
      oracle_text: "Azorius Chancery enters tapped.\nWhen Azorius Chancery enters, return a land you control to its owner's hand.\n{T}: Add {W}{U}.",
      mana_cost: '',
      image_uris: undefined,
    };
    
    const permanent = {
      id: 'perm_1',
      controller: 'p1',
      card,
    };
    
    const triggers = detectETBTriggers(card, permanent);
    
    // Should detect one ETB trigger
    expect(triggers.length).toBeGreaterThan(0);
    
    // Find the bounce land trigger
    const bounceTrigger = triggers.find(t => t.triggerType === 'etb_bounce_land');
    
    // Should have detected the bounce land trigger
    expect(bounceTrigger).toBeDefined();
    expect(bounceTrigger?.mandatory).toBe(true);
    expect(bounceTrigger?.requiresChoice).toBe(true);
    expect(bounceTrigger?.cardName).toBe('Azorius Chancery');
  });
  
  it('should detect bounce land trigger for Simic Growth Chamber', () => {
    const card = {
      id: 'simic_growth_chamber_1',
      name: 'Simic Growth Chamber',
      type_line: 'Land',
      oracle_text: "Simic Growth Chamber enters tapped.\nWhen Simic Growth Chamber enters, return a land you control to its owner's hand.\n{T}: Add {G}{U}.",
      mana_cost: '',
      image_uris: undefined,
    };
    
    const permanent = {
      id: 'perm_2',
      controller: 'p1',
      card,
    };
    
    const triggers = detectETBTriggers(card, permanent);
    const bounceTrigger = triggers.find(t => t.triggerType === 'etb_bounce_land');
    
    expect(bounceTrigger).toBeDefined();
    expect(bounceTrigger?.effect).toContain('return a land you control');
  });
  
  it('should not detect bounce land trigger for regular lands', () => {
    const card = {
      id: 'forest_1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      mana_cost: '',
      image_uris: undefined,
    };
    
    const permanent = {
      id: 'perm_3',
      controller: 'p1',
      card,
    };
    
    const triggers = detectETBTriggers(card, permanent);
    const bounceTrigger = triggers.find(t => t.triggerType === 'etb_bounce_land');
    
    // Regular lands should not have bounce land trigger
    expect(bounceTrigger).toBeUndefined();
  });
  
  it('should not detect bounce land trigger for shock lands', () => {
    const card = {
      id: 'hallowed_fountain_1',
      name: 'Hallowed Fountain',
      type_line: 'Land — Plains Island',
      oracle_text: "({T}: Add {W} or {U}.)\nAs Hallowed Fountain enters, you may pay 2 life. If you don't, it enters tapped.",
      mana_cost: '',
      image_uris: undefined,
    };
    
    const permanent = {
      id: 'perm_4',
      controller: 'p1',
      card,
    };
    
    const triggers = detectETBTriggers(card, permanent);
    const bounceTrigger = triggers.find(t => t.triggerType === 'etb_bounce_land');
    
    // Shock lands should not have bounce land trigger
    expect(bounceTrigger).toBeUndefined();
  });
});
