/**
 * Oracle IR rollout flags. Trigger and spell primary default ON in production.
 *
 * Opt-out (P4e — LEGACY aliases removed):
 * - ORACLE_IR_TRIGGER_PRIMARY=0|false|no|off
 * - ORACLE_IR_SPELL_PRIMARY=0|false|no|off
 *
 * ORACLE_IR_*_LEGACY is ignored. Vitest harness forces PRIMARY=0 by default;
 * production omits the vars (primary ON).
 */
export function parseOracleIrFeatureFlag(raw: string | undefined): boolean | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return undefined;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return undefined;
}

/** True when trigger IR primary is explicitly disabled (PRIMARY=0). */
export function isOracleIrTriggerLegacyForced(): boolean {
  return parseOracleIrFeatureFlag(process.env.ORACLE_IR_TRIGGER_PRIMARY) === false;
}

export function isOracleIrTriggerPrimaryEnabled(): boolean {
  const primaryOverride = parseOracleIrFeatureFlag(process.env.ORACLE_IR_TRIGGER_PRIMARY);
  if (primaryOverride === true) return true;
  if (primaryOverride === false) return false;
  return true;
}

/** True when spell IR primary is explicitly disabled (PRIMARY=0). */
export function isOracleIrSpellLegacyForced(): boolean {
  return parseOracleIrFeatureFlag(process.env.ORACLE_IR_SPELL_PRIMARY) === false;
}

export function isOracleIrSpellPrimaryEnabled(): boolean {
  const primaryOverride = parseOracleIrFeatureFlag(process.env.ORACLE_IR_SPELL_PRIMARY);
  if (primaryOverride === true) return true;
  if (primaryOverride === false) return false;
  return true;
}
