import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SuspicionTokenHistoryPanel } from './SuspicionTokenHistoryPanel';
import type { Player, SuspicionToken } from '../types';

const players: Player[] = [
  { id: 'p1', name: 'Alice', isHost: true, isAlive: true },
  { id: 'p2', name: 'Bob', isHost: false, isAlive: true },
  { id: 'p3', name: 'Cara', isHost: false, isAlive: true },
];

function token(
  placerId: string,
  targetId: string,
  round: number,
  isAuto = false,
): SuspicionToken {
  return { placerId, targetId, round, isAuto };
}

const openPanel = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /Past Suspicions/i }));
};

describe('SuspicionTokenHistoryPanel', () => {
  it('renders nothing when byRound is undefined', () => {
    const { container } = render(
      <SuspicionTokenHistoryPanel players={players} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when byRound is empty', () => {
    const { container } = render(
      <SuspicionTokenHistoryPanel players={players} byRound={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a tab per completed round, defaulting to the most recent', () => {
    const byRound: Record<number, SuspicionToken[]> = {
      1: [token('p1', 'p2', 1), token('p2', 'p3', 1)],
      2: [token('p1', 'p3', 2), token('p2', 'p3', 2)],
      3: [token('p1', 'p2', 3), token('p2', 'p1', 3)],
    };
    render(<SuspicionTokenHistoryPanel players={players} byRound={byRound} />);

    const toggle = screen.getByRole('button', { name: /Past Suspicions \(3\)/ });
    fireEvent.click(toggle);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['R3', 'R2', 'R1']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');

    expect(screen.getByText(/Changes vs Round 2/)).toBeInTheDocument();
  });

  it('selecting an older round updates the displayed graph and diff', () => {
    const byRound: Record<number, SuspicionToken[]> = {
      1: [token('p1', 'p2', 1)],
      2: [token('p1', 'p3', 2), token('p2', 'p3', 2)],
      3: [
        token('p1', 'p2', 3),
        token('p2', 'p1', 3),
        token('p3', 'p1', 3),
      ],
    };
    render(<SuspicionTokenHistoryPanel players={players} byRound={byRound} />);
    openPanel();

    expect(screen.getByText(/Changes vs Round 2/)).toBeInTheDocument();
    let graph = screen.getByRole('img', { name: /Suspicion Token graph/i });
    expect(graph.querySelectorAll('line')).toHaveLength(3);

    fireEvent.click(screen.getByRole('tab', { name: 'R2' }));

    const tabs = screen.getAllByRole('tab');
    expect(tabs.find((t) => t.textContent === 'R2')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(tabs.find((t) => t.textContent === 'R3')).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByText(/Changes vs Round 1/)).toBeInTheDocument();

    graph = screen.getByRole('img', { name: /Suspicion Token graph/i });
    expect(graph.querySelectorAll('line')).toHaveLength(2);

    fireEvent.click(screen.getByRole('tab', { name: 'R1' }));
    graph = screen.getByRole('img', { name: /Suspicion Token graph/i });
    expect(graph.querySelectorAll('line')).toHaveLength(1);
    expect(screen.queryByText(/Changes vs Round/)).not.toBeInTheDocument();
  });

  it('omits the diff section for the earliest round (no prior round)', () => {
    const byRound: Record<number, SuspicionToken[]> = {
      1: [token('p1', 'p2', 1)],
    };
    render(<SuspicionTokenHistoryPanel players={players} byRound={byRound} />);
    openPanel();
    expect(screen.queryByText(/Changes vs Round/)).not.toBeInTheDocument();
  });

  it('"Changes vs Round N" lists only placers whose target shifted', () => {
    const byRound: Record<number, SuspicionToken[]> = {
      1: [
        token('p1', 'p2', 1),
        token('p2', 'p3', 1),
        token('p3', 'p1', 1),
      ],
      2: [
        token('p1', 'p3', 2),
        token('p2', 'p3', 2),
        token('p3', 'p2', 2),
      ],
    };
    render(<SuspicionTokenHistoryPanel players={players} byRound={byRound} />);
    openPanel();

    const diffTitle = screen.getByText(/Changes vs Round 1/);
    const diffSection = diffTitle.parentElement!;
    const items = within(diffSection).getAllByRole('listitem');
    expect(items).toHaveLength(2);

    const texts = items.map((li) => li.textContent ?? '');
    expect(texts.some((t) => /Alice.*shifted.*Bob.*Cara/.test(t))).toBe(true);
    expect(texts.some((t) => /Cara.*shifted.*Alice.*Bob/.test(t))).toBe(true);
    expect(texts.some((t) => /Bob/.test(t.split('shifted')[0] ?? ''))).toBe(false);
  });

  it('shows "No one shifted suspicion." when targets are unchanged', () => {
    const byRound: Record<number, SuspicionToken[]> = {
      1: [token('p1', 'p2', 1), token('p2', 'p3', 1)],
      2: [token('p1', 'p2', 2), token('p2', 'p3', 2)],
    };
    render(<SuspicionTokenHistoryPanel players={players} byRound={byRound} />);
    openPanel();
    expect(screen.getByText('No one shifted suspicion.')).toBeInTheDocument();
  });
});
