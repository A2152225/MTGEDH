import re
p=r'D:\Git\MTGEDH\server\src\state\modules\casting-modifiers.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
# find syncCastingModifier / cost reduction grant types
for m in re.finditer(r'export (?:function|type|interface) \w+', t):
  print(m.group(0))
print('====')
i=t.find('syncCastingModifierGrantsFromOracleIRResult')
print(t[i:i+4000] if i>=0 else 'missing')
