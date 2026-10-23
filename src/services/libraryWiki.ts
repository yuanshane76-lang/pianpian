import { parseLibraryWikiPages, type LibraryWikiPage } from "../domain/libraryWiki";

const STORAGE_KEY = "zhiyan-workbench.library-wiki.v1";

export function loadLibraryWiki(): { pages: LibraryWikiPage[]; error: string | null } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return { pages: raw ? parseLibraryWikiPages(JSON.parse(raw)) : [], error: null };
  } catch {
    return { pages: [], error: "无法读取本地论文知识库，原数据未被覆盖。请检查本地存储后重试。" };
  }
}

export function saveLibraryWiki(pages: LibraryWikiPage[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
    return true;
  } catch {
    return false;
  }
}
