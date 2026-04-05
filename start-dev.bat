@echo off
echo ============================================
echo   CodeClinic Dev Server Startup
echo ============================================
echo.

REM Step 1: Start Docker Desktop if not running
echo [1/5] Starting Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
echo     Waiting 20 seconds for Docker to start...
timeout /t 20 /nobreak > nul

REM Step 2: Start postgres + redis
echo [2/5] Starting database and cache...
docker compose up -d postgres redis
echo     Waiting 8 seconds for DB to be ready...
timeout /t 8 /nobreak > nul

REM Step 3: Run migrations
echo [3/5] Running database migrations...
cd packages\database
call npx prisma migrate deploy
cd ..\..

REM Step 4: Seed if needed (safe to run multiple times)
echo [4/5] Seeding database (safe to re-run)...
cd packages\database
set DATABASE_URL=postgresql://codeclinic:codeclinic_dev@localhost:5432/codeclinic
call npx tsx prisma/seed.ts
cd ..\..

REM Step 5: Open two terminals - API and Web
echo [5/5] Starting API and Web servers...
start "CodeClinic API" cmd /k "cd apps\api && pnpm dev"
timeout /t 3 /nobreak > nul
start "CodeClinic Web" cmd /k "cd apps\web && npx next dev -p 3000"

echo.
echo ============================================
echo   All services starting!
echo   Web:  http://localhost:3000
echo   API:  http://localhost:4000
echo   Login: admin@codeclinic.ug / Admin@2024!
echo ============================================
pause
