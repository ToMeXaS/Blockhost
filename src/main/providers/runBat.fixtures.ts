// Verbatim run.bat output of the Forge 26.3-66.0.13 and NeoForge 26.3.0.88 installers.
export const FORGE_RUN_BAT = [
  '@echo off',
  'REM Add custom JVM arguments (such as RAM allocation) to the user_jvm_args.txt',
  '',
  'java -jar forge-26.3-66.0.13-shim.jar --onlyCheckJava',
  'if %ERRORLEVEL% NEQ 0 (',
  '    echo.',
  '    goto :exit',
  ')',
  '',
  'REM Add custom program arguments (such as nogui) to the next line before the %* or pass them to this script directly',
  'java @user_jvm_args.txt @libraries/net/minecraftforge/forge/26.3-66.0.13/win_args.txt %*',
  '',
  ':exit',
  'pause'
].join('\r\n')

export const NEO_RUN_BAT = [
  '@echo off',
  'REM Forge requires a configured set of both JVM and program arguments.',
  'java @user_jvm_args.txt @libraries/net/neoforged/neoforge/26.3.0.88/win_args.txt %*',
  'pause'
].join('\r\n')
