interface CacheEntry<Value> {
  expiresAt: number;
  value: Value;
  weight: number;
}

interface InFlightLoad<Value> {
  controller: AbortController;
  promise: Promise<Value>;
  settled: boolean;
  waiters: number;
}

export interface TtlLruCacheOptions<Value> {
  maxEntries: number;
  maxWeight?: number;
  now?: () => number;
  ttlMs: number;
  weigh?: (value: Value) => number;
}

export class TtlLruCache<Key, Value> {
  readonly #entries = new Map<Key, CacheEntry<Value>>();
  readonly #inFlight = new Map<Key, InFlightLoad<Value>>();
  readonly #maxEntries: number;
  readonly #maxWeight: number;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #weigh: (value: Value) => number;
  #totalWeight = 0;

  constructor(options: TtlLruCacheOptions<Value>) {
    if (options.maxEntries < 1) throw new Error("maxEntries must be at least 1");
    if (options.ttlMs < 1) throw new Error("ttlMs must be at least 1");
    if (options.maxWeight !== undefined && options.maxWeight < 1) {
      throw new Error("maxWeight must be at least 1");
    }

    this.#maxEntries = options.maxEntries;
    this.#maxWeight = options.maxWeight ?? Number.POSITIVE_INFINITY;
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs;
    this.#weigh = options.weigh ?? (() => 1);
  }

  get(key: Key): Value | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#delete(key, entry);
      return undefined;
    }

    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value, ttlMs = this.#ttlMs): void {
    if (!Number.isFinite(ttlMs) || ttlMs < 1) return;
    const weight = Math.max(0, this.#weigh(value));
    if (!Number.isFinite(weight) || weight > this.#maxWeight) return;

    const existing = this.#entries.get(key);
    if (existing) this.#delete(key, existing);
    this.#pruneExpired();

    while (
      this.#entries.size >= this.#maxEntries ||
      this.#totalWeight + weight > this.#maxWeight
    ) {
      const oldest = this.#entries.entries().next().value as [Key, CacheEntry<Value>] | undefined;
      if (!oldest) break;
      this.#delete(oldest[0], oldest[1]);
    }

    this.#entries.set(key, {
      expiresAt: this.#now() + ttlMs,
      value,
      weight,
    });
    this.#totalWeight += weight;
  }

  async getOrLoad(
    key: Key,
    load: (signal: AbortSignal) => Promise<Value>,
    shouldCache: (value: Value) => boolean = () => true,
    signal?: AbortSignal,
    ttlMs?: (value: Value) => number | undefined,
  ): Promise<Value> {
    signal?.throwIfAborted();
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    let pending = this.#inFlight.get(key);
    if (!pending) {
      const controller = new AbortController();
      let current: InFlightLoad<Value>;
      const promise = load(controller.signal)
        .then((value) => {
          if (shouldCache(value)) this.set(key, value, ttlMs?.(value));
          return value;
        })
        .finally(() => {
          current.settled = true;
          if (this.#inFlight.get(key) === current) this.#inFlight.delete(key);
        });
      current = {
        controller,
        promise,
        settled: false,
        waiters: 0,
      };
      this.#inFlight.set(key, current);
      pending = current;
    }

    return waitForLoad(pending, signal);
  }

  clear(): void {
    this.#entries.clear();
    this.#totalWeight = 0;
  }

  #delete(key: Key, entry: CacheEntry<Value>): void {
    if (!this.#entries.delete(key)) return;
    this.#totalWeight -= entry.weight;
  }

  #pruneExpired(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#delete(key, entry);
    }
  }
}

function waitForLoad<Value>(
  pending: InFlightLoad<Value>,
  signal?: AbortSignal,
): Promise<Value> {
  pending.waiters += 1;

  if (!signal) {
    return pending.promise.finally(() => releaseWaiter(pending));
  }

  return new Promise<Value>((resolve, reject) => {
    let finished = false;

    const finish = (callback: () => void) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      releaseWaiter(pending);
      callback();
    };
    const onAbort = () => finish(() => reject(signal.reason));

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    pending.promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function releaseWaiter<Value>(pending: InFlightLoad<Value>): void {
  pending.waiters -= 1;
  if (pending.waiters === 0 && !pending.settled) pending.controller.abort();
}
