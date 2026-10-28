@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM ============================================================================
REM VCompress release builder: builds BOTH release variants in one run.
REM
REM   VCompress-Fast        ffmpeg/btbn/ffmpeg.exe  (needs Nvidia driver 610+)
REM   VCompress-Compatible  ffmpeg/gyan/ffmpeg.exe  (driver ~537+, GTX 10xx ok)
REM
REM Usage:
REM   build-release.bat            build both variants
REM   build-release.bat fast       build only Fast
REM   build-release.bat compatible build only Compatible
REM
REM Output: dist\VCompress-Fast-win64.zip
REM         dist\VCompress-Compatible-win64.zip
REM Plus the unpacked folders dist\fast\ and dist\compatible\ for inspection.
REM ============================================================================

set "ONLY=%~1"
set "APPDIR=%~dp0"
if "%APPDIR:~-1%"=="\" set "APPDIR=%APPDIR:~0,-1%"
set "DIST=%APPDIR%\dist"

REM Guard: no running VCompress/electron (builder fails on locked exe)
tasklist /FI "IMAGENAME eq VCompress.exe" 2>nul | find /I "VCompress.exe" >nul && (
    echo ERROR: VCompress.exe is running - close it before building.
    exit /b 1
)

REM Guard: both variant binaries must exist
if not exist "%APPDIR%\ffmpeg\btbn\ffmpeg.exe" (
    echo ERROR: ffmpeg\btbn\ffmpeg.exe not found - put the BtbN build there.
    exit /b 1
)
if not exist "%APPDIR%\ffmpeg\gyan\ffmpeg.exe" (
    echo ERROR: ffmpeg\gyan\ffmpeg.exe not found - put the gyan build there.
    exit /b 1
)

set "BUILT=0"

REM ---------------------------------------------------------------------------
if /I not "%ONLY%"=="compatible" call :BuildVariant fast    "VCompress-Fast"        "%APPDIR%\ffmpeg\btbn\ffmpeg.exe" || exit /b 1
if /I not "%ONLY%"=="fast"       call :BuildVariant compatible "VCompress-Compatible"  "%APPDIR%\ffmpeg\gyan\ffmpeg.exe" || exit /b 1

echo.
echo ================================================================================
if "%BUILT%"=="2" echo Done: both zips are in dist\
exit /b 0
REM ---------------------------------------------------------------------------

:BuildVariant
set "VARKEY=%~1"
set "VARNAME=%~2"
set "VARFFMPEG=%~3"
echo.
echo === Building %VARNAME% (ffmpeg: %VARFFMPEG%) ===

REM 1. Put the variant's ffmpeg into the source tree the builder reads
copy /Y "%VARFFMPEG%" "%APPDIR%\ffmpeg\bin\ffmpeg.exe" >nul || exit /b 1

REM 2. Build the portable folder
cd /D "%APPDIR%"
call npx electron-builder --win --x64 || exit /b 1
if not exist "%DIST%\win-unpacked\VCompress.exe" (
    echo ERROR: builder produced no VCompress.exe
    exit /b 1
)

REM 3. Embed the window icon (Explorer taskbar/title) — electron-builder's
REM    own embed misses the icon-group resource Windows wants.
"%APPDIR%\node_modules\rcedit\bin\rcedit-x64.exe" "%DIST%\win-unpacked\VCompress.exe" --set-icon "%APPDIR%\build\icon.ico" || exit /b 1

REM 4. Move the unpacked folder to its variant name and zip it
if exist "%DIST%\%VARKEY%" rmdir /S /Q "%DIST%\%VARKEY%"
move /Y "%DIST%\win-unpacked" "%DIST%\%VARKEY%" >nul || exit /b 1
if exist "%DIST%\%VARNAME%-win64.zip" del /Q "%DIST%\%VARNAME%-win64.zip"
REM Zip via the dedicated PS script: inline powershell -Command strings
REM get mangled by the cmd/bash quoting layers around this builder.
pushd "%APPDIR%"
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File make-zip.ps1 -SourceDir dist\!VARKEY! -ZipPath dist\!VARNAME!-win64.zip || (popd & exit /b 1)
popd

echo     zip ready: see dist folder
set /A BUILT+=1
exit /b 0
