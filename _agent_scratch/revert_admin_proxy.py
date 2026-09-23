from pathlib import Path
import re

# root web.config
wc = Path(r"D:\Git\MTGEDH\web.config")
w = wc.read_text(encoding="utf-8")
w2, n = re.subn(
    r"\s*<!-- Admin HTTP.*?-->\s*<rule name=\"Admin\"[\s\S]*?</rule>\s*",
    "\n        ",
    w,
    count=1,
)
w2 = w2.replace(
    '<add input="{REQUEST_URI}" pattern="^/(api|admin|socket\\.io)" negate="true" />',
    '<add input="{REQUEST_URI}" pattern="^/(api|socket\\.io)" negate="true" />',
)
wc.write_text(w2, encoding="utf-8")
print("root web.config admin rule removals:", n, "still has Admin?", 'name="Admin"' in w2)

# public
pc = Path(r"D:\Git\MTGEDH\client\public\web.config")
pw = pc.read_text(encoding="utf-8")
pw2, n2 = re.subn(
    r"\s*<!-- 2b\) Proxy /admin/\*[\s\S]*?<rule name=\"ReverseProxyAdmin\"[\s\S]*?</rule>\s*",
    "\n\n        ",
    pw,
    count=1,
)
pw2 = re.sub(
    r'\s*<add input=\"\{REQUEST_URI\}\" pattern=\"\^/admin\" negate=\"true\" />\s*',
    "\n            ",
    pw2,
    count=1,
)
pc.write_text(pw2, encoding="utf-8")
print("public web.config ReverseProxyAdmin removals:", n2, "still has?", "ReverseProxyAdmin" in pw2)