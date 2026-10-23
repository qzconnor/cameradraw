; Included by electron-builder into the NSIS installer (nsis.include defaults to build/installer.nsh).
;
; An update started by the app (`--updated`) runs like the one-click installer of earlier versions:
; no "for whom" page, no finish page, and the app starts again by itself. Updates from current
; versions run silently and skip all pages anyway; this covers versions that start the installer
; visibly (the one-click versions before the installer had pages).

; Keeps the mode (per user or per machine) of the installation being updated instead of asking.
!macro customInstallMode
  ${if} ${isUpdated}
    ${if} $installMode == "all"
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  ${endif}
!macroend

; Runs at the end of the install section: starts the app like the one-click installer and quits
; before the finish page.
!macro customInstall
  ${if} ${isUpdated}
  ${andIfNot} ${Silent}
    ${if} ${isForceRun}
      HideWindow
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
    ${endif}
    SetErrorLevel 0
    Quit
  ${endif}
!macroend
