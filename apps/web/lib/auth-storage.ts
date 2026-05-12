const KEY = 'car_rental_access_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
}

export function setAccessToken(token: string): void {
  localStorage.setItem(KEY, token);
}

export function clearAccessToken(): void {
  localStorage.removeItem(KEY);
}
