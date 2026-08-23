from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIR.ts')
text = p.read_text(encoding='utf-8')
idx = text.find('teamworkChooseBoth')
print(repr(text[idx-120:idx+200]))
idx2 = text.find("kind: 'unless_discards'")
print('---')
print(repr(text[idx2-200:idx2+350]))
