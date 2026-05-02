export interface ColorOption {
  id: string;
  hex: string;
  label: string;
}

export interface AvatarOption {
  id: string;
  emoji: string;
  label: string;
}

export const PLAYER_COLORS: ColorOption[] = [
  { id: 'red',     hex: '#e94560', label: 'Red' },
  { id: 'orange',  hex: '#ff8c42', label: 'Orange' },
  { id: 'yellow',  hex: '#ffd700', label: 'Yellow' },
  { id: 'lime',    hex: '#7ec850', label: 'Lime' },
  { id: 'cyan',    hex: '#00d4ff', label: 'Cyan' },
  { id: 'blue',    hex: '#4a90e2', label: 'Blue' },
  { id: 'purple',  hex: '#9b59b6', label: 'Purple' },
  { id: 'pink',    hex: '#ff69b4', label: 'Pink' },
  { id: 'teal',    hex: '#26a69a', label: 'Teal' },
  { id: 'white',   hex: '#f0f0f0', label: 'White' },
  { id: 'gold',    hex: '#e6b800', label: 'Gold' },
  { id: 'magenta', hex: '#e040fb', label: 'Magenta' },
];

export const PLAYER_AVATARS: AvatarOption[] = [
  { id: 'crown',   emoji: '👑', label: 'Crown' },
  { id: 'star',    emoji: '⭐', label: 'Star' },
  { id: 'moon',    emoji: '🌙', label: 'Moon' },
  { id: 'flame',   emoji: '🔥', label: 'Flame' },
  { id: 'skull',   emoji: '💀', label: 'Skull' },
  { id: 'ghost',   emoji: '👻', label: 'Ghost' },
  { id: 'wolf',    emoji: '🐺', label: 'Wolf' },
  { id: 'owl',     emoji: '🦉', label: 'Owl' },
  { id: 'fox',     emoji: '🦊', label: 'Fox' },
  { id: 'dragon',  emoji: '🐉', label: 'Dragon' },
];

export const COLOR_IDS = PLAYER_COLORS.map((c) => c.id);
export const AVATAR_IDS = PLAYER_AVATARS.map((a) => a.id);

export function getColorHex(colorId: string | undefined): string {
  return PLAYER_COLORS.find((c) => c.id === colorId)?.hex ?? '#555555';
}

export function getAvatarEmoji(avatarId: string | undefined): string {
  return PLAYER_AVATARS.find((a) => a.id === avatarId)?.emoji ?? '?';
}
