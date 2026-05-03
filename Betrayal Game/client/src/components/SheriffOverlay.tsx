import { useState, useEffect } from 'react';
import type { SheriffResult } from '../types';

interface SheriffResultEntry {
  round: number;
  targetId: string;
  targetName: string;
  result: SheriffResult;
}

interface SheriffOverlayProps {
  myRole?: string;
  sheriffResult?: SheriffResultEntry;
  sheriffHistory?: SheriffResultEntry[];
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
  border: '2px solid #ffd166',
  borderRadius: 12,
  padding: 24,
  maxWidth: 420,
  width: '100%',
  color: '#f5e9d3',
  textAlign: 'center',
};

const buttonStyle: React.CSSProperties = {
  marginTop: 18,
  minHeight: 54,
  background: '#ffd166',
  color: '#1a1326',
  border: 'none',
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 16,
  padding: '12px 24px',
  cursor: 'pointer',
};

const historyButtonStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 80,
  left: 12,
  zIndex: 999,
  background: '#3a2a52',
  color: '#ffd166',
  border: '1px solid #ffd166',
  borderRadius: 8,
  padding: '8px 12px',
  minHeight: 44,
  cursor: 'pointer',
  fontSize: 13,
};

export function SheriffOverlay({ myRole, sheriffResult, sheriffHistory }: SheriffOverlayProps) {
  const [dismissedRound, setDismissedRound] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Reset dismissal whenever a new result lands.
  useEffect(() => {
    if (sheriffResult) setDismissedRound(null);
  }, [sheriffResult?.round, sheriffResult?.targetId]);

  if (myRole !== 'SHERIFF') return null;

  const pending = sheriffResult && sheriffResult.round !== dismissedRound;
  const history = sheriffHistory ?? [];

  return (
    <>
      {history.length > 0 && (
        <button type="button" style={historyButtonStyle} onClick={() => setShowHistory((s) => !s)}>
          🕵️ My Investigations ({history.length})
        </button>
      )}
      {pending && sheriffResult && (
        <div style={overlayStyle} role="dialog" aria-modal="true">
          <div style={cardStyle}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🕵️</div>
            <h2 style={{ margin: '0 0 4px' }}>Sheriff's Reading</h2>
            <p style={{ opacity: 0.7, marginTop: 0, fontSize: 13 }}>Round {sheriffResult.round} — Private</p>
            <p style={{ fontSize: 18, margin: '16px 0 4px' }}>
              <strong>{sheriffResult.targetName}</strong>
            </p>
            <p
              style={{
                fontSize: 22,
                fontWeight: 700,
                margin: '0 0 12px',
                color: sheriffResult.result === 'SUSPICIOUS' ? '#ff6b6b' : '#7bd389',
              }}
            >
              {sheriffResult.result === 'SUSPICIOUS' ? 'SUSPICIOUS' : 'CLEAR'}
            </p>
            <p style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
              Your readings are mostly reliable, but they are not infallible — about one in four
              comes back wrong.
            </p>
            <button type="button" style={buttonStyle} onClick={() => setDismissedRound(sheriffResult.round)}>
              Acknowledge
            </button>
          </div>
        </div>
      )}
      {showHistory && (
        <div style={overlayStyle} role="dialog" aria-modal="true">
          <div style={{ ...cardStyle, textAlign: 'left' }}>
            <h2 style={{ margin: '0 0 12px', textAlign: 'center' }}>My Investigations</h2>
            {history.length === 0 ? (
              <p style={{ opacity: 0.7 }}>No readings yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {history.map((h, i) => (
                  <li
                    key={`${h.round}-${h.targetId}-${i}`}
                    style={{
                      padding: '8px 0',
                      borderBottom: '1px solid #3a2a52',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <span style={{ opacity: 0.85 }}>R{h.round} · {h.targetName}</span>
                    <strong style={{ color: h.result === 'SUSPICIOUS' ? '#ff6b6b' : '#7bd389' }}>
                      {h.result}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" style={buttonStyle} onClick={() => setShowHistory(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
