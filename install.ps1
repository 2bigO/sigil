$ErrorActionPreference = "Stop"

$Repository = "qoherent/sigil"
$DefaultVersion = "__SIGIL_VERSION__"
$Version = if ($env:SIGIL_VERSION) { $env:SIGIL_VERSION } else { $DefaultVersion }
$InstallRoot = if ($env:SIGIL_INSTALL_DIR) { $env:SIGIL_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Sigil" }
$BinDir = if ($env:SIGIL_BIN_DIR) { $env:SIGIL_BIN_DIR } else { Join-Path $InstallRoot "bin" }
if (-not [Environment]::Is64BitOperatingSystem) { throw "Sigil supports only 64-bit Windows." }
if ($env:PROCESSOR_ARCHITECTURE -notin @("AMD64", "ARM64")) { throw "Unsupported Windows architecture: $env:PROCESSOR_ARCHITECTURE" }

$Archive = $env:SIGIL_ARCHIVE_PATH
$Checksums = $env:SIGIL_CHECKSUMS_PATH
if ([bool]$Archive -xor [bool]$Checksums) { throw "SIGIL_ARCHIVE_PATH and SIGIL_CHECKSUMS_PATH must be supplied together." }
$Temp = Join-Path ([IO.Path]::GetTempPath()) "sigil-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $Temp | Out-Null
try {
  if (-not $Archive) {
    $Asset = "sigil-x86_64-pc-windows-msvc.zip"
    $Base = "https://github.com/$Repository/releases/download/cli-v$Version"
    $Archive = Join-Path $Temp $Asset
    $Checksums = Join-Path $Temp "checksums.txt"
    Invoke-WebRequest -Uri "$Base/$Asset" -OutFile $Archive
    Invoke-WebRequest -Uri "$Base/checksums.txt" -OutFile $Checksums
  } else {
    if (-not (Test-Path $Archive -PathType Leaf) -or -not (Test-Path $Checksums -PathType Leaf)) { throw "Local installer inputs do not exist." }
  }
  $Asset = [IO.Path]::GetFileName($Archive)
  $Line = Get-Content $Checksums | Where-Object { $_ -match "\s+$([regex]::Escape($Asset))$" } | Select-Object -First 1
  if (-not $Line) { throw "Checksum entry for $Asset is missing." }
  $Expected = ($Line -split "\s+")[0].ToLowerInvariant()
  $Actual = (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "Checksum verification failed for $Asset." }
  Expand-Archive -Path $Archive -DestinationPath $Temp
  $Source = Join-Path $Temp "sigil-$Version"
  $Executable = Join-Path $Source "bin\sigil.exe"
  $Manifest = Join-Path $Source "lib\sigil\runtime\manifest.json"
  if (-not (Test-Path $Executable -PathType Leaf)) { throw "Archive does not contain bin\sigil.exe." }
  if (-not (Test-Path $Manifest -PathType Leaf)) { throw "Archive has no runtime manifest." }
  if (-not (Test-Path (Join-Path $Source "lib\sigil\runtime\egglog\sigil-semantic-engine.exe") -PathType Leaf)) { throw "Archive has no native engine." }
  if (-not (Test-Path (Join-Path $Source "lib\sigil\runtime\typescript\tsc.exe") -PathType Leaf)) { throw "Archive has no TypeScript runtime." }
  if (Get-ChildItem $Source -Recurse -Force | Where-Object { $_.LinkType }) { throw "Archive contains a symbolic link." }
  $ManifestHash = (Get-FileHash $Manifest -Algorithm SHA256).Hash.ToLowerInvariant()
  $Prefix = $ManifestHash.Substring(0, 16)
  $Versions = Join-Path $InstallRoot "versions"
  $Destination = Join-Path $Versions "$Version-$Prefix"
  New-Item -ItemType Directory -Force -Path $Versions, $BinDir | Out-Null
  if (Test-Path $Destination) {
    $ExistingManifest = Join-Path $Destination "lib\sigil\runtime\manifest.json"
    if (-not (Test-Path $ExistingManifest -PathType Leaf)) { throw "Existing installation is corrupt." }
    if ((Get-FileHash $ExistingManifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ManifestHash) { throw "Existing installation has a different runtime manifest." }
  } else {
    Move-Item $Source $Destination
  }
  & (Join-Path $Destination "bin\sigil.exe") doctor --format json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Runtime doctor failed; existing installation remains selected." }
  $Wrapper = Join-Path $BinDir "sigil.cmd"
  $WrapperTemp = "$Wrapper.$PID.tmp"
  Set-Content -Path $WrapperTemp -Encoding Ascii -Value "@echo off`r`n`"$(Join-Path $Destination 'bin\sigil.exe')`" %*"
  Move-Item -Force $WrapperTemp $Wrapper
  Write-Host "Installed Sigil $Version to $Destination"
} finally {
  if (Test-Path $Temp) { Remove-Item -Recurse -Force $Temp }
}
