/**
 * Oracle IR rollout flags. Trigger and spell primary default ON in production.
 *
 * Trigger primary opt-out:
 * - ORACLE_IR_TRIGGER_PRIMARY=0|false|no|off
 * - ORACLE_IR_TRIGGER_LEGACY=1|true|yes|on
 *
 * Spell primary opt-out:
 * - ORACLE_IR_SPELL_PRIMARY=0|false|no|off
 * - ORACLE_IR_SPELL_LEGACY=1|true|yes|on
 */
export function parseOracleIrFeatureFlag(raw: string | undefined): boolean | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return undefined;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return undefined;
}

export function isOracleIrTriggerLegacyForced(): boolean {
  if (parseOracleIrFeatureFlag(process.env.ORACLE_IR_TRIGGER_LEGACY) === true) {
    return true;
  }
  return parseOracleIrFeatureFlag(process.env.ORACLE_IR_TRIGGER_PRIMARY) === false;
}

export function isOracleIrTriggerPrimaryEnabled(): boolean {
  if (isOracleIrTriggerLegacyForced()) {
    return false;
  }
  const primaryOverride = parseOracleIrFeatureFlag(process.env.ORACLE_IR_TRIGGER_PRIMARY);
  if (primaryOverride === true) return true;
  if (primaryOverride === false) return false;
  return true;
}

export function isOracleIrSpellLegacyForced(): boolean {
  if (parseOracleIrFeatureFlag(process.env.ORACLE_IR_SPELL_LEGACY) === true) {
    return true;
  }
  return parseOracleIrFeatureFlag(process.env.ORACLE_IR_SPELL_PRIMARY) === false;
}

export function isOracleIrSpellPrimaryEnabled(): boolean {
  if (isOracleIrSpellLegacyForced()) {
    return false;
  }
  const primaryOverride = parseOracleIrFeatureFlag(process.env.ORACLE_IR_SPELL_PRIMARY);
  if (primaryOverride === true) return true;
  if (primaryOverride === false) return false;
  return true;
}
