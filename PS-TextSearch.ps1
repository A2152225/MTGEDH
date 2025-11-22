<#
.SYNOPSIS
    Recursively searches for the literal word "BEGINNING" inside .ts and .tsx files
    when run from a repository root (or any folder).

.DESCRIPTION
    By default this script:
      - Searches the current directory ('.') recursively
      - Includes files with extensions: .ts and .tsx
      - Excludes common build/vendor directories: node_modules, .git, dist, build, out
      - Searches for the literal string "BEGINNING" (case-sensitive by default)
      - Prints file path, line number and matching line(s)
#>

param(
    [string]$Root = ".",
    [string]$Pattern = "Next",
    [switch]$CaseSensitive = $true,
    [switch]$ListFilesOnly,
    [int]$Context = 0,
    [string[]]$IncludeExtensions = @("*.ts","*.tsx"),
    [string[]]$ExcludeDirs = @("node_modules",".git","dist","build","out")
)

# Normalize Root path
$rootPath = Resolve-Path -Path $Root -ErrorAction Stop

# Find candidate files
Write-Verbose "Searching under: $rootPath"
try {
    $allFiles = Get-ChildItem -Path $rootPath -Recurse -File -Include $IncludeExtensions -ErrorAction SilentlyContinue
} catch {
    # Use subexpressions so the colon after the variable doesn't break parsing
    Write-Error ("Failed to enumerate files under {0}: {1}" -f $($rootPath), $($_).ToString())
    exit 2
}

# Filter out files inside excluded directories (match directory segment exactly)
$files = $allFiles | Where-Object {
    if (-not $_.DirectoryName) { return $true }
    $segments = $_.DirectoryName -split '[\\/]'
    ($segments | Where-Object { $ExcludeDirs -contains $_ }).Count -eq 0
}

if (-not $files) {
    Write-Host "No files found with the specified extensions under $rootPath." -ForegroundColor Yellow
    exit 0
}

# Build parameters for Select-String
$selectParamsBase = @{
    Pattern = $Pattern
    SimpleMatch = $true    # literal match (not regex)
    Context = $Context
    ErrorAction = 'SilentlyContinue'
}

if ($CaseSensitive) {
    $selectParamsBase['CaseSensitive'] = $true
}

$matchCount = 0
$matchingFiles = [System.Collections.Generic.HashSet[string]]::new()

foreach ($file in $files) {
    # Use Select-String per-file so we can control output grouping
    $sp = $selectParamsBase.Clone()
    $sp['Path'] = $file.FullName

    $matches = Select-String @sp

    if ($matches) {
        $matchingFiles.Add($file.FullName) | Out-Null
        $matchCount += $matches.Count

        if ($ListFilesOnly) {
            continue
        }

        # Print header for the file
        Write-Host "`nFile: $($file.FullName)" -ForegroundColor Cyan

        foreach ($m in $matches) {
            $ln = $m.LineNumber
            $text = $m.Line.TrimEnd()

            # Context lines if present
            if ($Context -gt 0) {
                if ($m.Context.PreContext) {
                    foreach ($i in 0..($m.Context.PreContext.Count - 1)) {
                        $lineNum = $m.LineNumber - $m.Context.PreContext.Count + $i
                        Write-Host (" {0,6}: {1}" -f $lineNum, $m.Context.PreContext[$i]) -ForegroundColor DarkGray
                    }
                }
            }

            # Print the matching line with line number
            Write-Host (" {0,6}: {1}" -f $ln, $text) -ForegroundColor White

            if ($Context -gt 0) {
                if ($m.Context.PostContext) {
                    foreach ($i in 0..($m.Context.PostContext.Count - 1)) {
                        $lineNum = $m.LineNumber + $i + 1
                        Write-Host (" {0,6}: {1}" -f $lineNum, $m.Context.PostContext[$i]) -ForegroundColor DarkGray
                    }
                }
            }
        }
    }
}

if ($ListFilesOnly) {
    if ($matchingFiles.Count -eq 0) {
        Write-Host "No matches found for '$Pattern'." -ForegroundColor Yellow
    } else {
        Write-Host "Files containing '$Pattern':" -ForegroundColor Cyan
        foreach ($f in $matchingFiles) { Write-Host $f }
    }
} else {
    if ($matchCount -eq 0) {
        Write-Host "`nNo matches found for '$Pattern'." -ForegroundColor Yellow
    } else {
        Write-Host "`nTotal matches: $matchCount in $($matchingFiles.Count) file(s)." -ForegroundColor Green
    }
}