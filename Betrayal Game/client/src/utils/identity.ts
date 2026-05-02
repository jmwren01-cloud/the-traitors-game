const DEVICE_TOKEN_KEY = 'betrayal_device_token';
const PLAYER_NAME_KEY = 'betrayal_player_name';

export function getOrCreateDeviceToken(): string {
  let token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }
  return token;
}

export function getSavedPlayerName(): string | null {
  return localStorage.getItem(PLAYER_NAME_KEY);
}

export function savePlayerName(name: string): void {
  localStorage.setItem(PLAYER_NAME_KEY, name);
}

export function getPlayerProfile(): { deviceToken: string; playerName: string | null } {
  return {
    deviceToken: getOrCreateDeviceToken(),
    playerName: getSavedPlayerName(),
  };
}

export function isValidPlayerName(name: string): boolean {
  if (name.length < 2 || name.length > 20) return false;
  return /^[A-Za-z0-9 ]+$/.test(name);
}
