from pathlib import Path

path = Path(r"D:\Git\MTGEDH\server\src\state\modules\stackResolveTriggeredAbilityTargetPromptUtils.ts")
text = path.read_text(encoding="utf-8")

# Add import for infer if we want - better to resolve locally from item fields / text to avoid circular deps.
# inferTriggeredAbilityTargetMetadata is fine to import.

old_import = """import {
  PERMANENT_TRIGGER_TARGET_TYPES,
  matchesTriggeredBattlefieldTarget,
} from './triggeredAbilityBattlefieldTargetMatch.js';
"""
new_import = """import {
  PERMANENT_TRIGGER_TARGET_TYPES,
  matchesTriggeredBattlefieldTarget,
  type TriggeredBattlefieldTargetFilterMetadata,
} from './triggeredAbilityBattlefieldTargetMatch.js';
import { inferTriggeredAbilityTargetMetadata } from './inferTriggeredAbilityTargetMetadata.js';

function resolveTriggeredTargetCombatRole(item: any): TriggeredBattlefieldTargetFilterMetadata['targetCombatRole'] {
  const explicit = String(item?.targetCombatRole || '').trim();
  if (explicit === 'attacking' || explicit === 'blocking' || explicit === 'attacking_or_blocking') {
    return explicit;
  }
  const effectText = String(item?.effect || item?.description || item?.targetDescription || '');
  return inferTriggeredAbilityTargetMetadata(effectText).targetCombatRole;
}
"""
if old_import not in text:
    raise SystemExit('import block not found')
text = text.replace(old_import, new_import, 1)

old_filter = """            const matchesType = matchesTriggeredBattlefieldTarget(
              normalizedTargetType,
              typeLine,
              {
                targetFilterTypes,
                targetFilterRequiredTypeWords,
                targetFilterExcludeTypes,
                targetFilterRequiresOneOrMoreColors: (item as any).targetFilterRequiresOneOrMoreColors === true,
              },
              permanent,
              state,
            );
"""
new_filter = """            const matchesType = matchesTriggeredBattlefieldTarget(
              normalizedTargetType,
              typeLine,
              {
                targetFilterTypes,
                targetFilterRequiredTypeWords,
                targetFilterExcludeTypes,
                targetFilterRequiresOneOrMoreColors: (item as any).targetFilterRequiresOneOrMoreColors === true,
                targetCombatRole: resolveTriggeredTargetCombatRole(item),
              },
              permanent,
              state,
            );
"""
if old_filter not in text:
    raise SystemExit('matchesType call not found')
text = text.replace(old_filter, new_filter, 1)

# Improve targetDescription when combat role present
old_desc = """    const targetDescription = String(
      (item as any).targetDescription
      || (normalizedTargetType === 'any' || normalizedTargetType === 'any target' || normalizedTargetType === 'any_target'
        ? 'any target'
        : `target ${targetType || 'object'}`),
    );
"""
new_desc = """    const combatRole = resolveTriggeredTargetCombatRole(item);
    const combatRoleLabel =
      combatRole === 'attacking' ? 'attacking creature'
      : combatRole === 'blocking' ? 'blocking creature'
      : combatRole === 'attacking_or_blocking' ? 'attacking or blocking creature'
      : '';
    const targetDescription = String(
      (item as any).targetDescription
      || combatRoleLabel
      || (normalizedTargetType === 'any' || normalizedTargetType === 'any target' || normalizedTargetType === 'any_target'
        ? 'any target'
        : `target ${targetType || 'object'}`),
    );
"""
if old_desc not in text:
    raise SystemExit('targetDescription block not found')
text = text.replace(old_desc, new_desc, 1)

path.write_text(text, encoding='utf-8')
print('patched stackResolveTriggeredAbilityTargetPromptUtils.ts', round(path.stat().st_size/1024,1), 'KB')
