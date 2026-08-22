from pathlib import Path

# Verify FreeField
ff = Path(r"D:\Git\MTGEDH\client\src\components\FreeField.tsx").read_text(encoding="utf-8")
print("FreeField import:", "from '../utils/expandGroupedTokens'" in ff)
print("FreeField displayPerms:", "expandGroupedTokensForDisplay(perms)" in ff)
print("FreeField local fn gone:", "function expandGroupedTokensForDisplay" not in ff)

# Verify TableLayout / LandRow
tl = Path(r"D:\Git\MTGEDH\client\src\components\TableLayout.tsx").read_text(encoding="utf-8")
print("TableLayout expand manaSources:", "expandGroupedTokensForDisplay(nonLands.filter" in tl)
lr = Path(r"D:\Git\MTGEDH\client\src\components\LandRow.tsx").read_text(encoding="utf-8")
print("LandRow expand:", "expandGroupedTokensForDisplay(lands)" in lr)

# Verify activate resolve
inter = Path(r"D:\Git\MTGEDH\server\src\socket\interaction.ts").read_text(encoding="utf-8")
print("activate resolveGrouped:", inter.count("resolveGroupedPermanentRef(game, pid as any, String(permanentId))"))
print("permanentId rebind:", "permanentId = String(permanent.id);" in inter)
