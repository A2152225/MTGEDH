from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutionTypes.ts')
text=p.read_text(encoding='utf-8')
print('count', text.count('unlessSacrificesChoice'))
# show unique contexts
idx=0
while True:
  i=text.find('unlessSacrificesChoice', idx)
  if i<0: break
  print(repr(text[i-80:i+100]))
  print('---')
  idx=i+1
