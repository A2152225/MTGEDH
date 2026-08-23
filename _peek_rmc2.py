import re
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserSimpleActionClauses.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
# find remove all / remove counters patterns near remove_counter
for m in re.finditer(r'const remove\w+\s*=\s*clause\.match\([^)]+\)', t):
  s=m.group(0)
  if 'counter' in s.lower() or 'all' in s.lower():
    print(s[:250])
    print('---')
# also cost less
print('==== cost less ====')
for m in re.finditer(r'.{0,30}costs?.{0,40}less to cast.{0,200}', t, re.I):
  print(m.group(0).replace(chr(10),' ')[:300])
  print('---')
