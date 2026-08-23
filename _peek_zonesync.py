import re
p=r'D:\Git\MTGEDH\server\src\state\modules\oracleIrServerZoneSync.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print('len', len(t))
# find unless pay related functions
for m in re.finditer(r'function \w+|oracleIrUnless|unlessPays|unless_sacrific|player_choice', t):
  pass
# extract chunks around oracleIrUnlessPayChoice
idxs=[m.start() for m in re.finditer('oracleIrUnlessPayChoice|unlessPaysLifeChoice|unless_sacrifices|UnlessSacrific', t)]
print('idxs count', len(idxs))
for i in idxs[:8]:
  print('--- at', i)
  print(t[max(0,i-150):i+400].replace('\n','\n')[:500])
