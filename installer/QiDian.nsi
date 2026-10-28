Unicode true
!include "version.nsh"
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

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

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  SetShellVarContext current
  IfFileExists "$PROGRAMFILES32\Microsoft\EdgeWebView\Application\*.*" webview2_ok
  IfFileExists "$PROGRAMFILES64\Microsoft\EdgeWebView\Application\*.*" webview2_ok
  IfFileExists "$LOCALAPPDATA\Microsoft\EdgeWebView\Application\*.*" webview2_ok
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION "未检测到 Microsoft Edge WebView2 运行时。$\r$\n$\r$\nWindows 11 默认已内置；Windows 10 请先安装 WebView2 后再运行启点。点击“确定”继续安装，或点击“取消”退出。" IDOK webview2_ok
  Abort
  webview2_ok:
FunctionEnd

Section "主程序（必需）" SecMain
  SectionIn RO
  SetShellVarContext current
  SetOutPath "$INSTDIR"

  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM QiDian.exe /F'
  Sleep 300

  File /oname=QiDian.exe "../../qidian-build/QiDian.exe"
  WriteUninstaller "$INSTDIR\uninst.exe"

  CreateDirectory "$SMPROGRAMS\启点"
  CreateShortCut "$SMPROGRAMS\启点\启点.lnk" "$INSTDIR\QiDian.exe" "" "$INSTDIR\QiDian.exe" 0
  CreateShortCut "$SMPROGRAMS\启点\卸载 启点.lnk" "$INSTDIR\uninst.exe"

  WriteRegStr HKCU "Software\QiDian" "InstallDir" "$INSTDIR"
  ; 升级时保留用户上次的 AI 选择；仅在首次安装时写入默认关闭。
  ClearErrors
  ReadRegDWORD $0 HKCU "Software\QiDian" "AiEnabled"
  ${If} ${Errors}
    WriteRegDWORD HKCU "Software\QiDian" "AiEnabled" 0
  ${EndIf}
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

Section /o "本地 AI 助手（可选，约 1.2 GB）" SecAi
  SetShellVarContext current
  ; 只记录安装偏好；运行时与模型在首次打开「AI」页时按需下载，避免安装包膨胀。
  WriteRegDWORD HKCU "Software\QiDian" "AiEnabled" 1
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "安装启点主程序、开始菜单快捷方式、应用索引与卸载程序，并以管理员权限运行。"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "在桌面创建“启点”快捷方式；默认不勾选，保持桌面干净。"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAi} "启用本地 AI 助手：Qwen2.5-1.5B 问答与工具调用、Whisper 语音识别，全部在本机运行。安装包不包含模型，首次打开 AI 页时从 GitHub / Hugging Face 下载约 1.2 GB。"
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
