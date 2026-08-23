from pathlib import Path

RE = Path(r"D:\Git\MTGEDH\rules-engine\src")
SERVER = Path(r"D:\Git\MTGEDH\server\src\state\modules")
TESTS = Path(r"D:\Git\MTGEDH\server\tests")

helper = r'''import type { GameState, PlayerID } from '../../shared/src';

/**
 * Authoritative count of times this player has cast a commander from the command zone this game.
 * Prefer command-zone tax (tax += 2 per CZ cast => casts = sum(taxById)/2), matching Jeska-style ETB loyalty.
 * Falls back to explicit commanderCastsFromCommandZoneThisGame when tax is unavailable.
 */
export function resolveCommanderCastsFromCommandZoneThisGame(
  state: GameState | null | undefined,
  controllerId: PlayerID | string | null | undefined,
): number {
  const playerId = String(controllerId || '').trim();
  if (!playerId) return 0;

  const stateAny = state as any;
  const commandZoneEntry =
    stateAny?.commandZone?.[playerId]
    ?? stateAny?.commandZones?.[playerId]
    ?? null;

  let fromTax = 0;
  const taxById = commandZoneEntry?.taxById;
  if (taxById && typeof taxById === 'object') {
    for (const tax of Object.values(taxById)) {
      const taxNumber = typeof tax === 'number' ? tax : Number(tax);
      if (Number.isFinite(taxNumber) && taxNumber > 0) {
        fromTax += Math.floor(taxNumber / 2);
      }
    }
  } else {
    const totalTax = Number(commandZoneEntry?.tax);
    if (Number.isFinite(totalTax) && totalTax > 0) {
      fromTax = Math.floor(totalTax / 2);
    }
  }

  if (fromTax > 0) return fromTax;

  const explicit = Number(stateAny?.commanderCastsFromCommandZoneThisGame?.[playerId]);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(0, Math.floor(explicit));
  }

  // Explicit 0 / missing + no tax => 0 casts
  if (Number.isFinite(explicit) && explicit === 0) return 0;
  return 0;
}
'''

(RE / 'oracleIRExecutorCommanderCastCount.ts').write_text(helper, encoding='utf-8', newline='\n')
print('wrote helper')

# Patch resolveCopySpellCount
copy_path = RE / 'oracleIRExecutorCopySpellSupport.ts'
copy_text = copy_path.read_text(encoding='utf-8')
old_import = "import { parseManaSymbols } from './types/numbers';\n"
new_import = old_import + "import { resolveCommanderCastsFromCommandZoneThisGame } from './oracleIRExecutorCommanderCastCount';\n"
if "oracleIRExecutorCommanderCastCount" not in copy_text:
    if old_import not in copy_text:
        raise SystemExit('import anchor missing in CopySpellSupport')
    copy_text = copy_text.replace(old_import, new_import, 1)

old_block = """    if (/commander.*command zone.*this game/.test(raw)) {
      const count = Number((state as any)?.commanderCastsFromCommandZoneThisGame?.[controllerId]);
      return Math.max(0, Number.isFinite(count) ? count : 0);
    }"""
new_block = """    if (/commander.*command zone.*this game/.test(raw)) {
      return resolveCommanderCastsFromCommandZoneThisGame(state, controllerId);
    }"""
if old_block not in copy_text:
    raise SystemExit('commander copy block not found')
copy_text = copy_text.replace(old_block, new_block, 1)
copy_path.write_text(copy_text, encoding='utf-8', newline='\n')
print('patched CopySpellSupport')

# Patch ModifyPt scaler
mod_path = RE / 'oracleIRExecutorModifyPtStepHandlers.ts'
mod_text = mod_path.read_text(encoding='utf-8')
mod_imp = "import { tryResolveForEachReferenceAmount } from './oracleIRExecutorForEachQuantity';\n"
mod_imp_new = mod_imp + "import { resolveCommanderCastsFromCommandZoneThisGame } from './oracleIRExecutorCommanderCastCount';\n"
if "oracleIRExecutorCommanderCastCount" not in mod_text:
    if mod_imp not in mod_text:
        raise SystemExit('ModifyPt import anchor missing')
    mod_text = mod_text.replace(mod_imp, mod_imp_new, 1)

old_mod = """  if (/^for each time you've cast a commander from the command zone this game$/.test(normalized)) {
    const casts = Number((state as any)?.commanderCastsFromCommandZoneThisGame?.[controllerId] ?? 0);
    return Number.isFinite(casts) ? Math.max(0, casts) : 0;
  }"""
new_mod = """  if (/^for each time you've cast (?:a|your) commander from the command zone this game$/.test(normalized)) {
    return resolveCommanderCastsFromCommandZoneThisGame(state, controllerId);
  }"""
if old_mod not in mod_text:
    raise SystemExit('ModifyPt commander block not found')
mod_text = mod_text.replace(old_mod, new_mod, 1)
mod_path.write_text(mod_text, encoding='utf-8', newline='\n')
print('patched ModifyPt')

# Patch castCommander to also maintain explicit counter
cmd_path = SERVER / 'commander.ts'
cmd_text = cmd_path.read_text(encoding='utf-8')
old_cmd = """  if (!info.taxById) info.taxById = {};
  info.taxById[commanderId] = (info.taxById[commanderId] ?? 0) + 2;
  info.tax = Object.values(info.taxById).reduce((a: number, b: number) => a + b, 0);
  commandZone[playerId] = info;
  
  // Also update state.commandZone
  if (state && state.commandZone) {
    (state.commandZone as any)[playerId] = info;
  }
  
  debug(1, `[castCommander] Updated tax for ${commanderId}: ${info.taxById[commanderId]}, total tax: ${info.tax}`);
  
  bumpSeq();
}"""
new_cmd = """  if (!info.taxById) info.taxById = {};
  info.taxById[commanderId] = (info.taxById[commanderId] ?? 0) + 2;
  info.tax = Object.values(info.taxById).reduce((a: number, b: number) => a + b, 0);
  commandZone[playerId] = info;
  
  // Also update state.commandZone
  if (state && state.commandZone) {
    (state.commandZone as any)[playerId] = info;
  }

  // Keep explicit CZ-cast count in sync for oracle patterns ("copy it for each time you've cast your commander...").
  // Authoritative fallback remains taxById sum / 2 (same as Jeska-style loyalty).
  if (state) {
    const castsMap = ((state as any).commanderCastsFromCommandZoneThisGame ||= {}) as Record<string, number>;
    castsMap[playerId] = (Number(castsMap[playerId]) || 0) + 1;
  }
  
  debug(1, `[castCommander] Updated tax for ${commanderId}: ${info.taxById[commanderId]}, total tax: ${info.tax}`);
  
  bumpSeq();
}"""
if old_cmd not in cmd_text:
    raise SystemExit('castCommander block not found')
cmd_text = cmd_text.replace(old_cmd, new_cmd, 1)
cmd_path.write_text(cmd_text, encoding='utf-8', newline='\n')
print('patched castCommander')

# Patch Jeska to use shared helper via dynamic-looking import path from rules-engine
jeska_path = SERVER / 'stackResolvePermanentEntryUtils.ts'
jeska_text = jeska_path.read_text(encoding='utf-8')
# Check existing imports at top
print('jeska first lines:')
print('\n'.join(jeska_text.splitlines()[:40]))
