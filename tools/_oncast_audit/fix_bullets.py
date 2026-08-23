from pathlib import Path
path = Path(r"D:\Git\MTGEDH\rules-engine\src\cards\castTriggers.ts")
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
for i, line in enumerate(lines):
    if "test(next)" in line and i > 40 and i < 70 and "startsWith" not in line:
        print("before", i+1, repr(line))
        lines[i] = "      if (/^[\\u2022\\u25E6\\u2023\\u00B7]/.test(next) || /^[-\\u2013\\u2014]\\s+/.test(next)) {\n"
        print("after", repr(lines[i]))
        break
else:
    raise SystemExit("line not found")
path.write_text("".join(lines), encoding="utf-8")
print("ok")
