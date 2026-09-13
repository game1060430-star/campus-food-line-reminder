@echo off
set PROJECT=C:\Users\indians\Documents\New project\campus_food_register_codex_project\campus_food_register_codex_project
set PYTHON=C:\Users\indians\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
if not exist "%PROJECT%\logs" mkdir "%PROJECT%\logs"
cd /d "%PROJECT%"
"%PYTHON%" "%PROJECT%\scripts\send_upload_reminders.py" >> "%PROJECT%\logs\upload_reminders.log" 2>&1
