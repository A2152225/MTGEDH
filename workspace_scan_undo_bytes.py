from pathlib import Path
p = Path(r"D:\Git\MTGEDH\server\src\socket\undo.ts")
data = p.read_bytes()
# find all non-ascii bytes contexts
import re
# search for C2 BB (?) or EF BB BF or other
for needle, name in [(b"\xc2\xbb", "guillemet"), (b"\xef\xbb\xbf", "bom"), (b"\xc2\xab", "guillemet_open"), (b"\xe2\x80\x8b", "zwsp")]:
    idxs = []
    start = 0
    while True:
        i = data.find(needle, start)
        if i < 0: break
        idxs.append(i)
        start = i+1
    print(name, len(idxs), idxs[:10])

# locate line 1918 in bytes
text = data.decode("utf-8")
lines = text.splitlines(keepends=True)
# reconstruct offset of line 1918
offset = sum(len(l.encode("utf-8")) for l in lines[:1917])
chunk = data[offset:offset+40]
print("line1918_bytes", list(chunk))
print("line1918_ascii", chunk)
# scan whole file for high bytes near }); 
for i,l in enumerate(text.splitlines()):
    if any(ord(c) > 127 for c in l) and ("});" in l or "socket.on" in l or i > 1900):
        if i >= 1900 or "});" in l:
            print(i+1, [hex(ord(c)) for c in l if ord(c)>127], repr(l[:100]))
