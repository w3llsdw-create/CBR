@echo off
echo ====================================================
echo   RESTORING FILES FROM WORKING STATE BACKUP
echo ====================================================
echo.
echo This will restore all files to the state before 
echo adding colleague task features.
echo.
pause

Copy-Item "backups_working_state\board.html.backup" "static\board.html"
Copy-Item "backups_working_state\board.js.backup" "static\board.js"
Copy-Item "backups_working_state\tv.html.backup" "static\tv.html"
Copy-Item "backups_working_state\tv.js.backup" "static\tv.js"
Copy-Item "backups_working_state\app.py.backup" "app.py"
Copy-Item "backups_working_state\styles.css.backup" "static\styles.css"

echo.
echo Files restored successfully!
echo You may need to restart the caseboard application.
echo.
pause