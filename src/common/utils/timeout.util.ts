/** Wraps a promise with a timeout that rejects if not resolved in time. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );

    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
