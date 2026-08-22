from pathlib import Path
p = Path(r"D:\Git\MTGEDH\client\src\components\GameStatusIndicator.tsx")
raw = p.read_text(encoding="utf-8")
bt = chr(96)
bad = "            title={\\Round \\ (turn \\, \\ players)\\}"
# also match whatever broken form is present
import re
pattern = re.compile(r"^[ \t]*title=\{.*Round.*players.*\}$", re.M)
good = "            title={" + bt + "Round ${roundNumber} (turn ${turnNumber}, ${seatedPlayerCount} players)" + bt + "}"
m = pattern.search(raw)
if not m:
    raise SystemExit("title line not found: " + repr([l for l in raw.splitlines() if "Round" in l and "title" in l][:5]))
raw2 = pattern.sub(good, raw, count=1)
p.write_bytes(raw2.encode("utf-8"))
line = [l for l in raw2.splitlines() if "title={" in l and "Round" in l][0]
print("FIXED", repr(line))
print("backticks", line.count(bt))
print("dollar_braces", line.count("${"))
# neighbors
lines = raw2.splitlines()
idx = next(i for i,l in enumerate(lines) if "title={" in l and "Round" in l)
for j in range(idx-3, idx+4):
    print(f"{j+1}|{lines[j]}")
