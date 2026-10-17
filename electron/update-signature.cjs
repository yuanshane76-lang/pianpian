const { verify, createHash } = require("node:crypto");
const fs = require("node:fs");

async function verifyReleaseSignature({ envelope, info, installer, publicKey }) {
  if (typeof envelope?.payload !== "string" || envelope.payload.length > 4096 ||
      typeof envelope.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw new Error("更新签名格式无效");
  if (!verify(null, Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, "base64"))) throw new Error("更新签名校验失败");
  const payload = JSON.parse(envelope.payload);
  if (payload.schema !== 1 || payload.version !== info?.version || !/^\d+\.\d+\.\d+$/.test(payload.version)) throw new Error("更新版本校验失败");
  if (payload.file !== `Pianpian-Setup-${payload.version}-x64.exe` ||
      !Number.isSafeInteger(payload.size) || payload.size < 1 || payload.size > 2 * 1024 ** 3 ||
      typeof payload.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(payload.sha512)) throw new Error("更新文件信息校验失败");
  if (info.files?.length !== 1 || info.files[0].url !== payload.file || info.files[0].sha512 !== payload.sha512 || info.files[0].size !== payload.size) throw new Error("更新文件校验失败");
  if (installer) {
    const stat = await fs.promises.lstat(installer);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== payload.size) throw new Error("安装文件校验失败");
    const hash = createHash("sha512");
    for await (const chunk of fs.createReadStream(installer)) hash.update(chunk);
    if (hash.digest("base64") !== payload.sha512) throw new Error("安装文件校验失败");
  }
}
module.exports = { verifyReleaseSignature };
