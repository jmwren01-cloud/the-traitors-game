import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { useRovingFocus } from './useRovingFocus';

interface HarnessProps {
  initialIds: string[];
  preferredId?: string | null;
  onActivate?: (id: string) => void;
  onCancel?: () => void;
}

interface HarnessHandle {
  setIds: (ids: string[]) => void;
}

function Harness({
  initialIds,
  preferredId = null,
  onActivate = () => {},
  onCancel,
  handleRef,
}: HarnessProps & { handleRef?: (h: HarnessHandle) => void }) {
  const [ids, setIds] = useState(initialIds);
  if (handleRef) handleRef({ setIds });
  const { focusedId, getItemProps } = useRovingFocus({
    itemIds: ids,
    preferredId,
    onActivate,
    onCancel,
  });
  return (
    <div>
      <div data-testid="focused">{focusedId ?? ''}</div>
      <div role="radiogroup">
        {ids.map((id) => (
          <button
            {...getItemProps(id)}
            key={id}
            data-testid={`item-${id}`}
            type="button"
          >
            {id}
          </button>
        ))}
      </div>
    </div>
  );
}

const getItem = (id: string) => screen.getByTestId(`item-${id}`) as HTMLButtonElement;
const focusedText = () => screen.getByTestId('focused').textContent;

describe('useRovingFocus', () => {
  it('initialises focus on the first item when no preferredId is given', () => {
    render(<Harness initialIds={['a', 'b', 'c']} />);
    expect(focusedText()).toBe('a');
    expect(getItem('a').tabIndex).toBe(0);
    expect(getItem('b').tabIndex).toBe(-1);
    expect(getItem('c').tabIndex).toBe(-1);
  });

  it('honours preferredId when it exists in the item list', () => {
    render(<Harness initialIds={['a', 'b', 'c']} preferredId="b" />);
    expect(focusedText()).toBe('b');
    expect(getItem('b').tabIndex).toBe(0);
  });

  it('falls back to the first item when preferredId is not in the list', () => {
    render(<Harness initialIds={['a', 'b', 'c']} preferredId="z" />);
    expect(focusedText()).toBe('a');
  });

  it('renders no roving items when itemIds is empty', () => {
    render(<Harness initialIds={[]} />);
    expect(focusedText()).toBe('');
  });

  describe('arrow-key navigation', () => {
    it('ArrowRight / ArrowDown move forward', () => {
      render(<Harness initialIds={['a', 'b', 'c']} />);
      const a = getItem('a');
      a.focus();
      fireEvent.keyDown(a, { key: 'ArrowRight' });
      expect(focusedText()).toBe('b');
      expect(document.activeElement).toBe(getItem('b'));

      fireEvent.keyDown(getItem('b'), { key: 'ArrowDown' });
      expect(focusedText()).toBe('c');
      expect(document.activeElement).toBe(getItem('c'));
    });

    it('ArrowLeft / ArrowUp move backward', () => {
      render(<Harness initialIds={['a', 'b', 'c']} preferredId="c" />);
      const c = getItem('c');
      c.focus();
      fireEvent.keyDown(c, { key: 'ArrowLeft' });
      expect(focusedText()).toBe('b');

      fireEvent.keyDown(getItem('b'), { key: 'ArrowUp' });
      expect(focusedText()).toBe('a');
    });

    it('wraps around the end of the list with ArrowRight', () => {
      render(<Harness initialIds={['a', 'b', 'c']} preferredId="c" />);
      const c = getItem('c');
      c.focus();
      fireEvent.keyDown(c, { key: 'ArrowRight' });
      expect(focusedText()).toBe('a');
      expect(document.activeElement).toBe(getItem('a'));
    });

    it('wraps around the start of the list with ArrowLeft', () => {
      render(<Harness initialIds={['a', 'b', 'c']} />);
      const a = getItem('a');
      a.focus();
      fireEvent.keyDown(a, { key: 'ArrowLeft' });
      expect(focusedText()).toBe('c');
      expect(document.activeElement).toBe(getItem('c'));
    });

    it('calls preventDefault on arrow keys so the page does not scroll', () => {
      render(<Harness initialIds={['a', 'b']} />);
      const a = getItem('a');
      a.focus();
      const evt = { key: 'ArrowDown' };
      const result = fireEvent.keyDown(a, evt);
      // fireEvent returns false when an event handler called preventDefault.
      expect(result).toBe(false);
    });
  });

  describe('Home / End', () => {
    it('Home jumps to the first item', () => {
      render(<Harness initialIds={['a', 'b', 'c']} preferredId="c" />);
      const c = getItem('c');
      c.focus();
      fireEvent.keyDown(c, { key: 'Home' });
      expect(focusedText()).toBe('a');
      expect(document.activeElement).toBe(getItem('a'));
    });

    it('End jumps to the last item', () => {
      render(<Harness initialIds={['a', 'b', 'c']} />);
      const a = getItem('a');
      a.focus();
      fireEvent.keyDown(a, { key: 'End' });
      expect(focusedText()).toBe('c');
      expect(document.activeElement).toBe(getItem('c'));
    });
  });

  describe('activation', () => {
    it('Enter calls onActivate with the focused id', () => {
      const onActivate = vi.fn();
      render(<Harness initialIds={['a', 'b', 'c']} preferredId="b" onActivate={onActivate} />);
      const b = getItem('b');
      b.focus();
      fireEvent.keyDown(b, { key: 'Enter' });
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(onActivate).toHaveBeenCalledWith('b');
    });

    it('Space calls onActivate with the focused id', () => {
      const onActivate = vi.fn();
      render(<Harness initialIds={['a', 'b']} onActivate={onActivate} />);
      const a = getItem('a');
      a.focus();
      fireEvent.keyDown(a, { key: ' ' });
      expect(onActivate).toHaveBeenCalledWith('a');
    });

    it('legacy Spacebar key also activates', () => {
      const onActivate = vi.fn();
      render(<Harness initialIds={['a']} onActivate={onActivate} />);
      const a = getItem('a');
      a.focus();
      fireEvent.keyDown(a, { key: 'Spacebar' });
      expect(onActivate).toHaveBeenCalledWith('a');
    });
  });

  describe('cancellation', () => {
    it('Escape calls onCancel when provided', () => {
      const onCancel = vi.fn();
      render(<Harness initialIds={['a', 'b']} onCancel={onCancel} />);
      const a = getItem('a');
      a.focus();
      fireEvent.keyDown(a, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('Escape is a no-op when onCancel is omitted', () => {
      render(<Harness initialIds={['a', 'b']} />);
      const a = getItem('a');
      a.focus();
      // Should not throw and focus must stay put.
      fireEvent.keyDown(a, { key: 'Escape' });
      expect(focusedText()).toBe('a');
    });
  });

  describe('roving tabindex', () => {
    it('moves the tabindex=0 onto the focused item', () => {
      render(<Harness initialIds={['a', 'b', 'c']} />);
      expect(getItem('a').tabIndex).toBe(0);
      expect(getItem('b').tabIndex).toBe(-1);
      expect(getItem('c').tabIndex).toBe(-1);

      const a = getItem('a');
      a.focus();
      fireEvent.keyDown(a, { key: 'ArrowRight' });

      expect(getItem('a').tabIndex).toBe(-1);
      expect(getItem('b').tabIndex).toBe(0);
      expect(getItem('c').tabIndex).toBe(-1);
    });

    it('updates focusedId when an item receives focus from outside', () => {
      render(<Harness initialIds={['a', 'b', 'c']} />);
      // Programmatic focus (e.g. shift+tab from elsewhere) fires onFocus.
      fireEvent.focus(getItem('c'));
      expect(focusedText()).toBe('c');
      expect(getItem('c').tabIndex).toBe(0);
      expect(getItem('a').tabIndex).toBe(-1);
    });
  });

  describe('item-list changes re-validate focus', () => {
    it('moves focus to the new first item when the focused id is removed', () => {
      let handle: HarnessHandle | undefined;
      render(
        <Harness
          initialIds={['a', 'b', 'c']}
          preferredId="b"
          handleRef={(h) => {
            handle = h;
          }}
        />,
      );
      expect(focusedText()).toBe('b');

      act(() => {
        handle!.setIds(['x', 'y']);
      });

      expect(focusedText()).toBe('x');
      expect(getItem('x').tabIndex).toBe(0);
    });

    it('keeps the focused id when it survives the update', () => {
      let handle: HarnessHandle | undefined;
      render(
        <Harness
          initialIds={['a', 'b', 'c']}
          preferredId="b"
          handleRef={(h) => {
            handle = h;
          }}
        />,
      );
      expect(focusedText()).toBe('b');

      act(() => {
        handle!.setIds(['b', 'c', 'd']);
      });

      expect(focusedText()).toBe('b');
    });

    it('adopts the first item when going from empty to populated', () => {
      let handle: HarnessHandle | undefined;
      render(
        <Harness
          initialIds={[]}
          handleRef={(h) => {
            handle = h;
          }}
        />,
      );
      expect(focusedText()).toBe('');

      act(() => {
        handle!.setIds(['p', 'q']);
      });

      expect(focusedText()).toBe('p');
    });
  });
});
