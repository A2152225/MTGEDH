import { expect } from 'vitest';

type StepResultLike = { readonly applied: boolean };

/**
 * Asserts a step handler result applied, with no skip reason attached, and narrows it to the
 * applied variant so `state` / `log` / handler-specific fields are typed without casts.
 */
export function assertApplied<R extends StepResultLike>(
  result: R,
): asserts result is Extract<R, { readonly applied: true }> {
  expect(result.applied).toBe(true);
  expect(Reflect.get(result, 'reason')).toBeUndefined();
}

/** Asserts a step handler result was skipped and narrows it to the skip variant (`reason`, `message`). */
export function assertSkipped<R extends StepResultLike>(
  result: R,
): asserts result is Extract<R, { readonly applied: false }> {
  expect(result.applied).toBe(false);
}
