from pathlib import Path

# effectProgram.ts - add unless_sacrifices alongside unless_discards
p = Path(r'D:/Git/MTGEDH/rules-engine/src/effectProgram.ts')
text = p.read_text(encoding='utf-8')
count = text.count("unless_discards")
print('unless_discards mentions', count)
# Replace patterns carefully
text2 = text
# kind checks that list unless_discards
replacements = [
  ("kind === 'unless_pays_mana' || kind === 'unless_pays_life' || kind === 'unless_discards'",
   "kind === 'unless_pays_mana' || kind === 'unless_pays_life' || kind === 'unless_discards' || kind === 'unless_sacrifices'"),
  ("case 'unless_pays_mana':\ncase 'unless_pays_life':",
   "case 'unless_pays_mana':\ncase 'unless_pays_life':\ncase 'unless_sacrifices':"),
]
# Check exact strings
for old, new in replacements:
  c = text2.count(old)
  print('count', c, 'for', old[:60])
  if c > 0:
    text2 = text2.replace(old, new)

# Also the comment line about unless_pays/unless_discards
text2 = text2.replace(
  '// unless_pays/unless_discards already queue their own pay-or-decline choice; a',
  '// unless_pays/unless_discards/unless_sacrifices already queue their own pay-or-decline choice; a',
)

p.write_text(text2, encoding='utf-8')
print('effectProgram patched')

# oracleIRParser.ts optional skip for unless_sacrifices
p3 = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParser.ts')
t3 = p3.read_text(encoding='utf-8')
old = "if (optional && kind !== 'unless_pays_mana' && kind !== 'unless_pays_life') {"
new = "if (optional && kind !== 'unless_pays_mana' && kind !== 'unless_pays_life' && kind !== 'unless_sacrifices') {"
if old in t3:
  t3 = t3.replace(old, new, 1)
  p3.write_text(t3, encoding='utf-8')
  print('parser optional skip ok')
else:
  print('parser optional pattern not found (ok if different)')
