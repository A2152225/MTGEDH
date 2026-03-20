import { describe, it, expect, beforeEach } from 'vitest';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('Return Controlled Permanent Resolution Queue Integration', () => {
  const testGameId = 'test_game_bounce_land';
  
  beforeEach(() => {
    // Clean up any existing queue for this test game
    ResolutionQueueManager.removeQueue(testGameId);
  });
  
  it('should create a return-controlled-permanent resolution step', () => {
    // Simulate adding a generic return-controlled-permanent step to the queue.
    const step = ResolutionQueueManager.addStep(testGameId, {
      type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
      playerId: 'p1' as any,
      description: 'Azorius Chancery: Return a land you control to its owner\'s hand',
      mandatory: true,
      sourceId: 'perm_bounce_1',
      sourceName: 'Azorius Chancery',
      returnControlledPermanentChoice: true,
      returnControlledPermanentSourceName: 'Azorius Chancery',
      returnControlledPermanentDestination: 'hand',
      returnControlledPermanentOptions: [
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
    expect(step.type).toBe(ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE);
    expect(step.playerId).toBe('p1');
    expect(step.mandatory).toBe(true);
    expect((step as any).returnControlledPermanentSourceName).toBe('Azorius Chancery');
    expect((step as any).returnControlledPermanentOptions).toHaveLength(2);
  });
  
  it('should track the return-controlled-permanent step in the queue', () => {
    // Add a generic return-controlled-permanent step.
    ResolutionQueueManager.addStep(testGameId, {
      type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
      playerId: 'p1' as any,
      description: 'Simic Growth Chamber: Return a land you control to its owner\'s hand',
      mandatory: true,
      sourceId: 'perm_bounce_2',
      sourceName: 'Simic Growth Chamber',
      returnControlledPermanentChoice: true,
      returnControlledPermanentSourceName: 'Simic Growth Chamber',
      returnControlledPermanentDestination: 'hand',
      returnControlledPermanentOptions: [
        { permanentId: 'perm_island_1', cardName: 'Island' },
      ],
    });
    
    // Check queue summary
    const summary = ResolutionQueueManager.getPendingSummary(testGameId);
    
    expect(summary.hasPending).toBe(true);
    expect(summary.pendingCount).toBe(1);
    expect(summary.pendingTypes).toContain('return_controlled_permanent_choice');
  });
  
  it('should retrieve the return-controlled-permanent step for each player', () => {
    // Add steps for multiple players
    ResolutionQueueManager.addStep(testGameId, {
      type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
      playerId: 'p1' as any,
      description: 'Return a land',
      mandatory: true,
      sourceId: 'b1',
      sourceName: 'Bounce Land 1',
      returnControlledPermanentChoice: true,
      returnControlledPermanentSourceName: 'Bounce Land 1',
      returnControlledPermanentDestination: 'hand',
      returnControlledPermanentOptions: [],
    });
    
    ResolutionQueueManager.addStep(testGameId, {
      type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
      playerId: 'p2' as any,
      description: 'Return a land',
      mandatory: true,
      sourceId: 'b2',
      sourceName: 'Bounce Land 2',
      returnControlledPermanentChoice: true,
      returnControlledPermanentSourceName: 'Bounce Land 2',
      returnControlledPermanentDestination: 'hand',
      returnControlledPermanentOptions: [],
    });
    
    // Get steps for player 1
    const p1Steps = ResolutionQueueManager.getStepsForPlayer(testGameId, 'p1' as any);
    
    expect(p1Steps).toHaveLength(1);
    expect(p1Steps[0].playerId).toBe('p1');
    expect((p1Steps[0] as any).returnControlledPermanentSourceName).toBe('Bounce Land 1');
    
    // Get steps for player 2
    const p2Steps = ResolutionQueueManager.getStepsForPlayer(testGameId, 'p2' as any);
    
    expect(p2Steps).toHaveLength(1);
    expect(p2Steps[0].playerId).toBe('p2');
    expect((p2Steps[0] as any).returnControlledPermanentSourceName).toBe('Bounce Land 2');
  });
  
  it('should complete the return-controlled-permanent step when the player responds', () => {
    // Add a generic return-controlled-permanent step.
    const step = ResolutionQueueManager.addStep(testGameId, {
      type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
      playerId: 'p1' as any,
      description: 'Return a land',
      mandatory: true,
      sourceId: 'b1',
      sourceName: 'Test Bounce Land',
      returnControlledPermanentChoice: true,
      returnControlledPermanentSourceName: 'Test Bounce Land',
      returnControlledPermanentDestination: 'hand',
      returnControlledPermanentOptions: [
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
  
  it('should handle multiple return-controlled-permanent steps in APNAP order', () => {
    // Simulate multiple bounce-land-originated generic steps triggering at the same time.
    // Active player is p1, turn order is p1, p2, p3
    const turnOrder = ['p1', 'p2', 'p3'] as any[];
    const activePlayer = 'p1' as any;
    
    const stepConfigs = [
      {
        type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
        playerId: 'p2' as any,
        description: 'Return a land',
        mandatory: true,
        sourceId: 'b2',
        sourceName: 'P2 Bounce Land',
        returnControlledPermanentChoice: true,
        returnControlledPermanentSourceName: 'P2 Bounce Land',
        returnControlledPermanentDestination: 'hand',
        returnControlledPermanentOptions: [],
      },
      {
        type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
        playerId: 'p1' as any,
        description: 'Return a land',
        mandatory: true,
        sourceId: 'b1',
        sourceName: 'P1 Bounce Land',
        returnControlledPermanentChoice: true,
        returnControlledPermanentSourceName: 'P1 Bounce Land',
        returnControlledPermanentDestination: 'hand',
        returnControlledPermanentOptions: [],
      },
      {
        type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
        playerId: 'p3' as any,
        description: 'Return a land',
        mandatory: true,
        sourceId: 'b3',
        sourceName: 'P3 Bounce Land',
        returnControlledPermanentChoice: true,
        returnControlledPermanentSourceName: 'P3 Bounce Land',
        returnControlledPermanentDestination: 'hand',
        returnControlledPermanentOptions: [],
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
