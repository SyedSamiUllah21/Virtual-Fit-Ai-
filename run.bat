@echo off
echo ===================================================
echo 🚀 Starting VTONX Full Stack Application
echo ===================================================

echo.
echo ➡️  Starting Flask backend (Port 5000)...
start "VTONX Backend Server" cmd /k "title VTONX Backend && cd Code && ..\\.venv\\Scripts\\python.exe app.py"

timeout /t 3 /nobreak >nul

echo ➡️  Starting React frontend (Port 3000)...
start "VTONX Frontend Server" cmd /k "title VTONX Frontend && cd Frontend && npm run dev"

echo.
echo ✅ Both servers successfully launched in separate windows!
echo.
echo   🌐 Frontend web app: http://localhost:3000
echo   ⚙️  Backend API:      http://127.0.0.1:5000
echo.
echo You can close this particular window now. To stop the application later, simply close the two newly opened command prompt windows.
echo ===================================================
pause
