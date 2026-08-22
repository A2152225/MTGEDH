from pathlib import Path
p = Path(r"D:\Git\MTGEDH\server\src\socket\undo.ts")
raw = p.read_text(encoding="utf-8")
count = raw.count("\ufeff")
print("bom_count_before", count)
# also find any other weird controls
weird = []
for i,l in enumerate(raw.splitlines()):
    for ch in l:
        o = ord(ch)
        if ch in "\ufeff\u200b\u200c\u200d\u2060" or (o < 32 and ch not in "\t"):
            weird.append((i+1, hex(o), repr(l[:120])))
            break
print("weird_lines", len(weird))
for w in weird[:20]:
    print(w)
fixed = raw.replace("\ufeff", "")
# normalize any accidental non-ascii junk glued to }); endings
import re
fixed2 = re.sub(r"\}\);[^\S\r\n]*[^\x09\x0a\x0d\x20-\x7e]+", "});", fixed)
p.write_bytes(fixed2.encode("utf-8"))
raw2 = p.read_text(encoding="utf-8")
print("bom_after", raw2.count("\ufeff"))
print("line1918", repr(raw2.splitlines()[1917]))
print("line1917-1920:")
for i in range(1916,1921):
    print(i+1, repr(raw2.splitlines()[i]))
