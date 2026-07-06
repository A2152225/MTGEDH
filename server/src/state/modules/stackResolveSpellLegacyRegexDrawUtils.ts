import { debug } from '../../utils/debug.js';
import { shouldSkipLegacySpellRegexHandlers } from './oracleIrSpellLegacyRouting.js';

export function logLegacySpellRegexPrimaryMiss(
  oracleIrSpellHandled: boolean,
  spellName: string,
  oracleText: string,
): void {
  if (shouldSkipLegacySpellRegexHandlers(oracleText, spellName) && !oracleIrSpellHandled) {
    debug(
      1,
      `[resolveTopOfStack] ${spellName || 'spell'}: IR primary owns spell effect but did not apply via top gate: ${String(oracleText || '').trim()}`,
    );
  }
}
