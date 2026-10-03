# Downloads the latest Node.js LTS (official zip from nodejs.org, checksum
# verified) into <Dest>\node - a private copy used only by Javinizer-JS, no
# admin rights, nothing installed system-wide. Called by start.bat when no
# recent enough Node.js is installed. <Dest> lives under data\, which the
# in-app updater never touches.

param([Parameter(Mandatory = $true)][string]$Dest)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# A 32-bit PowerShell on a 64-bit Windows reports x86 here; the real one is in PROCESSOR_ARCHITEW6432
$osArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
switch ($osArch) {
    'AMD64' { $arch = 'x64' }
    'ARM64' { $arch = 'arm64' }
    default { throw "Unsupported architecture: $osArch (Node.js needs 64-bit Windows)" }
}

$release = Invoke-RestMethod 'https://nodejs.org/dist/index.json' |
    Where-Object { $_.lts -and ($_.files -contains "win-$arch-zip") } |
    Select-Object -First 1
if (-not $release) { throw "No Node.js LTS release found for win-$arch" }

$version = $release.version
$name = "node-$version-win-$arch"
$base = "https://nodejs.org/dist/$version"
$zip = Join-Path $Dest "$name.zip"

Write-Host "[INFO] Downloading Node.js $version ($arch)..."
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Invoke-WebRequest "$base/$name.zip" -OutFile $zip -UseBasicParsing

$sums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
$line = ($sums -split "`n") | Where-Object { $_.Trim().EndsWith("  $name.zip") } | Select-Object -First 1
if (-not $line) { throw "Checksum for $name.zip not found" }
$expected = ($line.Trim() -split '\s+')[0]
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) {
    Remove-Item $zip -Force
    throw "Checksum mismatch for $name.zip"
}

Write-Host "[INFO] Extracting..."
$target = Join-Path $Dest 'node'
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
$extracted = Join-Path $Dest $name
if (Test-Path $extracted) { Remove-Item $extracted -Recurse -Force }

# tar.exe (Windows 10 1803+) is much faster than Expand-Archive on thousands of files
if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
    tar.exe -xf $zip -C $Dest
    if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
} else {
    Expand-Archive -Path $zip -DestinationPath $Dest -Force
}
Rename-Item $extracted 'node'
Remove-Item $zip -Force

Write-Host "[INFO] Node.js $version ready in $target"
