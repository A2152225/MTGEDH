import { describe, it, expect, beforeEach } from 'vitest';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('Bounce Land Resolution Queue Integration', () => {
  const testGameId = 'test_game_bounce_land';
  
  beforeEach(() => {
    // Clean up any existing queue for this test game
    ResolutionQueueManager.removeQueue(testGameId);
  });
  
  it('should create a bounce land choice resolution step', () => {
    // Simulate adding a bounce land choice step to the queue
    const step = ResolutionQueueManager.addStep(testGameId, {
      type: ResolutionStepType.BOUNCE_LAND_CHOICE,
      playerId: 'p1' as any,
      description: 'Azorius Chancery: Return a land you control to its owner\'s hand',
      mandatory: true,
      sourceId: 'perm_bounce_1',
      sourceName: 'Azorius Chancery',
      bounceLandId: 'perm_bounce_1',
      bounceLandName: 'Azorius Chancery',
      landsToChoose: [
        {
          permanentId: 'perm_forest_1',
          cardName: 'Forest',
          imageUrl: undefined,
        },
        {
          permanentId: 'perm_bounce_1',
          cardName: 'Azorius Chancery',
          imageUrl: undefined,
        },
      ],
      stackItemId: 'stack_item_1',
    });
    
    // Verify the step was created correctly
    expect(step).toBeDefined();
    expect(step.type).toBe(ResolutionStepType.BOUNCE_LAND_CHOICE);
    expect(step.playerId).toBe('p1');
    expect(step.mandatory).toBe(true);
    expect((step as any).bounceLandName).toBe('Azorius Chancery');
    expect((step as any).landsToChoose).toHaveLength(2);
  });
  
  it('should track bounce land choice step in the queue', () => {
    // Add a bounce land choice step
    ResolutionQueueManager.addStep(testGameId, {
      type: ResolutionStepType.BOUNCE_LAND_CHOICE,
      playerId: 'p1' as any,
      description: 'Simic Growth Chamber: Return a land you control to its owner\'s hand',
      mandatory: true,
      sourceId: 'perm_bounce_2',
      sourceName: 'Simic Growth Chamber',
      bounceLandId: 'perm_bounce_2',
      bounceLandName: 'Simic Growth Chamber',
      landsToChoose: [
        { permanentId: 'perm_island_1', cardName: 'Island' },
      ],
    });
    
    // Check queue summary
    const summary = ResolutionQueueManager.getPendingSummary(testGameId);
    
    expect(summary.hasPending).toBe(true);
    expect(summary.pendingCount).toBe(1);
    expect(summary.pendingTypes).toContain('bounce_land_choice');
  });
  
  it('should retrieve bounce land choice step for player', () => {
    // Add steps for multiple players
    ResolutionQueueManager.addStep(testGameId, {
      type: ResolutionStepType.BOUNCE_LAND_CHOICE,
      playerId: 'p1' as any,
      description: 'Return a land',
      mandatory: true,
      bounceLandId: 'b1',
      bounceLandName: 'Bounce Land 1',
      landsToChoose: [],
    });
    
    ResolutionQueueManager.addStep(testGameId, {
      type: ResolutionStepType.BOUNCE_LAND_CHOICE,
      playerId: 'p2' as any,
      description: 'Return a land',
      mandatory: true,
      bounceLandId: 'b2',
      bounceLandName: 'Bounce Land 2',
      landsToChoose: [],
    });
    
    // Get steps for player 1
    const p1Steps = ResolutionQueueManager.getStepsForPlayer(testGameId, 'p1' as any);
    
    expect(p1Steps).toHaveLength(1);
    expect(p1Steps[0].playerId).toBe('p1');
    expect((p1Steps[0] as any).bounceLandName).toBe('Bounce Land 1');
    
    // Get steps for player 2
    const p2Steps = ResolutionQueueManager.getStepsForPlayer(testGameId, 'p2' as any);
    
    expect(p2Steps).toHaveLength(1);
    expect(p2Steps[0].playerId).toBe('p2');
    expect((p2Steps[0] as any).bounceLandName).toBe('Bounce Land 2');
  });
  
  it('should complete bounce land choice step when player responds', () => {
    // Add a bounce land choice step
    const step = ResolutionQueueManager.addStep(testGameId, {
      type: ResolutionStepType.BOUNCE_LAND_CHOICE,
      playerId: 'p1' as any,
      description: 'Return a land',
      mandatory: true,
      bounceLandId: 'b1',
      bounceLandName: 'Test Bounce Land',
      landsToChoose: [
        { permanentId: 'land_1', cardName: 'Forest' },
        { permanentId: 'land_2', cardName: 'Island' },
      ],
    });
    
    // Player chooses to return Forest
    const response = {
      stepId: step.id,
      playerId: 'p1' as any,
      selections: 'land_1',
      cancelled: false,
      timestamp: Date.now(),
    };
    
    const completed = ResolutionQueueManager.completeStep(testGameId, step.id, response);
    
    expect(completed).toBeTruthy();
    
    // Queue should now be empty
    const summary = ResolutionQueueManager.getPendingSummary(testGameId);
    expect(summary.hasPending).toBe(false);
    expect(summary.pendingCount).toBe(0);
  });
  
  it('should handle multiple bounce lands in APNAP order', () => {
    // Simulate multiple bounce lands triggering at the same time
    // Active player is p1, turn order is p1, p2, p3
    const turnOrder = ['p1', 'p2', 'p3'] as any[];
    const activePlayer = 'p1' as any;
    
    const stepConfigs = [
      {
        type: ResolutionStepType.BOUNCE_LAND_CHOICE,
        playerId: 'p2' as any,
        description: 'Return a land',
        mandatory: true,
        bounceLandId: 'b2',
        bounceLandName: 'P2 Bounce Land',
        landsToChoose: [],
      },
      {
        type: ResolutionStepType.BOUNCE_LAND_CHOICE,
        playerId: 'p1' as any,
        description: 'Return a land',
        mandatory: true,
        bounceLandId: 'b1',
        bounceLandName: 'P1 Bounce Land',
        landsToChoose: [],
      },
      {
        type: ResolutionStepType.BOUNCE_LAND_CHOICE,
        playerId: 'p3' as any,
        description: 'Return a land',
        mandatory: true,
        bounceLandId: 'b3',
        bounceLandName: 'P3 Bounce Land',
        landsToChoose: [],
      },
    ];
    
    // Add steps with APNAP ordering
    const steps = ResolutionQueueManager.addStepsWithAPNAP(
      testGameId,
      stepConfigs,
      turnOrder,
      activePlayer
    );
    
    // Steps should be ordered: p1 (active player), then p2, then p3
    expect(steps).toHaveLength(3);
    expect(steps[0].playerId).toBe('p1');
    expect(steps[1].playerId).toBe('p2');
    expect(steps[2].playerId).toBe('p3');
    
    // Get next step should return p1's first
    const nextStep = ResolutionQueueManager.getNextStep(testGameId);
    expect(nextStep?.playerId).toBe('p1');
  });
});
