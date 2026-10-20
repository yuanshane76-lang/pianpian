const ALLOWED_EXTERNAL_HOSTS = new Set([
  "mineru.net",
  "help.aliyun.com",
  "bailian.console.aliyun.com",
  "platform.deepseek.com",
  "doi.org",
  "semanticscholar.org",
  "www.semanticscholar.org",
]);

function isAllowedExternalUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && ALLOWED_EXTERNAL_HOSTS.has(url.hostname.toLocaleLowerCase());
  } catch {
    return false;
  }
}

module.exports = { isAllowedExternalUrl };
