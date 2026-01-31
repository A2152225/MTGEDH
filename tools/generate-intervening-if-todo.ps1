$ErrorActionPreference = 'Stop'

$sourcePath = "D:\Git\MTGEDH\server\src\state\modules\triggers\intervening-if.ts"
$outPath = "D:\Git\MTGEDH\docs\intervening-if-automation-todo.md"

$lines = Get-Content -Path $sourcePath

$items = @()
for ($i = 0; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -match "\(best-effort\)") {
    $header = $lines[$i].Trim()

    $probe = ""
    for ($j = $i + 1; $j -lt [Math]::Min($i + 40, $lines.Length); $j++) {
      $t = $lines[$j].Trim()
      if ($t -match "clause\.match\(" -or $t -match "\.test\(clause\)" -or $t -match "const m = clause\.match") {
        $probe = $t
        break
      }
    }

    $items += [pscustomobject]@{
      idx = $items.Count + 1
      line = $i + 1
      header = $header
      probe = $probe
    }
  }
}

$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine('# Intervening-If Automation Todo (135)')
$null = $sb.AppendLine('')
$null = $sb.AppendLine('One todo per `(best-effort)` marker in `server/src/state/modules/triggers/intervening-if.ts`.')
$null = $sb.AppendLine('')
$null = $sb.AppendLine('Legend: [ ] not started, [~] in progress, [x] done, [!] blocked')
$null = $sb.AppendLine('')
$null = $sb.AppendLine('## Items')

foreach ($it in $items) {
  $null = $sb.AppendLine('')
  $null = $sb.AppendLine(("### Item {0}" -f $it.idx))
  $null = $sb.AppendLine('- Status: [ ]')
  $null = $sb.AppendLine(("- Source: server/src/state/modules/triggers/intervening-if.ts#L{0}" -f $it.line))
  $null = $sb.AppendLine(("- Comment: {0}" -f $it.header.Replace('`', '\`')))
  if ($it.probe) {
    $null = $sb.AppendLine(('- Nearby check: `{0}`' -f $it.probe.Replace('`', '\`')))
  }
  $null = $sb.AppendLine('- Plan: TBD')
}

$sb.ToString() | Set-Content -Path $outPath -Encoding UTF8
Write-Host ("WROTE={0}" -f $items.Count)
