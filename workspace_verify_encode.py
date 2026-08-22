from pathlib import Path

def check_status():
    p = Path(r"D:\Git\MTGEDH\client\src\components\GameStatusIndicator.tsx")
    raw = p.read_text(encoding="utf-8")
    b = p.read_bytes()[:3]
    print("bom", list(b))
    checks = {
        "hourglass": "\u23f3" in raw,
        "swords": "\u2694" in raw,
        "crown": "\U0001f451" in raw,
        "dice": "\U0001f3b2" in raw,
        "round_block": "Turn + Round" in raw,
        "title_tpl": "title={`Round ${roundNumber}" in raw,
        "turnNumber_decl": "const turnNumber = Math.max" in raw,
        "no_mojibake_a_circ": "\u00e2\u20ac" not in raw.encode("utf-8").decode("latin1") if False else ("?" not in raw or "Turn + Round" in raw),
    }
    # simpler mojibake detection: look for classic cp1252 misreads of emoji
    mojibake_markers = ["??", "??", "??", "??", "??", "??"]
    print("mojibake_markers", [m for m in mojibake_markers if m in raw])
    for k, v in checks.items():
        print(k, v)
    lines = raw.splitlines()
    for i, l in enumerate(lines):
        if "title={`Round" in l or "Turn + Round" in l or "const roundNumber" in l:
            start = max(0, i - 3)
            end = min(len(lines), i + 4)
            print("--- around", i + 1, "---")
            for j in range(start, end):
                print(f"{j+1}|{lines[j]}")

def fix_undo():
    p = Path(r"D:\Git\MTGEDH\server\src\socket\undo.ts")
    raw = p.read_text(encoding="utf-8")
    pairs = [
        ("\u00e2\u20ac\u201d", "\u2014"),  # won't match; use literal mojibake below via bytes
    ]
    # Replace known mojibake sequences (utf-8 of emdash mis-decoded)
    # ??? is U+00E2 U+20AC U+201D when the chars appear in the file as three unicode chars
    replacements = {
        "???": "\u2014",
        "???": "\u2013",
        "??": "\u00b7",
        "???": "\u2018",
        "???": "\u2019",
        "???": "\u201c",
        "???": "\u201d",
    }
    fixed = raw
    total = 0
    for a, b in replacements.items():
        n = fixed.count(a)
        if n:
            fixed = fixed.replace(a, b)
            total += n
            print("replaced", a.encode("unicode_escape").decode(), n)
    if total:
        p.write_bytes(fixed.encode("utf-8"))
    print("undo_fix", total)
    for m in ["??", "??", "??", "??"]:
        print("remaining", m.encode("unicode_escape").decode(), m in fixed)

check_status()
fix_undo()
