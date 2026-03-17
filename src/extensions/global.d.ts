export {}; // Ensure this file is treated as a module

declare global {
  /**
   * String Prototype Extensions
   */
  interface String {
    /**
     * Checks if the string is null, undefined, or empty after trimming whitespace.
     * @author Matan Bardugo
     * @returns {boolean} True if the string is null, empty, or only whitespace.
     * @example "".isNullOrEmpty() // true
     */
    isNullOrEmpty(): boolean;

    /**
     * Capitalizes the first character and lowercases the rest.
     * @author Matan Bardugo
     * @returns {string} The formatted string.
     * @example "hello WORLD".capitalize() // "Hello world"
     */
    capitalize(): string;

    /**
     * Truncates the string to a specified length and appends an ellipsis.
     * @author Matan Bardugo
     * @param {number} length Maximum length before truncation.
     * @returns {string} The truncated string or original if shorter than length.
     * @example "Long text here".truncate(5) // "Long ..."
     */
    truncate(length: number): string;
  }

  /**
   * Array Prototype Extensions
   */
  interface Array<T> {
    /**
     * Groups elements into a Map based on a key selector.
     * @author Matan Bardugo
     * @param keySelector Function to extract the key for each element.
     * @returns {Map<K, T[]>} A Map of grouped elements.
     */
    groupBy<K>(keySelector: (item: T) => K): Map<K, T[]>;

    /**
     * Returns a new array containing only unique elements.
     * @author Matan Bardugo
     * @returns {T[]} Array with duplicates removed.
     */
    unique(): T[];

    /**
     * Returns a sorted copy of the array based on a key.
     * @author Matan Bardugo
     * @param keySelector Function to select the sort property.
     * @param {('asc'|'desc')} [order='asc'] The sort direction.
     * @returns {T[]} A new sorted array.
     */
    sortBy(keySelector: (item: T) => any, order?: 'asc' | 'desc'): T[];

    /**
     * Retrieves the last element of the array.
     * @returns {T | undefined} The last item or undefined if empty.
     */
    last(): T | undefined;

    isEmpty(): boolean;
  }

  /**
   * Number Prototype Extensions
   */
  interface Number {
    /**
     * Restricts the number to remain within a specific range.
     * @author Matan Bardugo
     * @param {number} min Minimum allowed value.
     * @param {number} max Maximum allowed value.
     * @returns {number} The clamped value.
     */
    clamp(min: number, max: number): number;

    /**
     * Formats the number as a currency string.
     * @author Matan Bardugo
     * @param {string} [locale='en-US'] The BCP 47 language tag.
     * @param {string} [currency='USD'] The ISO 4217 currency code.
     * @returns {string} Formatted currency string.
     */
    toCurrency(locale?: string, currency?: string): string;
  }

  /**
   * Promise Static Extensions
   */
  interface PromiseConstructor {
    /**
     * Returns a promise that rejects after a set time.
     * Ideal for use with Promise.race() to enforce timeouts in Agent execution.
     * @author Matan Bardugo
     * @param {number} ms Timeout in milliseconds.
     * @param {string} [message] Custom error message for the timeout.
     * @returns {Promise<never>}
     * @example Promise.race([fetchData(), Promise.timeout(5000)])
     */
    timeout(ms: number, message?: string): Promise<never>;

    /**
     * Pauses execution for a set time.
     * @param {number} ms Timeout in milliseconds.
     * @return {Promise<void>}
     */
    delay(ms: number): Promise<void>;
  }

  /**
   * Fluent builder for safe, predictable task execution.
   */
  interface SafeExecutionBuilder<T> {
    /** * Sets a fallback value to be returned if the task fails or exceeds its time limit.
     * @author Matan Bardugo
     * @param {T} value The value to return on failure.
     * @returns {SafeExecutionBuilder<T>} The builder instance.
     */
    fallback(value: T): SafeExecutionBuilder<T>;

    /** * Enforces a maximum duration for the task.
     * Internally leverages Promise.timeout to prevent long-running hangs.
     * @param {number} ms Maximum execution time in milliseconds.
     * @returns {SafeExecutionBuilder<T>} The builder instance.
     */
    limit(ms: number): SafeExecutionBuilder<T>;

    /** * Registers a custom error handler to be executed upon failure.
     * @param {function(Error): void} handler Callback receiving the caught error.
     * @returns {SafeExecutionBuilder<T>} The builder instance.
     */
    onError(handler: (err: Error) => void): SafeExecutionBuilder<T>;

    /** * Registers a callback to be executed regardless of the outcome.
     * Ideal for UI cleanups like stopping loaders or closing connections.
     * @param {function(): void} handler Finalization callback.
     * @returns {SafeExecutionBuilder<T>} The builder instance.
     */
    onFinish(handler: () => void): SafeExecutionBuilder<T>;

    /** * Finalizes the configuration and triggers the task execution.
     * @returns {Promise<T | undefined>} A promise resolving to the task result, the fallback value, or undefined.
     */
    go(): Promise<T | undefined>;

    /** * Retries the task N times on failure before returning fallback.
     * Essential for flaky AI LLM endpoints.
     * @param {count: number}
     * @return {SafeExecutionBuilder<T>} The builder instance.
     */
    retry(count: number): SafeExecutionBuilder<T>;
  }

  /**
   * Functional switch-case replacement.
   */
  interface MatchBuilder<T, R> {
    case(value: T, result: R | (() => R)): MatchBuilder<T, R>;
    default(result: R | (() => R)): R;
  }

  /**
   *
   * @param value
   */
  function match<T, R = any>(value: T): MatchBuilder<T, R>;

  /**
   * Initializes a fluent task execution chain.
   * Useful for wrapping LangGraph nodes or NestJS service calls in a safety layer.
   * @author Matan Bardugo
   * @param {function(): T | Promise<T>} work The logic to be executed.
   * @returns {SafeExecutionBuilder<T>} A new builder instance.
   * @example const res = await task(() => api.call()).limit(2000).go();
   */
  function task<T>(work: () => T | Promise<T>): SafeExecutionBuilder<T>;
}
