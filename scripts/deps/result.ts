export type Result<T, E> = { data: T; error: null } | { data: null; error: E };

/** Narrows a Result where `if (error)` can't: inside generic code. */
export function failed<T, E>(result: Result<T, E>): result is { data: null; error: E } {
  return result.error !== null;
}
