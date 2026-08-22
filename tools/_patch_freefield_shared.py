from pathlib import Path

ff = Path(r"D:\Git\MTGEDH\client\src\components\FreeField.tsx")
text = ff.read_text(encoding="utf-8")

# Add import if missing
if "expandGroupedTokensForDisplay" in text and "from '../utils/expandGroupedTokens'" not in text:
    # remove local helper function block
    start = text.find("/**\n * Expand server emit-side token groups into individual battlefield entries for FreeField.")
    if start < 0:
        start = text.find("function expandGroupedTokensForDisplay(permanents: BattlefieldPermanent[]): BattlefieldPermanent[] {")
        # find doc comment above
        doc = text.rfind("/**", 0, start)
        if doc > 0:
            start = doc
    if start < 0:
        raise SystemExit("local helper not found to remove")
    end = text.find("\nfunction parsePT", start)
    if end < 0:
        raise SystemExit("parsePT after helper not found")
    text = text[:start] + text[end+1:]  # keep "function parsePT"

    # add import near other utils
    anchor = "from '../utils/creatureUtils';"
    if anchor not in text:
        # try battlefieldGrid import end
        anchor = "from '../utils/battlefieldGrid';"
        # find end of that import block
        idx = text.find(anchor)
        # find closing }; of the import
        close = text.find("} from '../utils/battlefieldGrid';", idx)
        if close < 0:
            raise SystemExit("no import anchor")
        insert_at = close + len("} from '../utils/battlefieldGrid';")
        text = text[:insert_at] + "\nimport { expandGroupedTokensForDisplay } from '../utils/expandGroupedTokens';" + text[insert_at:]
    else:
        text = text.replace(anchor, anchor + "\nimport { expandGroupedTokensForDisplay } from '../utils/expandGroupedTokens';", 1)

    ff.write_text(text, encoding="utf-8")
    print("FreeField refactored to shared util")
elif "from '../utils/expandGroupedTokens'" in text:
    print("FreeField already imports shared util")
else:
    print("unexpected FreeField state")
    # show whether displayPerms uses the helper
    print("has displayPerms", "displayPerms" in text)
