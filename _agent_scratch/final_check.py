from pathlib import Path
import xml.etree.ElementTree as ET
for p in [r"D:\Git\MTGEDH\client\public\web.config", r"D:\Git\MTGEDH\web.config", r"D:\Git\MTGEDH\client\dist\web.config"]:
    ET.parse(p)
    print("XML OK", p)
gl = Path(r"D:\Git\MTGEDH\client\src\components\GameList.tsx").read_text(encoding="utf-8")
print("socket.connected", "socket.connected" in gl)
print("has DELETE fallback", 'method: "DELETE"' in gl)
print("prefer socket comment", "Prefer socket deleteGame" in gl)
idx = Path(r"D:\Git\MTGEDH\server\src\index.ts").read_text(encoding="utf-8")
print("POST requires userIsAdmin", "POST /api/admin/games/:id/delete" in idx and "IIS ARR peers appear as 127.0.0.1" in idx)
dh = Path(r"D:\Git\MTGEDH\server\src\decks\decksHttp.ts").read_text(encoding="utf-8")
print("deck POST delete", "/api/decks/:id/delete" in dh)