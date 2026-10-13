@echo off
cd /d "%~dp0"
echo Mengunduh database label terbaru...
python tools\update_labels.py
pause
