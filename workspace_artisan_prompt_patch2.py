from pathlib import Path

path = Path(r"D:\Git\MTGEDH\server\src\state\modules\stackResolveTriggeredAbilityTargetPromptUtils.ts")
text = path.read_text(encoding="utf-8")

old_guard = "  if (!isReplaying && !hasPersistedLockedTargets && targetZone === 'graveyard') {"
new_guard = (
    "  // If targets were already chosen (ETB/on-cast Choice stamp), do not re-prompt;\n"
    "  // fall through so executeTriggerEffect can apply the GY return.\n"
    "  if (!isReplaying && !hasPersistedLockedTargets && existingTargets.length === 0 && targetZone === 'graveyard') {"
)
if old_guard not in text:
    raise SystemExit("guard not found")
text = text.replace(old_guard, new_guard, 1)

old_sel = "        triggeredAbilityGraveyardSelection: true,\n        triggeredAbilityCastFromGraveyard: targetAction === 'cast',"
if old_sel not in text:
    raise SystemExit("sel flag not found")

new_sel = """        // Cast/return-from-GY triggered abilities (Artisan of Kozilek, etc.): stamp
        // chosen card onto the stack item (Choice), matching ETB wiring, so
        // executeTriggerEffect applies the move when the trigger resolves.
        // Keep Selection+destination for cast-from-GY (targetAction === 'cast').
        ...(targetAction === 'cast'
          ? {
              triggeredAbilityGraveyardSelection: true,
              triggeredAbilityCastFromGraveyard: true,
            }
          : {
              triggeredAbilityGraveyardChoice: true,
              triggerStackItemId: String((item as any).id || sourceId || ''),
            }),
        triggeredAbilityCastFromGraveyard: targetAction === 'cast',"""

# Wait - that would duplicate triggeredAbilityCastFromGraveyard. Better replace a larger unique span.
text = text.replace(old_sel, """        ...(targetAction === 'cast'
          ? {
              triggeredAbilityGraveyardSelection: true,
              triggeredAbilityCastFromGraveyard: true,
              triggeredAbilityCastWithoutPayingManaCost: (item as any).targetCastWithoutPayingManaCost === true,
              triggeredAbilityMayCastFromGraveyard: (item as any).targetCastIsOptional === true,
            }
          : {
              triggeredAbilityGraveyardChoice: true,
              triggerStackItemId: String((item as any).id || sourceId || ''),
            }),
        __ARTISAN_REMOVE_NEXT_LINES__: true,""", 1)

# Remove the old lines that are now duplicated after the marker
dup_block = """        __ARTISAN_REMOVE_NEXT_LINES__: true,
        triggeredAbilityCastWithoutPayingManaCost: (item as any).targetCastWithoutPayingManaCost === true,
        triggeredAbilityMayCastFromGraveyard: (item as any).targetCastIsOptional === true,
"""
if dup_block not in text:
    raise SystemExit("dup block not found after replace: " + repr(text[text.find("__ARTISAN"):text.find("__ARTISAN")+400]))
text = text.replace(dup_block, "", 1)

path.write_text(text, encoding="utf-8")
print("ok", path.stat().st_size)
# verify
t2 = path.read_text(encoding="utf-8")
assert "existingTargets.length === 0 && targetZone === 'graveyard'" in t2
assert "triggeredAbilityGraveyardChoice: true" in t2
assert "__ARTISAN" not in t2
print("verified")
