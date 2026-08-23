import re
# Find remove counter / casting modifier step kinds in oracleIR
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIR.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
for m in re.finditer(r"kind:\s*'([^']*(?:counter|cost|casting|modifier|remove)[^']*)'", t, re.I):
  print(m.group(0)[:120])
print('==== casting modifier in battlefield handlers ====')
p2=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorBattlefieldStepHandlers.ts'
t2=open(p2,encoding='utf-8',errors='ignore').read()
for needle in ['next spell you cast', 'casting_modifier', 'cost_reduction', 'remove_counter', 'remove all counters']:
  i=t2.lower().find(needle.lower())
  print(needle, i)
  if i>=0:
    print(t2[max(0,i-200):i+400][:500])
    print('---')
