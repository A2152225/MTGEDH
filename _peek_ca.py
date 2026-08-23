import re
p=r'D:\Git\MTGEDH\server\src\state\modules\cost-adjustments.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
print(t[:4000])
print('====')
for m in re.finditer(r'export (?:function|type|interface) \w+|nextSpell|temporaryCost|delayedCost|costReductionGrant', t):
  print(m.group(0))
