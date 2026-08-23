$path = "D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorAnyPlayerMayStep.ts"
$t = Get-Content $path -Raw
$t = $t -replace "from '../../shared/src/types\.js';", "from '../../shared/src';"
$t = $t -replace "from './oracleIR\.js';", "from './oracleIR';"
$t = $t -replace "from './oracleIRExecutionTypes\.js';", "from './oracleIRExecutionTypes';"
$t = $t -replace "from './oracleIRAnyPlayerMay\.js';", "from './oracleIRAnyPlayerMay';"
Set-Content $path $t -Encoding utf8 -NoNewline
Write-Output "fixed imports"

# Also fix anyPlayerMay module import
$path2 = "D:\Git\MTGEDH\rules-engine\src\oracleIRAnyPlayerMay.ts"
$t2 = Get-Content $path2 -Raw
$t2 = $t2 -replace "from './oracleIR\.js';", "from './oracleIR';"
Set-Content $path2 $t2 -Encoding utf8 -NoNewline
Write-Output "fixed anyPlayerMay import"
