import { useState, useEffect } from 'react';
import type { Player, Role, C2SEvent } from '../types';

interface SeerReadingEntry {
  round: number;
  targetId: string;
  targetName: string;
  role: Role;
}

interface SeerControlProps {
  myRole?: Role;
  myPlayerId?: string;
  players: Player[];
  phase: string;
  currentRound?: number;
  seerResult?: SeerReadingEntry;
  seerActivatedRounds?: number[];
  onSend: (event: C2SEvent) => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.78)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const cardStyle: React.CSSProperties = {
  background: '#1a1326',
  border: '2px solid #b794f6',
  borderRadius: 12,
  padding: 24,
  maxWidth: 420,
  width: '100%',
  color: '#f5e9d3',
  textAlign: 'center',
};

const buttonStyle: React.CSSProperties = {
  minHeight: 54,
  border: 'none',
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 15,
  padding: '12px 18px',
  cursor: 'pointer',
};

const fabStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 80,
  left: 12,
  zIndex: 999,
  background: '#b794f6',
  color: '#1a1326',
  border: 'none',
  borderRadius: 30,
  padding: '12px 18px',
  minHeight: 54,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
};

function roleLabel(role: Role): string {
  if (role === 'TRAITOR') return 'TRAITOR';
  if (role === 'SHERIFF') return 'Sheriff';
  if (role === 'MEDIC') return 'Medic';
  if (role === 'SEER') return 'Seer';
  return 'Faithful';
}

function roleColor(role: Role): string {
  return role === 'TRAITOR' ? '#ff6b6b' : '#7bd389';
}

export function SeerControl({
  myRole,
  myPlayerId,
  players,
  phase,
  currentRound,
  seerResult,
  seerActivatedRounds,
  onSend,
}: SeerControlProps) {
  const [confirming, setConfirming] = useState(false);
  const [dismissedReading, setDismissedReading] = useState<string | null>(null);
  const me = players.find((p) => p.id === myPlayerId);
  const isSeer = myRole === 'SEER';
  const giftUsed = me?.seerUsedAtRound !== undefined;

  useEffect(() => {
    if (seerResult) setDismissedReading(null);
  }, [seerResult?.round, seerResult?.targetId]);

  // Traitor notice — small banner shown at top of roundtable.
  if (myRole === 'TRAITOR' && phase === 'ROUNDTABLE' && currentRound !== undefined) {
    const activeRound = seerActivatedRounds?.includes(currentRound);
    if (activeRound) {
      return (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: 70,
            left: 12,
            right: 12,
            zIndex: 998,
            background: '#3a1f4f',
            color: '#e9d8fd',
            border: '1px solid #b794f6',
            borderRadius: 8,
            padding: '10px 14px',
            textAlign: 'center',
            fontSize: 14,
          }}
        >
          🔮 The Seer has used their gift this round.
        </div>
      );
    }
  }

  if (!isSeer) return null;

  const showFab = phase === 'ROUNDTABLE' && me?.isAlive && !giftUsed;
  const showReading = seerResult && (dismissedReading !== `${seerResult.round}-${seerResult.targetId}`);

  return (
    <>
      {showFab && !confirming && (
        <button type="button" style={fabStyle} onClick={() => setConfirming(true)}>
          🔮 Activate Gift
        </button>
      )}
      {showFab === false && giftUsed && me?.isAlive && phase === 'ROUNDTABLE' && (
        <div
          style={{
            position: 'fixed',
            bottom: 80,
            left: 12,
            zIndex: 999,
            background: '#3a2a52',
            color: '#b794f6',
            border: '1px solid #b794f6',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
          }}
        >
          🔮 Gift used — Round {me?.seerUsedAtRound}
        </div>
      )}
      {confirming && (
        <div style={overlayStyle} role="dialog" aria-modal="true">
          <div style={cardStyle}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔮</div>
            <h2 style={{ margin: '0 0 8px' }}>Activate your gift?</h2>
            <p style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.45 }}>
              You will receive the true role of a randomly chosen alive player. The Traitors will
              be told a Seer used their gift this round (but not who you are). This is one-shot.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
              <button
                type="button"
                style={{ ...buttonStyle, background: '#3a2a52', color: '#f5e9d3' }}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, background: '#b794f6', color: '#1a1326' }}
                onClick={() => {
                  onSend({ type: 'C2S_ACTIVATE_SEER', payload: {} });
                  setConfirming(false);
                }}
              >
                Activate
              </button>
            </div>
          </div>
        </div>
      )}
      {showReading && seerResult && (
        <div style={overlayStyle} role="dialog" aria-modal="true">
          <div style={cardStyle}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔮</div>
            <h2 style={{ margin: '0 0 4px' }}>Your Reading</h2>
            <p style={{ opacity: 0.7, marginTop: 0, fontSize: 13 }}>Round {seerResult.round}</p>
            <p style={{ fontSize: 18, margin: '16px 0 4px' }}>
              <strong>{seerResult.targetName}</strong>
            </p>
            <p
              style={{
                fontSize: 22,
                fontWeight: 700,
                margin: '0 0 12px',
                color: roleColor(seerResult.role),
              }}
            >
              {roleLabel(seerResult.role)}
            </p>
            <p style={{ fontSize: 12, opacity: 0.75 }}>The Seer's gift never lies.</p>
            <button
              type="button"
              style={{ ...buttonStyle, background: '#b794f6', color: '#1a1326', marginTop: 12 }}
              onClick={() => setDismissedReading(`${seerResult.round}-${seerResult.targetId}`)}
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}
    </>
  );
}
