import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve("scripts/setup-github.ps1"), "utf8");
const harness = String.raw`
$ErrorActionPreference = 'Stop'
$scenario = Get-Content -LiteralPath $env:ZHIYAN_GITHUB_SCENARIO | ConvertFrom-Json
$global:publishedMain = $false
$global:createdRepository = $false
$global:checked = $false
function Record($name, $arguments) {
  @{ command = $name; arguments = @($arguments) } | ConvertTo-Json -Compress |
    Add-Content -LiteralPath $env:ZHIYAN_GITHUB_CALLS
}
function global:git {
  Record 'git' $args
  $global:LASTEXITCODE = 0
  $gitArguments = @($args)
  while ($gitArguments.Count -ge 2 -and $gitArguments[0] -eq '-c') {
    $gitArguments = @($gitArguments | Select-Object -Skip 2)
  }
  $joined = $gitArguments -join ' '
  switch ($joined) {
    'status --porcelain' { if ($scenario.dirty) { ' M src/app/App.tsx' }; return }
    'remote get-url origin' {
      if ($scenario.origin) { $scenario.origin } else { $global:LASTEXITCODE = 2 }
      return
    }
    'remote get-url --push --all origin' {
      if ($scenario.badPushUrl) { 'https://github.com/someone/public-project.git' }
      else { 'https://github.com/yuanshane76-lang/zhiyan-workbench.git' }
      return
    }
    'ls-remote --heads origin main' {
      if ($scenario.remoteMain) { "old refs/heads/main" }; return
    }
    'ls-remote --heads origin' {
      if ($scenario.remoteMain) { "old refs/heads/main" }
      elseif ($scenario.remoteOtherBranch) { "old refs/heads/master" }
      return
    }
    'branch --show-current' { if ($scenario.branch) { $scenario.branch } else { 'chore/collaboration-setup' }; return }
    'rev-parse HEAD' {
      if ($scenario.changeCommitAfterCheck -and $global:checked) { 'unchecked' }
      elseif ($scenario.sameHead) { 'old' } else { 'new' }
      return
    }
    'rev-parse origin/main' { if ($global:publishedMain) { 'new' } else { 'old' }; return }
  }
  if ($gitArguments[0] -eq 'push' -and $gitArguments[-1] -eq 'new:refs/heads/main') {
    $global:publishedMain = $true
  }
}
function global:npm {
  Record 'npm' $args
  $global:LASTEXITCODE = 0
  $global:checked = $true
}
function global:node {
  Record 'node' $args
  $global:LASTEXITCODE = 0
}
function global:gh {
  Record 'gh' $args
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'api' -and $args -contains 'user') {
    if ($scenario.wrongAccount) { 'someone-else' } else { 'yuanshane76-lang' }
    return
  }
  if ($args[0] -eq 'repo' -and $args[1] -eq 'view') {
    if ($scenario.repoMissing -and -not $global:createdRepository) {
      'GraphQL: Could not resolve to a Repository with the name'; $global:LASTEXITCODE = 1; return
    }
    $url = if ($scenario.wrongHost) { 'https://example.org/yuanshane76-lang/zhiyan-workbench' } else { 'https://github.com/yuanshane76-lang/zhiyan-workbench' }
    @{ isPrivate = -not $scenario.publicRepository; viewerPermission = 'ADMIN'; url = $url; defaultBranchRef = @{ name = 'main' } } |
      ConvertTo-Json -Compress
    return
  }
  if ($args[0] -eq 'repo' -and $args[1] -eq 'create') {
    $global:createdRepository = $true
    return
  }
  if ($args[0] -eq 'api' -and ($args -join ' ') -match '/protection' -and $scenario.protectionDenied) {
    'HTTP 403: Upgrade to GitHub Pro or make this repository public to enable this feature.'
    $global:LASTEXITCODE = 1
    return
  }
  if ($args[0] -eq 'pr' -and $args[1] -eq 'create') {
    'https://github.com/yuanshane76-lang/zhiyan-workbench/pull/1'
  }
}
if ($scenario.bypassGitProxy) {
  & (Join-Path $PSScriptRoot 'scripts/setup-github.ps1') -BypassGitProxy
} else {
  & (Join-Path $PSScriptRoot 'scripts/setup-github.ps1')
}
`;

type Call = { command: string; arguments: string[] };

function run(scenario: Record<string, unknown>) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "zhiyan-github-test-"));
  mkdirSync(path.join(temporary, "scripts"));
  writeFileSync(path.join(temporary, "scripts/setup-github.ps1"), source);
  writeFileSync(path.join(temporary, "harness.ps1"), harness);
  writeFileSync(path.join(temporary, "scenario.json"), JSON.stringify(scenario));
  try {
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-File", path.join(temporary, "harness.ps1")], {
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        ZHIYAN_GITHUB_SCENARIO: path.join(temporary, "scenario.json"),
        ZHIYAN_GITHUB_CALLS: path.join(temporary, "calls.jsonl"),
      },
    });
    if (result.error) throw result.error;
    const callPath = path.join(temporary, "calls.jsonl");
    const calls = existsSync(callPath) ? readFileSync(callPath, "utf8")
      .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Call) : [];
    return { status: result.status, output: result.stdout + result.stderr, calls };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

const isMutation = (call: Call) =>
  (call.command === "git" && ["push", "fetch", "config", "remote"].includes(call.arguments[0]) &&
    !(call.arguments[0] === "remote" && call.arguments[1] === "get-url")) ||
  (call.command === "gh" && (
    (call.arguments[0] === "repo" && ["create", "edit"].includes(call.arguments[1])) ||
    (call.arguments[0] === "pr" && call.arguments[1] === "create") ||
    call.arguments.includes("PATCH") || call.arguments.includes("PUT")
  ));

describe("GitHub setup boundaries", () => {
  it.each([
    { dirty: true },
    { wrongAccount: true },
    { publicRepository: true },
    { origin: "https://github.com/someone/another-project.git" },
    { origin: "https://github.com/yuanshane76-lang/zhiyan-workbench.git", badPushUrl: true },
    { wrongHost: true },
    { changeCommitAfterCheck: true },
  ])("stops without remote mutations for unsafe inputs: %j", (scenario) => {
    const result = run(scenario);
    expect(result.status, result.output).toBe(1);
    expect(result.calls.filter(isMutation)).toEqual([]);
  });

  it("does not treat an existing repository with another default branch as empty", () => {
    const result = run({ remoteOtherBranch: true });
    expect(result.status, result.output).toBe(1);
    expect(result.calls.some((call) => call.command === "git" && call.arguments[0] === "push")).toBe(false);
    expect(result.calls.some((call) => call.command === "gh" && call.arguments[0] === "repo" && call.arguments[1] === "edit")).toBe(false);
  });

  it("bootstraps a private empty repository and reports unavailable protection accurately", () => {
    const result = run({ repoMissing: true, protectionDenied: true });
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toContainEqual({
      command: "git", arguments: ["push", "--force-with-lease=refs/heads/main:", "origin", "new:refs/heads/main"],
    });
    expect(result.output).toContain("分支保护未启用");
    expect(result.output).not.toContain("main 分支保护已经启用");
  });

  it("uses a PR rather than pushing main in an existing repository", () => {
    const result = run({ remoteMain: true });
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toContainEqual({
      command: "git", arguments: ["push", "origin", "new:refs/heads/chore/collaboration-setup"],
    });
    expect(result.calls.some((call) => call.command === "git" && call.arguments.some((argument) => argument.endsWith(":refs/heads/main")))).toBe(false);
    expect(result.calls.some((call) => call.command === "gh" && call.arguments[0] === "pr" && call.arguments[1] === "create")).toBe(true);
  });

  it("bypasses a configured Git proxy for child commands without changing proxy settings", () => {
    const result = run({ bypassGitProxy: true });
    expect(result.status, result.output).toBe(0);
    const push = result.calls.find((call) => call.command === "git" && call.arguments.includes("push"));
    expect(push?.arguments).toEqual([
      "-c", "http.proxy=", "-c", "https.proxy=", "-c", "http.https://github.com/.proxy=",
      "push", "--force-with-lease=refs/heads/main:", "origin", "new:refs/heads/main",
    ]);
    const configCalls = result.calls.filter((call) => call.command === "git" && call.arguments.includes("config"));
    expect(configCalls.some((call) =>
      call.arguments.slice(call.arguments.indexOf("config") + 1).some((argument) => /proxy/.test(argument)))).toBe(false);
  });
});
