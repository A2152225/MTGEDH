import re
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserPostprocess.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
for m in re.finditer(r'.{0,60}(if a player does|if you do|any player may).{0,150}', t, re.I):
  print('-', m.group(0).replace(chr(10),' ')[:250])
