export interface TranslationQueueJob {
  key: string;
  paperId: string;
  label: string;
  priority: number;
  run: (signal: AbortSignal, onDelta: (delta: string) => void) => Promise<string>;
  onDelta?: (delta: string) => void;
  onComplete?: (value: string) => void;
  onError?: (error: unknown) => void;
}

export interface TranslationQueueSnapshot {
  queuedCount: number;
  activeCount: number;
  translatedCount: number;
  failedCount: number;
  paused: boolean;
  currentLabel?: string;
}

interface QueueListener {
  (paperId: string, snapshot: TranslationQueueSnapshot): void;
}

export class TranslationQueue {
  private readonly jobs = new Map<string, TranslationQueueJob>();
  private readonly counters = new Map<string, { translatedCount: number; failedCount: number }>();
  private readonly listeners = new Set<QueueListener>();
  private active: { job: TranslationQueueJob; controller: AbortController } | null = null;
  private paused = false;

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enqueue(job: TranslationQueueJob): void {
    if (this.jobs.has(job.key)) return;
    this.jobs.set(job.key, job);
    this.emit(job.paperId);
    void this.pump();
  }

  pause(): void {
    this.paused = true;
    this.emitAll();
  }

  resume(): void {
    this.paused = false;
    this.emitAll();
    void this.pump();
  }

  cancelPaper(paperId: string): void {
    for (const [key, job] of this.jobs) {
      if (job.paperId === paperId) this.jobs.delete(key);
    }
    if (this.active?.job.paperId === paperId) this.active.controller.abort();
    this.emit(paperId);
  }

  clear(): void {
    const paperIds = new Set([...this.jobs.values()].map((job) => job.paperId));
    this.jobs.clear();
    this.active?.controller.abort();
    for (const paperId of paperIds) this.emit(paperId);
  }

  snapshot(paperId: string): TranslationQueueSnapshot {
    const queued = [...this.jobs.values()].filter((job) => job.paperId === paperId);
    const counters = this.counters.get(paperId) ?? { translatedCount: 0, failedCount: 0 };
    const active = this.active?.job.paperId === paperId ? 1 : 0;
    return {
      queuedCount: queued.length,
      activeCount: active,
      translatedCount: counters.translatedCount,
      failedCount: counters.failedCount,
      paused: this.paused,
      currentLabel: active ? this.active?.job.label : undefined,
    };
  }

  private emit(paperId: string): void {
    const snapshot = this.snapshot(paperId);
    for (const listener of this.listeners) listener(paperId, snapshot);
  }

  private emitAll(): void {
    const paperIds = new Set([...this.jobs.values()].map((job) => job.paperId));
    if (this.active) paperIds.add(this.active.job.paperId);
    for (const paperId of paperIds) this.emit(paperId);
  }

  private nextJob(): TranslationQueueJob | undefined {
    return [...this.jobs.values()].sort((left, right) => left.priority - right.priority)[0];
  }

  private async pump(): Promise<void> {
    if (this.paused || this.active) return;
    const job = this.nextJob();
    if (!job) return;
    this.jobs.delete(job.key);
    const controller = new AbortController();
    this.active = { job, controller };
    this.emit(job.paperId);
    try {
      const value = await job.run(controller.signal, (delta) => job.onDelta?.(delta));
      if (!controller.signal.aborted) {
        const counters = this.counters.get(job.paperId) ?? { translatedCount: 0, failedCount: 0 };
        counters.translatedCount += 1;
        this.counters.set(job.paperId, counters);
        job.onComplete?.(value);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const counters = this.counters.get(job.paperId) ?? { translatedCount: 0, failedCount: 0 };
        counters.failedCount += 1;
        this.counters.set(job.paperId, counters);
        job.onError?.(error);
      }
    } finally {
      this.active = null;
      this.emit(job.paperId);
      void this.pump();
    }
  }
}
