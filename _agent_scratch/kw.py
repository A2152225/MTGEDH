import pathlib, re, json
# Keywords docs
for path in [r"D:/Git/MTGEDH/docs/rules/Keywords_20260925.json", r"D:/Git/MTGEDH/Keywords.json"]:
  p = pathlib.Path(path)
  if not p.exists():
    print("missing", path); continue
  text = p.read_text(encoding="utf-8", errors="replace")
  print("====", path, "len", len(text))
  for needle in ["Empower", "Alone", "506.6", "attacks a player"]:
    idx = text.lower().find(needle.lower())
    if idx >= 0:
      print(needle, "->", text[max(0,idx-80):idx+200].replace("\n"," ")[:280])
