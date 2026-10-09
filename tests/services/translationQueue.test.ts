import { describe, expect, it, vi } from "vitest";
import { TranslationQueue } from "../../src/services/translationQueue";

describe("incremental translation queue", () => {
  it("runs only one request at a time and respects priority", async () => {
    const queue = new TranslationQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<string>((resolve) => { releaseFirst = () => resolve("first"); });
    queue.enqueue({ key: "low", paperId: "paper", label: "low", priority: 10, run: async () => { order.push("low"); return first; } });
    queue.enqueue({ key: "high", paperId: "paper", label: "high", priority: 1, run: async () => { order.push("high"); return "high"; } });
    await vi.waitFor(() => expect(order).toEqual(["low"]));
    releaseFirst();
    await vi.waitFor(() => expect(order).toEqual(["low", "high"]));
  });

  it("deduplicates jobs, exposes progress, and pauses new work", async () => {
    const queue = new TranslationQueue();
    const complete = vi.fn();
    let release!: () => void;
    queue.pause();
    queue.enqueue({ key: "same", paperId: "paper", label: "第一段", priority: 1, run: () => new Promise((resolve) => { release = () => resolve("译文"); }), onComplete: complete });
    queue.enqueue({ key: "same", paperId: "paper", label: "重复", priority: 1, run: async () => "重复" });
    expect(queue.snapshot("paper")).toMatchObject({ queuedCount: 1, activeCount: 0, paused: true });
    queue.resume();
    await vi.waitFor(() => expect(queue.snapshot("paper").activeCount).toBe(1));
    release();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("译文"));
    expect(queue.snapshot("paper").translatedCount).toBe(1);
  });
});
