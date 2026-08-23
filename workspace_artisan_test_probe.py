from pathlib import Path

path = Path(r"D:\Git\MTGEDH\server\tests\eldrazi-cast-trigger-resolution.integration.test.ts")
text = path.read_bytes().decode("utf-8")
# detect encoding
try:
    text = path.read_bytes().decode("utf-8")
    enc = "utf-8"
except UnicodeDecodeError:
    text = path.read_bytes().decode("cp1252")
    enc = "cp1252"
print("enc", enc, "ends with", repr(text[-80:]))

# Insert before final closing of describe if needed - find last test end
needle = "  it('queues Emrakul, the Aeons Torn on-cast trigger"
idx = text.find(needle)
print("emrakul idx", idx)

# Find end of file describe
print("last 500 chars lines:")
print(text[-800:])
