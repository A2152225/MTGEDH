from pathlib import Path

# Propagate targetCombatRole in combat.ts wherever targetType is spread from targetMetadata
path = Path(r"D:\Git\MTGEDH\server\src\socket\combat.ts")
text = path.read_text(encoding="utf-8")
needle = "...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),"
insert = "...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),\n              ...(targetMetadata.targetCombatRole ? { targetCombatRole: targetMetadata.targetCombatRole } : null),"
count = text.count(needle)
if count == 0:
    raise SystemExit('no targetType spreads found')
# Use a unique-enough replacement - only when followed by targetConstraint typically
text2 = text.replace(
    "...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),\n              ...(targetMetadata.targetConstraint",
    "...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),\n              ...(targetMetadata.targetCombatRole ? { targetCombatRole: targetMetadata.targetCombatRole } : null),\n              ...(targetMetadata.targetConstraint",
)
# Also handle slightly different indentation variants
text2 = text2.replace(
    "...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),\n    ...(targetMetadata.targetConstraint",
    "...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),\n    ...(targetMetadata.targetCombatRole ? { targetCombatRole: targetMetadata.targetCombatRole } : null),\n    ...(targetMetadata.targetConstraint",
)
added = text2.count("targetCombatRole: targetMetadata.targetCombatRole") - text.count("targetCombatRole: targetMetadata.targetCombatRole")
path.write_text(text2, encoding='utf-8')
print(f'combat.ts: added {added} targetCombatRole spreads (was {count} targetType needles)')
