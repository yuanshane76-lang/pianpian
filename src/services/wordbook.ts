import { parseWordbook, type WordbookEntry } from "../domain/wordbook";

const STORAGE_KEY = "zhiyan-workbench.wordbook.v1";

export function loadWordbook(): { entries: WordbookEntry[]; error: string | null } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return { entries: raw ? parseWordbook(raw) : [], error: null };
  } catch {
    return { entries: [], error: "无法读取本地单词表，原数据未被覆盖。请检查本地存储后重试。" };
  }
}
export function saveWordbook(entries: WordbookEntry[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch { return false; }
}
