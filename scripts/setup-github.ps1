[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9-]{0,38}$')]
  [string]$Owner = 'yuanshane76-lang',
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')]
  [string]$Repository = 'pianpian',
  [switch]$CheckOnly,
  [switch]$BypassGitProxy
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = Split-Path -Parent $PSScriptRoot
$previousLocation = Get-Location
$previousGhHost = $env:GH_HOST
$env:GH_HOST = 'github.com'

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  if ($Command -eq 'git' -and $BypassGitProxy) {
    $Arguments = @(
      '-c', 'http.proxy=', '-c', 'https.proxy=',
      '-c', 'http.https://github.com/.proxy=', '-c', 'remote.origin.proxy='
    ) + $Arguments
  }
  $output = @(& $Command @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw ($output -join "`n")
  }
  return ($output -join "`n").Trim()
}

try {
  Set-Location -LiteralPath $repoRoot
  foreach ($command in @('git', 'gh', 'node', 'npm')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw "缺少 $command。请先安装 Git、GitHub CLI 和 Node.js 24。"
    }
  }

  $dirty = Invoke-Checked git @('status', '--porcelain')
  if ($dirty) {
    throw '当前工作区还有未提交改动。请只提交本任务文件，或在干净的协作 worktree 中执行；脚本不会自动暂存其他人的代码。'
  }
  $verifiedHead = Invoke-Checked git @('rev-parse', 'HEAD')
  $verifiedBranch = Invoke-Checked git @('branch', '--show-current')
  if (-not $verifiedBranch) {
    throw '当前处于 detached HEAD，请先切换到任务分支。'
  }
  Invoke-Checked node @('scripts/check-credentials.cjs') | Write-Host

  $login = Invoke-Checked gh @('api', '--hostname', 'github.com', 'user', '--jq', '.login')
  if ($login -ne $Owner) {
    throw "登录账号是 $login，预期账号是 $Owner。请确认账号；需要另一个账号时显式传入 -Owner。"
  }

  $fullName = "$Owner/$Repository"
  $expectedRemote = "https://github.com/$fullName.git"
  $repositoryUrl = "https://github.com/$fullName"
  $qualifiedRepository = "github.com/$fullName"
  $allowedRemotes = @(
    $expectedRemote,
    $repositoryUrl,
    "git@github.com:$fullName.git"
  )
  $existingRemote = @(& git remote get-url origin 2>$null)
  if ($LASTEXITCODE -eq 0) {
    if (($existingRemote -join '').Trim() -notin $allowedRemotes) {
      throw '当前 origin 指向其他仓库。请先核对；脚本不会覆盖现有远程地址。'
    }
    $pushRemotes = (Invoke-Checked git @('remote', 'get-url', '--push', '--all', 'origin')) -split "`r?`n"
    if (-not $pushRemotes.Count -or ($pushRemotes | Where-Object { $_ -notin $allowedRemotes })) {
      throw 'origin 的实际推送地址与目标私有仓库不一致。请核对 pushurl 或 pushInsteadOf；脚本不会覆盖配置或上传源码。'
    }
  } else {
    $existingRemote = @()
  }

  Write-Host "账号验证通过：$login；目标私有仓库：$fullName"
  if ($CheckOnly) {
    Write-Host '只读检查结束：没有创建仓库、推送代码或修改远程设置。'
    return
  }

  & npm run check
  if ($LASTEXITCODE -ne 0) {
    throw '本地质量检查失败，停止发布。'
  }
  if (Invoke-Checked git @('status', '--porcelain')) {
    throw '质量检查期间工作区出现变更。请核对并提交后重试。'
  }
  if ((Invoke-Checked git @('rev-parse', 'HEAD')) -ne $verifiedHead -or
      (Invoke-Checked git @('branch', '--show-current')) -ne $verifiedBranch) {
    throw '质量检查期间提交或分支发生变化。请重新检查；脚本不会发布未验证的提交。'
  }

  $repoOutput = @(& gh repo view $qualifiedRepository --json 'isPrivate,viewerPermission,url' 2>&1)
  if ($LASTEXITCODE -eq 0) {
    $repoInfo = ($repoOutput -join "`n") | ConvertFrom-Json
    if ($repoInfo.url -ne $repositoryUrl) {
      throw 'GitHub 返回的仓库主机或地址与目标不一致，停止配置。'
    }
    if (-not $repoInfo.isPrivate) {
      throw '目标仓库已经存在且不是私有仓库。脚本不会改可见性或上传代码。'
    }
    if ($repoInfo.viewerPermission -ne 'ADMIN') {
      throw '当前账号没有目标仓库的管理员权限，无法完成协作配置。'
    }
  } else {
    $repoError = $repoOutput -join "`n"
    if ($repoError -notmatch 'HTTP 404|Could not resolve to a Repository') {
      throw "无法确认目标仓库是否存在，停止创建：$repoError"
    }
    Invoke-Checked gh @(
      'repo', 'create', $fullName, '--private', '--disable-wiki',
      '--description', '篇篇 Pianpian：每篇论文，都有个伴。中文、本地优先的 AI 论文阅读伙伴。'
    ) | Write-Host
  }

  # Re-check visibility before attaching a remote or transmitting source code.
  $repoInfo = (Invoke-Checked gh @(
    'repo', 'view', $qualifiedRepository, '--json', 'isPrivate,viewerPermission,url'
  )) | ConvertFrom-Json
  if ($repoInfo.url -ne $repositoryUrl -or -not $repoInfo.isPrivate -or $repoInfo.viewerPermission -ne 'ADMIN') {
    throw '仓库私有可见性或管理员权限验证失败，停止推送。'
  }
  if (-not $existingRemote.Count) {
    Invoke-Checked git @('remote', 'add', 'origin', $expectedRemote) | Write-Host
  }
  $pushRemotes = (Invoke-Checked git @('remote', 'get-url', '--push', '--all', 'origin')) -split "`r?`n"
  if (-not $pushRemotes.Count -or ($pushRemotes | Where-Object { $_ -notin $allowedRemotes })) {
    throw '实际推送地址校验失败，停止上传。'
  }

  $remoteHeads = Invoke-Checked git @('ls-remote', '--heads', 'origin')
  $remoteMain = $remoteHeads -match '(?m)\srefs/heads/main$'
  if ($remoteHeads -and -not $remoteMain) {
    throw '目标仓库已有其他分支但没有 main。请先核对默认分支和历史；脚本不会把已有仓库当作空仓库初始化。'
  }
  $branch = $verifiedBranch
  if ((Invoke-Checked git @('rev-parse', 'HEAD')) -ne $verifiedHead -or
      (Invoke-Checked git @('branch', '--show-current')) -ne $verifiedBranch -or
      (Invoke-Checked git @('status', '--porcelain'))) {
    throw '推送前工作区、提交或分支发生变化，请重新检查。'
  }
  if (-not $remoteMain) {
    # The first publication is an explicitly authorized repository bootstrap.
    Invoke-Checked git @('push', '--force-with-lease=refs/heads/main:', 'origin', "${verifiedHead}:refs/heads/main") | Write-Host
    Invoke-Checked git @('fetch', 'origin', 'main') | Write-Host
    Invoke-Checked gh @('repo', 'edit', $qualifiedRepository, '--default-branch', 'main') | Write-Host
    Write-Host '已将经过检查的提交初始化为远程 main；未修改其他 worktree 的分支或文件。'
  } else {
    Invoke-Checked git @('fetch', 'origin', 'main') | Write-Host
    $remoteHead = Invoke-Checked git @('rev-parse', 'origin/main')
    if ($verifiedHead -ne $remoteHead) {
      if ($branch -eq 'main') {
        throw '已有远程 main。请切换到任务分支，再通过 PR 发布；脚本不会直接覆盖主分支。'
      }
      Invoke-Checked git @('merge-base', $verifiedHead, 'origin/main') | Out-Null
      Invoke-Checked git @('push', 'origin', "${verifiedHead}:refs/heads/$branch") | Write-Host
      Invoke-Checked git @('config', '--local', "branch.$branch.remote", 'origin') | Out-Null
      Invoke-Checked git @('config', '--local', "branch.$branch.merge", "refs/heads/$branch") | Out-Null
      $existingPr = Invoke-Checked gh @(
        'pr', 'list', '--repo', $qualifiedRepository, '--state', 'open',
        '--head', $branch, '--base', 'main', '--json', 'url', '--jq', '.[0].url'
      )
      if ($existingPr) {
        Write-Host "已有 PR：$existingPr"
      } else {
        $bodyPath = [System.IO.Path]::GetTempFileName()
        try {
          @'
建立中文协作约定、开发入门、Issue/PR 模板和 Windows 自动质量检查。

验证：执行脚本前运行了 npm run check。桌面真实服务 E2E 不在本次自动检查范围内。

共享工作区中的其他产品改动保持独立。密钥和用户数据不进入仓库。
'@ | Set-Content -LiteralPath $bodyPath -Encoding utf8
          Invoke-Checked gh @(
            'pr', 'create', '--repo', $qualifiedRepository, '--base', 'main', '--head', $branch,
            '--title', 'chore: 建立篇篇协作流程', '--body-file', $bodyPath
          ) | Write-Host
        } finally {
          Remove-Item -LiteralPath $bodyPath -ErrorAction SilentlyContinue
        }
      }
    }
  }

  Invoke-Checked git @('config', '--local', 'branch.main.remote', 'origin') | Out-Null
  Invoke-Checked git @('config', '--local', 'branch.main.merge', 'refs/heads/main') | Out-Null
  Invoke-Checked gh @(
    'api', '--hostname', 'github.com', "repos/$fullName", '--method', 'PATCH', '--silent',
    '-F', 'allow_squash_merge=true', '-F', 'allow_merge_commit=false',
    '-F', 'allow_rebase_merge=false', '-F', 'delete_branch_on_merge=true'
  ) | Out-Null

  $protection = @{
    required_status_checks = @{ strict = $true; contexts = @('Quality checks (Windows)') }
    enforce_admins = $true
    required_pull_request_reviews = @{
      dismiss_stale_reviews = $true
      required_approving_review_count = 1
    }
    restrictions = $null
    allow_force_pushes = $false
    allow_deletions = $false
  }
  $protectionPath = [System.IO.Path]::GetTempFileName()
  try {
    $protection | ConvertTo-Json -Depth 5 |
      Set-Content -LiteralPath $protectionPath -Encoding utf8
    $protectionOutput = @(& gh api --hostname github.com "repos/$fullName/branches/main/protection" `
      --method PUT --input $protectionPath --silent 2>&1)
    if ($LASTEXITCODE -eq 0) {
      Write-Host 'main 分支保护已经启用：PR、一次审查、质量检查、禁止强推和删除。'
    } else {
      Write-Warning "分支保护未启用，仓库和源码保留。请核对私有仓库套餐和权限：$($protectionOutput -join "`n")"
      Write-Warning '当前只能按 AGENTS.md 执行团队约定，不能声称平台强制保护已生效。'
    }
  } finally {
    Remove-Item -LiteralPath $protectionPath -ErrorAction SilentlyContinue
  }

  $finalInfo = Invoke-Checked gh @(
    'repo', 'view', $qualifiedRepository, '--json', 'url,isPrivate,defaultBranchRef'
  )
  Write-Host $finalInfo
  Write-Host '源码接入完成。GitHub Actions 的远端执行结果仍需在仓库 Actions 页面确认。'
} catch {
  Write-Error "GitHub 配置未完成：$($_.Exception.Message)。认证或网络失败时，请先运行 gh auth login --hostname github.com --git-protocol https --web。"
  exit 1
} finally {
  if ($null -eq $previousGhHost) {
    Remove-Item -LiteralPath Env:GH_HOST -ErrorAction SilentlyContinue
  } else {
    $env:GH_HOST = $previousGhHost
  }
  Set-Location -LiteralPath $previousLocation
}
