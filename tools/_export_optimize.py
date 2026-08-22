from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\socket\util.ts")
text = path.read_text(encoding="utf-8")
old = "function optimizeBattlefieldTokensForEmit("
new = "export function optimizeBattlefieldTokensForEmit("
if old not in text:
    if new in text:
        print("already exported")
    else:
        raise SystemExit("function not found")
else:
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("exported optimizeBattlefieldTokensForEmit")
