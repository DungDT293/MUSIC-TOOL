!macro customInit
  ; Ngăn cài lại cùng 1 version (v1.0.0) trên cùng máy
  Var /GLOBAL AlreadyInstalledVersion
  ReadRegStr $AlreadyInstalledVersion HKCU "Software\\93MediaToolMixNhac" "Version"
  ${If} $AlreadyInstalledVersion != ""
    ${If} $AlreadyInstalledVersion == "${VERSION}"
      MessageBox MB_ICONSTOP "Phiên bản hiện tại (${VERSION}) đã được cài trên máy này. Chỉ có thể cài bản nâng cấp mới hơn."
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ; Ghi version đã cài vào registry để lần sau kiểm tra
  WriteRegStr HKCU "Software\\93MediaToolMixNhac" "Version" "${VERSION}"
!macroend

!macro customUnInstall
  ; Xoá dấu version khi gỡ cài đặt
  DeleteRegKey HKCU "Software\\93MediaToolMixNhac"
!macroend

!macro customInstallMode
!macroend

!macro customUnInstallMode
!macroend

!macro customFinish
  ; Sau khi cài đặt xong thì tự xoá file installer (nếu có quyền)
  ; Cách ổn định hơn: tạo 1 file .bat tạm, chờ vài giây rồi xoá EXEPATH và tự xoá chính nó.
  StrCpy $0 "$TEMP\_delete_93media_installer.bat"
  FileOpen $1 "$0" w
  ; Đợi ~3s
  FileWrite $1 'ping 127.0.0.1 -n 3 >nul$\r$\n'
  ; Xoá file installer
  FileWrite $1 'del /f /q "$EXEPATH"$\r$\n'
  ; Xoá luôn batch script
  FileWrite $1 'del /f /q "%~f0"$\r$\n'
  FileClose $1
  Exec '"$0"'
  
  ; Tạo shortcuts cho Uninstaller và Diagnostic
  CreateDirectory "$SMPROGRAMS\93 Media Tool"
  CreateShortcut "$SMPROGRAMS\93 Media Tool\Gỡ Cài Đặt Hoàn Toàn.lnk" "$INSTDIR\resources\scripts\uninstall-complete.bat" "" "$INSTDIR\resources\scripts\uninstall-complete.bat" 0
  CreateShortcut "$SMPROGRAMS\93 Media Tool\Chẩn Đoán Lỗi.lnk" "$INSTDIR\resources\scripts\diagnose-app.bat" "" "$INSTDIR\resources\scripts\diagnose-app.bat" 0
!macroend


