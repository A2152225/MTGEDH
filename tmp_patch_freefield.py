from pathlib import Path
p = Path(r"D:\Git\MTGEDH\client\src\components\FreeField.tsx")
text = p.read_text(encoding="utf-8")
old = "      const isCreature = /\\bcreature\\b/.test(tl);"
new = "      const isCreature = isCurrentlyCreature(p as any);"
if old not in text:
    # show nearby
    idx = text.find("const isCreature")
    raise SystemExit(repr(text[idx:idx+90]))
if "isCurrentlyCreature(p" in text:
    print("FreeField already uses isCurrentlyCreature for isCreature")
else:
    text = text.replace(old, new, 1)
    p.write_text(text, encoding="utf-8")
    print("Patched FreeField isCreature")
