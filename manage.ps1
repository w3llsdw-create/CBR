<#

NickelodeonCaseMgr.ps1 — keyboard‑first, early‑90s Nickelodeon‑style terminal UI for Caseboard
#>

What it is
- A fast TUI client for your existing FastAPI backend.
- Loud neon palette, chunky ASCII borders, playful splash, zero mouse.
- Uses the same endpoints your old script used: GET /api/cases and POST /api/cases/import.
- Tries optional endpoints if your API supports them:
        • POST /api/cases/{id}/focus
        • POST /api/cases/{id}/attention/{state}
        • GET  /api/cases/{id}/deadlines
- No external modules. PowerShell 7+ recommended.

Keys
- Global: Up/Down to move • Enter open • Esc back • / search • R refresh • I import CSV • Q quit
- Case screen: F set Focus • A cycle Attention • D view Deadlines • C copy Case# • B back

Run
    pwsh -File .\NickelodeonCaseMgr.ps1
#>

#region Theme Param
param([ValidateSet('nick','halloween')][string]$Theme='nick')
$script:IsHalloween = $Theme -eq 'halloween'

What it is
- A fast TUI client for your existing FastAPI backend.
- Loud neon palette, chunky ASCII borders, playful splash, zero mouse.
- Uses the same endpoints your old script used: GET /api/cases and POST /api/cases/import.
- Tries optional endpoints if your API supports them:
    • POST /api/cases/{id}/focus
    • POST /api/cases/{id}/attention/{state}
    • GET  /api/cases/{id}/deadlines
- No external modules. PowerShell 7+ recommended.

Keys
- Global: Up/Down to move • Enter open • Esc back • / search • R refresh • I import CSV • Q quit
- Case screen: F set Focus • A cycle Attention • D view Deadlines • C copy Case# • B back

Run
  pwsh -File .\NickelodeonCaseMgr.ps1
#>

#region Config
$ErrorActionPreference = 'Stop'
$BaseUrl = $env:CASEBOARD_URL
if (-not $BaseUrl -or $BaseUrl.Trim() -eq '') { $BaseUrl = 'http://127.0.0.1:8000' }
$Host.UI.RawUI.WindowTitle = 'Nickelodeon Caseboard — Neon Slime Console'
#endregion

#region ANSI + Theme
$SLIME  = "\e[38;5;46m"      # neon green
$GOO    = "\e[38;5;82m"      # lighter slime
$ORANGE = "\e[38;5;208m"     # Nickelodeon orange
$PURPLE = "\e[38;5;99m"
$TEAL   = "\e[38;5;44m"
$GRAY   = "\e[38;5;245m"
$WHITE  = "\e[97m"
$RESET  = "\e[0m"
$BGSLIME= "\e[48;5;46m"
$BGPURP = "\e[48;5;55m"
$BGBLACK= "\e[40m"

if ($script:IsHalloween) {
    # Halloween palette: pumpkin + purple + spooky green on black
    $SLIME   = "`e[38;5;118m"   # neon green
    $GOO     = "`e[38;5;190m"   # pale lime
    $ORANGE  = "`e[38;5;202m"   # pumpkin orange
    $PURPLE  = "`e[38;5;93m"    # witch purple
    $TEAL    = "`e[38;5;51m"    # cyan accent
    $GRAY    = "`e[38;5;245m"
    $WHITE   = "`e[97m"
    $RESET   = "`e[0m"
    $BGSLIME = "`e[48;5;52m"    # dark maroon progress fill
    $BGPURP  = "`e[48;5;54m"    # deep purple bar
    # keep $BGBLACK as black
}

function Color([string]$s,[string]$c){ return "$c$s$RESET" }

function SleepMs([int]$ms){ Start-Sleep -Milliseconds $ms }
#endregion

#region HTTP
function Invoke-Api {
    param(
        [Parameter(Mandatory)][ValidateSet('GET','POST','PUT','PATCH','DELETE')] [string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [object]$Body
    )
    $uri = "$BaseUrl$Path"
    $params = @{ Method=$Method; Uri=$uri; Headers=@{ 'Accept'='application/json' } }
    if ($PSBoundParameters.ContainsKey('Body')) {
        $params['ContentType'] = 'application/json'
        $params['Body'] = ($Body | ConvertTo-Json -Depth 10)
    }
    try {
        return Invoke-RestMethod @params
    } catch {
        throw "API $Method $Path failed: $($_.Exception.Message)"
    }
}
#endregion

#region Utils
function Pad([string]$s,[int]$n){ if(-not $s){$s=''}; if($s.Length -gt $n){ return $s.Substring(0,$n-1)+'…' } else { return $s.PadRight($n) } }
function Center([string]$s,[int]$w){ $p=[Math]::Max(0,($w-$s.Length)/2); return (' ' * [int]$p) + $s }
function ReadKey(){ [Console]::ReadKey($true) }
function Clear(){ Clear-Host }
function Banner(){
    $w=[Console]::WindowWidth; if($w -lt 60){ $w=60 }
    Clear
    $top = @(
        "    __   _      _         __           _                 ",
        "   / /  (_)____(_)____   / /___  _____(_)___  ____  _____ ",
        "  / /  / / ___/ / ___/  / / __ \\ / ___/ / __ \\/ __ \\/ ___/ ",
        " / /__/ (__  ) (__  )  / / /_/ /(__  ) / /_/ / /_/ (__  )  ",
        "/____/_/____/_/____/  /_/ .___/____/_/ .___/ .___/____/   ",
        "                         /_/         /_/   /_/             "
    )
    Write-Host ($BGBLACK + ' ' * $w + $RESET)
    foreach($line in $top){ Write-Host ((Color $line $SLIME) + $RESET) }
    if ($script:IsHalloween) {
        Write-Host (Color (Center '🎃 HALLOWEEN MODE 🎃' $w) $ORANGE)
    }
    Write-Host (Color (Center 'neon‑slime terminal for Caseboard' $w) $ORANGE)
    Write-Host ''
    SlimeBar -Text 'Loading'
}

function SlimeBar([string]$Text){
    $w=[Math]::Min(60,[Console]::WindowWidth-4)
    $bar=''
    for($i=0;$i -le $w;$i+=3){
        $bar = ($BGSLIME + ' ' * $i + $RESET)
        Write-Host ("  " + $GOO + $Text + ' ' + $RESET)
        Write-Host (' [' + $bar + (' ' * ($w-$i)) + ']')
        SleepMs 15
        [Console]::SetCursorPosition(0,[Console]::CursorTop-2)
    }
    Write-Host (' [' + $BGSLIME + (' ' * $w) + $RESET + ']')
}

function Coalesce { param($v,$fallback) if ($null -eq $v -or $v -eq '') { $fallback } else { $v } }
function Fuzzy([string]$q,[string]$h){ if([string]::IsNullOrWhiteSpace($q)){return $true}; $q=$q.ToLower(); $h=$h.ToLower(); $i=0; foreach($ch in $q.ToCharArray()){ $pos=$h.IndexOf($ch,$i); if($pos -lt 0){return $false}; $i=$pos+1 }; return $true }
#endregion

#region Data
function Get-Cases { Invoke-Api -Method GET -Path '/api/cases' }
function Import-CsvFile([string]$Path){
    if(-not (Test-Path $Path)){ throw "CSV not found: $Path" }
    $csvText = Get-Content -Raw -Path $Path
    Invoke-Api -Method POST -Path '/api/cases/import' -Body @{ csv = $csvText } | Out-Null
}
function Try-SetFocus([int]$Id,[string]$focus){ try { Invoke-Api -Method POST -Path "/api/cases/$Id/focus" -Body @{ focus=$focus } | Out-Null; return $true } catch { return $false } }
function Try-SetAttention([int]$Id,[string]$state){ try { Invoke-Api -Method POST -Path "/api/cases/$Id/attention/$state" | Out-Null; return $true } catch { return $false } }
function Try-GetDeadlines([int]$Id){ try { return Invoke-Api -Method GET -Path "/api/cases/$Id/deadlines" } catch { return @() } }
#endregion

#region Table UI
function Header(){
    $w=[Console]::WindowWidth
    $bar = ($PURPLE + ('═' * [Math]::Min($w,100)) + $RESET)
    Write-Host $bar
    Write-Host (Color ' IDX  !  CLIENT                   | CASE NAME                     | STATUS       | DUE  ' $WHITE)
    Write-Host $bar
}

function AttGlyph($att){ switch($att){ 'needs_attention' { return (Color '!' $ORANGE) } 'waiting' { return (Color '~' $TEAL) } default { return (Color ' ' $GRAY) } } }
function DueColor($c){ if(-not $c.next_due){ return $GRAY }; $d=[DateTime]$c.next_due; if($d.Date -lt (Get-Date).Date){ return $ORANGE }; if($d.Date -le (Get-Date).AddDays(3).Date){ return $SLIME }; return $GRAY }

function Row($idx,$c){
    $idxTxt = ('{0,3}' -f $idx)
    $client = Pad (Coalesce $c.client_name '--') 23
    $case   = Pad (Coalesce $c.case_name '--') 27
    $status = Pad (Coalesce $c.status '--') 12
    $due    = if($c.next_due){ (Get-Date $c.next_due).ToString('MMM dd') } else { '--' }
    $dueC   = DueColor $c
    Write-Host -NoNewline (" $idxTxt  ")
    Write-Host -NoNewline (AttGlyph $c.attention)
    Write-Host -NoNewline ("  ")
    Write-Host -NoNewline (Color $client $WHITE)
    Write-Host -NoNewline (" | ")
    Write-Host -NoNewline (Color $case $GRAY)
    Write-Host -NoNewline (" | ")
    Write-Host -NoNewline (Color $status $TEAL)
    Write-Host -NoNewline (" | due: ")
    Write-Host (Color $due $dueC)
}

function List-Cases([array]$cases,[string]$q=''){
    $i=0
    while($true){
        Clear
        Banner
        $filtered = $cases | Where-Object { Fuzzy $q ("$($_.client_name) $($_.case_name) $($_.status) $($_.id)") }
        Header
        for($k=0; $k -lt [Math]::Min($filtered.Count,30); $k++){
            $active = ($k -eq $i)
            if($active){ Write-Host ("" + $BGPURP + ' ' + $RESET) -NoNewline }
            Row $k $filtered[$k]
        }
        Write-Host ("\n" + Color '↑/↓ move  Enter open   / search   R refresh   I import CSV   Q quit' $GRAY)
        if($q){ Write-Host (Color ("Filter: '$q'") $GRAY) }
        $key = ReadKey
        switch($key.Key){
            'UpArrow'   { if($i -gt 0){ $i-- } }
            'DownArrow' { if($i -lt [Math]::Max($filtered.Count-1,0)){ $i++ } }
            'Enter'     { if($filtered.Count){ Case-Screen $filtered[$i] } }
            'Escape'    { return }
            'R'         { $cases = Get-Cases }
            'I'         { $p = Read-Host 'Path to CSV'; try{ Import-CsvFile $p; $cases = Get-Cases; Write-Host (Color 'Import complete.' $SLIME); SleepMs 600 } catch { Write-Host (Color $_ $ORANGE); Read-Host 'press Enter' | Out-Null } }
            'Oem2'      { $q = Read-Host 'Type to filter (fuzzy). Leave blank to clear' }
            'Q'         { exit }
        }
    }
}
#endregion

#region Case screen
function Case-Screen($c){
    while($true){
        Clear
        Write-Host (Color ('╔' + ('═'*76) + '╗') $PURPLE)
        Write-Host (Color ('║ ' + (Pad "$($c.client_name) — $($c.case_name)" 74) + ' ║') $PURPLE)
        Write-Host (Color ('╚' + ('═'*76) + '╝') $PURPLE)
        Write-Host (Color ("Case #$($c.id)") $WHITE)
        Write-Host (Color ("Status: " + (Coalesce $c.status '--')) $TEAL)
        if($c.next_due){ Write-Host (Color ("Next due: $((Get-Date $c.next_due).ToString('yyyy-MM-dd'))") $GOO) }
        if($c.current_focus){ Write-Host (Color ("Focus: $($c.current_focus)") $WHITE) }
        Write-Host ''
        Write-Host (Color 'F set Focus  A cycle Attention  D deadlines  C copy Case#  B back' $GRAY)
        $k = ReadKey
        switch($k.Key){
            'B' { return }
            'Escape' { return }
            'F' {
                $focus = Read-Host 'Focus text'
                if([string]::IsNullOrWhiteSpace($focus)){ continue }
                if(Try-SetFocus $c.id $focus){ $c.current_focus = $focus; Write-Host (Color 'Focus updated.' $SLIME); SleepMs 500 } else { Write-Host (Color 'Focus not supported by API.' $ORANGE); SleepMs 800 }
            }
            'A' {
                $states = @('needs_attention','waiting','none')
                $curr = if($c.attention){ $c.attention } else { 'none' }
                $next = $states[ ([Array]::IndexOf($states,$curr)+1) % $states.Count ]
                if($next -eq 'none'){ $next = 'clear' }
                if(Try-SetAttention $c.id $next){ $c.attention = if($next -eq 'clear'){ $null } else { $next }; Write-Host (Color 'Attention updated.' $SLIME); SleepMs 500 } else { Write-Host (Color 'Attention not supported by API.' $ORANGE); SleepMs 800 }
            }
            'D' {
                $dl = Try-GetDeadlines $c.id
                if(-not $dl -or $dl.Count -eq 0){ Write-Host (Color 'No deadlines or endpoint unsupported.' $ORANGE); SleepMs 900; continue }
                Write-Host (Color '-- Deadlines --' $TEAL)
                foreach($d in $dl){ $flag = if($d.resolved){'[x]'}else{'[ ]'}; $due = Coalesce $d.due_date '--'; $desc = Coalesce $d.description ''; Write-Host ("  $flag  $due  $desc") }
                Read-Host 'press Enter to return' | Out-Null
            }
            'C' { $txt="$($c.id)"; Set-Clipboard -Value $txt; Write-Host (Color 'Copied Case# to clipboard.' $GOO); SleepMs 400 }
        }
    }
}
#endregion

#region Main
try {
    Banner
    $cases = Get-Cases
    List-Cases -cases $cases
} catch {
    Clear
    Write-Host (Color 'Startup failed:' $ORANGE)
    Write-Host $_
    Read-Host 'press Enter to exit' | Out-Null
}
#endregion
