p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserSimpleActionClauses.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('const gainControl = clause.match')
print(t[i:i+2500])
