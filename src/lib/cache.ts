interface CacheEntry<Value> {
  expiresAt: number;
  value: Value;
  weight: number;
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
  readonly #inFlight = new Map<Key, Promise<Value>>();
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

  set(key: Key, value: Value): void {
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
      expiresAt: this.#now() + this.#ttlMs,
      value,
      weight,
    });
    this.#totalWeight += weight;
  }

  async getOrLoad(
    key: Key,
    load: () => Promise<Value>,
    shouldCache: (value: Value) => boolean = () => true,
  ): Promise<Value> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const pending = this.#inFlight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        if (shouldCache(value)) this.set(key, value);
        return value;
      })
      .finally(() => {
        if (this.#inFlight.get(key) === promise) this.#inFlight.delete(key);
      });

    this.#inFlight.set(key, promise);
    return promise;
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
