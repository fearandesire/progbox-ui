param(
    [switch]$Yes,
    [switch]$NoWinget,
    [switch]$SkipEngine,
    [switch]$SkipDoctor,
    [switch]$PreflightOnly,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

foreach ($arg in $RemainingArgs) {
    switch ($arg) {
        "--" { continue }
        "-Yes" { $Yes = $true; continue }
        "--yes" { $Yes = $true; continue }
        "-NoWinget" { $NoWinget = $true; continue }
        "-SkipEngine" { $SkipEngine = $true; continue }
        "-SkipDoctor" { $SkipDoctor = $true; continue }
        "-PreflightOnly" { $PreflightOnly = $true; continue }
        default { throw "Unknown setup-windows.ps1 option: $arg" }
    }
}

$PnpmVersion = if ($env:PNPM_VERSION) { $env:PNPM_VERSION } else { "10.8.0" }
$NodeMinMajor = if ($env:NODE_MIN_MAJOR) { [int]$env:NODE_MIN_MAJOR } else { 22 }

function Resolve-RepoRoot {
    $scriptDir = Split-Path -Parent $PSCommandPath
    $parent = Resolve-Path (Join-Path $scriptDir "..")

    try {
        $gitRoot = & git -C $parent rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -eq 0 -and $gitRoot) {
            return (Resolve-Path $gitRoot).Path
        }
    } catch {
        # Fall back to the script parent below.
    }

    return $parent.Path
}

$Root = Resolve-RepoRoot
Set-Location $Root

if (-not (Test-Path "package.json") -or -not (Test-Path "pnpm-workspace.yaml") -or -not (Test-Path "web") -or -not (Test-Path "api/vendor/progbox_cpp")) {
    throw "Refusing to run: could not prove repo root is progbox-ui ($Root)."
}

$package = Get-Content -Raw "package.json" | ConvertFrom-Json
if ($package.name -ne "progbox-ui") {
    throw "Refusing to run: package.json name is '$($package.name)', expected 'progbox-ui'."
}

New-Item -ItemType Directory -Force -Path "logs" | Out-Null
$LogFile = Join-Path $Root ("logs/setup-windows-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType File -Force -Path $LogFile | Out-Null

Add-Content -Path $LogFile -Value "progbox-ui Windows setup"
Add-Content -Path $LogFile -Value "Repo: $Root"
Add-Content -Path $LogFile -Value "Date: $(Get-Date -Format o)"
Add-Content -Path $LogFile -Value "PowerShell: $($PSVersionTable.PSVersion)"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "> $Message" -ForegroundColor Cyan
    Add-Content -Path $LogFile -Value ""
    Add-Content -Path $LogFile -Value "==> $Message"
}

function Write-Ok([string]$Message) {
    Write-Host "  OK $Message" -ForegroundColor Green
    Add-Content -Path $LogFile -Value "OK: $Message"
}

function Write-Warn([string]$Message) {
    Write-Host "  WARN $Message" -ForegroundColor Yellow
    Add-Content -Path $LogFile -Value "WARN: $Message"
}

function Write-Fail([string]$Message) {
    Write-Host "  FAIL $Message" -ForegroundColor Red
    Add-Content -Path $LogFile -Value "FAIL: $Message"
}

function Confirm-Action([string]$Message, [bool]$DefaultYes = $true) {
    if ($Yes) {
        Add-Content -Path $LogFile -Value "Auto-confirmed: $Message"
        return $true
    }

    if (-not [Environment]::UserInteractive) {
        Add-Content -Path $LogFile -Value "Non-interactive default no: $Message"
        return $false
    }

    $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
    $answer = Read-Host "  $Message $suffix"
    if ([string]::IsNullOrWhiteSpace($answer)) {
        return $DefaultYes
    }
    return $answer -match "^(y|yes)$"
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Format-CommandLine([string]$File, [string[]]$Arguments) {
    $parts = @($File) + $Arguments
    $quoted = foreach ($part in $parts) {
        if ($part -match "\s") { '"' + $part.Replace('"', '\"') + '"' } else { $part }
    }
    return ($quoted -join " ")
}

function Invoke-Native([string]$Label, [string]$File, [string[]]$Arguments = @()) {
    Write-Step $Label
    Add-Content -Path $LogFile -Value ("+ " + (Format-CommandLine $File $Arguments))

    $global:LASTEXITCODE = 0
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $File @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    foreach ($line in $output) {
        Add-Content -Path $LogFile -Value $line
    }

    if ($exitCode -ne 0) {
        Write-Fail "$Label (exit $exitCode)"
        Write-Host ""
        Write-Host "Last log lines:" -ForegroundColor Red
        Get-Content -Path $LogFile -Tail 30 | ForEach-Object { Write-Host $_ }
        throw "$Label failed"
    }

    Write-Ok $Label
}

function Test-FrontendNativeDeps {
    Push-Location (Join-Path $Root "web")
    try {
        Add-Content -Path $LogFile -Value "+ node -e import('vite')"
        $global:LASTEXITCODE = 0
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $output = & node -e "import('vite').then(() => process.exit(0), (err) => { console.error(err && err.message ? err.message : err); process.exit(1); })" 2>&1
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        foreach ($line in $output) {
            Add-Content -Path $LogFile -Value $line
        }
        return ($exitCode -eq 0)
    } finally {
        Pop-Location
    }
}

function Update-ProcessPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Install-WithWinget([string]$Name, [string]$Id, [string[]]$ExtraArgs = @()) {
    if ($NoWinget) {
        Write-Warn "winget installs disabled; install $Name manually."
        return $false
    }

    if (-not (Test-Command "winget")) {
        Write-Warn "winget is not available; install $Name manually."
        return $false
    }

    if (-not (Confirm-Action "Install $Name with winget?")) {
        Write-Warn "Skipped $Name install."
        return $false
    }

    $args = @(
        "install",
        "--id", $Id,
        "-e",
        "--source", "winget",
        "--accept-package-agreements",
        "--accept-source-agreements"
    ) + $ExtraArgs
    Invoke-Native "Installing $Name" "winget" $args
    Update-ProcessPath
    return $true
}

function Get-NodeMajor {
    if (-not (Test-Command "node")) {
        return 0
    }
    $version = (& node --version 2>$null)
    if ($version -match "^v?(\d+)") {
        return [int]$Matches[1]
    }
    return 0
}

function Get-VSWherePath {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
        "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    return $null
}

function Test-MSVCBuildTools {
    if (Test-Command "cl") {
        return $true
    }

    $vswhere = Get-VSWherePath
    if (-not $vswhere) {
        return $false
    }

    $global:LASTEXITCODE = 0
    $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    return ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($installPath))
}

function Remove-RepoChildDirectory([string]$Path, [string]$ExpectedLeaf) {
    if (-not (Test-Path $Path)) {
        return
    }

    $resolvedRoot = (Resolve-Path $Root).Path.TrimEnd("\")
    $resolvedPath = (Resolve-Path $Path).Path.TrimEnd("\")
    $leaf = Split-Path -Leaf $resolvedPath

    if ($leaf -ne $ExpectedLeaf) {
        throw "Refusing to remove unexpected directory '$resolvedPath'."
    }

    if (-not $resolvedPath.StartsWith($resolvedRoot + "\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove path outside repo: $resolvedPath"
    }

    Add-Content -Path $LogFile -Value "Removing $resolvedPath"
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $resolvedPath) {
        throw "Could not fully remove '$resolvedPath'. Close any terminals/editors using it, then rerun setup."
    }
}

Write-Host ""
Write-Host "progbox-ui Windows setup" -ForegroundColor White
Write-Host "Repo: $Root" -ForegroundColor DarkGray
Write-Host "Log:  $LogFile" -ForegroundColor DarkGray

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "This script must run on native Windows. Use bash scripts/setup-wsl.sh under WSL/Linux."
}

Write-Step "Checking Windows prerequisites"

if (-not (Test-Command "git")) {
    Install-WithWinget "Git" "Git.Git" | Out-Null
}
if (-not (Test-Command "git")) {
    throw "git is missing. Install Git for Windows, reopen PowerShell, and rerun this script."
}
Write-Ok (& git --version)

$nodeMajor = Get-NodeMajor
if ($nodeMajor -lt $NodeMinMajor) {
    if ($nodeMajor -eq 0) {
        Write-Warn "Node.js is missing."
    } else {
        Write-Warn "Node.js major $nodeMajor is below required major $NodeMinMajor."
    }
    Install-WithWinget "Node.js LTS" "OpenJS.NodeJS.LTS" | Out-Null
    $nodeMajor = Get-NodeMajor
}
if ($nodeMajor -lt $NodeMinMajor) {
    throw "Node.js $NodeMinMajor+ is required. Install it, reopen PowerShell, and rerun this script."
}
Write-Ok "node $(& node --version)"

if (-not (Test-Command "cmake")) {
    Write-Warn "CMake is missing."
    Install-WithWinget "CMake" "Kitware.CMake" | Out-Null
}
if (-not (Test-Command "cmake")) {
    throw "CMake is required. Install CMake, reopen PowerShell, and rerun this script."
}
Write-Ok ((& cmake --version | Select-Object -First 1) -join "")

if (-not (Test-MSVCBuildTools)) {
    Write-Warn "MSVC Build Tools with Desktop development with C++ were not found."
    Install-WithWinget `
        "Visual Studio Build Tools C++ workload" `
        "Microsoft.VisualStudio.2022.BuildTools" `
        @("--override", "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended") | Out-Null
}
if (-not (Test-MSVCBuildTools)) {
    throw "MSVC Build Tools are required for the native Windows C++ engine build. Install Visual Studio Build Tools with the C++ workload, reopen PowerShell, and rerun this script."
}
Write-Ok "MSVC Build Tools detected"

Write-Step "Checking pnpm"
$currentPnpm = if (Test-Command "pnpm") { (& pnpm --version 2>$null) } else { "" }
if ($currentPnpm -ne $PnpmVersion -and (Test-Command "corepack")) {
    Invoke-Native "Enabling corepack" "corepack" @("enable")
    $currentPnpm = if (Test-Command "pnpm") { (& pnpm --version 2>$null) } else { "" }
    if ($currentPnpm -ne $PnpmVersion) {
        Invoke-Native "Activating pnpm $PnpmVersion" "corepack" @("prepare", "pnpm@$PnpmVersion", "--activate")
        Update-ProcessPath
    }
}

$currentPnpm = if (Test-Command "pnpm") { (& pnpm --version 2>$null) } else { "" }
if ($currentPnpm -ne $PnpmVersion) {
    if (-not (Test-Command "corepack")) {
        Write-Warn "corepack is missing; falling back to npm for pnpm $PnpmVersion."
    } else {
        Write-Warn "corepack did not expose pnpm $PnpmVersion; installing pnpm globally."
    }
    if (-not (Test-Command "npm")) {
        throw "npm is required to install pnpm. Reinstall Node.js and rerun this script."
    }
    Invoke-Native "Installing pnpm $PnpmVersion" "npm" @("install", "-g", "pnpm@$PnpmVersion")
    Update-ProcessPath
} elseif (-not (Test-Command "corepack")) {
    Write-Warn "corepack is missing, but pnpm $PnpmVersion is already available."
}

$currentPnpm = if (Test-Command "pnpm") { (& pnpm --version 2>$null) } else { "" }
if ($currentPnpm -ne $PnpmVersion) {
    throw "pnpm $PnpmVersion is required. Current value: '$currentPnpm'."
}
Write-Ok "pnpm $currentPnpm"

if ($PreflightOnly) {
    Write-Host ""
    Write-Host "Preflight complete" -ForegroundColor White
    Write-Host "  Log: $LogFile"
    exit 0
}

if (Test-FrontendNativeDeps) {
    Invoke-Native "Installing workspace dependencies" "pnpm" @("install", "--frozen-lockfile")
} else {
    Write-Warn "Frontend native dependencies are missing for this platform; forcing a pnpm reinstall."
    Invoke-Native "Repairing workspace dependencies" "pnpm" @("install", "--frozen-lockfile", "--force")
    if (-not (Test-FrontendNativeDeps)) {
        throw "Frontend native dependency check still fails after pnpm reinstall."
    }
    Write-Ok "Frontend native dependencies are usable"
}

if (-not $SkipEngine) {
    Invoke-Native "Building C++ engine" "pnpm" @("run", "build:engine")
} else {
    Write-Warn "Skipped C++ engine build"
}

if (-not $SkipDoctor) {
    Invoke-Native "Running doctor" "pnpm" @("run", "doctor")
} else {
    Write-Warn "Skipped doctor"
}

Write-Host ""
Write-Host "Setup complete" -ForegroundColor White
Write-Host "  Start:    pnpm dev"
Write-Host "  Log:      $LogFile"
