import type { BattlefieldPermanent } from '../../../shared/src';

/**
 * Loose battlefield-permanent fixture. Many executor tests still build permanents with the legacy
 * flat fields (`name`, `type_line`, `power`, `cardType`, `effectiveTypes`, ...) that the executor's
 * fallbacks read, so this keeps those fixtures typed without per-field `as any` casts.
 */
export type BattlefieldPermanentFixture = { readonly [K in keyof BattlefieldPermanent]?: unknown } & {
  readonly [key: string]: unknown;
};

/** The single documented boundary where a loose fixture is treated as a BattlefieldPermanent. */
export function asBattlefieldPermanent(fixture: BattlefieldPermanentFixture): BattlefieldPermanent {
  return fixture as unknown as BattlefieldPermanent;
}
