from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\socket\interaction.ts")
text = path.read_text(encoding="utf-8")
start = text.find('"activateBattlefieldAbility"')
# Only patch within this handler's opening
chunk_end = start + 2500
chunk = text[start:chunk_end]
old_decl = "    const permanentId = payload?.permanentId;"
if old_decl not in chunk:
    raise SystemExit("decl not in handler start: " + repr(chunk[200:400]))
chunk2 = chunk.replace(old_decl, "    let permanentId = payload?.permanentId;", 1)
old_after = """    const permanent = battlefield[permIndex];
    const card = (permanent as any).card;
"""
new_after = """    const permanent = battlefield[permIndex];
    permanentId = String(permanent.id);
    const card = (permanent as any).card;
"""
if old_after not in chunk2:
    raise SystemExit("after-lookup anchor missing")
chunk2 = chunk2.replace(old_after, new_after, 1)
text2 = text[:start] + chunk2 + text[chunk_end:]
path.write_text(text2, encoding="utf-8")
print("rebinding permanentId to resolved id")
