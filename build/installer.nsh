; Custom NSIS hooks for the Blockhost installer (electron-builder `nsis.include`).

; electron-builder hides the details list and prints nothing; show what Setup is doing.
!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Blockhost ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "Setup will install Blockhost, a desktop app for creating and running Minecraft servers on this PC.$\r$\n$\r$\nYour servers live in Documents\MinecraftServers and your settings and backups in %APPDATA%\Blockhost. Setup doesn't touch either, so updating or reinstalling keeps them.$\r$\n$\r$\nIf Blockhost is open, Setup will close it first.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Defining customCheckAppRunning makes electron-builder skip these two, so declare them here.
; This wraps its internal _CHECK_APP_RUNNING; recheck it when upgrading electron-builder.
!include "getProcessInfo.nsh"
Var pid

; Runs inside the install section, after electron-builder turns detail printing off and
; before the old version is removed and the new files are extracted.
!macro customCheckAppRunning
  SetDetailsPrint both
  DetailPrint "Installing Blockhost ${VERSION} to $INSTDIR"
  DetailPrint "Checking whether Blockhost is running..."
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  DetailPrint "Removing the previous version, if any..."
  DetailPrint "Copying Blockhost files..."
  SetDetailsPrint listonly
!macroend

!macro customInstall
  SetDetailsPrint both
  DetailPrint "Added Blockhost to the Start menu and the desktop"
  DetailPrint "Registered the uninstaller in Settings > Apps"
  DetailPrint "Blockhost ${VERSION} is installed."
!macroend

; The uninstaller also runs silently (/S) during updates, so these pages only show when
; the user uninstalls from Settings > Apps, and servers are never deleted by an update.
!ifdef BUILD_UNINSTALLER
  !include nsDialogs.nsh

  Var unServersDir
  Var unDeleteServers
  Var unDeleteServersBox
!endif

; Inserted where electron-builder declares the uninstaller's pages, after its own
; variables (like $installMode) exist, so the servers page's functions live here too.
!macro customUnWelcomePage
  ; The default servers folder (index.ts serversDir); servers made elsewhere aren't touched.
  Function un.findServersDir
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    StrCpy $unServersDir "$DOCUMENTS\MinecraftServers"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  FunctionEnd

  Function un.serversPage
    Call un.findServersDir
    ${ifNot} ${FileExists} "$unServersDir\*.*"
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "Your servers" "Choose whether to keep your Minecraft servers."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 40u "Your servers and their worlds are in $unServersDir. They're kept unless you choose to delete them, so reinstalling Blockhost picks them up again.$\r$\n$\r$\nServers you created in other folders are always kept."
    Pop $0
    ${NSD_CreateCheckbox} 0 48u 100% 12u "&Delete my servers and their worlds (this can't be undone)"
    Pop $unDeleteServersBox
    ${if} $unDeleteServers == "1"
      ${NSD_Check} $unDeleteServersBox
    ${endif}
    nsDialogs::Show
  FunctionEnd

  Function un.serversPageLeave
    StrCpy $unDeleteServers "0"
    ${NSD_GetState} $unDeleteServersBox $0
    ${if} $0 == ${BST_CHECKED}
      ${if} ${Cmd} `MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Delete every server in $unServersDir, including their worlds?$\r$\n$\r$\nThis can't be undone." IDNO`
        Abort
      ${endif}
      StrCpy $unDeleteServers "1"
    ${endif}
  FunctionEnd

  !define MUI_WELCOMEPAGE_TITLE "Uninstall Blockhost ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "This will remove Blockhost from this PC.$\r$\n$\r$\nOn the next page you can choose whether to keep your servers. Your settings and backups in %APPDATA%\Blockhost are kept.$\r$\n$\r$\nIf Blockhost is open, it will be closed first.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.serversPage un.serversPageLeave
!macroend

; Runs inside the uninstall section, before the files and shortcuts are removed.
!macro customUnInstall
  DetailPrint "Removing Blockhost ${VERSION} from $INSTDIR"
  DetailPrint "Removing the Start menu and desktop shortcuts..."
  DetailPrint "Removing Blockhost from Settings > Apps..."
!macroend

; A section after electron-builder's, so this runs once the app itself is gone.
!macro customUnInstallSection
  Section "un.Done"
    ${if} $unDeleteServers == "1"
      DetailPrint "Deleting your servers in $unServersDir..."
      RMDir /r "$unServersDir"
      ${if} ${FileExists} "$unServersDir\*.*"
        DetailPrint "Some server files couldn't be deleted. A server may still be running; delete $unServersDir yourself."
      ${endif}
      DetailPrint "Blockhost is uninstalled. Your settings and backups were kept."
    ${else}
      DetailPrint "Blockhost is uninstalled. Your servers, settings and backups were kept."
    ${endif}
  SectionEnd
!macroend
