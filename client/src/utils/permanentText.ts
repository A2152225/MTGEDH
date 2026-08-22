import type { BattlefieldPermanent } from '../../../shared/src';
import { stripCreateTokenGrantedAbilities } from '../../../rules-engine/src/oracleReminderText';

function normalizeTextEntry(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text : null;
}

/**
 * Oracle fragments used for keyword / combat helper scans.
 * Strip create-token ability tails and token-type reminders so creators
 * (e.g. T'Challa / Vibranium) do not inherit token keywords like indestructible.
 */
function normalizeOracleFragmentForPermanentScan(value: unknown): string | null {
  const normalized = normalizeTextEntry(value);
  if (!normalized) return null;
  const stripped = stripCreateTokenGrantedAbilities(normalized).trim();
  return stripped || null;
}

export function getPermanentTextFragments(permanent: BattlefieldPermanent | any): string[] {
  const fragments: string[] = [];

  const cardOracle = normalizeOracleFragmentForPermanentScan((permanent as any)?.card?.oracle_text);
  if (cardOracle) fragments.push(cardOracle);

  const permanentOracle = normalizeOracleFragmentForPermanentScan((permanent as any)?.oracle_text);
  if (permanentOracle && permanentOracle !== cardOracle) {
    fragments.push(permanentOracle);
  }

  if (Array.isArray((permanent as any)?.grantedAbilities) && (permanent as any).grantedAbilities.length > 0) {
    fragments.push((permanent as any).grantedAbilities.join('\n'));
  }

  const temporaryEffects = Array.isArray((permanent as any)?.temporaryEffects)
    ? (permanent as any).temporaryEffects
    : [];
  for (const effect of temporaryEffects) {
    const description = normalizeTextEntry(effect?.description);
    if (description) {
      fragments.push(description);
    }
  }

  return fragments;
}

export function getCombinedPermanentText(permanent: BattlefieldPermanent | any): string {
  return getPermanentTextFragments(permanent).join('\n').toLowerCase();
}
