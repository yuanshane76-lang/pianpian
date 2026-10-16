function resolveMessageCitations(content, evidence) {
  const citations = new Map();
  for (const match of String(content).matchAll(/\[引用:([^\]\r\n]{1,420})\]/g)) {
    const source = evidence.get(match[1]);
    if (source && citations.size < 20) citations.set(match[1], source);
  }
  return [...citations.values()];
}
module.exports = { resolveMessageCitations };
