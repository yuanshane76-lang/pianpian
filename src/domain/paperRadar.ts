import { normalizeDoi } from "./library";

export { normalizeDoi };

export const RADAR_PROTOCOL_VERSION = "radar-v1";

export interface RadarSeed {
  title: string;
  doi?: string;
  paperId?: string;
}

export interface RadarCandidate {
  /** Stable dedupe identity: DOI when available, otherwise normalized title. */
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  citationCount?: number;
  source: string;
}

const MAX_TITLE = 500;
const MAX_AUTHOR = 120;
const MAX_AUTHORS = 20;
const MAX_ABSTRACT = 4000;
const MAX_VENUE = 300;
const MAX_URL = 2000;

function text(value: unknown, maximum: number): string {
  if (typeof value === "string") return value.trim().slice(0, maximum);
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, maximum);
  return "";
}

/** Case, width and punctuation insensitive form used for identity comparison. */
export function normalizeTitle(value: unknown): string {
  return text(value, MAX_TITLE)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeYear(value: unknown): number | null {
  const year = typeof value === "number" ? value : Number.parseInt(text(value, 8), 10);
  return Number.isInteger(year) && year >= 1800 && year <= 2200 ? year : null;
}

function normalizeAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const authors: string[] = [];
  for (const entry of value) {
    const name = text(entry, MAX_AUTHOR);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    authors.push(name);
    if (authors.length >= MAX_AUTHORS) break;
  }
  return authors;
}

function normalizeUrl(value: unknown): string | undefined {
  const raw = text(value, MAX_URL);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function candidateIdentity(doi: string | undefined, title: string): string {
  const normalized = normalizeDoi(doi);
  return normalized ? `doi:${normalized}` : `title:${normalizeTitle(title)}`;
}

export function normalizeRadarCandidate(raw: unknown): RadarCandidate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const title = text(source.title, MAX_TITLE);
  if (!title) return null;
  const doi = normalizeDoi(source.doi) || undefined;
  const id = candidateIdentity(doi, title);
  if (id === "title:") return null;
  const abstract = text(source.abstract, MAX_ABSTRACT) || undefined;
  const venue = text(source.venue, MAX_VENUE) || undefined;
  const rawCount = source.citationCount;
  const citationCount = typeof rawCount === "number" && Number.isInteger(rawCount) && rawCount >= 0
    ? rawCount
    : undefined;
  return {
    id,
    title,
    authors: normalizeAuthors(source.authors),
    year: normalizeYear(source.year),
    ...(venue ? { venue } : {}),
    ...(doi ? { doi } : {}),
    ...(normalizeUrl(source.url) ? { url: normalizeUrl(source.url)! } : {}),
    ...(abstract ? { abstract } : {}),
    ...(citationCount === undefined ? {} : { citationCount }),
    source: text(source.source, 100) || "Semantic Scholar",
  };
}

export function seedIdentities(seed: RadarSeed): string[] {
  const identities = new Set<string>();
  const doi = normalizeDoi(seed.doi);
  if (doi) identities.add(`doi:${doi}`);
  const title = normalizeTitle(seed.title);
  if (title) identities.add(`title:${title}`);
  const paperId = text(seed.paperId, 200);
  if (paperId) identities.add(`s2:${paperId.toLocaleLowerCase()}`);
  return [...identities];
}

export function libraryIdentities(papers: Array<{ title?: string; doi?: string }>): string[] {
  const identities = new Set<string>();
  for (const paper of papers) {
    const doi = normalizeDoi(paper?.doi);
    const title = normalizeTitle(paper?.title);
    if (doi) identities.add(`doi:${doi}`);
    if (title) identities.add(`title:${title}`);
  }
  return [...identities];
}

export function buildRadarCacheKey(source: string, seed: RadarSeed): string {
  const keys = seedIdentities(seed);
  const anchor = keys.find((key) => key.startsWith("doi:")) ?? keys[0] ?? "unknown";
  return [source, RADAR_PROTOCOL_VERSION, anchor].join("::");
}

function hasMoreEvidence(candidate: RadarCandidate): number {
  return (candidate.abstract ? 2 : 0) + (candidate.doi ? 1 : 0);
}

/**
 * Keeps the source relevance order, drops the seed itself and papers the user already owns,
 * and merges duplicates by keeping the entry carrying the most comparable evidence.
 */
export function selectRadarCandidates(options: {
  candidates: unknown;
  seed: RadarSeed;
  known?: Array<{ title?: string; doi?: string }>;
  limit?: number;
}): RadarCandidate[] {
  const limit = Number.isInteger(options.limit) && (options.limit as number) > 0
    ? Math.min(options.limit as number, 200)
    : 50;
  const excluded = new Set([...seedIdentities(options.seed), ...libraryIdentities(options.known ?? [])]);
  const byIdentity = new Map<string, RadarCandidate>();
  const input = Array.isArray(options.candidates) ? options.candidates : [];
  for (const raw of input) {
    const candidate = normalizeRadarCandidate(raw);
    if (!candidate || excluded.has(candidate.id)) continue;
    const previous = byIdentity.get(candidate.id);
    if (!previous || hasMoreEvidence(candidate) > hasMoreEvidence(previous)) {
      byIdentity.set(candidate.id, candidate);
    }
  }
  return [...byIdentity.values()].slice(0, limit);
}

export function formatRadarAuthors(authors: string[], maximum = 3): string {
  if (!authors.length) return "作者未知";
  if (authors.length <= maximum) return authors.join("、");
  return `${authors.slice(0, maximum).join("、")} 等 ${authors.length} 人`;
}
