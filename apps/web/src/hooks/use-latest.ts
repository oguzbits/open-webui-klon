import { useEffect, useRef } from 'react';

/**
 * A ref that always holds the value of the latest render. For callbacks that a library keeps from the first render
 * on (`useChat` stores its options once): they read the ref instead of a stale closure.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
