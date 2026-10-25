/**
 * Batch 21: run executeSpellEffect with the resolving spell recorded, for callers outside the main spell
 * resolution loop (graveyard automation, reflexive preludes). An already-recorded outer spell is restored after.
 */
import type { GameContext } from '../context.js';
import { executeSpellEffect } from './executeSpellEffect.js';
import { type ResolvingSpellSource, withResolvingSpellSource } from './replacementResolvingSpellSource.js';

type Rest = Parameters<typeof executeSpellEffect> extends [GameContext, ...infer R] ? R : never;

export function executeSpellEffectRecorded(ctx: GameContext, src: ResolvingSpellSource, ...rest: Rest): void {
  withResolvingSpellSource(ctx.state, src, () => executeSpellEffect(ctx, ...rest));
}
