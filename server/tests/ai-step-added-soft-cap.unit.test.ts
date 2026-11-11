/**
 * Soft-cap for STEP_ADDED auto-resolve recreate storms (Mirko library_search,
 * Taste of Death target_selection, Heliod X).
 */
import { describe, expect, it } from 'vitest'
import {
  makeAiResolutionStepCapKey,
  shouldSoftCapAiAutoResolveStep,
  takeAiResolutionStepCapSlot,
} from '../src/socket/ai-handlers/aiResolutionStepLoopBreak.js'

function makeGame(turnNumber = 5) {
  return {
    state: {
      turnNumber,
      _aiResolutionStepCounts: {},
      _aiBlockedResolutionSources: {},
      _aiResolutionCapSeenStepIds: {},
    },
  }
}

describe('AI STEP_ADDED soft-cap', () => {
  it('soft-caps library_search, target_selection, x_value_selection, graveyard_selection', () => {
    expect(shouldSoftCapAiAutoResolveStep({ type: 'library_search' })).toBe(true)
    expect(shouldSoftCapAiAutoResolveStep({ type: 'target_selection' })).toBe(true)
    expect(shouldSoftCapAiAutoResolveStep({ type: 'x_value_selection' })).toBe(true)
    expect(shouldSoftCapAiAutoResolveStep({ type: 'graveyard_selection' })).toBe(true)
    expect(shouldSoftCapAiAutoResolveStep({ type: 'scry' })).toBe(false)
    expect(shouldSoftCapAiAutoResolveStep({ type: 'mode_selection' })).toBe(false)
  })

  it('allows two answers then blocks the same source/type for the rest of the turn', () => {
    const game = makeGame(12)
    const playerId = 'p1'
    const base = {
      type: 'library_search',
      sourceName: 'Mirko, Obsessive Theorist',
      playerId,
    }

    expect(takeAiResolutionStepCapSlot(game, playerId, { ...base, id: 's1' })).toBe('answer')
    expect(takeAiResolutionStepCapSlot(game, playerId, { ...base, id: 's2' })).toBe('answer')
    expect(takeAiResolutionStepCapSlot(game, playerId, { ...base, id: 's3' })).toBe('block')
    expect(takeAiResolutionStepCapSlot(game, playerId, { ...base, id: 's4' })).toBe('block')

    const key = makeAiResolutionStepCapKey(playerId, 12, 'library_search', 'Mirko, Obsessive Theorist')
    expect(game.state._aiBlockedResolutionSources[key]).toBe(true)
    expect(game.state._aiResolutionStepCounts[key]).toBe(2)
  })

  it('is idempotent per step.id (STEP_ADDED gate + builder do not double-count)', () => {
    const game = makeGame(3)
    const step = {
      id: 'same-step',
      type: 'x_value_selection',
      sourceName: "Heliod's Intervention",
      playerId: 'p1',
    }
    expect(takeAiResolutionStepCapSlot(game, 'p1', step)).toBe('answer')
    expect(takeAiResolutionStepCapSlot(game, 'p1', step)).toBe('answer')
    expect(takeAiResolutionStepCapSlot(game, 'p1', step)).toBe('answer')

    const key = makeAiResolutionStepCapKey('p1', 3, 'x_value_selection', "Heliod's Intervention")
    expect(game.state._aiResolutionStepCounts[key]).toBe(1)
  })

  it('tracks different sources independently', () => {
    const game = makeGame(7)
    const mirko = { type: 'library_search', sourceName: 'Mirko, Obsessive Theorist', playerId: 'p1' }
    const taste = { type: 'target_selection', sourceName: 'Taste of Death', playerId: 'p1' }

    expect(takeAiResolutionStepCapSlot(game, 'p1', { ...mirko, id: 'a1' })).toBe('answer')
    expect(takeAiResolutionStepCapSlot(game, 'p1', { ...taste, id: 'b1' })).toBe('answer')
    expect(takeAiResolutionStepCapSlot(game, 'p1', { ...mirko, id: 'a2' })).toBe('answer')
    expect(takeAiResolutionStepCapSlot(game, 'p1', { ...taste, id: 'b2' })).toBe('answer')
    expect(takeAiResolutionStepCapSlot(game, 'p1', { ...mirko, id: 'a3' })).toBe('block')
    expect(takeAiResolutionStepCapSlot(game, 'p1', { ...taste, id: 'b3' })).toBe('block')
  })
})
