from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/effectProgram.ts')
text=p.read_text(encoding='utf-8')

# Fix the first list that didn't get unless_sacrifices (around line with surveil)
old1 = """    || kind === 'unless_pays_mana'
    || kind === 'unless_pays_life'
    || kind === 'unless_discards'
    || kind === 'pay_mana'"""
new1 = """    || kind === 'unless_pays_mana'
    || kind === 'unless_pays_life'
    || kind === 'unless_discards'
    || kind === 'unless_sacrifices'
    || kind === 'pay_mana'"""
if old1 in text and 'unless_sacrifices' not in text[text.find(old1):text.find(old1)+200]:
    text = text.replace(old1, new1, 1)
    print('list1 ok')
else:
    # maybe already partially
    print('list1 skip or done', old1 in text)

# case statements for OPTION_CHOICE
old2 = """    case 'unless_pays_mana':
    case 'unless_pays_life':
    case 'unless_discards':
      return ChoiceEventType.OPTION_CHOICE;"""
new2 = """    case 'unless_pays_mana':
    case 'unless_pays_life':
    case 'unless_discards':
    case 'unless_sacrifices':
      return ChoiceEventType.OPTION_CHOICE;"""
c = text.count(old2)
print('case count', c)
text = text.replace(old2, new2)

# Add payload for unless_sacrifices after unless_discards payload
idx = text.find("if (kind === 'unless_discards')")
if idx < 0:
    raise SystemExit('unless_discards payload missing')
# find end of that block
snippet = text[idx:idx+600]
print('PAYLOAD SNIP:', repr(snippet[:500]))

# Insert after unless_discards block - find closing of that if
# Look for declineChoiceId after unless_discards
marker = "if (kind === 'unless_discards') {"
end_marker_search = text.find(marker)
# find matching closing - approximate by next "if (kind ==="
next_if = text.find("\n  if (kind ===", end_marker_search + 10)
block = text[end_marker_search:next_if]
print('BLOCK LEN', len(block))
print(block[:400])

if "if (kind === 'unless_sacrifices')" not in text:
    insert = """
  if (kind === 'unless_sacrifices') {
    const whatText = String((step as any).what?.text || (step as any).what || 'a permanent').trim();
    return {
      ...basePayload,
      sacrificeFilter: whatText,
      payChoiceId: 'sacrifice',
      declineChoiceId: 'decline',
    };
  }
"""
    text = text[:next_if] + insert + text[next_if:]
    print('payload inserted')

p.write_text(text, encoding='utf-8')
print('ep done')
