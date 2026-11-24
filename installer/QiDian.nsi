Unicode true
!include "version.nsh"
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"

ManifestDPIAware true
; 启点需要读取全部用户应用、系统信息并支持深度内存释放，安装与运行都按管理员权限执行。
RequestExecutionLevel admin
CRCCheck on
SetCompressor /SOLID lzma
SetCompressorDictSize 32
ShowInstDetails show
ShowUninstDetails show

Name "启点"
Caption "启点安装程序"
OutFile "../../qidian-build/QiDian-Setup-${APP_VERSION}-x64.exe"
BrandingText "启点 · 本地应用启动台"

VIProductVersion "${APP_VERSION_4}"
VIAddVersionKey /LANG=2052 "ProductName" "启点"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION_4}"
VIAddVersionKey /LANG=2052 "CompanyName" "QiDian"
VIAddVersionKey /LANG=2052 "FileDescription" "启点安装程序"
VIAddVersionKey /LANG=2052 "LegalCopyright" "QiDian"

InstallDir "$LOCALAPPDATA\Programs\QiDian"
InstallDirRegKey HKCU "Software\QiDian" "InstallDir"

!define MUI_ICON "../src-tauri/icons/icon.ico"
!define MUI_UNICON "../src-tauri/icons/icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装 启点"
!define MUI_WELCOMEPAGE_TEXT "启点会自动扫描本机开始菜单、桌面与任务栏快捷方式、卸载注册表、App Paths 与 Microsoft Store 应用，按分类整理成启动台。$\r$\n$\r$\n安装程序与启点将以管理员权限运行，用于完整扫描所有用户的应用、读取磁盘与进程信息，并支持深度释放内存。$\r$\n$\r$\n安装不会创建桌面快捷方式（可在下一步选择），程序不常驻后台。$\r$\n$\r$\n需要 Windows 10 1809 或更高版本；Windows 11 已内置 WebView2。"
!define MUI_DIRECTORYPAGE_TEXT_TOP "启点将安装到下面的目录。默认安装到当前用户目录，安装程序与主程序以管理员权限运行。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\QiDian.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 启点"

; 自动更新传入 /P（passive，仅显示进度）或 /S（完全静默）。
; 这两种模式下跳过欢迎、目录、组件与完成页，只保留进度页。
Var SilentMode
Var RestartAfter

Function SkipIfSilent
  ${If} $SilentMode != "interactive"
    Abort
  ${EndIf}
FunctionEnd

; MUI 每插入一个页面就会消费掉该宏，因此每个需要跳过的页面都要单独定义一次。
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfSilent
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfSilent
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfSilent
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfSilent
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

Section "主程序（必需）" SecMain
  SectionIn RO
  SetShellVarContext current
  SetOutPath "$INSTDIR"

  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM QiDian.exe /F'
  Sleep 600
  ; 覆盖升级：旧文件被占用时先尝试删除，再由 File 写入新版本。
  Delete "$INSTDIR\QiDian.exe"

  File /oname=QiDian.exe "../../qidian-build/QiDian.exe"
  WriteUninstaller "$INSTDIR\uninst.exe"

  CreateDirectory "$SMPROGRAMS\启点"
  CreateShortCut "$SMPROGRAMS\启点\启点.lnk" "$INSTDIR\QiDian.exe" "" "$INSTDIR\QiDian.exe" 0
  CreateShortCut "$SMPROGRAMS\启点\卸载 启点.lnk" "$INSTDIR\uninst.exe"

  WriteRegStr HKCU "Software\QiDian" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian" "DisplayName" "启点"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian" "DisplayIcon" "$INSTDIR\QiDian.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian" "Publisher" "QiDian"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian" "UninstallString" '"$INSTDIR\uninst.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian" "QuietUninstallString" '"$INSTDIR\uninst.exe" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian" "NoRepair" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian" "EstimatedSize" 4000
SectionEnd

Section /o "桌面快捷方式（可选）" SecDesktop
  SetShellVarContext current
  CreateShortCut "$DESKTOP\启点.lnk" "$INSTDIR\QiDian.exe" "" "$INSTDIR\QiDian.exe" 0
SectionEnd

; 放在最后执行：等所有快捷方式写完后统一刷新 Explorer 图标缓存，
; 否则升级后开始菜单 / 任务栏 / 桌面仍可能显示旧版图标。
Section "-刷新图标缓存"
  nsExec::ExecToLog '"$SYSDIR\ie4uinit.exe" -show'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
SectionEnd

; 自动更新以 /R 传入时，安装完成后重新启动启点。
Section "-更新后重启"
  ${If} $RestartAfter == 1
    Exec '"$INSTDIR\QiDian.exe"'
  ${EndIf}
SectionEnd

Function .onInit
  SetShellVarContext current
  StrCpy $SilentMode "interactive"
  StrCpy $RestartAfter "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/S" $R1
  ${IfNot} ${Errors}
    StrCpy $SilentMode "silent"
  ${Else}
    ClearErrors
    ${GetOptions} $R0 "/P" $R1
    ${IfNot} ${Errors}
      StrCpy $SilentMode "passive"
    ${EndIf}
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/R" $R1
  ${IfNot} ${Errors}
    StrCpy $RestartAfter "1"
  ${EndIf}
  ${If} $SilentMode == "silent"
    SetSilent silent
  ${EndIf}
  IfFileExists "$PROGRAMFILES32\Microsoft\EdgeWebView\Application\*.*" webview2_ok
  IfFileExists "$PROGRAMFILES64\Microsoft\EdgeWebView\Application\*.*" webview2_ok
  IfFileExists "$LOCALAPPDATA\Microsoft\EdgeWebView\Application\*.*" webview2_ok
  ; /SD 保证自动更新（/S 或 /P）时不会卡在提示框上。
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION|MB_DEFBUTTON1 "未检测到 Microsoft Edge WebView2 运行时。$\r$\n$\r$\nWindows 11 默认已内置；Windows 10 请先安装 WebView2 后再运行启点。点击“确定”继续安装，或点击“取消”退出。" /SD IDOK IDOK webview2_ok
  Abort
  webview2_ok:
FunctionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "安装启点主程序、开始菜单快捷方式、应用索引与卸载程序，并以管理员权限运行。"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "在桌面创建“启点”快捷方式；默认不勾选，保持桌面干净。"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  SetShellVarContext current
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM QiDian.exe /F'
  Sleep 300

  nsExec::ExecToLog '"$SYSDIR\schtasks.exe" /Delete /TN "QiDian" /F'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "QiDian"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "QiDian"
  Delete "$DESKTOP\启点.lnk"
  Delete "$SMPROGRAMS\启点\启点.lnk"
  Delete "$SMPROGRAMS\启点\卸载 启点.lnk"
  RMDir "$SMPROGRAMS\启点"

  Delete "$INSTDIR\QiDian.exe"
  Delete "$INSTDIR\uninst.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QiDian"
  DeleteRegKey HKCU "Software\QiDian"

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除启点的应用索引、图标缓存和设置？$\r$\n选择“否”会保留这些数据，方便以后重新安装。" /SD IDNO IDNO KeepData
  RMDir /r "$LOCALAPPDATA\com.qidian.launcher"
  KeepData:
SectionEnd
