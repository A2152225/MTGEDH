import re
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParser.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
# find clause splitting / parseOracleTextToIR
for m in re.finditer(r'export function \w+', t):
  if any(x in m.group(0).lower() for x in ['parse', 'split', 'clause', 'effect']):
    print(m.group(0), 'at', m.start())
print('====')
# look for if a player does handling
for m in re.finditer(r'.{0,80}if a player does.{0,200}', t, re.I):
  print(m.group(0).replace(chr(10),' ')[:280])
