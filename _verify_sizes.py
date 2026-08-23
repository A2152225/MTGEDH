# Verify OracleQuantity supports kind all
p=r'D:\Git\MTGEDH\rules-engine\src\oracleIR.ts'
t=open(p,encoding='utf-8').read()
i=t.find('OracleQuantity')
print(t[i:i+600])
print('==== new file sizes ====')
import os
for f in [
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRAnyPlayerMay.ts',
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorAnyPlayerMayStep.ts',
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRGainControlCompoundRepair.ts',
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRRemoveCountersCostReduce.ts',
 r'D:\Git\MTGEDH\server\src\state\modules\nextSpellCostReduction.ts',
 r'D:\Git\MTGEDH\server\tests\on-cast-any-player-may-gain-control-cultist.unit.test.ts',
]:
  print(os.path.getsize(f), f.split('\\')[-1])
