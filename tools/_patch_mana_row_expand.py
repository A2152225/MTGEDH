from pathlib import Path

# --- TableLayout: import + expand manaSources ---
tl = Path(r"D:\Git\MTGEDH\client\src\components\TableLayout.tsx")
text = tl.read_text(encoding="utf-8")

if "expandGroupedTokensForDisplay" not in text:
    # add import after LandRow import
    old_imp = "import { LandRow } from './LandRow';"
    new_imp = "import { LandRow } from './LandRow';\nimport { expandGroupedTokensForDisplay } from '../utils/expandGroupedTokens';"
    if old_imp not in text:
        raise SystemExit("LandRow import not found")
    text = text.replace(old_imp, new_imp, 1)

old_ms = "                const manaSources = nonLands.filter(x => isManaSource(x));"
new_ms = """                // Expand TokenOptimization groups so each Vibranium/Powerstone/etc.
                // stays visible in the mana-source row (grouping is emit-only; BF still has all).
                const manaSources = expandGroupedTokensForDisplay(nonLands.filter(x => isManaSource(x)));"""
if old_ms not in text:
    raise SystemExit("manaSources line not found")
text = text.replace(old_ms, new_ms, 1)
tl.write_text(text, encoding="utf-8")
print("TableLayout updated")

# --- LandRow: expand as safety net ---
lr = Path(r"D:\Git\MTGEDH\client\src\components\LandRow.tsx")
lr_text = lr.read_text(encoding="utf-8")
if "expandGroupedTokensForDisplay" not in lr_text:
    old_lr_imp = "import { getPlayableCardHighlight } from '../utils/appearanceSettings';"
    new_lr_imp = "import { getPlayableCardHighlight } from '../utils/appearanceSettings';\nimport { expandGroupedTokensForDisplay } from '../utils/expandGroupedTokens';"
    if old_lr_imp not in lr_text:
        raise SystemExit("LandRow appearanceSettings import not found")
    lr_text = lr_text.replace(old_lr_imp, new_lr_imp, 1)

old_items = "  const items = useMemo(() => lands.map(p => {"
new_items = "  const items = useMemo(() => expandGroupedTokensForDisplay(lands).map(p => {"
if old_items not in lr_text:
    raise SystemExit(f"LandRow items useMemo not found: look for similar")
lr_text = lr_text.replace(old_items, new_items, 1)
# fix dependency array if it only has lands - still fine
lr.write_text(lr_text, encoding="utf-8")
print("LandRow updated")
