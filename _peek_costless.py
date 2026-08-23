# How does IR parse "costs less to cast"
import re
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserSimpleActionClauses.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
for m in re.finditer(r'.{0,40}costs?\s+.+\s+less.{0,120}|kind:\s*\'(?:grant_cost|cost_reduction|modify_cost|casting_cost)', t, re.I):
  print('-', m.group(0).replace(chr(10),' ')[:200])
# also in parser.ts
p2=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParser.ts'
t2=open(p2,encoding='utf-8',errors='ignore').read()
print('==== parser.ts ====')
for m in re.finditer(r'.{0,40}(next spell you cast|costs \{1\} less|cost_reduction|modify_casting).{0,100}', t2, re.I):
  print('-', m.group(0).replace(chr(10),' ')[:220])
