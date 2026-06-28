@echo off
REM ---------------------------------------------------------------------------
REM Builds the SMALL release APK and drops it on the Desktop.
REM
REM Why a script (not Gradle config): Flutter's Gradle plugin force-sets the APK's
REM ndk abiFilters to all target ABIs, overriding anything in build.gradle.kts, so
REM per-ABI splitting MUST be a build flag. --split-per-abi yields arm64-v8a (~18MB)
REM instead of the ~53MB universal APK; arm64-v8a covers every modern phone.
REM
REM Note: the Android buildDir is redirected to C:\digygo_build (see
REM android\build.gradle.kts), so Flutter prints "failed to produce an .apk" /
REM points at mobile\build, but the real APKs land in C:\digygo_build. We copy from
REM there and don't trust Flutter's exit code for that reason.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

call flutter build apk --release --split-per-abi --obfuscate ^
  --split-debug-info=build\symbols ^
  --dart-define=DIGYGO_API=https://crm.digygo.in

set "APK=C:\digygo_build\app\outputs\flutter-apk\app-arm64-v8a-release.apk"
set "DEST=%USERPROFILE%\OneDrive\Desktop\DigyGo-Dialer-LIVE.apk"

if exist "%APK%" (
  copy /Y "%APK%" "%DEST%" >nul
  echo.
  echo  Done: small arm64-v8a APK copied to Desktop as DigyGo-Dialer-LIVE.apk
  echo  ^(armeabi-v7a build for old 32-bit phones is in C:\digygo_build\app\outputs\flutter-apk\^)
) else (
  echo.
  echo  ERROR: expected APK not found at %APK%
  echo  Check the build output above.
)
