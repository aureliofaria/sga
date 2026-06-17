// Tipos de pedido que podem ser controlados por permissão
export const REQUEST_TYPES = ['ONBOARDING', 'OFFBOARDING', 'PAYMENT', 'PURCHASE'] as const;

// Remove o passwordHash e converte requestPermissions (JSON string) em array.
// requestPermissions === null significa "todos os tipos liberados".
export function serializeUser<T extends { passwordHash?: string; requestPermissions?: string | null }>(
  user: T
): Omit<T, 'passwordHash' | 'requestPermissions'> & { requestPermissions: string[] | null } {
  const { passwordHash: _ph, requestPermissions, ...rest } = user as any;
  let parsed: string[] | null = null;
  if (requestPermissions) {
    try {
      const arr = JSON.parse(requestPermissions);
      parsed = Array.isArray(arr) ? arr.filter((t: any) => typeof t === 'string') : null;
    } catch {
      parsed = null;
    }
  }
  return { ...rest, requestPermissions: parsed };
}

// Normaliza um valor recebido do cliente em string JSON (ou null) para persistir.
// Array vazio é válido (usuário sem permissão para abrir nenhum tipo).
export function normalizeRequestPermissions(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const valid = value.filter((t): t is string => typeof t === 'string' && (REQUEST_TYPES as readonly string[]).includes(t));
  return JSON.stringify(Array.from(new Set(valid)));
}

// Verifica se o usuário pode abrir um pedido do tipo informado.
// ADMIN sempre pode; requestPermissions null = todos liberados.
export function canOpenRequestType(
  user: { role?: string; requestPermissions?: string | null },
  type: string
): boolean {
  if (user.role === 'ADMIN') return true;
  if (!user.requestPermissions) return true;
  try {
    const arr = JSON.parse(user.requestPermissions);
    return Array.isArray(arr) && arr.includes(type);
  } catch {
    return true;
  }
}
