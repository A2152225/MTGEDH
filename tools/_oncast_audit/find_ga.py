from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\socket\game-actions.ts")
text = path.read_bytes().decode("cp1252")
idx = text.find("resolveOnCastSpellTrigger")
print("idx", idx)
print(repr(text[idx-80:idx+200]))
idx2 = text.find("On-cast trigger matching")
print("idx2", idx2)
print(repr(text[idx2-300:idx2+250]))
