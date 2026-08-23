from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\state\modules\inferTriggeredAbilityTargetMetadata.ts")
raw = path.read_bytes()
print("bom", raw[:3])
text = raw.decode("utf-8")
idx = text.find("target creature or planeswalker")
print("idx", idx)
print(repr(text[idx-20:idx+900]))
