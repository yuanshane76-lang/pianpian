function resolveMessageCitations(content, evidence) {
  const citations = new Map();
  for (const match of String(content).matchAll(/\[引用:([^\]\r\n]{1,200})\]/g)) {
    const source = evidence.get(match[1]);
    if (source && citations.size < 20) citations.set(source.blockId, source);
  }
  return [...citations.values()];
}
module.exports = { resolveMessageCitations };
