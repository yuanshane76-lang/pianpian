const fs = require("node:fs");
const path = require("node:path");
const manifest = require("../skills/research/manifest.json");

const SKILL_ROOT = path.join(__dirname, "..", "skills", "research");
const catalogue = manifest.skills;
const byName = new Map(catalogue.map((skill) => [skill.name, skill]));

function skillFile(name) {
  const skill = typeof name === "string" ? byName.get(name) : undefined;
  if (!skill) throw new Error("未找到该预置研究技能");
  const directory = path.join(SKILL_ROOT, skill.name);
  const file = path.join(directory, "SKILL.md");
  // Do not let a directory junction or symlink turn a bundled name into an external file reader.
  for (const item of [path.dirname(SKILL_ROOT), SKILL_ROOT, directory, file]) {
    if (fs.lstatSync(item).isSymbolicLink()) throw new Error("预置研究技能路径无效");
  }
  const root = fs.realpathSync(SKILL_ROOT);
  const actual = fs.realpathSync(file);
  const relative = path.relative(root, actual);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(file).isFile()) {
    throw new Error("预置研究技能路径无效");
  }
  return file;
}

function listBundledResearchSkills() {
  return catalogue.map((skill) => ({ ...skill }));
}

function readBundledResearchSkill(name) {
  const skill = typeof name === "string" ? byName.get(name) : undefined;
  if (!skill) throw new Error("未找到该预置研究技能");
  const instructions = fs.readFileSync(skillFile(name), "utf8");
  if (!instructions.trim() || instructions.length > 20000) throw new Error("预置研究技能内容无效");
  return { name: skill.name, title: skill.title, instructions };
}

function loadBundledResearchSkills(pi) {
  const result = pi.loadSkills({
    cwd: SKILL_ROOT, agentDir: SKILL_ROOT, includeDefaults: false,
    skillPaths: catalogue.map((skill) => skillFile(skill.name)),
  });
  if (result.diagnostics.length || result.skills.length !== catalogue.length
    || result.skills.some((skill) => !byName.has(skill.name))) {
    throw new Error("预置研究技能加载失败，请检查安装包是否完整");
  }
  return result;
}

module.exports = { listBundledResearchSkills, readBundledResearchSkill, loadBundledResearchSkills };
