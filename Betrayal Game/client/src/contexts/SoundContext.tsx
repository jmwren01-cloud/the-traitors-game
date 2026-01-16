import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useSounds } from '../hooks/useSounds';
import type { SoundType } from '../hooks/useSounds';

interface SoundContextType {
  play: (sound: SoundType) => void;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
}

const SoundContext = createContext<SoundContextType | null>(null);

export function SoundProvider({ children }: { children: ReactNode }) {
  const sounds = useSounds();
  return (
    <SoundContext.Provider value={sounds}>
      {children}
    </SoundContext.Provider>
  );
}

export function useSoundContext() {
  const context = useContext(SoundContext);
  if (!context) {
    throw new Error('useSoundContext must be used within a SoundProvider');
  }
  return context;
}
