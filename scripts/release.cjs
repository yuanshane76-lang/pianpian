const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, createPrivateKey, createPublicKey, sign } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const yaml = require("js-yaml");
const root = path.resolve(__dirname, "..");
const config = require("../update-config.json");
const { verifyReleaseSignature } = require("../electron/update-signature.cjs");

function validateReleaseMetadata(info, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || info?.version !== version) throw new Error("版本号不匹配或不是正式版本");
  if (info.files?.length !== 1 || info.files[0].url !== `Pianpian-Setup-${version}-x64.exe` ||
      !/^[A-Za-z0-9+/]{86}==$/.test(info.files[0].sha512) || !Number.isSafeInteger(info.files[0].size) || info.files[0].size < 1) throw new Error("发布文件格式无效");
  return info.files[0];
}
async function release(action) {
  const output = path.join(root, "out", "installer");
  const { version } = require("../package.json");
  const info = yaml.load(await fs.readFile(path.join(output, "latest.yml"), "utf8"));
  const asset = validateReleaseMetadata(info, version);
  const installer = path.join(output, asset.url);
  const signatureFile = path.join(output, "update-signature.json");
  if (action === "sign") {
    const keyFile = process.env.PIANPIAN_UPDATE_SIGNING_KEY_FILE || path.join(process.env.LOCALAPPDATA || "", "PianpianPublisher", "update-signing-private.pem");
    const privateKey = createPrivateKey(await fs.readFile(keyFile));
    if (createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString() !== config.publicKey) throw new Error("发布私钥与应用内公钥不匹配，不能发布。");
    const payload = JSON.stringify({ schema: 1, version, file: asset.url, sha512: asset.sha512, size: asset.size });
    const envelope = { payload, signature: sign(null, Buffer.from(payload), privateKey).toString("base64") };
    await verifyReleaseSignature({ envelope, info, installer, publicKey: config.publicKey });
    await fs.writeFile(signatureFile, JSON.stringify(envelope, null, 2) + "\n");
    const names = [asset.url, `${asset.url}.blockmap`, `Pianpian-${version}-x64.zip`, "latest.yml", "update-signature.json"];
    const checksums = [];
    for (const name of names) checksums.push(`${createHash("sha256").update(await fs.readFile(path.join(output, name))).digest("hex")}  ${name}`);
    await fs.writeFile(path.join(output, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
    console.log(`已签名 ${version}，私钥没有写入产物。`);
    return;
  }
  if (action !== "publish") throw new Error("用法：node scripts/release.cjs sign|publish");
  await verifyReleaseSignature({ envelope: JSON.parse(await fs.readFile(signatureFile, "utf8")), info, installer, publicKey: config.publicKey });
  const repo = `${config.owner}/${config.repo}`;
  const gh = (args) => execFileSync("gh", args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const repository = JSON.parse(gh(["repo", "view", repo, "--json", "visibility"]));
  if (repository.visibility !== "PUBLIC") throw new Error("发行仓库必须公开；脚本不会自动公开源码仓库。");
  let existing = null;
  try { existing = JSON.parse(gh(["release", "view", `v${version}`, "--repo", repo, "--json", "isDraft"])); }
  catch (error) { if (!String(error.stderr || "").includes("release not found")) throw error; }
  if (existing && !existing.isDraft) throw new Error("该版本已正式发布，请递增版本号，不要覆盖已发布的更新。");
  const notes = path.join(root, "docs", "releases", `${version}.md`);
  await fs.access(notes);
  if (!existing) gh(["release", "create", `v${version}`, "--repo", repo, "--draft", "--title", `篇篇 ${version}`, "--notes-file", notes]);
  const assets = [asset.url, `${asset.url}.blockmap`, `Pianpian-${version}-x64.zip`, "latest.yml", "update-signature.json", "SHA256SUMS.txt"].map(name => path.join(output, name));
  gh(["release", "upload", `v${version}`, "--repo", repo, ...assets, "--clobber"]);
  gh(["release", "edit", `v${version}`, "--repo", repo, "--draft=false", "--latest"]);
  console.log(`已发布 ${repo} v${version}`);
}
if (require.main === module) release(process.argv[2]).catch(() => {
  console.error("发布未完成。请检查版本、签名私钥、产物与公开发行仓库权限；现有正式版本不会被覆盖。");
  process.exitCode = 1;
});
module.exports = { validateReleaseMetadata, release };
