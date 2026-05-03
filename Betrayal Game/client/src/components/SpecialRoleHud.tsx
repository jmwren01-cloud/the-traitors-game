import { useEffect, useRef, useState } from 'react';
import type { Player, C2SEvent, Role, SheriffReport } from '../types';
import { useRovingFocus } from '../hooks/useRovingFocus';

const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const medicCandidateBaseStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  font: 'inherit',
  cursor: 'pointer',
  minHeight: 36,
};

const medicCandidateFocusStyle: React.CSSProperties = {
  outline: '3px solid #ffd54a',
  outlineOffset: 2,
};

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

  // Locally dismissed Medic picker. The server auto-skips after the
  // timer; this lets a keyboard user explicitly skip without committing
  // a protection. We compare against the current nightId so a stale
  // skip from a previous night does not bleed through.
  const nightId = `${phase}-${me?.medicLastProtectedTargetId ?? ''}`;
  const [medicSkippedNight, setMedicSkippedNight] = useState<string | null>(null);
  const [transientMedicMsg, setTransientMedicMsg] = useState<string | null>(null);

  const medicPickerVisible =
    myRole === 'MEDIC'
    && phase === 'NIGHT'
    && !medicProtectedTarget
    && medicSkippedNight !== nightId;
  const medicCandidates = medicPickerVisible
    ? players.filter((p) => p.isAlive && p.id !== myPlayerId)
    : [];
  const medicLastTarget = me?.medicLastProtectedTargetId;
  const medicEligibleIds = medicCandidates
    .filter((p) => p.id !== medicLastTarget)
    .map((p) => p.id);
  const medicPickerOpenForUser = medicPickerVisible && medicSecondsLeft > 0;

  const medicAnnouncement = transientMedicMsg
    ?? (medicPickerOpenForUser
      ? 'Medic picker open. Use arrow keys to move, Enter or Space to protect, Escape to skip tonight.'
      : '');

  const skipMedicProtection = (reason: 'escape' | 'button') => {
    setMedicSkippedNight(nightId);
    setTransientMedicMsg(
      reason === 'escape'
        ? 'Protection skipped via Escape. The night will auto-resolve.'
        : 'Protection skipped. The night will auto-resolve.',
    );
  };

  const medicRoving = useRovingFocus({
    itemIds: medicEligibleIds,
    onActivate: (id) => {
      if (id === medicLastTarget) return;
      const name = players.find((p) => p.id === id)?.name ?? 'player';
      setTransientMedicMsg(`Protecting ${name} tonight.`);
      onSend({ type: 'C2S_MEDIC_PROTECT', payload: { targetId: id } });
    },
    onCancel: () => skipMedicProtection('escape'),
  });

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
    if (medicProtectedTarget) {
      blocks.push(
        <div key="medic-confirm" style={banner} role="status" aria-live="polite">
          🛡️ You are silently protecting <strong>{medicProtectedTarget.name}</strong> tonight.
        </div>
      );
    } else if (medicSkippedNight === nightId) {
      blocks.push(
        <div key="medic-user-skipped" style={banner} role="status" aria-live="polite">
          ⌛ You skipped protection for tonight.
        </div>
      );
    } else if (medicSecondsLeft > 0) {
      blocks.push(
        <div key="medic-pick" style={banner}>
          <div role="status" aria-live="polite" style={srOnlyStyle}>
            {medicAnnouncement}
          </div>
          <div id="medic-pick-label">
            <strong>🛡️ Medic — choose a player to protect tonight</strong>{' '}
            <span style={{ opacity: 0.75, fontSize: 12 }}>
              ({medicSecondsLeft}s — auto-skip if you don't pick)
            </span>
          </div>
          <div
            role="group"
            aria-labelledby="medic-pick-label"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}
          >
            {medicCandidates.map((p) => {
              const disabled = p.id === medicLastTarget;
              const itemProps = disabled ? null : medicRoving.getItemProps(p.id);
              const isFocusTarget = medicRoving.focusedId === p.id;
              const ariaLabel = disabled
                ? `${p.name}, already protected last night, unavailable`
                : `Protect ${p.name}`;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  ref={itemProps?.ref}
                  tabIndex={disabled ? -1 : itemProps?.tabIndex ?? -1}
                  onKeyDown={itemProps?.onKeyDown}
                  onFocus={itemProps?.onFocus}
                  onClick={() =>
                    !disabled && onSend({ type: 'C2S_MEDIC_PROTECT', payload: { targetId: p.id } })
                  }
                  aria-label={ariaLabel}
                  title={disabled ? 'Cannot protect the same player two nights in a row' : ''}
                  style={{
                    ...medicCandidateBaseStyle,
                    ...(isFocusTarget ? medicCandidateFocusStyle : null),
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {p.name}
                  {disabled ? ' (last night)' : ''}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => skipMedicProtection('button')}
              aria-label="Skip protection for tonight"
              style={{
                ...medicCandidateBaseStyle,
                padding: '6px 14px',
                background: 'transparent',
                borderColor: 'rgba(255,255,255,0.4)',
              }}
            >
              Skip Tonight
            </button>
          </div>
        </div>
      );
    } else {
      blocks.push(
        <div key="medic-skipped" style={banner} role="status" aria-live="polite">
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
              type="button"
              onClick={() => onSend({ type: 'C2S_ACTIVATE_SEER', payload: {} })}
              aria-label="Activate Seer gift to reveal a random player's true role"
              style={{ ...medicCandidateBaseStyle, padding: '8px 14px' }}
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
