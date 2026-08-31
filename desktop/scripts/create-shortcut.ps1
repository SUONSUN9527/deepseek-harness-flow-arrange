# Creates a "DeepSeek Harness" shortcut on the current user's desktop.
# Targets electron.exe directly, so double-click opens no console window.
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) {
  Write-Host '[ERROR] Electron not installed yet. Run the launcher .bat once first.'
  exit 1
}
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$lnkPath = Join-Path $desktop 'DeepSeek Harness.lnk'
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $electron
$lnk.Arguments = '"' + $root + '"'
$lnk.WorkingDirectory = $root
$lnk.IconLocation = (Join-Path $root 'app.ico') + ',0'
$lnk.Description = 'DeepSeek Harness Desktop'
$lnk.Save()
Write-Host ('Shortcut created: ' + $lnkPath)
