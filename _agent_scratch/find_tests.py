import pathlib, re
root = pathlib.Path(r"D:/Git/MTGEDH")
for base in [root/"rules-engine", root/"server"]:
  for p in base.rglob("*test*"):
    if p.suffix not in {".ts", ".js", ".mjs", ".cjs"}: continue
    try: text = p.read_text(encoding="utf-8", errors="replace")
    except: continue
    if re.search(r"amass|empower|attacks.?alone|attacks_a_player|Army creature|Jace planeswalker", text, re.I):
      print(p)
