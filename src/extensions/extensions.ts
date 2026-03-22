/**
 * @file extensions.ts
 * @description Native prototype extensions for String, Array, Number, and Promise.
 * @author Matan Bardugo
 */

// --- String Extensions ---

String.prototype.isNullOrEmpty = function (): boolean {
  return !this || this.trim().length === 0;
};

String.prototype.capitalize = function (): string {
  if (this.length === 0) return '';
  return this.charAt(0).toUpperCase() + this.slice(1).toLowerCase();
};

String.prototype.truncate = function (length: number): string {
  return this.length > length
    ? this.substring(0, length) + '...'
    : this.toString();
};

// --- Array Extensions ---

Array.prototype.groupBy = function <T, K>(
  this: T[],
  keySelector: (item: T) => K,
): Map<K, T[]> {
  return this.reduce((map, item) => {
    const key = keySelector(item);
    const group = map.get(key) || [];
    group.push(item);
    map.set(key, group);
    return map;
  }, new Map<K, T[]>());
};

Array.prototype.unique = function <T>(this: T[]): T[] {
  return [...new Set(this)];
};

Array.prototype.sortBy = function <T>(
  this: T[],
  keySelector: (item: T) => any,
  order: 'asc' | 'desc' = 'asc',
): T[] {
  return [...this].sort((a, b) => {
    const valA = keySelector(a);
    const valB = keySelector(b);
    if (valA === valB) return 0;
    const result = valA > valB ? 1 : -1;
    return order === 'asc' ? result : -result;
  });
};

Array.prototype.last = function <T>(this: T[]): T | undefined {
  return this.length > 0 ? this[this.length - 1] : undefined;
};

Array.prototype.isEmpty = function (): boolean {
  return this.length === 0;
};

// --- Number Extensions ---

Number.prototype.clamp = function (min: number, max: number): number {
  return Math.min(Math.max(this.valueOf(), min), max);
};

Number.prototype.toCurrency = function (
  locale = 'en-US',
  currency = 'USD',
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    this.valueOf(),
  );
};

// --- Promise Extensions ---

/**
 * Static extension for the Promise constructor to handle timeouts.
 * Ideal for racing against long-running Agent tasks.
 * @author Matan Bardugo
 */
Promise.timeout = function (ms: number, message?: string): Promise<never> {
  return new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(message || `Operation timed out after ${ms}ms`));
    }, ms);
  });
};

Promise.delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

// --- Matcher Implementation ---

class Matcher<T, R> implements MatchBuilder<T, R> {
  private _cases = new Map<T, R | (() => R)>();

  constructor(private _value: T) {}

  case(value: T, result: R | (() => R)) {
    this._cases.set(value, result);
    return this;
  }

  default(result: R | (() => R)): R {
    const handler = this._cases.get(this._value) || result;
    return typeof handler === 'function' ? (handler as () => R)() : handler;
  }
}

(globalThis as any).match = (val: any) => new Matcher(val);

// --- Fluent Builder ---

// --- TaskBuilder Updates (Robust Retry) ---

class TaskBuilder<T> implements SafeExecutionBuilder<T> {
  private _errCb?: (err: Error) => void;
  private _finishCb?: () => void;
  private _limitMs?: number;
  private _fallback?: T;
  private _retries = 0; // New

  constructor(private _work: () => T | Promise<T>) {}

  retry(count: number) {
    this._retries = count;
    return this;
  }
  onError(h: (err: Error) => void) {
    this._errCb = h;
    return this;
  }
  onFinish(h: () => void) {
    this._finishCb = h;
    return this;
  }
  fallback(v: T) {
    this._fallback = v;
    return this;
  }
  limit(ms: number) {
    this._limitMs = ms;
    return this;
  }

  async go(): Promise<T> {
    let attempts = 0;
    while (attempts <= this._retries) {
      try {
        const p = Promise.resolve(this._work());
        return this._limitMs
          ? await Promise.race([p, Promise.timeout(this._limitMs)])
          : await p;
      } catch (err: any) {
        attempts++;
        if (attempts > this._retries) {
          // Defensive err check
          if (!err) {
            const fallbackError = new Error('Unknown error occurred');
            this._errCb?.(fallbackError);
            return this._fallback!;
          }

          const error = err instanceof Error ? err : new Error(String(err));
          this._errCb?.(error);
          this._finishCb?.(); // Execute finish ONLY after retries exhausted
          return this._fallback!;
        }
        // Exponential backoff retry
        await Promise.delay(attempts * 500);
      }
      // Removed finally - logic now inline
    }
    // Unreachable due to retry logic, but TypeScript safety
    throw new Error('TaskBuilder exhausted retries without fallback');
  }
}

(globalThis as any).task = <T>(work: any) => new TaskBuilder<T>(work);

class SortedArray<T> {
    private _array: T[];

    constructor(initialItems: T[] = []) {
        this._array = [...initialItems].sort((a, b) => this.compare(a, b));
    }

    get array(): ReadonlyArray<T> {
        return this._array;
    }

    add(item: T): void {
        if (this.contains(item)) return;

        const index = this.findInsertIndex(item);
        this._array.splice(index, 0, item);
    }

    remove(item: T): boolean {
        const index = this.indexOf(item);
        if (index === -1) return false;

        this._array.splice(index, 1);
        return true;
    }

    contains(item: T): boolean {
        return this.indexOf(item) !== -1;
    }

    indexOf(item: T): number {
        const index = this.binarySearch(item);
        return index >= 0 ? index : -1;
    }

    private binarySearch(item: T): number {
        let left = 0;
        let right = this._array.length - 1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const cmp = this.compare(item, this._array[mid]);

            if (cmp === 0) return mid;
            if (cmp < 0) right = mid - 1;
            else left = mid + 1;
        }

        return ~left; // Returns the insertion point
    }

    private findInsertIndex(item: T): number {
        const index = this.binarySearch(item);
        return index >= 0 ? index : ~index;
    }

    private compare(a: T, b: T): number {
        return a < b ? -1 : a > b ? 1 : 0;
    }
}

(globalThis as any).SortedArray = SortedArray;

export {}; // Ensure this file is treated as a module
