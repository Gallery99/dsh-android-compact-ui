# 一键发布到 GitHub
#
# 用法（在本目录下打开 PowerShell）：
#   1. 先改下面的 $Owner，或者在运行前设置环境变量 $env:GH_OWNER
#   2. 运行： powershell -ExecutionPolicy Bypass -File publish.ps1
#
# 前提：已在浏览器登录 GitHub 并创建了同名的空仓库，或者有 Personal Access Token。
#
# 这个脚本会：
#   - 把 package.json / README 里的 OWNER 占位符换成你的用户名
#   - 提交这次替换
#   - 添加 remote 并推送
#
# 如果仓库还不存在，脚本会用 gh CLI 创建（需要先装 gh：winget install GitHub.cli）

param(
    [string]$Owner = $env:GH_OWNER,
    [string]$Repo  = "dsh-android-compact-ui",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not $Owner) {
    Write-Host "缺少 GitHub 用户名。" -ForegroundColor Yellow
    Write-Host "  方式一：设置环境变量  `$env:GH_OWNER = '你的用户名'"
    Write-Host "  方式二：编辑本文件顶部的 param 默认值"
    exit 1
}

Write-Host "仓库所有者: $Owner" -ForegroundColor Cyan

# ---- 1. 替换占位符 ----
$changed = $false
foreach ($f in @("package.json", "README.md")) {
    if (-not (Test-Path $f)) { continue }
    $text = [System.IO.File]::ReadAllText((Resolve-Path $f), [System.Text.Encoding]::UTF8)
    if ($text -match 'OWNER') {
        $text = $text -replace 'OWNER', $Owner
        [System.IO.File]::WriteAllText((Resolve-Path $f), $text, (New-Object System.Text.UTF8Encoding $false))
        Write-Host "  已更新 $f" -ForegroundColor Green
        $changed = $true
    }
}

if ($changed) {
    & git add package.json README.md
    & git -c user.name="$Owner" -c user.email="$Owner@users.noreply.github.com" commit -m "chore: point repository metadata at $Owner" | Out-Null
}

# ---- 2. 检查是否已有 remote ----
$remotes = & git remote
if ($remotes -notcontains "origin") {
    & git remote add origin "https://github.com/$Owner/$Repo.git"
    Write-Host "  已添加 remote origin" -ForegroundColor Green
}

# ---- 3. 推送 ----
Write-Host "`n正在推送..." -ForegroundColor Cyan
& git push -u origin $Branch

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n发布成功: https://github.com/$Owner/$Repo" -ForegroundColor Green
    Write-Host "`n可选：发布到 npm" -ForegroundColor Yellow
    Write-Host "  npm publish --access public"
} else {
    Write-Host "`n推送失败。常见原因：" -ForegroundColor Red
    Write-Host "  - 仓库还没在 GitHub 上创建 → 先去 https://github.com/new 建一个空仓库"
    Write-Host "    （不要勾选 README / .gitignore / LICENSE，否则会冲突）"
    Write-Host "  - 未认证 → 首次推送会弹出浏览器登录，或改用 Token："
    Write-Host "    git remote set-url origin https://<TOKEN>@github.com/$Owner/$Repo.git"
    exit 1
}
