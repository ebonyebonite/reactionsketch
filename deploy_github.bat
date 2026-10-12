@echo off
chcp 65001 >nul
rem ============================================================
rem  Web 版を GitHub Pages に公開 (更新) する
rem
rem  初回だけ:
rem   1. GitHub で公開用リポジトリを作る (例: reactionsketch、Public)
rem   2. このフォルダに deploy_target.txt を作り、リポジトリの URL を 1 行で書く
rem        例) https://github.com/<ユーザー名>/reactionsketch.git
rem   3. 公開後、リポジトリの Settings → Pages で
rem        Source: Deploy from a branch / Branch: gh-pages, / (root) を選ぶ
rem
rem  2 回目からはこの bat を実行するだけで、最新の Web 版が公開されます。
rem ============================================================
setlocal
cd /d "%~dp0"
where git >nul 2>nul || (echo git が見つかりません。& goto :error)
where npm >nul 2>nul || (echo Node.js が見つかりません。https://nodejs.org からインストールしてください。& goto :error)
if not exist deploy_target.txt (echo deploy_target.txt がありません。上の説明を読んでください。& goto :error)
set /p REPO=<deploy_target.txt

if not exist node_modules call npm install || goto :error
call npm run build || goto :error

if not exist deploy\.git (
    git clone --branch gh-pages --single-branch "%REPO%" deploy 2>nul || (
        if exist deploy rmdir /s /q deploy
        mkdir deploy
        git -C deploy init -b gh-pages || goto :error
        git -C deploy remote add origin "%REPO%" || goto :error
    )
)

robocopy dist deploy /MIR /XD .git /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :error

git -C deploy add -A || goto :error
git -C deploy commit -m "Web 版を更新" || echo (変更はありません)
git -C deploy push -u origin gh-pages || goto :error

echo.
echo 公開しました。数分後に https://ユーザー名.github.io/リポジトリ名/ に反映されます。
pause
exit /b 0

:error
echo.
echo *** 公開に失敗しました。上のメッセージを確認してください。 ***
pause
exit /b 1
