import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface RovingItemProps {
  ref: (el: HTMLButtonElement | null) => void;
  tabIndex: 0 | -1;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
}

export interface UseRovingFocusOptions {
  itemIds: string[];
  preferredId?: string | null;
  onActivate: (id: string) => void;
  onCancel?: () => void;
}

export interface UseRovingFocusResult {
  focusedId: string | null;
  getItemProps: (id: string) => RovingItemProps;
  setFocusedId: (id: string) => void;
}

export function useRovingFocus(opts: UseRovingFocusOptions): UseRovingFocusResult {
  const { itemIds, preferredId, onActivate, onCancel } = opts;
  const idsKey = itemIds.join('|');

  const [focusedId, setFocusedId] = useState<string | null>(() => {
    if (preferredId && itemIds.includes(preferredId)) return preferredId;
    return itemIds[0] ?? null;
  });
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (focusedId && !itemIds.includes(focusedId)) {
      setFocusedId(itemIds[0] ?? null);
    } else if (!focusedId && itemIds.length > 0) {
      setFocusedId(itemIds[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const focusId = useCallback((id: string) => {
    setFocusedId(id);
    const el = refs.current.get(id);
    if (el) el.focus();
  }, []);

  const moveFocus = useCallback(
    (delta: number) => {
      if (itemIds.length === 0) return;
      const idx = focusedId ? itemIds.indexOf(focusedId) : -1;
      const start = idx === -1 ? 0 : idx;
      const len = itemIds.length;
      const nextIdx = (start + delta + len) % len;
      const nextId = itemIds[nextIdx];
      if (nextId) focusId(nextId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedId, idsKey, focusId],
  );

  const focusEdge = useCallback(
    (toEnd: boolean) => {
      const nextId = toEnd ? itemIds[itemIds.length - 1] : itemIds[0];
      if (nextId) focusId(nextId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey, focusId],
  );

  const getItemProps = useCallback(
    (id: string): RovingItemProps => ({
      ref: (el) => {
        if (el) refs.current.set(id, el);
        else refs.current.delete(id);
      },
      tabIndex: focusedId === id || (focusedId === null && itemIds[0] === id) ? 0 : -1,
      onFocus: () => setFocusedId(id),
      onKeyDown: (e) => {
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown':
            e.preventDefault();
            moveFocus(1);
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
            e.preventDefault();
            moveFocus(-1);
            break;
          case 'Home':
            e.preventDefault();
            focusEdge(false);
            break;
          case 'End':
            e.preventDefault();
            focusEdge(true);
            break;
          case 'Escape':
            if (onCancel) {
              e.preventDefault();
              onCancel();
            }
            break;
          case 'Enter':
          case ' ':
          case 'Spacebar':
            e.preventDefault();
            onActivate(id);
            break;
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedId, idsKey, moveFocus, focusEdge, onActivate, onCancel],
  );

  return { focusedId, getItemProps, setFocusedId };
}
