from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutionTypes.ts')
text=p.read_text(encoding='utf-8')
print('unlessSacrificesChoice count', text.count('unlessSacrificesChoice'))
print('unlessDiscardsChoice count', text.count('unlessDiscardsChoice'))
# Add wherever unlessDiscardsChoice exists without unlessSacrifices nearby
import re
parts=[]
for m in re.finditer(r"readonly unlessDiscardsChoice\?: 'discard' \| 'decline';", text):
    nearby=text[m.end():m.end()+80]
    print('at', m.start(), 'nearby', repr(nearby[:60]))
    if 'unlessSacrificesChoice' not in nearby:
        parts.append(m.start())
print('need insert at', parts)
for start in reversed(parts):
    end = text.find('\n', start)
    insert = "\n  /** Choice for unless-sacrifices wrappers when already known. */\n  readonly unlessSacrificesChoice?: 'sacrifice' | 'decline';"
    # find the line end of unlessDiscardsChoice
    line_end = text.find('\n', start)
    text = text[:line_end] + insert + text[line_end:]
p.write_text(text, encoding='utf-8')
print('now count', text.count('unlessSacrificesChoice'))
