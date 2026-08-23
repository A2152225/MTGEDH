import re
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIR.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
# find unless_sacrifices and unless_pays in type defs
for needle in ["unless_sacrifices", "unless_pays_life", "unless_discards", "pay_mana", "OracleEffectStep"]:
  print(needle, t.find(needle))
i=t.find("kind: 'unless_sacrifices'")
print('==== unless_sacrifices type ====')
print(t[i-200:i+500] if i>=0 else 'NOT IN oracleIR.ts')
i2=t.find("kind: 'unless_pays_life'")
print('==== unless_pays_life ====')
print(t[i2-100:i2+600] if i2>=0 else 'missing')
