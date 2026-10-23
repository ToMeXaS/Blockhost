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

; The uninstaller also runs silently (/S) during updates, so these only show when the
; user uninstalls from Settings > Apps.
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Uninstall Blockhost ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "This will remove Blockhost from this PC.$\r$\n$\r$\nYour servers in Documents\MinecraftServers and your settings and backups in %APPDATA%\Blockhost are kept, so reinstalling picks up where you left off. Delete those folders yourself if you no longer need them.$\r$\n$\r$\nIf Blockhost is open, it will be closed first.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

; Runs inside the uninstall section, before the files and shortcuts are removed.
!macro customUnInstall
  DetailPrint "Removing Blockhost ${VERSION} from $INSTDIR"
  DetailPrint "Removing the Start menu and desktop shortcuts..."
  DetailPrint "Removing Blockhost from Settings > Apps..."
!macroend

; A section after electron-builder's, so this prints once everything is gone.
!macro customUnInstallSection
  Section "un.Done"
    DetailPrint "Blockhost is uninstalled. Your servers, settings and backups were kept."
  SectionEnd
!macroend
