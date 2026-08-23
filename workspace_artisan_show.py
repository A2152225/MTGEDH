from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\socket\game-actions.ts")
text = path.read_bytes().decode("cp1252")
idx = text.find("const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(description);")
print("idx", idx)
print(repr(text[idx-200:idx+1200]))
