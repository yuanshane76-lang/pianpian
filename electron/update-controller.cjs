function newer(candidate, current) {
  const parse = (value) => /^\d+\.\d+\.\d+$/.test(value || "") ? value.split(".").map(BigInt) : null;
  const next = parse(candidate), previous = parse(current);
  if (!next || !previous) return false;
  for (let index = 0; index < 3; index++) if (next[index] !== previous[index]) return next[index] > previous[index];
  return false;
}

function createUpdateController({ updater, version, supported, verify, prepare, emit = () => {} }) {
  let state = { phase: supported ? "idle" : "unsupported", currentVersion: version,
    message: supported ? "更新只替换应用程序，论文和阅读记录保留在本机。" : "当前为开发版或免安装版，请先下载安装版以启用自动更新。" };
  let info, installer, checking, downloading, installing;
  function publish(patch) { state = { ...state, ...patch }; emit({ ...state }); return { ...state }; }
  function fail() { return publish({ phase: "error", message: "更新失败：无法连接 GitHub，或更新文件校验未通过。请检查网络后重试，当前版本仍可使用。" }); }
  Object.assign(updater, { autoDownload: false, autoInstallOnAppQuit: false, allowDowngrade: false,
    allowPrerelease: false, disableWebInstaller: true, disableDifferentialDownload: true });
  updater.on("error", fail);
  updater.on("download-progress", (progress) => {
    if (state.phase !== "downloading") return;
    publish({ progress: Math.max(0, Math.min(100, Number(progress.percent) || 0)), message: "正在下载更新，可以继续阅读。" });
  });
  return {
    getState: () => ({ ...state }),
    check() {
      if (!supported || ["downloaded", "preparing", "installing", "downloading"].includes(state.phase)) return Promise.resolve({ ...state });
      if (checking) return checking;
      publish({ phase: "checking", message: "正在检查 GitHub 上的最新版本…", progress: undefined });
      checking = (async () => {
        try {
          const result = await updater.checkForUpdates();
          if (!result) return fail();
          if (!result.isUpdateAvailable || !newer(result.updateInfo?.version, version)) {
            info = null; installer = null;
            return publish({ phase: "current", latestVersion: undefined, releaseNotes: undefined, message: "你使用的已是最新正式版。" });
          }
          await verify(result.updateInfo, null);
          info = result.updateInfo; installer = null;
          const notes = typeof info.releaseNotes === "string" ? info.releaseNotes : "本次更新包含体验改进与问题修复。";
          return publish({ phase: "available", latestVersion: info.version, releaseNotes: notes.slice(0, 12000), message: "发现新版本，下载后由你决定何时重启更新。" });
        } catch { return fail(); }
        finally { checking = null; }
      })();
      return checking;
    },
    download() {
      if (downloading) return downloading;
      if (!supported || !info || !["available", "error"].includes(state.phase)) return Promise.reject(new Error("请先检查并确认可下载的新版本。"));
      publish({ phase: "downloading", progress: 0, message: "正在下载更新，可以继续阅读。" });
      downloading = (async () => {
        try {
          const files = await updater.downloadUpdate();
          if (!files?.[0]) throw new Error("缺少安装文件");
          await verify(info, files[0]);
          installer = files[0];
          return publish({ phase: "downloaded", progress: 100, message: "更新已下载并校验，准备好后重启安装。" });
        } catch { installer = null; return fail(); }
        finally { downloading = null; }
      })();
      return downloading;
    },
    install(snapshot) {
      if (installing) return installing;
      if (!supported || !installer || state.phase !== "downloaded") return Promise.reject(new Error("请先下载并校验新版本。"));
      publish({ phase: "preparing", message: "正在保存记录并备份关键数据，请稍候…" });
      installing = (async () => {
        try {
          await verify(info, installer);
          await prepare(snapshot, info.version);
          publish({ phase: "installing", message: "已保存并备份，正在重启更新…" });
          updater.quitAndInstall(true, true);
          return { ...state };
        } catch (error) {
          publish({ phase: "downloaded", message: "更新尚未安装：保存或备份未完成。请稍后重试，当前数据保持不变。" });
          throw error;
        } finally { installing = null; }
      })();
      return installing;
    },
  };
}
module.exports = { createUpdateController, newer };
