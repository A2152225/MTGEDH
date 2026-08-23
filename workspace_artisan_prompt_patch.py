from pathlib import Path

path = Path(r"D:\Git\MTGEDH\server\src\state\modules\stackResolveTriggeredAbilityTargetPromptUtils.ts")
raw = path.read_bytes()
for enc in ("utf-8", "cp1252", "latin-1"):
    try:
        text = raw.decode(enc)
        print("enc", enc)
        break
    except Exception as e:
        print(enc, e)
else:
    raise SystemExit("decode fail")

# 1) Skip re-prompt when targets already stamped on a GY trigger
old = """  if (!isReplaying && !hasPersistedLockedTargets && targetZone === 'graveyard') {"""
new = """  // If targets were already chosen (ETB/on-cast Choice stamp), do not re-prompt;
  // fall through so executeTriggerEffect can apply the GY return.
  if (!isReplaying && !hasPersistedLockedTargets && existingTargets.length === 0 && targetZone === 'graveyard') {"""
if old not in text:
    raise SystemExit("guard not found")
text = text.replace(old, new, 1)

# 2) Prefer Choice-style stamping (like ETB) for triggered GY returns so the
# stack item keeps targets and resolve applies via executeTriggerEffect.
# Find the queueResolveTopOfStackPrompt block flags.
old_flags = """        triggeredAbilityGraveyardSelection: true,
        triggeredAbilityCastFromGraveyard: targetAction === 'cast',
        triggeredAbilityCastWithoutPayingManaCost: (item as any).targetCastWithoutPayingManaCost === true,
        triggeredAbilityMayCastFromGraveyard: (item as any).targetCastIsOptional === true,
        triggeredAbilityEffectText: String((item as any).effect || description || ''),
        triggeredAbilitySourcePermanentId: String((item as any).source || (item as any).permanentId || ''),
        triggeredAbilityCardSnapshot: (item as any).card && typeof (item as any).card === 'object'
          ? { ...((item as any).card as any) }
          : undefined,"""

new_flags = """        // Cast/return-from-GY triggered abilities (Artisan of Kozilek, etc.): stamp
        // the chosen card onto the stack item (Choice), matching ETB wiring, so
        // executeTriggerEffect applies the move when the trigger resolves.
        // Keep Selection+destination for cast-from-GY (targetAction === 'cast').
        ...(targetAction === 'cast'
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
        triggeredAbilityEffectText: String((item as any).effect || description || ''),
        triggeredAbilitySourcePermanentId: String((item as any).source || (item as any).permanentId || ''),
        triggeredAbilityCardSnapshot: (item as any).card && typeof (item as any).card === 'object'
          ? { ...((item as any).card as any) }
          : undefined,"""

if old_flags not in text:
    raise SystemExit("flags not found")
text = text.replace(old_flags, new_flags, 1)

# For Choice path, destination on the step is unused (handler stamps + returns).
# Leaving destination set is fine (ETB does the same).

out_enc = enc if enc != "latin-1" else "cp1252"
# detect original
orig = raw
if orig.decode("utf-8", errors="replace") == text or enc == "utf-8":
    try:
        orig.decode("utf-8")
        out_enc = "utf-8"
    except Exception:
        out_enc = "cp1252"

path.write_bytes(text.encode(out_enc))
print("patched prompt utils", out_enc, path.stat().st_size)
