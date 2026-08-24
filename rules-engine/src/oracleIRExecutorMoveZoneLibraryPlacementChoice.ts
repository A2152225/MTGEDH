// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster: library-placement destinations that are a player choice rather than a fixed position.
// Public entry symbols: isUndecidedLibraryPlacementChoice
//
// getLibraryPlacement() collapses "top or bottom" to 'top' so a destination always resolves. That
// is wrong for wordings like "on your choice of the top or bottom of its owner's library": the
// position is a choice made on resolution, so the executor must skip and let the resolution queue
// prompt for it instead of silently picking top.

import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type MoveZoneStep = Extract<OracleEffectStep, { kind: 'move_zone' }>;

function getSuppliedLibraryPlacement(ctx: OracleIRExecutionContext | undefined): string {
  if (!ctx) return '';
  return String((ctx as any).libraryPlacement || ctx.selectorContext?.libraryPlacement || '')
    .trim()
    .toLowerCase();
}

// Deliberately narrow, and limited to the controller's own choice ("your choice of the top or
// bottom"). When the choice belongs to each affected card's owner instead ("its owner puts it on
// their choice of...", Aetherspouts), the executor already applies a per-owner default, and
// wordings without "choice" at all are settled by dedicated paths.
const CHOICE_PATTERNS: RegExp[] = [
  /\byour\s+choice\s+of\s+(?:the\s+)?(?:top|bottom)\s+or\s+(?:the\s+)?(?:top|bottom)\b/i,
];

export function isUndecidedLibraryPlacementChoice(
  step: MoveZoneStep,
  ctx?: OracleIRExecutionContext
): boolean {
  if (step.to !== 'library') return false;
  // An explicit parsed placement means the parser already settled the position.
  if (step.libraryPlacement === 'top' || step.libraryPlacement === 'bottom') return false;
  // The caller already resolved the choice (Hinder supplies 'bottom'), so it is no longer undecided.
  const supplied = getSuppliedLibraryPlacement(ctx);
  if (supplied === 'top' || supplied === 'bottom') return false;

  const toRaw = String(step.toRaw || '');
  const raw = String(step.raw || '');
  return CHOICE_PATTERNS.some((pattern) => pattern.test(toRaw) || pattern.test(raw));
}
