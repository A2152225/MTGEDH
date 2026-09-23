import pathlib, re
root = pathlib.Path(r"D:/Git/MTGEDH/rules-engine/src")
pat = re.compile(r"don.t control|control an Army|Army creature|planeswalker token|Jace", re.I)
for p in list(root.rglob("oracleIRExecutorConditional*.ts")) + list(root.rglob("*Control*.ts")):
    try:
        text = p.read_text(encoding="utf-8")
    except Exception:
        text = p.read_text(encoding="utf-8", errors="replace")
    hits = []
    for i, line in enumerate(text.splitlines(), 1):
        if pat.search(line):
            hits.append(f"{i}:{line.strip()[:180]}")
    if hits:
        print("FILE", p)
        for h in hits[:30]:
            print(h)
        print("---")
