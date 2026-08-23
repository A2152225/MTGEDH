from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorExecutionContext.ts')
text = p.read_text(encoding='utf-8')
# find final return of build function - look for unlessPaysManaChoice after selectorContext
i = text.find('selectorContext:')
print('first selectorContext', i)
# Find return after selectorContext built
# Search for pattern: ...(hintUnlessPaysManaChoice
indices=[]
start=0
while True:
  j=text.find('hintUnlessPaysManaChoice || baseUnlessPaysManaChoice', start)
  if j<0: break
  indices.append(j)
  start=j+1
print('indices', indices)
for j in indices:
  print('--- at', j)
  print(repr(text[j-100:j+200]))
