from pathlib import Path
import re
text = Path(r"D:\Git\MTGEDH\server\src\socket\interaction.ts").read_text(encoding="utf-8")
start = text.find('"activateBattlefieldAbility"')
print("start", start)
chunk = text[start:start + 5000]
# Show around permanentId declaration and our patch
idx = chunk.find("resolvedPermanentId")
print(chunk[idx-400:idx+800])
