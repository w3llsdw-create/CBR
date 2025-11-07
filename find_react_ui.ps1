# Find the React + Tailwind UI in common locations and under the current folder
# Usage: Right-click > Run with PowerShell, or:
#   powershell -ExecutionPolicy Bypass -File .\find_react_ui.ps1

$ErrorActionPreference = 'SilentlyContinue'

function Search-Roots {
  param([string[]]$Roots, [string[]]$Targets)
  $found = @()
  foreach ($root in $Roots) {
    if (Test-Path $root) {
      Write-Host "Searching in: $root" -ForegroundColor Cyan
      $found += Get-ChildItem -Path $root -Recurse -File |
        Where-Object { $Targets -contains $_.Name }
    }
  }
  return $found
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultRoots = @(
  $scriptRoot,
  (Join-Path $scriptRoot '..'),
  "$env:USERPROFILE\Desktop",
  "$env:USERPROFILE\Documents"
)

# Most likely files to identify the React UI
$primaryTargets = @('StatusBadge.tsx')
$secondaryTargets = @('tailwind.config.js', 'postcss.config.js', 'package.json')

Write-Host "\nLooking for StatusBadge.tsx (primary target)..." -ForegroundColor Yellow
$primary = Search-Roots -Roots $defaultRoots -Targets $primaryTargets

if ($primary.Count -gt 0) {
  Write-Host "\nFound likely badge component file(s):" -ForegroundColor Green
  $primary | ForEach-Object { Write-Host $_.FullName }
  Write-Host "\nOpen the file above and I can patch in the 'prospect' variant for you." -ForegroundColor Green
  Write-Host "\nPress Enter to close this window..."
  [void](Read-Host)
  exit 0
}

Write-Host "\nPrimary not found. Scanning for React/Tailwind project markers..." -ForegroundColor Yellow
$secondary = Search-Roots -Roots $defaultRoots -Targets $secondaryTargets | Select-Object -ExpandProperty Directory -Unique

if ($secondary.Count -gt 0) {
  Write-Host "\nFound candidate project folders (contain tailwind/postcss/package.json):" -ForegroundColor Green
  $secondary | ForEach-Object { Write-Host $_.FullName }
  Write-Host "\nOpen the 'src/components' folder (or similar) inside one of the above and look for StatusBadge.tsx (or a badge component)." -ForegroundColor Green
  Write-Host "\nPress Enter to close this window..."
  [void](Read-Host)
  exit 0
}

Write-Host "\nNo React/Tailwind files found in common locations." -ForegroundColor Red
Write-Host "Try running this script again from the parent folder that contains all your projects, or tell me where your React app lives and I’ll patch it." -ForegroundColor Red
Write-Host "\nPress Enter to close this window..."
[void](Read-Host)
