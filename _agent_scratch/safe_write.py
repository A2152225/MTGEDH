from pathlib import Path

def write_text(path, content):
    path = Path(path)
    raw = path.read_bytes() if path.exists() else b""
    eol = b"\r\n" if b"\r\n" in raw else b"\n"
    if raw.startswith(b"\xef\xbb\xbf"):
        raise SystemExit(f"BOM on existing {path}")
    text = content.replace("\r\n", "\n").replace("\r", "\n")
    out = text.encode("utf-8").replace(b"\n", eol)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out)
    check = path.read_bytes()
    if check.startswith(b"\xef\xbb\xbf"):
        raise SystemExit(f"wrote BOM {path}")
    print(f"wrote {path} {len(check)} bytes eol={eol!r}")

def patch_once(path, old, new):
    path = Path(path)
    raw = path.read_bytes()
    eol = b"\r\n" if b"\r\n" in raw else b"\n"
    text = raw.decode("utf-8")
    if text.startswith("\ufeff"):
        text = text.lstrip("\ufeff")
    norm = text.replace("\r\n", "\n").replace("\r", "\n")
    old_n = old.replace("\r\n", "\n").replace("\r", "\n")
    new_n = new.replace("\r\n", "\n").replace("\r", "\n")
    count = norm.count(old_n)
    if count != 1:
        raise SystemExit(f"Expected 1 occurrence in {path}, found {count} for snippet:\n{old_n[:240]}")
    norm2 = norm.replace(old_n, new_n, 1)
    out = norm2.encode("utf-8").replace(b"\n", eol)
    path.write_bytes(out)
    print(f"patched {path} {len(out)} bytes")