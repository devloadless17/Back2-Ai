@echo off
setlocal

rem  Drag a PDF onto this file, or double-click it and type the path.
rem  It reads the book, then checks the result.

cd /d "%~dp0..\.."

echo ============================================
echo   OCR a book
echo ============================================
echo.

if not exist ".env" (
  echo   ERROR: no .env file in %CD%
  echo   Ask the team for the keys before running this.
  echo.
  pause
  exit /b 1
)

set "PDF=%~1"
if "%PDF%"=="" (
  set /p "PDF=Drag the PDF here and press Enter: "
)

rem Strip quotes a drag-and-drop may add
set PDF=%PDF:"=%

if not exist "%PDF%" (
  echo.
  echo   ERROR: cannot find that file:
  echo   %PDF%
  echo.
  pause
  exit /b 1
)

set "PAGES=%~2"
if "%PAGES%"=="" (
  echo.
  echo   Whole book, or just some pages?
  echo     - press Enter for the whole book
  echo     - or type a range like  1-30
  echo.
  set /p "PAGES=Pages: "
)

echo.
echo   File:  %PDF%
if "%PAGES%"=="" (echo   Pages: all) else (echo   Pages: %PAGES%)
echo.
echo   Starting. A big book takes a few minutes - do not close this window.
echo.

if "%PAGES%"=="" (
  call npm run corpus:mathpix -- --file "%PDF%"
) else (
  call npm run corpus:mathpix -- --file "%PDF%" --pages %PAGES%
)

if errorlevel 1 (
  echo.
  echo   The OCR step failed. Read the message above, then see
  echo   scripts\corpus\README.md section "When something goes wrong".
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Checking the pages
echo ============================================
echo.

call npm run corpus:gates

echo.
echo ============================================
echo   Done.
echo.
echo   The text is in    corpus\text\
echo   The report is in  corpus\meta\
echo.
echo   Next: open 5 of the page files and compare
echo   them to the same pages in the PDF, then send
echo   everything above to the team.
echo ============================================
echo.
pause
