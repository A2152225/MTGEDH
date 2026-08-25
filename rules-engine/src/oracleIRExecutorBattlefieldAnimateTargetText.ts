// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: normalizeAnimatePermanentTargetText.
// Public entry: normalizeAnimatePermanentTargetText.

import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';

export function normalizeAnimatePermanentTargetText(value: string): string {
  const trimmed = normalizeBattlefieldTargetReferenceText(value)
    .replace(/^up to one\s+/i, '')
    .replace(/^one\s+/i, '')
    .replace(/\s+becomes?\s+an?\s+.+$/i, '')
    .trim();
  const haveTarget = trimmed.match(/^have\s+(target\s+.+)$/i);
  if (haveTarget) return String(haveTarget[1] || '').trim();
  const otherLand = trimmed.match(/^other\s+(target\s+land you control)$/i);
  if (otherLand) return String(otherLand[1] || '').trim();
  if (/^land you control$/i.test(trimmed)) return 'target land you control';
  return trimmed;
}

