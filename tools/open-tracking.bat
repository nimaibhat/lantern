@echo off
rem Opens the Tracking page in its own Chrome window that may speak without a click first. Demo laptops only:
rem that window lets any site play sound on its own. Double-click to run; edit the two lines below first.

rem The hub laptop's address (localhost on the hub itself), and this laptop's name as the Tracking page shows it.
rem Use + for spaces, e.g. Living+room.
set HUB=localhost
set LAPTOP=Hallway

set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" (
  echo Chrome was not found on this laptop.
  pause
  exit /b 1
)

rem A separate profile, so the setting applies even while normal Chrome is open
start "" "%CHROME%" --user-data-dir="%LocalAppData%\LanternChrome" --autoplay-policy=no-user-gesture-required --no-first-run "http://%HUB%:3000/dashboard/tracking?laptop=%LAPTOP%"
