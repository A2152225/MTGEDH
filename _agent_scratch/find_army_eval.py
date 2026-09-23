import pathlib, re
root = pathlib.Path(r"D:/Git/MTGEDH/rules-engine/src")
needles = ["Army", "you don't control", "dontControl", "controlCount", "countControlled", "controlledPermanents", "evaluateIfCondition", "condition.raw"]
for p in root.rglob("*.ts"):
    try:
        text = p.read_text(encoding="utf-8")
    except Exception:
        continue
    if "Army" not in text and "don't control" not in text and "do not control" not in text:
        continue
    # focus on runtime eval not parser
    if "Parser" in p.name or "parser" in p.name or "Postprocess" in p.name:
        continue
    for i, line in enumerate(text.splitlines(), 1):
        low = line.lower()
        if ("army" in low and ("control" in low or "select" in low or "match" in low)) or ("don't control" in low) or ("do not control" in low):
            print(f"{p.name}:{i}:{line.strip()[:200]}")
