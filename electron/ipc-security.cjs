function assertAppSender(event, isDev) {
  const frame = event?.senderFrame;
  if (!frame || frame !== event?.sender?.mainFrame) {
    throw new Error("不允许从非应用主页面调用桌面服务");
  }
  const expected = isDev ? "http://127.0.0.1:4173/" : "zhiyan://app/index.html";
  if (frame.url !== expected) throw new Error("不允许从外部页面调用桌面服务");
}

module.exports = { assertAppSender };
