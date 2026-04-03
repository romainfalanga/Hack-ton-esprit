// ============================================
// AUTH — Simple token-based auth
// ============================================

import { Context, MiddlewareHandler } from 'hono';
import type { Bindings, Variables } from './types';

// Simple hash for passwords (using Web Crypto API)
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'decode-ton-esprit-salt-2024');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate session token
export function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Simple token store (using a cookie-based approach for simplicity)
// In production, use KV or D1 for session storage
export const authMiddleware: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Non autorisé' }, 401);
  }

  const token = authHeader.replace('Bearer ', '');

  // Decode the simple token (base64 encoded user data)
  try {
    const decoded = atob(token);
    const user = JSON.parse(decoded);
    if (!user.id || !user.email) {
      return c.json({ error: 'Token invalide' }, 401);
    }

    // Verify user exists in DB
    const dbUser = await c.env.DB.prepare('SELECT id, email, username, display_name FROM users WHERE id = ?')
      .bind(user.id)
      .first();

    if (!dbUser) {
      return c.json({ error: 'Utilisateur non trouvé' }, 401);
    }

    c.set('user', dbUser as any);
    await next();
  } catch {
    return c.json({ error: 'Token invalide' }, 401);
  }
};

export function createToken(user: { id: number; email: string; username: string; display_name: string }): string {
  return btoa(JSON.stringify({ id: user.id, email: user.email, username: user.username, display_name: user.display_name }));
}
