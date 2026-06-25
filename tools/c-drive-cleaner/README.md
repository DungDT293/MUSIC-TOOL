# C Drive Cleaner

Tool PowerShell nho de quet va don cache an toan tren o C.

## Cau truc folder

```text
c-drive-cleaner/
  01-personal-pc/   Chay tren may ca nhan/dev workstation
  02-vps/           Chay tren VPS Windows
  scripts/          PowerShell logic chinh
  logs/             Log cua VPS cleaner
  README.md
```

## Cach dung nhanh

May ca nhan: mo `01-personal-pc` va chay mot trong cac file:

- `scan-only.bat`: chi quet, khong xoa gi.
- `clean-safe-cache.bat`: don cache an toan, khong tu dong tat Chrome/CapCut.
- `clean-aggressive-safe.bat`: don rong hon, them browser/dev/app cache, khong tu dong tat Chrome/CapCut.
- `clean-interactive.bat`: hoi xac nhan truoc khi don.

VPS: mo `02-vps` va chay:

- `vps-scan-dryrun.bat`: VPS dry-run, khong xoa gi.
- `vps-clean-execute.bat`: VPS cleanup that, chi don file cu trong temp/WER/crash dump.
- `vps-clean-dev-execute.bat`: VPS cleanup that kem dev cache, chi dung neu server la may build/dev.

Hoac chay PowerShell truc tiep tu repo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -ScanOnly
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanAllSafe
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanAllSafe -Force
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -AggressiveSafe -Force
```

## Tuy chon nang cao

Don rieng tung nhom:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanPip -Force
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanNpm -Force
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanChrome -Force
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanBrowsers -Force
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanDevCaches -Force
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanAppCaches -Force
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanCapCut -Force
```

## Che do aggressive safe

`-AggressiveSafe` gom cac nhom sau:

- pip, npm, temp
- Chrome, Edge, Brave, Firefox cache
- CapCut cache
- Yarn, pnpm, Gradle, NuGet, Cargo, Playwright cache
- Crash dumps, Direct3D/NVIDIA shader cache, VS Code/Cursor cache

Che do nay chi xoa cache co the tao lai. App dang mo se bi skip cache bi khoa, tru khi ban chay them flag stop rieng.

Neu muon tool tu dong tat app de don cache bi khoa:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanChrome -StopChrome -Force
powershell -NoProfile -ExecutionPolicy Bypass -File tools\c-drive-cleaner\scripts\c-drive-cleaner.ps1 -CleanCapCut -StopCapCut -Force
```

## Nguyen tac an toan

- Khong xoa file ca nhan nhu Desktop, Documents, Downloads.
- Khong xoa Cookies, History, Login Data cua Chrome.
- Khong xoa Cookies, History, Login Data cua Edge/Brave/Firefox.
- Khong tu dong tat Chrome/CapCut neu khong co flag `-StopChrome` hoac `-StopCapCut`.
- Truoc khi xoa de quy, script kiem tra path phai nam trong cac thu muc cache/temp duoc phep.

## VPS

Dung file rieng `vps-c-drive-cleaner.ps1` cho VPS. Mac dinh file nay la dry-run, muon xoa that phai co `-Execute`.

Chay nhanh bang `.bat`:

```powershell
02-vps\vps-scan-dryrun.bat
02-vps\vps-clean-execute.bat
```

Khong nen chay `clean-aggressive-safe.bat` tren VPS. File do danh cho may ca nhan/dev workstation.
