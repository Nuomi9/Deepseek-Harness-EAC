; DSH Desktop (Tauri) NSIS installer hooks —— 自 build/installer.nsh（Electron 版）
; 移植的实战逻辑，按 Tauri v2 的四个钩子点重组：
;
;   NSIS_HOOK_PREINSTALL    运行中进程清理（本代+三代旧版）→ 有界等待放行 → 旧快捷方式清理
;   NSIS_HOOK_POSTINSTALL   （空）
;   NSIS_HOOK_PREUNINSTALL  再杀一次进程（静默卸载时应用可能仍在跑）→ 用户数据删除询问（默认保留）
;
; 与 Electron 版的差异（有意为之，勿"补回"）：
;   · 不做 nested-dir heal / dshTakeoverWipe：那是 Electron 三代同目录升级的
;     历史包袱；Tauri 装独立目录，重装/覆盖由 Tauri 自带的旧版本卸载步骤处理，
;     本文件绝不 RMDir $INSTDIR（误删风险 > 收益）。
;   · 卸载询问只清 Tauri 自己的数据目录（identifier + ~/.dsh-v4lite）；
;     绝不动 Electron 版数据（%APPDATA%\Deepseek Harness EAC / ~/.dsh）——
;     双轨并存期两代共用一台机器。
;   · 全程无 cmd 管道 / find / nsProcess（v4.2 教训：nsExec 在无控制台上下文
;     管道读取偶发永不返回；electron-builder 自带 NSIS 加载不了 nsProcess）。
;     探测用 nsExec 直接 CreateProcess 的 tasklist /FI CSV /NH，首字符判断。

!macro _dshKillAll
  ; 本代（安装名 + 开发调试名）
  nsExec::Exec 'taskkill /F /T /IM "Deepseek Harness EAC v4Lite.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "dsh-desktop-lite.exe"'
  Pop $0
  ; 旧代 Electron 版（并存期防互踩 DSH_HOME）
  nsExec::Exec 'taskkill /F /T /IM "Deepseek Harness EAC.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "Deepseek Harness EAC v2.0.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "Deepseek Harness EAC v1.0.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "DSH Desktop.exe"'
  Pop $0
!macroend

; 有界等待本代进程退场（最多 20 × 500ms ≈ 10s，超时放行不卡死安装）。
; 无管道：tasklist /FI 按映像名精确过滤 + /FO CSV /NH，进程存在时输出首字符
; 必为双引号，与系统语言无关。
!macro _dshWaitCurrentExits
  StrCpy $1 0
  dshWaitLoop:
    IntOp $1 $1 + 1
    ${If} $1 > 20
      DetailPrint "App process did not exit; continuing anyway"
      Goto dshWaitDone
    ${EndIf}
    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq Deepseek Harness EAC v4Lite.exe" /FO CSV /NH'
    Pop $3
    Pop $0
    StrCpy $4 $0 1
    ${If} $4 == '"'
      Sleep 500
      Goto dshWaitLoop
    ${EndIf}
  dshWaitDone:
!macroend

; 尽力删除一个目录；深层 node_modules 超 MAX_PATH 时用 robocopy 镜像空目录兜底
; （robocopy 原生支持 >260 字符路径）。
!macro dshWipeDir target
  ClearErrors
  RMDir /r "${target}"
  ${If} ${FileExists} "${target}"
    CreateDirectory "$TEMP\dsh-empty-wipe"
    nsExec::Exec 'robocopy "$TEMP\dsh-empty-wipe" "${target}" /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1'
    RMDir /r "${target}"
    RMDir "$TEMP\dsh-empty-wipe"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro _dshKillAll
  !insertmacro _dshWaitCurrentExits

  ; 清理旧代遗留快捷方式（指向已不存在的旧 exe 时任务栏图标空白，issue #14）。
  ; 当前代 "Deepseek Harness EAC v4Lite.lnk" 由标准安装步骤重建。
  Delete "$DESKTOP\Deepseek Harness EAC v2.0.lnk"
  Delete "$DESKTOP\Deepseek Harness EAC v1.0.lnk"
  Delete "$DESKTOP\DSH Desktop.lnk"
  Delete "$SMPROGRAMS\Deepseek Harness EAC v2.0.lnk"
  Delete "$SMPROGRAMS\Deepseek Harness EAC v1.0.lnk"
  Delete "$SMPROGRAMS\DSH Desktop.lnk"
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 先确保没有残留进程占用用户数据文件
  !insertmacro _dshKillAll

  ; 卸载完成前询问是否同时删除用户数据；默认「否」（保留）——
  ; 重装后设置与会话历史原样恢复。
  ; 删除范围仅限 Tauri 版自有数据：
  ;   · %APPDATA%\com.deepseek.dsh.desktop.lite —— 设置/日志/更新缓存/登录状态
  ;   · %USERPROFILE%\.dsh-v4lite               —— web profile 与全部对话记录
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "是否同时删除用户数据？$\r$\n$\r$\n将删除：$\r$\n  · 设置与登录状态（%APPDATA%\com.deepseek.dsh.desktop.lite）$\r$\n  · Web 工作目录与全部对话记录（%USERPROFILE%\.dsh-v4lite）$\r$\n$\r$\n选择「否」（推荐）则保留数据，重装后原样恢复。" \
    IDYES dshUnWipe IDNO dshUnKeep
  Goto dshUnKeep
  dshUnWipe:
    !insertmacro dshWipeDir "$APPDATA\com.deepseek.dsh.desktop.lite"
    !insertmacro dshWipeDir "$PROFILE\.dsh-v4lite"
  dshUnKeep:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
