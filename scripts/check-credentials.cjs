const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const patterns = [
  ["service-key", /sk-[A-Za-z0-9_-]{24,}/],
  ["github-token", /ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}/],
  ["jwt-token", /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const textFile = /\.(?:md|cjs|mjs|js|ts|tsx|json|ps1|ya?ml|txt)$|(?:^|\/)\.env(?:\.|$)/;
const sensitiveFile = /(?:^|\/)\.env(?:\.|$)|\.enc\.json$|\.(?:pem|key)$/;

function credentialKinds(text) {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

function auditRepository(cwd = process.cwd()) {
  const git = (args) => execFileSync("git", args, {
    cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  const findings = [];
  const inspect = (file, content, source) => {
    const kinds = credentialKinds(content);
    if (sensitiveFile.test(file) && file !== ".env.example") kinds.push("sensitive-file");
    if (kinds.length) findings.push({ source, file, kinds });
  };
  for (const item of git(["rev-list", "--objects", "HEAD"]).trim().split(/\r?\n/)) {
    const space = item.indexOf(" ");
    if (space < 0) continue;
    const object = item.slice(0, space);
    const file = item.slice(space + 1);
    if (textFile.test(file) || sensitiveFile.test(file)) {
      inspect(file, git(["cat-file", "blob", object]), "history");
    }
  }
  const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0").filter(Boolean);
  for (const file of files) {
    if (textFile.test(file) || sensitiveFile.test(file)) {
      const target = path.join(cwd, file);
      try {
        inspect(file, readFileSync(target, "utf8"), "worktree");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        inspect(file, git(["show", `:${file}`]), "index");
      }
    }
  }
  return findings;
}

if (require.main === module) {
  try {
    const findings = auditRepository();
    if (findings.length) {
      // Locations and kinds only: never echo the matching credentials.
      console.error(JSON.stringify({ message: "检测到疑似凭据，停止验证或上传", locations: findings }, null, 2));
      process.exitCode = 1;
    } else {
      console.log("常见凭据格式及当前分支历史检查通过。");
    }
  } catch (error) {
    console.error(`凭据检查未完成：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { credentialKinds, auditRepository };
