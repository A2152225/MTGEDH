from pathlib import Path
checks = {
 r"D:\Git\MTGEDH\client\src\components\GameList.tsx": ["deleteGameViaAdminHttp", "socket.connected", "formatDeleteError", 'socket.emit("deleteGame"'],
 r"D:\Git\MTGEDH\server\src\index.ts": ["/api/admin/games/:id/delete", "adminHardDeleteGame", "handleAdminDeleteGameById"],
 r"D:\Git\MTGEDH\server\src\decks\decksHttp.ts": ["/api/decks/:id/delete", "handleDeleteDeck"],
 r"D:\Git\MTGEDH\client\src\utils\serverDeckApi.ts": ["/delete", "method: 'POST'"],
 r"D:\Git\MTGEDH\client\public\web.config": ["ReverseProxyAdmin", "^/admin"],
 r"D:\Git\MTGEDH\web.config": ['rule name="Admin"'],
}
for p, keys in checks.items():
 t = Path(p).read_text(encoding="utf-8")
 missing = [k for k in keys if k not in t]
 print(p, "MISSING" if missing else "OK", missing or "")
 if missing:
  raise SystemExit(1)
print("all ok")
# show snippet of handleDelete
gl = Path(r"D:\Git\MTGEDH\client\src\components\GameList.tsx").read_text(encoding="utf-8")
i = gl.find("const handleDelete")
print(gl[i:i+900])
