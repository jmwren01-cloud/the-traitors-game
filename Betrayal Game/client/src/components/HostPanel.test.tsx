import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HostPanel } from './HostPanel';
import type { Player, Vote } from '../types';

const players: Player[] = [
  { id: 'host', name: 'Alice', isHost: true, isAlive: true },
  { id: 'p2', name: 'Bob', isHost: false, isAlive: true },
];

const votes: Vote[] = [
  { voterId: 'host', targetId: 'p2' },
  { voterId: 'p2', targetId: 'host' },
];

const openPanel = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /host panel/i }));
};

describe('HostPanel — VOTE_REVEAL banish control', () => {
  it('shows only a waiting hint while votes are still revealing', () => {
    render(
      <HostPanel
        players={players}
        myPlayerId="host"
        phase="VOTE_REVEAL"
        votes={votes}
        revealedVotes={[votes[0]!]}
        voteCount={{ received: 2, needed: 2 }}
        onSend={vi.fn()}
      />,
    );
    openPanel();
    expect(screen.queryByRole('button', { name: /Banish Player/i })).toBeNull();
    expect(screen.getByText(/banish prompt will appear when complete/i)).toBeTruthy();
  });

  it('offers "Banish Player" once every vote has been revealed, and sends C2S_BANISH_PLAYER', () => {
    const onSend = vi.fn();
    render(
      <HostPanel
        players={players}
        myPlayerId="host"
        phase="VOTE_REVEAL"
        votes={votes}
        revealedVotes={votes}
        voteCount={{ received: 2, needed: 2 }}
        onSend={onSend}
      />,
    );
    openPanel();
    const button = screen.getByRole('button', { name: /Banish Player/i });
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith({ type: 'C2S_BANISH_PLAYER', payload: {} });
  });
});
