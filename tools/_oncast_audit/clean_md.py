from pathlib import Path
p = Path(r"D:\Git\MTGEDH\tools\on-cast-trigger-coverage.md")
t = p.read_text(encoding="utf-8")
# replace common mojibake sequences
replacements = {
    "\uFFFD": "-",
    "â€”": "-",
    "â†’": "->",
    "—": "-",
    "→": "->",
}
for a,b in replacements.items():
    t = t.replace(a,b)
# also replace any leftover weirdness around "11 passing"
import re
t = re.sub(r"unit\.test\.ts`\s*.\s*11 passing", "unit.test.ts`) - 11 passing", t)
t = t.replace("`executeTriggerEffect` -> oracle IR", "`executeTriggerEffect` -> oracle IR")
t = t.replace("optional pay / processor `If you do` now keeps full text; verify optional payment UI + effect.", "optional pay / processor If-you-do now keeps full text; verify optional payment UI + effect.")
p.write_text(t, encoding="utf-8")
print("cleaned")
# verify singular export still exists
u = Path(r"D:\Git\MTGEDH\server\src\state\modules\onCastSpellTriggerUtils.ts").read_text(encoding="utf-8")
print("has singular", "export function resolveOnCastSpellTriggerDescription" in u)
print("has plural", "export function resolveOnCastSpellTriggerDescriptions" in u)
