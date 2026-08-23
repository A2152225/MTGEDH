from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorExecutionContext.ts')
text = p.read_text(encoding='utf-8')

old = """  const baseUnlessDiscardsChoice =
    baseSel?.unlessDiscardsChoice === 'discard' || baseSel?.unlessDiscardsChoice === 'decline'
      ? baseSel.unlessDiscardsChoice
      : undefined;"""
new = """  const baseUnlessDiscardsChoice =
    baseSel?.unlessDiscardsChoice === 'discard' || baseSel?.unlessDiscardsChoice === 'decline'
      ? baseSel.unlessDiscardsChoice
      : undefined;
  const baseUnlessSacrificesChoice =
    baseSel?.unlessSacrificesChoice === 'sacrifice' || baseSel?.unlessSacrificesChoice === 'decline'
      ? baseSel.unlessSacrificesChoice
      : undefined;"""
if old not in text:
    raise SystemExit('baseUnlessDiscards missing')
text = text.replace(old, new, 1)

# Find where unlessDiscardsChoice is put on return / selectorContext
idxs=[]
start=0
while True:
  i=text.find('unlessDiscardsChoice:', start)
  if i<0: break
  idxs.append(i)
  print(repr(text[i-40:i+120]))
  print('---')
  start=i+1
print('idxs', idxs)
p.write_text(text, encoding='utf-8')
