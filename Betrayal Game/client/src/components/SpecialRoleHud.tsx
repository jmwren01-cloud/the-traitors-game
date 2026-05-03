import { useEffect, useRef, useState } from 'react';
import type { Player, C2SEvent, Role, SheriffReport } from '../types';

const MEDIC_AUTO_SKIP_SECONDS = 30;

interface SpecialRoleHudProps {
  phase: string;
  myPlayerId?: string;
  myRole?: Role;
  players: Player[];
  traitorIds?: string[];
  sheriffReports?: SheriffReport[];
  medicProtectedTarget?: { id: string; name: string };
  seerResult?: { targetId: string; targetName: string; actualRole: Role };
  seerActivatedAlert?: boolean;
  onSend: (event: C2SEvent) => void;
}

const banner: React.CSSProperties = {
  background: 'rgba(20,20,28,0.92)',
  border: '1px solid #6a5acd',
  borderRadius: 8,
  padding: '10px 14px',
  margin: '8px 0',
  color: '#fff',
  fontSize: 14,
};

export function SpecialRoleHud(props: SpecialRoleHudProps) {
  const {
    phase, myPlayerId, myRole, players, traitorIds,
    sheriffReports, medicProtectedTarget, seerResult, seerActivatedAlert,
    onSend,
  } = props;

  const me = players.find((p) => p.id === myPlayerId);
  const seerGiftUsed = !!me?.seerGiftUsed;

  // Wave 4 — Medic picker auto-skip countdown. Restarts whenever a fresh
  // NIGHT begins (signalled by phase entering NIGHT with no current
  // protection submitted), and stops once a target is chosen or the
  // phase changes.
  const [medicSecondsLeft, setMedicSecondsLeft] = useState<number>(MEDIC_AUTO_SKIP_SECONDS);
  const medicTimerStartedFor = useRef<string | null>(null);
  const medicNightKey = `${phase}|${medicProtectedTarget ? 'submitted' : 'open'}`;
  useEffect(() => {
    if (myRole !== 'MEDIC') return;
    if (phase !== 'NIGHT' || medicProtectedTarget) {
      medicTimerStartedFor.current = null;
      setMedicSecondsLeft(MEDIC_AUTO_SKIP_SECONDS);
      return;
    }
    if (medicTimerStartedFor.current === medicNightKey) return;
    medicTimerStartedFor.current = medicNightKey;
    setMedicSecondsLeft(MEDIC_AUTO_SKIP_SECONDS);
    const interval = window.setInterval(() => {
      setMedicSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [myRole, phase, medicProtectedTarget, medicNightKey]);

  const blocks: React.ReactNode[] = [];

  if (myRole === 'SHERIFF' && sheriffReports && sheriffReports.length > 0) {
    const latest = sheriffReports[sheriffReports.length - 1]!;
    const history = sheriffReports.slice(0, -1).reverse();
    if (phase === 'MORNING') {
      blocks.push(
        <div key="sheriff-latest" style={banner}>
          <strong>🔍 Sheriff Report (Round {latest.round}):</strong>{' '}
          Your investigation of <em>{latest.targetName}</em> reports them as{' '}
          <strong>{latest.reportedRole}</strong>. (Reports are imperfect — about
          one in four is wrong.)
        </div>
      );
    }
    if (history.length > 0) {
      blocks.push(
        <div key="sheriff-history" style={banner}>
          <div style={{ marginBottom: 4 }}><strong>📜 My Investigations</strong></div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {history.map((r) => (
              <li key={`${r.round}-${r.targetId}`}>
                Round {r.round}: <em>{r.targetName}</em> →{' '}
                <strong>{r.reportedRole}</strong>
              </li>
            ))}
          </ul>
        </div>
      );
    }
  }

  if (myRole === 'MEDIC' && phase === 'NIGHT') {
    const aliveOthers = players.filter((p) => p.isAlive && p.id !== myPlayerId);
    const lastTarget = me?.medicLastProtectedTargetId;
    if (medicProtectedTarget) {
      blocks.push(
        <div key="medic-confirm" style={banner}>
          🛡️ You are silently protecting <strong>{medicProtectedTarget.name}</strong> tonight.
        </div>
      );
    } else if (medicSecondsLeft > 0) {
      blocks.push(
        <div key="medic-pick" style={banner}>
          <div>
            <strong>🛡️ Medic — choose a player to protect tonight</strong>{' '}
            <span style={{ opacity: 0.75, fontSize: 12 }}>
              ({medicSecondsLeft}s — auto-skip if you don't pick)
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {aliveOthers.map((p) => {
              const disabled = p.id === lastTarget;
              return (
                <button
                  key={p.id}
                  disabled={disabled}
                  onClick={() => onSend({ type: 'C2S_MEDIC_PROTECT', payload: { targetId: p.id } })}
                  title={disabled ? 'Cannot protect the same player two nights in a row' : ''}
                  style={{ padding: '4px 8px', borderRadius: 4 }}
                >
                  {p.name}{disabled ? ' (last night)' : ''}
                </button>
              );
            })}
          </div>
        </div>
      );
    } else {
      blocks.push(
        <div key="medic-skipped" style={banner}>
          ⌛ You did not protect anyone tonight.
        </div>
      );
    }
  }

  if (myRole === 'SEER' && phase === 'ROUNDTABLE') {
    if (seerResult) {
      blocks.push(
        <div key="seer-result" style={banner}>
          🔮 Your gift revealed: <strong>{seerResult.targetName}</strong> is truly{' '}
          <strong>{seerResult.actualRole}</strong>.
        </div>
      );
    } else if (!seerGiftUsed) {
      blocks.push(
        <div key="seer-pick" style={banner}>
          <div><strong>🔮 Seer — one-time true-role reveal</strong></div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
            Burning your gift reveals the TRUE role of one randomly chosen
            player. You do not pick the target.
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => onSend({ type: 'C2S_ACTIVATE_SEER', payload: {} })}
              style={{ padding: '6px 12px', borderRadius: 4 }}
            >
              Activate Gift
            </button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            Warning: the Traitors will be alerted that the Seer has acted.
          </div>
        </div>
      );
    }
  }

  if (myRole === 'TRAITOR' && seerActivatedAlert && (traitorIds?.includes(myPlayerId ?? '') ?? false)) {
    blocks.push(
      <div key="seer-alert" style={{ ...banner, borderColor: '#c0392b' }}>
        ⚠️ The Seer has used their gift. Someone now knows a true role.
      </div>
    );
  }

  if (blocks.length === 0) return null;
  return <div style={{ position: 'fixed', top: 8, left: 8, right: 8, zIndex: 50, maxWidth: 520, margin: '0 auto' }}>{blocks}</div>;
}
