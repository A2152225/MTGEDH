from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\socket\game-actions.ts")
raw = path.read_bytes()
for enc in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
    try:
        text = raw.decode(enc)
        print("decoded", enc, "len", len(text))
        break
    except Exception as e:
        print("fail", enc, e)
else:
    raise SystemExit("no encoding")

old_import = 'import { resolveOnCastSpellTriggerDescription } from "../state/modules/onCastSpellTriggerUtils.js";'
new_import = 'import { resolveOnCastSpellTriggerDescriptions } from "../state/modules/onCastSpellTriggerUtils.js";'
if old_import not in text:
    raise SystemExit("import not found")
text = text.replace(old_import, new_import, 1)

old_start = '        const onCastTrigger = resolveOnCastSpellTriggerDescription(cardInHand);\n        if (onCastTrigger) {'
new_start = '        const onCastTriggers = resolveOnCastSpellTriggerDescriptions(cardInHand);\n        for (const onCastTrigger of onCastTriggers) {'
if old_start not in text:
    raise SystemExit("on-cast start not found")
text = text.replace(old_start, new_start, 1)

# write back with same encoding if possible; prefer utf-8
path.write_bytes(text.encode(enc))
print("patched game-actions")
