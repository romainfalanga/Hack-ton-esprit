// ============================================
// XP & PROGRESSION SYSTEM
// ============================================

import type { XPReward, StatKey } from './types';
import { LEVEL_THRESHOLDS } from './types';

export function calculateLevel(xp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

export function calculateGlobalLevel(stats: Record<string, number>): number {
  const totalXP = (stats.lucidity_xp || 0) + (stats.resonance_xp || 0) + 
    (stats.liberty_xp || 0) + (stats.connection_xp || 0) + (stats.action_xp || 0);
  const avgXP = totalXP / 5;
  return calculateLevel(avgXP);
}

export async function awardXP(db: D1Database, userId: number, reward: XPReward, sourceType: string, sourceId?: number, description?: string) {
  const luc = reward.lucidity || 0;
  const res = reward.resonance || 0;
  const lib = reward.liberty || 0;
  const con = reward.connection || 0;
  const act = reward.action || 0;
  const total = luc + res + lib + con + act;

  // Update user_stats
  await db.prepare(`
    UPDATE user_stats SET 
      lucidity_xp = lucidity_xp + ?,
      resonance_xp = resonance_xp + ?,
      liberty_xp = liberty_xp + ?,
      connection_xp = connection_xp + ?,
      action_xp = action_xp + ?,
      total_xp = total_xp + ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(luc, res, lib, con, act, total, userId).run();

  // Recalculate levels
  const stats = await db.prepare('SELECT * FROM user_stats WHERE user_id = ?').bind(userId).first() as any;
  if (stats) {
    const lucLevel = calculateLevel(stats.lucidity_xp);
    const resLevel = calculateLevel(stats.resonance_xp);
    const libLevel = calculateLevel(stats.liberty_xp);
    const conLevel = calculateLevel(stats.connection_xp);
    const actLevel = calculateLevel(stats.action_xp);
    const globalLevel = calculateGlobalLevel(stats);

    await db.prepare(`
      UPDATE user_stats SET 
        lucidity_level = ?, resonance_level = ?, liberty_level = ?,
        connection_level = ?, action_level = ?, global_level = ?
      WHERE user_id = ?
    `).bind(lucLevel, resLevel, libLevel, conLevel, actLevel, globalLevel, userId).run();
  }

  // Log XP history
  await db.prepare(`
    INSERT INTO xp_history (user_id, source_type, source_id, lucidity_xp, resonance_xp, liberty_xp, connection_xp, action_xp, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(userId, sourceType, sourceId || null, luc, res, lib, con, act, description || null).run();

  return { awarded: reward, total_awarded: total };
}

// Update streak
export async function updateStreak(db: D1Database, userId: number) {
  const today = new Date().toISOString().split('T')[0];
  const user = await db.prepare('SELECT last_checkin_date, current_streak, longest_streak FROM users WHERE id = ?')
    .bind(userId).first() as any;

  if (!user) return;

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  let newStreak = 1;
  if (user.last_checkin_date === yesterday) {
    newStreak = (user.current_streak || 0) + 1;
  } else if (user.last_checkin_date === today) {
    newStreak = user.current_streak || 1;
  }

  const longestStreak = Math.max(newStreak, user.longest_streak || 0);

  await db.prepare(`
    UPDATE users SET last_checkin_date = ?, current_streak = ?, longest_streak = ? WHERE id = ?
  `).bind(today, newStreak, longestStreak, userId).run();

  return { current_streak: newStreak, longest_streak: longestStreak };
}
