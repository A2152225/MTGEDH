from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\socket\game-actions.ts")
text = path.read_bytes().decode("cp1252")

old_import = 'import { resolveOnCastSpellTriggerDescription } from "../state/modules/onCastSpellTriggerUtils.js";'
new_import = 'import { resolveOnCastSpellTriggerDescriptions } from "../state/modules/onCastSpellTriggerUtils.js";'
if old_import not in text:
    raise SystemExit("import not found")
text = text.replace(old_import, new_import, 1)

old_start = "        const onCastTrigger = resolveOnCastSpellTriggerDescription(cardInHand);\r\n        if (onCastTrigger) {"
new_start = "        const onCastTriggers = resolveOnCastSpellTriggerDescriptions(cardInHand);\r\n        for (const onCastTrigger of onCastTriggers) {"
if old_start not in text:
    raise SystemExit("on-cast start not found")
text = text.replace(old_start, new_start, 1)

path.write_bytes(text.encode("cp1252"))
print("patched game-actions ok")
# verify
t2 = path.read_bytes().decode("cp1252")
print("has Descriptions import", "resolveOnCastSpellTriggerDescriptions" in t2)
print("has for-loop", "for (const onCastTrigger of onCastTriggers)" in t2)
print("old single still?", "resolveOnCastSpellTriggerDescription(cardInHand)" in t2)
