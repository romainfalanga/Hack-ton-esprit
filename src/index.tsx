// ============================================
// HACK TON ESPRIT — MAIN APP (v2 — 5 new modules)
// ============================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings, Variables } from './lib/types';
import { EMOTION_CATEGORIES, LEVEL_NAMES, AWAKENING_NAMES, LEVEL_THRESHOLDS } from './lib/types';
import { hashPassword, authMiddleware, createToken } from './lib/auth';
import { awardXP, updateStreak } from './lib/xp';
import { categorizeCapture, analyzePatterns, generateRitualPrompts, callAI } from './lib/ai';
import { PATTERN_DEFINITIONS, getQuestsForPattern } from './lib/patterns';
import { DB_STATEMENTS, DEFAULT_THOUGHT_BRANCHES, LIFE_DOMAINS } from './lib/db-schema';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', cors());

// ============================================
// INIT DATABASE
// ============================================
app.get('/api/init-db', async (c) => {
  const db = c.env.DB;
  for (const sql of DB_STATEMENTS) {
    await db.prepare(sql).run();
  }
  return c.json({ success: true, message: 'Base de donnees initialisee' });
});

// ============================================
// AUTH ROUTES
// ============================================
app.post('/api/auth/register', async (c) => {
  const db = c.env.DB;
  const { email, username, password, display_name } = await c.req.json();

  if (!email || !username || !password) {
    return c.json({ error: 'Email, nom d\'utilisateur et mot de passe requis' }, 400);
  }

  const existing = await db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').bind(email, username).first();
  if (existing) {
    return c.json({ error: 'Cet email ou nom d\'utilisateur existe deja' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const result = await db.prepare(
    'INSERT INTO users (email, username, password_hash, display_name) VALUES (?, ?, ?, ?)'
  ).bind(email, username, passwordHash, display_name || username).run();

  const userId = result.meta.last_row_id as number;
  await db.prepare('INSERT INTO user_stats (user_id) VALUES (?)').bind(userId).run();

  // Create default thought branches
  for (const branch of DEFAULT_THOUGHT_BRANCHES) {
    await db.prepare('INSERT INTO thought_branches (user_id, branch_key, branch_name, description) VALUES (?, ?, ?, ?)').bind(userId, branch.key, branch.name, branch.description).run();
  }

  // Create 2 default system micro-habits
  const defaultHabits = [
    { name: 'Emotion forte du soir', description: 'Logger l\'emotion la plus forte de ta journee chaque soir', category: 'fondateur', frequency: 'daily' },
    { name: 'Lettre au futur moi', description: 'Ecrire un message a ton toi dans 10 ans', category: 'fondateur', frequency: 'weekly' },
  ];
  for (const h of defaultHabits) {
    await db.prepare('INSERT INTO micro_habits (user_id, name, description, category, is_system_habit, frequency) VALUES (?, ?, ?, ?, 1, ?)').bind(userId, h.name, h.description, h.category, h.frequency).run();
  }

  const user = { id: userId, email, username, display_name: display_name || username };
  const token = createToken(user);

  return c.json({ success: true, token, user });
});

app.post('/api/auth/login', async (c) => {
  const db = c.env.DB;
  const { email, password } = await c.req.json();

  const passwordHash = await hashPassword(password);
  const user = await db.prepare(
    'SELECT id, email, username, display_name FROM users WHERE email = ? AND password_hash = ?'
  ).bind(email, passwordHash).first() as any;

  if (!user) {
    return c.json({ error: 'Email ou mot de passe incorrect' }, 401);
  }

  await db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();

  const token = createToken(user);
  return c.json({ success: true, token, user });
});

// ============================================
// PROTECTED ROUTES
// ============================================
app.use('/api/me/*', authMiddleware);
app.use('/api/checkin/*', authMiddleware);
app.use('/api/capture/*', authMiddleware);
app.use('/api/weekly/*', authMiddleware);
app.use('/api/quest/*', authMiddleware);
app.use('/api/ritual/*', authMiddleware);
app.use('/api/pattern/*', authMiddleware);
app.use('/api/lifeline/*', authMiddleware);
app.use('/api/psych/*', authMiddleware);
app.use('/api/thought/*', authMiddleware);
app.use('/api/habits/*', authMiddleware);
app.use('/api/chat/*', authMiddleware);
app.use('/api/letter/*', authMiddleware);

// ============================================
// PROFILE & STATS
// ============================================
app.get('/api/me/profile', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const stats = await db.prepare('SELECT * FROM user_stats WHERE user_id = ?').bind(user.id).first();
  const userData = await db.prepare('SELECT current_streak, longest_streak, awakening_level, onboarding_done FROM users WHERE id = ?').bind(user.id).first() as any;

  const today = new Date().toISOString().split('T')[0];
  const todayCheckins = await db.prepare(
    "SELECT type FROM checkins WHERE user_id = ? AND date(created_at) = ?"
  ).bind(user.id, today).all();

  const hasMorningCheckin = todayCheckins.results?.some((c: any) => c.type === 'morning');
  const hasEveningCheckin = todayCheckins.results?.some((c: any) => c.type === 'evening');

  const activePatterns = await db.prepare(
    "SELECT COUNT(*) as count FROM patterns WHERE user_id = ? AND status IN ('detected', 'active')"
  ).bind(user.id).first() as any;

  const activeQuests = await db.prepare(
    "SELECT COUNT(*) as count FROM quests WHERE user_id = ? AND status IN ('available', 'active')"
  ).bind(user.id).first() as any;

  const totalCaptures = await db.prepare(
    "SELECT COUNT(*) as count FROM captures WHERE user_id = ?"
  ).bind(user.id).first() as any;

  const lifeEventsCount = await db.prepare(
    "SELECT COUNT(*) as count FROM life_events WHERE user_id = ?"
  ).bind(user.id).first() as any;

  const habitsCount = await db.prepare(
    "SELECT COUNT(*) as count FROM micro_habits WHERE user_id = ? AND status = 'active'"
  ).bind(user.id).first() as any;

  return c.json({
    user: {
      ...user,
      current_streak: userData?.current_streak || 0,
      longest_streak: userData?.longest_streak || 0,
      awakening_level: userData?.awakening_level || 1,
      onboarding_done: userData?.onboarding_done || 0,
    },
    stats,
    today: {
      morning_done: !!hasMorningCheckin,
      evening_done: !!hasEveningCheckin,
    },
    counts: {
      active_patterns: activePatterns?.count || 0,
      active_quests: activeQuests?.count || 0,
      total_captures: totalCaptures?.count || 0,
      life_events: lifeEventsCount?.count || 0,
      active_habits: habitsCount?.count || 0,
    },
    level_names: LEVEL_NAMES,
    awakening_names: AWAKENING_NAMES,
    level_thresholds: LEVEL_THRESHOLDS,
  });
});

// ============================================
// COUCHE 1 — CHECK-INS
// ============================================
app.post('/api/checkin/morning', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { emotion, emotion_detail, energy_level, intention } = await c.req.json();

  if (!emotion || !energy_level) {
    return c.json({ error: 'Emotion et niveau d\'energie requis' }, 400);
  }

  let depth = 0;
  if (emotion_detail && emotion_detail.length > 10) depth += 2;
  if (intention && intention.length > 5) depth += 1;
  if (energy_level) depth += 1;

  const result = await db.prepare(
    'INSERT INTO checkins (user_id, type, emotion, emotion_detail, energy_level, intention, depth_score) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, 'morning', emotion, emotion_detail || null, energy_level, intention || null, depth).run();

  const xp = await awardXP(db, user.id, { resonance: 5 }, 'checkin', result.meta.last_row_id as number, 'Check-in du matin');
  const streak = await updateStreak(db, user.id);

  return c.json({ success: true, id: result.meta.last_row_id, xp, streak });
});

app.post('/api/checkin/evening', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { micro_victories, invisible_gratitude, strong_emotion, strong_emotion_trigger } = await c.req.json();

  let exercisesCount = 0;
  if (micro_victories && JSON.parse(micro_victories).length > 0) exercisesCount++;
  if (invisible_gratitude) exercisesCount++;
  if (strong_emotion && strong_emotion_trigger) exercisesCount++;

  if (exercisesCount === 0) {
    return c.json({ error: 'Au moins un exercice du scan du soir requis' }, 400);
  }

  let depth = exercisesCount * 2;

  const result = await db.prepare(
    'INSERT INTO checkins (user_id, type, micro_victories, invisible_gratitude, strong_emotion, strong_emotion_trigger, depth_score) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, 'evening', micro_victories || null, invisible_gratitude || null, strong_emotion || null, strong_emotion_trigger || null, depth).run();

  const xpAmount = 5 + (exercisesCount - 1) * 5;
  const xpReward: any = { resonance: Math.ceil(xpAmount / 2), lucidity: Math.floor(xpAmount / 2) };
  const xp = await awardXP(db, user.id, xpReward, 'checkin', result.meta.last_row_id as number, 'Scan du soir');

  return c.json({ success: true, id: result.meta.last_row_id, xp, exercises_completed: exercisesCount });
});

// ============================================
// COUCHE 1 — CAPTURES INSTANTANEES
// ============================================
app.post('/api/capture/new', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { content, intensity } = await c.req.json();

  if (!content) {
    return c.json({ error: 'Contenu requis' }, 400);
  }

  let aiResult = { emotion: 'neutre', category: 'quotidien', tags: [] as string[], is_anxious: false };
  try {
    const apiKey = c.env.OPENROUTER_API_KEY;
    if (apiKey) {
      aiResult = await categorizeCapture(apiKey, content);
    }
  } catch (e) { }

  const result = await db.prepare(
    'INSERT INTO captures (user_id, content, emotion, intensity, category, tags, is_anxious) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, content, aiResult.emotion, intensity || 5, aiResult.category, JSON.stringify(aiResult.tags), aiResult.is_anxious ? 1 : 0).run();

  const xp = await awardXP(db, user.id, { lucidity: 2 }, 'capture', result.meta.last_row_id as number, 'Capture instantanee');

  return c.json({ success: true, id: result.meta.last_row_id, analysis: aiResult, xp });
});

app.get('/api/capture/list', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const limit = Number(c.req.query('limit') || 20);
  const offset = Number(c.req.query('offset') || 0);

  const captures = await db.prepare(
    'SELECT * FROM captures WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(user.id, limit, offset).all();

  return c.json({ captures: captures.results });
});

// ============================================
// COUCHE 1 — EXERCICES HEBDOMADAIRES
// ============================================
app.post('/api/weekly/decontamination', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { invasive_thought, proofs_for, proofs_against, scenario_worst, scenario_probable, scenario_best, conclusion } = await c.req.json();

  if (!invasive_thought) {
    return c.json({ error: 'Pensee envahissante requise' }, 400);
  }

  const weekNumber = getWeekNumber();
  const result = await db.prepare(
    'INSERT INTO decontaminations (user_id, invasive_thought, proofs_for, proofs_against, scenario_worst, scenario_probable, scenario_best, conclusion, week_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, invasive_thought, proofs_for || '[]', proofs_against || '[]', scenario_worst || null, scenario_probable || null, scenario_best || null, conclusion || null, weekNumber).run();

  const xp = await awardXP(db, user.id, { lucidity: 20, action: 10 }, 'decontamination', result.meta.last_row_id as number, 'Decontamination hebdomadaire');

  return c.json({ success: true, id: result.meta.last_row_id, xp });
});

app.post('/api/weekly/influence-circle', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { concerns, reflections } = await c.req.json();

  if (!concerns) {
    return c.json({ error: 'Preoccupations requises' }, 400);
  }

  const weekNumber = getWeekNumber();
  const result = await db.prepare(
    'INSERT INTO influence_circles (user_id, concerns, reflections, week_number) VALUES (?, ?, ?, ?)'
  ).bind(user.id, concerns, reflections || null, weekNumber).run();

  const xp = await awardXP(db, user.id, { lucidity: 15, liberty: 10 }, 'influence_circle', result.meta.last_row_id as number, 'Cercle d\'influence');

  return c.json({ success: true, id: result.meta.last_row_id, xp });
});

app.post('/api/weekly/worry-review', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { worried_items, overall_insight } = await c.req.json();

  if (!worried_items) {
    return c.json({ error: 'Elements requis' }, 400);
  }

  const weekNumber = getWeekNumber();
  const result = await db.prepare(
    'INSERT INTO worry_reviews (user_id, worried_items, overall_insight, week_number) VALUES (?, ?, ?, ?)'
  ).bind(user.id, worried_items, overall_insight || null, weekNumber).run();

  const xp = await awardXP(db, user.id, { lucidity: 15, resonance: 10 }, 'worry_review', result.meta.last_row_id as number, 'Bilan de la boite a soucis');

  return c.json({ success: true, id: result.meta.last_row_id, xp });
});

// ============================================
// COUCHE 2 — PATTERNS & QUESTS
// ============================================
app.post('/api/pattern/analyze', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const apiKey = c.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return c.json({ error: 'Cle API non configuree' }, 500);
  }

  const checkins = await db.prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').bind(user.id).all();
  const captures = await db.prepare('SELECT * FROM captures WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
  const decontaminations = await db.prepare('SELECT * FROM decontaminations WHERE user_id = ? ORDER BY created_at DESC LIMIT 8').bind(user.id).all();
  const influenceCircles = await db.prepare('SELECT * FROM influence_circles WHERE user_id = ? ORDER BY created_at DESC LIMIT 8').bind(user.id).all();

  const result = await analyzePatterns(apiKey, {
    checkins: checkins.results || [],
    captures: captures.results || [],
    decontaminations: decontaminations.results || [],
    influenceCircles: influenceCircles.results || [],
  });

  const newPatterns = [];
  for (const pattern of result.patterns) {
    const existing = await db.prepare(
      "SELECT id FROM patterns WHERE user_id = ? AND pattern_key = ? AND status != 'resolved'"
    ).bind(user.id, pattern.key).first();

    if (!existing) {
      const patternResult = await db.prepare(
        'INSERT INTO patterns (user_id, pattern_key, pattern_name, description, confidence, status, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(user.id, pattern.key, pattern.name, '', pattern.confidence, 'detected', JSON.stringify(pattern.evidence)).run();

      const patternId = patternResult.meta.last_row_id;
      const questDefs = getQuestsForPattern(pattern.key);
      for (const quest of questDefs) {
        await db.prepare(
          'INSERT INTO quests (user_id, pattern_id, quest_key, quest_name, description, technique, xp_rewards, frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(user.id, patternId, quest.key, quest.name, quest.description, quest.technique, JSON.stringify(quest.xp_rewards), quest.frequency).run();
      }

      newPatterns.push({ ...pattern, quests: questDefs.map(q => q.name) });
    }
  }

  await db.prepare(
    'INSERT INTO ai_analyses (user_id, analysis_type, output_data, model_used) VALUES (?, ?, ?, ?)'
  ).bind(user.id, 'pattern_detection', JSON.stringify(result), 'google/gemini-2.0-flash-001').run();

  return c.json({ success: true, new_patterns: newPatterns, total_detected: result.patterns.length });
});

app.get('/api/pattern/list', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const patterns = await db.prepare("SELECT * FROM patterns WHERE user_id = ? ORDER BY confidence DESC").bind(user.id).all();
  return c.json({ patterns: patterns.results });
});

app.post('/api/pattern/self-declare', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { pattern_key } = await c.req.json();

  const patternDef = PATTERN_DEFINITIONS.find(p => p.key === pattern_key);
  if (!patternDef) return c.json({ error: 'Pattern inconnu' }, 400);

  const existing = await db.prepare(
    "SELECT id FROM patterns WHERE user_id = ? AND pattern_key = ? AND status != 'resolved'"
  ).bind(user.id, pattern_key).first();

  if (existing) return c.json({ error: 'Pattern deja actif' }, 409);

  const patternResult = await db.prepare(
    'INSERT INTO patterns (user_id, pattern_key, pattern_name, description, confidence, status, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, pattern_key, patternDef.name, patternDef.description, 1.0, 'active', JSON.stringify(['Auto-declare par l\'utilisateur'])).run();

  const patternId = patternResult.meta.last_row_id;
  for (const quest of patternDef.quests) {
    await db.prepare(
      'INSERT INTO quests (user_id, pattern_id, quest_key, quest_name, description, technique, xp_rewards, frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(user.id, patternId, quest.key, quest.name, quest.description, quest.technique, JSON.stringify(quest.xp_rewards), quest.frequency).run();
  }

  return c.json({ success: true, pattern: patternDef.name, quests_unlocked: patternDef.quests.length });
});

app.get('/api/quest/list', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const quests = await db.prepare(
    "SELECT q.*, p.pattern_name, p.pattern_key FROM quests q LEFT JOIN patterns p ON q.pattern_id = p.id WHERE q.user_id = ? ORDER BY q.unlocked_at DESC"
  ).bind(user.id).all();

  const questsWithPrompts = (quests.results || []).map((q: any) => {
    const patternDef = PATTERN_DEFINITIONS.find(p => p.key === q.pattern_key);
    const questDef = patternDef?.quests.find(qd => qd.key === q.quest_key);
    return { ...q, prompts: questDef?.prompts || [] };
  });

  return c.json({ quests: questsWithPrompts });
});

app.post('/api/quest/complete', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { quest_id, responses, reflection } = await c.req.json();

  const quest = await db.prepare('SELECT * FROM quests WHERE id = ? AND user_id = ?').bind(quest_id, user.id).first() as any;
  if (!quest) return c.json({ error: 'Quete non trouvee' }, 404);

  const result = await db.prepare(
    'INSERT INTO quest_completions (user_id, quest_id, response, reflection, xp_earned) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, quest_id, JSON.stringify(responses), reflection || null, quest.xp_rewards).run();

  await db.prepare('UPDATE quests SET times_completed = times_completed + 1, last_completed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(quest_id).run();

  const xpRewards = JSON.parse(quest.xp_rewards || '{}');
  const xp = await awardXP(db, user.id, xpRewards, 'quest', result.meta.last_row_id as number, `Quete : ${quest.quest_name}`);

  return c.json({ success: true, xp, quest_name: quest.quest_name });
});

// ============================================
// COUCHE 3 — RITUALS
// ============================================
app.get('/api/ritual/available', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const stats = await db.prepare('SELECT global_level FROM user_stats WHERE user_id = ?').bind(user.id).first() as any;
  const globalLevel = stats?.global_level || 1;

  const rituals = [
    { key: 'unsent_letter', name: 'La Lettre non envoyee', frequency: 'monthly', min_level: 5, xp: { liberty: 30, resonance: 20 } },
    { key: 'automatism_audit', name: 'L\'Audit de mes automatismes', frequency: 'monthly', min_level: 5, xp: { liberty: 30, lucidity: 15 } },
    { key: 'family_scripts', name: 'Le Bilan des scripts familiaux', frequency: 'quarterly', min_level: 5, xp: { liberty: 50, lucidity: 30 } },
    { key: 'future_nostalgic', name: 'Le Futur soi nostalgique', frequency: 'quarterly', min_level: 5, xp: { resonance: 40, action: 20 } },
    { key: 'exit_criteria', name: 'Les Criteres de sortie', frequency: 'quarterly', min_level: 5, xp: { action: 40, lucidity: 30 } },
    { key: 'ancestors_letter', name: 'La Grande Lettre aux ancetres', frequency: 'yearly', min_level: 7, xp: { liberty: 100, resonance: 50 } },
    { key: 'character_arc', name: 'L\'Arc de mon personnage', frequency: 'yearly', min_level: 7, xp: { lucidity: 100, resonance: 100, liberty: 100, connection: 100, action: 100 } },
  ];

  const available = rituals.filter(r => globalLevel >= r.min_level);
  const locked = rituals.filter(r => globalLevel < r.min_level);

  for (const ritual of available) {
    const last = await db.prepare(
      'SELECT completed_at FROM rituals WHERE user_id = ? AND ritual_key = ? ORDER BY completed_at DESC LIMIT 1'
    ).bind(user.id, ritual.key).first() as any;
    (ritual as any).last_completed = last?.completed_at || null;
  }

  return c.json({ available, locked, global_level: globalLevel });
});

app.post('/api/ritual/start', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { ritual_key } = await c.req.json();
  const apiKey = c.env.OPENROUTER_API_KEY;

  const patterns = await db.prepare(
    "SELECT * FROM patterns WHERE user_id = ? AND status IN ('active', 'detected')"
  ).bind(user.id).all();

  const recentCaptures = await db.prepare(
    'SELECT content, emotion, category FROM captures WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(user.id).all();

  let prompts: string[] = [];
  if (apiKey) {
    try {
      prompts = await generateRitualPrompts(apiKey, ritual_key, patterns.results || [], recentCaptures.results || []);
    } catch {}
  }

  if (prompts.length === 0) {
    prompts = getDefaultRitualPrompts(ritual_key);
  }

  return c.json({ success: true, ritual_key, prompts });
});

app.post('/api/ritual/complete', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { ritual_key, ritual_name, frequency, content, prompts } = await c.req.json();

  const ritualXP: Record<string, any> = {
    unsent_letter: { liberty: 30, resonance: 20 },
    automatism_audit: { liberty: 30, lucidity: 15 },
    family_scripts: { liberty: 50, lucidity: 30 },
    future_nostalgic: { resonance: 40, action: 20 },
    exit_criteria: { action: 40, lucidity: 30 },
    ancestors_letter: { liberty: 100, resonance: 50 },
    character_arc: { lucidity: 100, resonance: 100, liberty: 100, connection: 100, action: 100 },
  };

  const xpReward = ritualXP[ritual_key] || { lucidity: 10 };

  const result = await db.prepare(
    'INSERT INTO rituals (user_id, ritual_key, ritual_name, frequency, content, ai_prompts, xp_earned) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, ritual_key, ritual_name, frequency, JSON.stringify(content), JSON.stringify(prompts), JSON.stringify(xpReward)).run();

  const xp = await awardXP(db, user.id, xpReward, 'ritual', result.meta.last_row_id as number, `Rituel : ${ritual_name}`);

  return c.json({ success: true, xp });
});

// ============================================
// MODULE 1 — LIGNE DE VIE
// ============================================
app.post('/api/lifeline/event', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { title, description, event_date, age_at_event, global_intensity, valence, life_domain, emotions } = await c.req.json();

  if (!title) return c.json({ error: 'Titre requis' }, 400);

  const result = await db.prepare(
    'INSERT INTO life_events (user_id, title, description, event_date, age_at_event, global_intensity, valence, life_domain) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, title, description || null, event_date || null, age_at_event || null, global_intensity || 5, valence || 'mixed', life_domain || 'quotidien').run();

  const eventId = result.meta.last_row_id as number;

  // Save emotions
  if (emotions && Array.isArray(emotions)) {
    for (const emo of emotions) {
      await db.prepare('INSERT INTO life_event_emotions (event_id, emotion, intensity) VALUES (?, ?, ?)').bind(eventId, emo.emotion, emo.intensity || 5).run();
    }
  }

  // Award XP
  const eventsCount = await db.prepare('SELECT COUNT(*) as count FROM life_events WHERE user_id = ?').bind(user.id).first() as any;
  let xpReward: any = { lucidity: 10, resonance: 5 };

  // Bonus for completing initial 10 events (onboarding)
  if (eventsCount?.count === 10) {
    xpReward = { lucidity: 25, resonance: 15 };
    await db.prepare('UPDATE users SET onboarding_done = 1 WHERE id = ?').bind(user.id).run();
  }

  const xp = await awardXP(db, user.id, xpReward, 'life_event', eventId, 'Ligne de vie : ' + title);

  return c.json({ success: true, id: eventId, xp, total_events: eventsCount?.count || 1 });
});

app.get('/api/lifeline/events', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const events = await db.prepare(
    'SELECT * FROM life_events WHERE user_id = ? ORDER BY COALESCE(age_at_event, 0) ASC, created_at ASC'
  ).bind(user.id).all();

  // Fetch emotions for each event
  const eventsWithEmotions = [];
  for (const event of (events.results || [])) {
    const emos = await db.prepare('SELECT emotion, intensity FROM life_event_emotions WHERE event_id = ?').bind((event as any).id).all();
    eventsWithEmotions.push({ ...event, emotions: emos.results || [] });
  }

  return c.json({ events: eventsWithEmotions, domains: LIFE_DOMAINS });
});

app.put('/api/lifeline/event/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const eventId = Number(c.req.param('id'));
  const { title, description, event_date, age_at_event, global_intensity, valence, life_domain, emotions } = await c.req.json();

  const existing = await db.prepare('SELECT id FROM life_events WHERE id = ? AND user_id = ?').bind(eventId, user.id).first();
  if (!existing) return c.json({ error: 'Evenement non trouve' }, 404);

  await db.prepare(
    'UPDATE life_events SET title = ?, description = ?, event_date = ?, age_at_event = ?, global_intensity = ?, valence = ?, life_domain = ? WHERE id = ?'
  ).bind(title, description || null, event_date || null, age_at_event || null, global_intensity || 5, valence || 'mixed', life_domain || 'quotidien', eventId).run();

  // Replace emotions
  await db.prepare('DELETE FROM life_event_emotions WHERE event_id = ?').bind(eventId).run();
  if (emotions && Array.isArray(emotions)) {
    for (const emo of emotions) {
      await db.prepare('INSERT INTO life_event_emotions (event_id, emotion, intensity) VALUES (?, ?, ?)').bind(eventId, emo.emotion, emo.intensity || 5).run();
    }
  }

  return c.json({ success: true });
});

app.delete('/api/lifeline/event/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const eventId = Number(c.req.param('id'));

  await db.prepare('DELETE FROM life_event_emotions WHERE event_id = ?').bind(eventId).run();
  await db.prepare('DELETE FROM life_events WHERE id = ? AND user_id = ?').bind(eventId, user.id).run();

  return c.json({ success: true });
});

// ============================================
// MODULE 2 — PROFIL PSYCHOLOGIQUE
// ============================================
app.get('/api/psych/profile', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const traits = await db.prepare(
    'SELECT * FROM psych_profile_traits WHERE user_id = ? AND status = \'active\' ORDER BY probability DESC'
  ).bind(user.id).all();

  const lastSnapshot = await db.prepare(
    'SELECT * FROM psych_profile_snapshots WHERE user_id = ? ORDER BY generated_at DESC LIMIT 1'
  ).bind(user.id).first() as any;

  return c.json({
    traits: traits.results || [],
    last_snapshot: lastSnapshot ? { ...lastSnapshot, full_profile: JSON.parse(lastSnapshot.full_profile || '{}') } : null,
  });
});

app.post('/api/psych/generate', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const apiKey = c.env.OPENROUTER_API_KEY;

  if (!apiKey) return c.json({ error: 'Cle API non configuree' }, 500);

  // Gather ALL user data
  const lifeEvents = await db.prepare('SELECT * FROM life_events WHERE user_id = ? ORDER BY age_at_event ASC').bind(user.id).all();
  const checkins = await db.prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
  const captures = await db.prepare('SELECT * FROM captures WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
  const decontaminations = await db.prepare('SELECT * FROM decontaminations WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').bind(user.id).all();
  const patterns = await db.prepare('SELECT * FROM patterns WHERE user_id = ?').bind(user.id).all();
  const existingTraits = await db.prepare('SELECT * FROM psych_profile_traits WHERE user_id = ?').bind(user.id).all();

  // Fetch emotions for life events
  const eventsWithEmotions = [];
  for (const evt of (lifeEvents.results || [])) {
    const emos = await db.prepare('SELECT emotion, intensity FROM life_event_emotions WHERE event_id = ?').bind((evt as any).id).all();
    eventsWithEmotions.push({ ...evt, emotions: emos.results });
  }

  const prompt = `Tu es un psychologue clinicien specialise en TCC et psychologie de la personnalite.
Analyse les donnees ci-dessous pour generer un profil psychologique detaille.

EVENEMENTS DE VIE (Ligne de vie) :
${JSON.stringify(eventsWithEmotions.slice(-20), null, 2)}

CHECK-INS RECENTS :
${JSON.stringify((checkins.results || []).slice(-20), null, 2)}

CAPTURES INSTANTANEES :
${JSON.stringify((captures.results || []).slice(-20), null, 2)}

DECONTAMINATIONS :
${JSON.stringify((decontaminations.results || []).slice(-5), null, 2)}

PATTERNS DETECTES :
${JSON.stringify(patterns.results || [], null, 2)}

TRAITS DEJA IDENTIFIES :
${JSON.stringify((existingTraits.results || []).map((t: any) => ({ key: t.trait_key, name: t.trait_name, probability: t.probability })), null, 2)}

Reponds UNIQUEMENT en JSON avec ce format :
{
  "traits": [
    {
      "category": "attachment|defense|bias|emotional_regulation|relational|identity|cognitive",
      "trait_key": "unique_snake_case_key",
      "trait_name": "Nom en francais",
      "description": "Description detaillee du trait (2-3 phrases)",
      "probability": 0.85,
      "evidence": ["preuve 1 basee sur les donnees", "preuve 2"],
      "counter_evidence": ["element contraire si present"]
    }
  ],
  "global_summary": "Resume global du profil (3-5 phrases)",
  "key_dynamics": ["dynamique 1", "dynamique 2"],
  "growth_areas": ["axe de developpement 1", "axe 2"],
  "strengths": ["force 1", "force 2"]
}

Pour chaque trait, la probability (0-1) represente ta certitude. Plus il y a de donnees coherentes, plus c'est eleve.
IMPORTANT: Mets a jour les traits existants si les donnees le justifient (probabilite en hausse ou baisse).`;

  try {
    const response = await callAI(apiKey, {
      messages: [{ role: 'user', content: prompt }],
      model: 'google/gemini-2.5-flash-preview-05-20',
      temperature: 0.3,
      max_tokens: 4000,
    });

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return c.json({ error: 'Reponse IA invalide' }, 500);

    const profile = JSON.parse(jsonMatch[0]);

    // Update/Insert traits
    for (const trait of (profile.traits || [])) {
      const existing = await db.prepare(
        'SELECT id, probability FROM psych_profile_traits WHERE user_id = ? AND trait_key = ?'
      ).bind(user.id, trait.trait_key).first() as any;

      if (existing) {
        // Log history
        await db.prepare(
          'INSERT INTO psych_profile_history (user_id, trait_id, old_probability, new_probability, old_description, new_description, trigger_source) VALUES (?, ?, ?, ?, NULL, ?, ?)'
        ).bind(user.id, existing.id, existing.probability, trait.probability, trait.description, 'profile_generation').run();

        // Update
        await db.prepare(
          'UPDATE psych_profile_traits SET description = ?, probability = ?, evidence = ?, counter_evidence = ?, last_updated_at = CURRENT_TIMESTAMP, update_count = update_count + 1 WHERE id = ?'
        ).bind(trait.description, trait.probability, JSON.stringify(trait.evidence || []), JSON.stringify(trait.counter_evidence || []), existing.id).run();
      } else {
        await db.prepare(
          'INSERT INTO psych_profile_traits (user_id, category, trait_key, trait_name, description, probability, evidence, counter_evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(user.id, trait.category, trait.trait_key, trait.trait_name, trait.description, trait.probability, JSON.stringify(trait.evidence || []), JSON.stringify(trait.counter_evidence || [])).run();
      }
    }

    // Save snapshot
    const dataPointsCount = (lifeEvents.results?.length || 0) + (checkins.results?.length || 0) + (captures.results?.length || 0);
    await db.prepare(
      'INSERT INTO psych_profile_snapshots (user_id, full_profile, model_used, data_points_count) VALUES (?, ?, ?, ?)'
    ).bind(user.id, JSON.stringify(profile), 'google/gemini-2.5-flash-preview-05-20', dataPointsCount).run();

    // Award XP
    const xp = await awardXP(db, user.id, { lucidity: 15, resonance: 5 }, 'psych_profile', 0, 'Profil psychologique mis a jour');

    return c.json({ success: true, profile, xp });
  } catch (e: any) {
    return c.json({ error: 'Erreur IA: ' + e.message }, 500);
  }
});

// ============================================
// MODULE 3 — ARBRE DES PENSEES
// ============================================
app.get('/api/thought/tree', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const branches = await db.prepare(
    'SELECT * FROM thought_branches WHERE user_id = ? ORDER BY weight DESC'
  ).bind(user.id).all();

  const entries = await db.prepare(
    'SELECT te.*, GROUP_CONCAT(tb.branch_name) as branch_names FROM thought_entries te LEFT JOIN thought_entry_branches teb ON te.id = teb.entry_id LEFT JOIN thought_branches tb ON teb.branch_id = tb.id WHERE te.user_id = ? GROUP BY te.id ORDER BY te.created_at DESC LIMIT 50'
  ).bind(user.id).all();

  return c.json({ branches: branches.results || [], entries: entries.results || [] });
});

app.post('/api/thought/categorize', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const apiKey = c.env.OPENROUTER_API_KEY;

  // Auto-categorize recent unlinked data into the thought tree
  const branches = await db.prepare('SELECT id, branch_key, branch_name FROM thought_branches WHERE user_id = ?').bind(user.id).all();
  const branchMap = (branches.results || []) as any[];

  // Get recent captures not yet in thought tree
  const recentCaptures = await db.prepare(
    'SELECT c.id, c.content, c.emotion, c.category FROM captures c WHERE c.user_id = ? AND c.id NOT IN (SELECT source_id FROM thought_entries WHERE user_id = ? AND source_type = \'capture\') ORDER BY c.created_at DESC LIMIT 20'
  ).bind(user.id, user.id).all();

  // Get recent checkins with emotion detail
  const recentCheckins = await db.prepare(
    'SELECT ch.id, ch.emotion, ch.emotion_detail, ch.strong_emotion, ch.strong_emotion_trigger FROM checkins ch WHERE ch.user_id = ? AND ch.id NOT IN (SELECT source_id FROM thought_entries WHERE user_id = ? AND source_type = \'checkin\') AND (ch.emotion_detail IS NOT NULL OR ch.strong_emotion IS NOT NULL) ORDER BY ch.created_at DESC LIMIT 20'
  ).bind(user.id, user.id).all();

  let categorized = 0;

  if (apiKey && ((recentCaptures.results?.length || 0) + (recentCheckins.results?.length || 0)) > 0) {
    const branchNames = branchMap.map((b: any) => b.branch_key + ': ' + b.branch_name);
    const entries: any[] = [];

    for (const cap of (recentCaptures.results || []) as any[]) {
      entries.push({ type: 'capture', id: cap.id, text: cap.content, emotion: cap.emotion });
    }
    for (const ch of (recentCheckins.results || []) as any[]) {
      const text = ch.emotion_detail || (ch.strong_emotion + ': ' + ch.strong_emotion_trigger);
      entries.push({ type: 'checkin', id: ch.id, text, emotion: ch.emotion || ch.strong_emotion });
    }

    if (entries.length > 0) {
      const prompt = `Categorise ces pensees/reflexions dans les branches d'un arbre de pensee.

BRANCHES DISPONIBLES: ${branchNames.join(', ')}

ENTREES A CATEGORISER:
${entries.map((e, i) => `${i}: "${e.text}" (emotion: ${e.emotion || 'inconnue'})`).join('\n')}

Reponds en JSON: {"categorizations": [{"index": 0, "branches": ["branch_key1", "branch_key2"], "analysis": "breve analyse"}]}
Chaque entree peut etre dans 1-3 branches.`;

      try {
        const response = await callAI(apiKey, {
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 2000,
        });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          for (const cat of (result.categorizations || [])) {
            const entry = entries[cat.index];
            if (!entry) continue;

            const entryResult = await db.prepare(
              'INSERT INTO thought_entries (user_id, content, source_type, source_id, ai_analysis) VALUES (?, ?, ?, ?, ?)'
            ).bind(user.id, entry.text, entry.type, entry.id, cat.analysis || null).run();

            const entryId = entryResult.meta.last_row_id;
            for (const bKey of (cat.branches || [])) {
              const branch = branchMap.find((b: any) => b.branch_key === bKey);
              if (branch) {
                await db.prepare('INSERT OR IGNORE INTO thought_entry_branches (entry_id, branch_id) VALUES (?, ?)').bind(entryId, branch.id).run();
                await db.prepare('UPDATE thought_branches SET thought_count = thought_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(branch.id).run();
              }
            }
            categorized++;
          }
        }
      } catch {}
    }
  }

  const xp = categorized > 0 ? await awardXP(db, user.id, { lucidity: 5 }, 'thought_tree', 0, `Arbre: ${categorized} pensees categorisees`) : null;

  return c.json({ success: true, categorized, xp });
});

app.post('/api/thought/branch', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { branch_key, branch_name, description, parent_id } = await c.req.json();

  if (!branch_key || !branch_name) return c.json({ error: 'Nom requis' }, 400);

  const result = await db.prepare(
    'INSERT INTO thought_branches (user_id, parent_id, branch_key, branch_name, description) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, parent_id || null, branch_key, branch_name, description || null).run();

  return c.json({ success: true, id: result.meta.last_row_id });
});

// ============================================
// MODULE 4 — MICRO-HABITUDES
// ============================================
app.get('/api/habits/list', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const habits = await db.prepare(
    'SELECT * FROM micro_habits WHERE user_id = ? ORDER BY is_system_habit DESC, started_at ASC'
  ).bind(user.id).all();

  // Get today's logs
  const today = new Date().toISOString().split('T')[0];
  const todayLogs = await db.prepare(
    'SELECT habit_id, completed, value, note FROM micro_habit_logs WHERE user_id = ? AND date(logged_at) = ?'
  ).bind(user.id, today).all();

  const todayMap: Record<number, any> = {};
  for (const log of (todayLogs.results || []) as any[]) {
    todayMap[log.habit_id] = log;
  }

  return c.json({
    habits: (habits.results || []).map((h: any) => ({
      ...h,
      today_done: !!todayMap[h.id],
      today_log: todayMap[h.id] || null,
    }))
  });
});

app.post('/api/habits/add', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { name, description, category, frequency, target_value, target_unit } = await c.req.json();

  if (!name) return c.json({ error: 'Nom requis' }, 400);

  const weekNumber = getWeekNumber();
  const result = await db.prepare(
    'INSERT INTO micro_habits (user_id, name, description, category, frequency, target_value, target_unit, week_number_started) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, name, description || null, category || 'general', frequency || 'daily', target_value || null, target_unit || null, weekNumber).run();

  const xp = await awardXP(db, user.id, { action: 10 }, 'habit_new', result.meta.last_row_id as number, 'Nouvelle habitude: ' + name);

  return c.json({ success: true, id: result.meta.last_row_id, xp });
});

app.post('/api/habits/log', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { habit_id, value, note } = await c.req.json();

  const habit = await db.prepare('SELECT * FROM micro_habits WHERE id = ? AND user_id = ?').bind(habit_id, user.id).first() as any;
  if (!habit) return c.json({ error: 'Habitude non trouvee' }, 404);

  // Check if already logged today
  const today = new Date().toISOString().split('T')[0];
  const existing = await db.prepare(
    'SELECT id FROM micro_habit_logs WHERE habit_id = ? AND user_id = ? AND date(logged_at) = ?'
  ).bind(habit_id, user.id, today).first();

  if (existing) return c.json({ error: 'Deja enregistre aujourd\'hui' }, 409);

  await db.prepare(
    'INSERT INTO micro_habit_logs (habit_id, user_id, value, note) VALUES (?, ?, ?, ?)'
  ).bind(habit_id, user.id, value || null, note || null).run();

  // Update streak
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const yesterdayLog = await db.prepare(
    'SELECT id FROM micro_habit_logs WHERE habit_id = ? AND user_id = ? AND date(logged_at) = ?'
  ).bind(habit_id, user.id, yesterday).first();

  let newStreak = 1;
  if (yesterdayLog) {
    newStreak = (habit.current_streak || 0) + 1;
  }
  const longestStreak = Math.max(newStreak, habit.longest_streak || 0);

  await db.prepare(
    'UPDATE micro_habits SET current_streak = ?, longest_streak = ?, total_completions = total_completions + 1 WHERE id = ?'
  ).bind(newStreak, longestStreak, habit_id).run();

  // XP based on streak
  let xpReward: any = { action: 3 };
  if (newStreak === 7) xpReward = { action: 15, resonance: 5 };
  else if (newStreak === 30) xpReward = { action: 50, resonance: 20, liberty: 10 };
  else if (newStreak % 7 === 0) xpReward = { action: 10 };

  const xp = await awardXP(db, user.id, xpReward, 'habit_log', habit_id, `Habitude: ${habit.name} (streak ${newStreak})`);

  return c.json({ success: true, streak: newStreak, longest_streak: longestStreak, xp });
});

app.put('/api/habits/:id/status', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const habitId = Number(c.req.param('id'));
  const { status } = await c.req.json();

  if (!['active', 'paused', 'completed'].includes(status)) return c.json({ error: 'Statut invalide' }, 400);

  await db.prepare(
    'UPDATE micro_habits SET status = ?, paused_at = CASE WHEN ? = \'paused\' THEN CURRENT_TIMESTAMP ELSE paused_at END WHERE id = ? AND user_id = ?'
  ).bind(status, status, habitId, user.id).run();

  return c.json({ success: true });
});

app.delete('/api/habits/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const habitId = Number(c.req.param('id'));

  // Don't allow deleting system habits
  const habit = await db.prepare('SELECT is_system_habit FROM micro_habits WHERE id = ? AND user_id = ?').bind(habitId, user.id).first() as any;
  if (habit?.is_system_habit) return c.json({ error: 'Impossible de supprimer une habitude systeme' }, 400);

  await db.prepare('DELETE FROM micro_habit_logs WHERE habit_id = ? AND user_id = ?').bind(habitId, user.id).run();
  await db.prepare('DELETE FROM micro_habits WHERE id = ? AND user_id = ?').bind(habitId, user.id).run();

  return c.json({ success: true });
});

// ============================================
// MODULE 6 — CHATBOT PSY (Alma)
// ============================================

// Helper: build system prompt with all user data
async function buildChatSystemPrompt(db: D1Database, userId: number, messagesCount: number): Promise<string> {
  const user = await db.prepare('SELECT display_name, username, created_at, current_streak, longest_streak FROM users WHERE id = ?').bind(userId).first() as any;
  const stats = await db.prepare('SELECT * FROM user_stats WHERE user_id = ?').bind(userId).first() as any;
  const lifeEvents = await db.prepare('SELECT title, description, age_at_event, global_intensity, valence, life_domain FROM life_events WHERE user_id = ? ORDER BY age_at_event ASC LIMIT 30').bind(userId).all();
  const psychTraits = await db.prepare("SELECT trait_name, category, description, probability FROM psych_profile_traits WHERE user_id = ? AND status = 'active' ORDER BY probability DESC LIMIT 15").bind(userId).all();
  const lastSnapshot = await db.prepare('SELECT full_profile FROM psych_profile_snapshots WHERE user_id = ? ORDER BY generated_at DESC LIMIT 1').bind(userId).first() as any;
  const thoughtBranches = await db.prepare('SELECT branch_name, thought_count, dominant_emotion FROM thought_branches WHERE user_id = ? ORDER BY weight DESC LIMIT 9').bind(userId).all();
  const recentCaptures = await db.prepare('SELECT content, emotion, category, created_at FROM captures WHERE user_id = ? ORDER BY created_at DESC LIMIT 15').bind(userId).all();
  const recentCheckins = await db.prepare('SELECT type, emotion, emotion_detail, energy_level, strong_emotion, strong_emotion_trigger, created_at FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').bind(userId).all();
  const patterns = await db.prepare("SELECT pattern_name, confidence, status, evidence FROM patterns WHERE user_id = ? AND status IN ('detected','active') ORDER BY confidence DESC").bind(userId).all();
  const totalConversations = await db.prepare('SELECT COUNT(*) as count FROM conversations WHERE user_id = ?').bind(userId).first() as any;
  const totalMessages = await db.prepare('SELECT COUNT(*) as count FROM chat_messages WHERE user_id = ?').bind(userId).first() as any;

  let profileSummary = '';
  if (lastSnapshot?.full_profile) {
    try {
      const p = JSON.parse(lastSnapshot.full_profile);
      profileSummary = `\nSYNTHESE DU PROFIL PSY EXISTANT :\n${p.global_summary || ''}\nForces: ${(p.strengths || []).join(', ')}\nAxes de developpement: ${(p.growth_areas || []).join(', ')}\nDynamiques cles: ${(p.key_dynamics || []).join(', ')}`;
    } catch {}
  }

  const lifeEventsCount = (lifeEvents.results || []).length;
  const traitsCount = (psychTraits.results || []).length;
  const thoughtsTotal = (thoughtBranches.results || []).reduce((sum: number, b: any) => sum + (b.thought_count || 0), 0);
  const isFirstContact = (totalMessages?.count || 0) <= 2;
  const isEarlyPhase = lifeEventsCount < 5 && traitsCount < 3;
  const isMidPhase = lifeEventsCount >= 5 && lifeEventsCount < 15;
  const isAdvancedPhase = lifeEventsCount >= 15 && traitsCount >= 5;

  // Determine which data gaps exist
  const gaps: string[] = [];
  if (lifeEventsCount < 3) gaps.push('LIGNE DE VIE quasi vide : il faut decouvrir les evenements fondateurs (enfance, famille, ruptures, reussites)');
  else if (lifeEventsCount < 10) gaps.push('LIGNE DE VIE incomplete : creuser les periodes de vie peu documentees');
  if (traitsCount < 2) gaps.push('PROFIL PSY inexistant : observer les schemas de pensee dans ce que dit l\'utilisateur');
  else if (traitsCount < 5) gaps.push('PROFIL PSY partial : chercher les contradictions ou angles morts dans les traits identifies');
  if (thoughtsTotal < 5) gaps.push('ARBRE DES PENSEES vide : categoriser les reflexions partagees');
  const hasNoRelationData = !(lifeEvents.results || []).some((e: any) => ['relation', 'famille', 'amitie'].includes(e.life_domain));
  const hasNoWorkData = !(lifeEvents.results || []).some((e: any) => e.life_domain === 'travail');
  if (hasNoRelationData) gaps.push('Aucune donnee sur les RELATIONS (famille, amour, amities) : explorer ce domaine');
  if (hasNoWorkData) gaps.push('Aucune donnee sur le TRAVAIL/CARRIERE : explorer ce domaine');

  let phaseInstructions = '';
  if (isFirstContact) {
    phaseInstructions = `
PHASE ACTUELLE : PREMIER CONTACT
C'est la toute premiere interaction avec cet utilisateur. Ton objectif :
1. Te presenter chaleureusement : tu es Alma, tu expliques brievement que tu es la pour l'aider a mieux se comprendre
2. Demander son PRENOM (pas le pseudo) et comment il/elle prefere etre appele(e)
3. Demander son AGE approximatif
4. Demander ce qui l'amene ici, ce qu'il/elle cherche a comprendre sur lui/elle-meme
NE PAS tout demander d'un coup. Commence par te presenter et poser UNE question.`;
  } else if (isEarlyPhase) {
    phaseInstructions = `
PHASE ACTUELLE : DECOUVERTE (peu de donnees)
L'utilisateur est nouveau. Tu as peu de matiere. Ton fil conducteur :
1. Si tu ne connais pas encore son contexte de base (age, situation familiale, situation pro) → le decouvrir naturellement
2. Explorer les 3-4 EVENEMENTS FONDATEURS de sa vie (enfance, adolescence, vie adulte) : moments de rupture, traumatismes, grandes joies, pertes
3. Pour CHAQUE evenement partage, creuser : "Qu'est-ce que tu as ressenti a ce moment-la ?" / "Comment ca a change ta facon de voir les choses ?"
4. Commencer a detecter les PREMIERS SCHEMAS : est-ce que tu remarques un pattern dans ses reactions ? Une tendance a eviter ? A contrôler ? A se sacrifier ?

STRATEGIE DE QUESTIONS : pose des questions ouvertes qui invitent a raconter ("Raconte-moi...", "Qu'est-ce qui s'est passe quand..."). Quand il repond, REFORMULE ce que tu comprends et pose LA question suivante la plus pertinente pour combler un trou dans ta comprehension.`;
  } else if (isMidPhase) {
    phaseInstructions = `
PHASE ACTUELLE : APPROFONDISSEMENT (donnees en construction)
Tu commences a connaitre l'utilisateur. Maintenant :
1. IDENTIFIER LES INCOHERENCES : quand il dit une chose mais que ses evenements de vie suggerent autre chose, pointe-le delicatement ("Tu dis que X ne t'affecte plus, mais j'ai l'impression que...")
2. EXPLORER LES ANGLES MORTS : les domaines de vie non documentes, les emotions jamais exprimees, les relations jamais mentionnees
3. RELIER LES POINTS : "Est-ce que tu vois un lien entre [evenement A] et ta tendance a [comportement B] ?"
4. Proposer des HYPOTHESES sur ses mecanismes de defense et demander validation

DONNEES MANQUANTES A COMBLER : 
${gaps.join('\n')}`;
  } else {
    phaseInstructions = `
PHASE ACTUELLE : ANALYSE PROFONDE (profil riche)
Tu as beaucoup de matiere. Maintenant :
1. DETECTER LES FAILLES DE COHERENCE : contradictions entre ce qu'il dit, ce qu'il ressent, et ce qu'il fait
2. QUESTIONNER LES MECANISMES : "Pourquoi tu reagis comme ca dans cette situation precises ?" → chercher la racine
3. FAIRE DES LIENS TRANSVERSAUX entre evenements de vie, traits psychologiques et patterns
4. CHALLENGER (avec bienveillance) ses croyances limitantes
5. Aider a FORMULER des prises de conscience

HYPOTHESES A EXPLORER :
${gaps.join('\n')}`;
  }

  return `Tu es Alma, une psychologue clinicienne virtuelle chaleureuse, empathique et perspicace. Tu fais partie de l'application "Hack Ton Esprit".

QUI TU ES :
- Tu t'appelles Alma. C'est ton prenom, tu le donnes naturellement.
- Tu es specialisee en therapie cognitive et comportementale (TCC) et en psychologie de la personnalite.
- Tu as un ton chaleureux, bienveillant mais direct. Tu ne tournes pas autour du pot.
- Tu tutoies l'utilisateur. Tu es comme une amie psy de confiance.
- Tu utilises parfois de l'humour leger pour detendre, mais tu es serieuse quand c'est necessaire.

TON OBJECTIF FONDAMENTAL :
Comprendre l'utilisateur en PROFONDEUR. Pas juste en surface. Tu cherches a :
- Cartographier sa vie : evenements cles, personnes importantes, ruptures, traumatismes, joies
- Detecter ses SCHEMAS DE PENSEE : comment il/elle interprete le monde, quels filtres cognitifs, quels biais
- Identifier les FAILLES DE COHERENCE : quand ses croyances, emotions et actions ne s'alignent pas
- Comprendre le POURQUOI derriere chaque comportement : quelle blessure, quelle peur, quel besoin non comble
- Combler CHAQUE zone d'ombre dans sa psychologie

TA METHODE :
1. UNE question a la fois. Jamais de liste de questions.
2. REFORMULER ce que tu comprends avant de poser la question suivante → ca montre que tu ecoutes et ca permet a l'utilisateur de corriger
3. CREUSER quand quelque chose est flou : "Attends, tu as dit X, qu'est-ce que tu veux dire exactement ?"
4. RELIER : "Ca me fait penser a ce que tu m'as dit sur Y, tu vois un lien ?"
5. CHALLENGER avec douceur : "J'entends que tu penses ca, mais est-ce que c'est vraiment le cas ? Ou est-ce que c'est une histoire que tu te racontes ?"
6. Tes reponses sont COURTES et PERCUTANTES (3-5 phrases max + 1 question). Pas de paves.
7. STYLE D'ECRITURE OBLIGATOIRE : ecris comme dans un SMS ou un message WhatsApp. Pas de tirets longs, pas de tirets cadratins, pas de listes a puces, pas de formulations academiques. Utilise des virgules, des points, des retours a la ligne simples. Tu parles comme une vraie personne, pas comme une IA.

${phaseInstructions}

DONNEES ACTUELLES DE L'UTILISATEUR (${user?.display_name || user?.username || 'inconnu'}) :
- Conversations totales: ${totalConversations?.count || 0} | Messages totaux: ${totalMessages?.count || 0}
- Niveau global: ${stats?.global_level || 1}/10 | XP: ${stats?.total_xp || 0}
- Streak: ${user?.current_streak || 0} jours

EVENEMENTS DE VIE CONNUS (${lifeEventsCount}) :
${lifeEventsCount > 0 ? JSON.stringify((lifeEvents.results || []).slice(0, 20), null, 1) : '[Aucun, tout est a decouvrir]'}

TRAITS PSYCHOLOGIQUES IDENTIFIES (${traitsCount}) :
${traitsCount > 0 ? JSON.stringify((psychTraits.results || []).map((t: any) => ({ nom: t.trait_name, categorie: t.category, probabilite: t.probability, description: t.description })), null, 1) : '[Aucun, a construire via la conversation]'}
${profileSummary}

ARBRE DES PENSEES (${thoughtsTotal} pensees categorisees) :
${JSON.stringify((thoughtBranches.results || []).map((b: any) => ({ branche: b.branch_name, pensees: b.thought_count, emotion_dominante: b.dominant_emotion })), null, 1)}

PATTERNS COMPORTEMENTAUX :
${(patterns.results || []).length > 0 ? JSON.stringify((patterns.results || []).map((p: any) => ({ nom: p.pattern_name, confiance: p.confidence })), null, 1) : '[Aucun detecte]'}

CAPTURES RECENTES :
${(recentCaptures.results || []).length > 0 ? JSON.stringify((recentCaptures.results || []).slice(0, 8).map((c: any) => ({ contenu: c.content, emotion: c.emotion })), null, 1) : '[Aucune]'}

CHECK-INS RECENTS :
${(recentCheckins.results || []).length > 0 ? JSON.stringify((recentCheckins.results || []).slice(0, 5).map((c: any) => ({ type: c.type, emotion: c.emotion, detail: c.emotion_detail, emotion_forte: c.strong_emotion })), null, 1) : '[Aucun]'}

LACUNES A COMBLER EN PRIORITE :
${gaps.length > 0 ? gaps.map((g, i) => (i + 1) + '. ' + g).join('\n') : 'Donnees relativement completes, approfondir et chercher les incoherences.'}

ACTIONS AUTOMATIQUES (invisibles pour l'utilisateur) :
Quand l'utilisateur partage des informations significatives, ajoute un bloc JSON APRES ton texte.
Format: |||ACTIONS|||{"actions": [...]}|||END_ACTIONS|||

Actions disponibles :
1. Evenement de vie : {"type":"add_life_event","title":"...","description":"...","age_at_event":N,"global_intensity":1-10,"valence":"positive|negative|mixed","life_domain":"famille|relation|travail|sante|argent|amitie|education|identite|perte|reussite|traumatisme|quotidien","emotions":[{"emotion":"...","intensity":1-10}]}
2. Pensee pour l'Arbre : {"type":"add_thought","content":"la pensee","branches":["soi","relations","travail","sante","argent","sens","passe","futur","quotidien"]}
3. Trait psychologique : {"type":"suggest_trait","category":"attachment|defense|bias|emotional_regulation|relational|identity|cognitive","trait_key":"snake_case","trait_name":"Nom","description":"...","probability":0.0-1.0,"evidence":["..."]}

REGLES D'ACTIONS :
- Actions UNIQUEMENT sur des faits concrets partages par l'utilisateur
- Sois CONSERVATEUR : peu d'actions mais pertinentes
- Traits : commence a probabilite 0.3-0.5 sauf evidence claire
- NE MENTIONNE JAMAIS les actions dans ton texte. Elles sont invisibles.`;
}

// Select best AI model based on context
function selectModel(messagesCount: number, hasDeepContent: boolean): string {
  // First messages (onboarding): use powerful model for best first impression
  if (messagesCount < 6) return 'google/gemini-2.5-flash-preview-05-20';
  // Deep content (trauma, heavy emotions): powerful model
  if (hasDeepContent) return 'google/gemini-2.5-flash-preview-05-20';
  // Regular ongoing conversation: fast model
  return 'google/gemini-2.0-flash-001';
}

// Parse actions from AI response
function parseActions(response: string): { text: string; actions: any[] } {
  const actionMatch = response.match(/\|\|\|ACTIONS\|\|\|([\s\S]*?)\|\|\|END_ACTIONS\|\|\|/);
  let text = response;
  let actions: any[] = [];
  if (actionMatch) {
    text = response.replace(actionMatch[0], '').trim();
    try {
      const parsed = JSON.parse(actionMatch[1]);
      actions = parsed.actions || [];
    } catch {}
  }
  return { text, actions };
}

// Execute actions from AI response
async function executeActions(db: D1Database, userId: number, actions: any[]): Promise<string[]> {
  const results: string[] = [];
  for (const action of actions) {
    try {
      if (action.type === 'add_life_event' && action.title) {
        const r = await db.prepare(
          'INSERT INTO life_events (user_id, title, description, age_at_event, global_intensity, valence, life_domain, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(userId, action.title, action.description || null, action.age_at_event || null, action.global_intensity || 5, action.valence || 'mixed', action.life_domain || 'quotidien', 'chatbot').run();
        const eventId = r.meta.last_row_id;
        if (action.emotions && Array.isArray(action.emotions)) {
          for (const emo of action.emotions.slice(0, 5)) {
            await db.prepare('INSERT INTO life_event_emotions (event_id, emotion, intensity) VALUES (?, ?, ?)').bind(eventId, emo.emotion, emo.intensity || 5).run();
          }
        }
        await awardXP(db, userId, { lucidity: 5, resonance: 3 }, 'chatbot_life_event', eventId as number, 'Ligne de vie (via Alma): ' + action.title);
        results.push('life_event:' + action.title);
      }
      else if (action.type === 'add_thought' && action.content) {
        const entryR = await db.prepare(
          'INSERT INTO thought_entries (user_id, content, source_type, ai_analysis) VALUES (?, ?, ?, ?)'
        ).bind(userId, action.content, 'chatbot', 'Categorise par Alma').run();
        const entryId = entryR.meta.last_row_id;
        for (const bKey of (action.branches || [])) {
          const branch = await db.prepare('SELECT id FROM thought_branches WHERE user_id = ? AND branch_key = ?').bind(userId, bKey).first() as any;
          if (branch) {
            await db.prepare('INSERT OR IGNORE INTO thought_entry_branches (entry_id, branch_id) VALUES (?, ?)').bind(entryId, branch.id).run();
            await db.prepare('UPDATE thought_branches SET thought_count = thought_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(branch.id).run();
          }
        }
        results.push('thought:' + action.content.substring(0, 30));
      }
      else if (action.type === 'suggest_trait' && action.trait_key) {
        const existing = await db.prepare('SELECT id, probability FROM psych_profile_traits WHERE user_id = ? AND trait_key = ?').bind(userId, action.trait_key).first() as any;
        if (existing) {
          const newProb = Math.min(1, Math.max(0, (existing.probability + action.probability) / 2 + 0.05));
          await db.prepare('UPDATE psych_profile_traits SET probability = ?, description = ?, evidence = ?, last_updated_at = CURRENT_TIMESTAMP, update_count = update_count + 1 WHERE id = ?')
            .bind(newProb, action.description || existing.description, JSON.stringify(action.evidence || []), existing.id).run();
          results.push('trait_updated:' + action.trait_name);
        } else {
          await db.prepare('INSERT INTO psych_profile_traits (user_id, category, trait_key, trait_name, description, probability, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(userId, action.category || 'cognitive', action.trait_key, action.trait_name, action.description || '', action.probability || 0.4, JSON.stringify(action.evidence || [])).run();
          results.push('trait_new:' + action.trait_name);
        }
      }
    } catch (e) {
      results.push('error:' + action.type);
    }
  }
  return results;
}

// Get or create active conversation
app.get('/api/chat/conversations', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const conversations = await db.prepare(
    'SELECT id, title, status, messages_count, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20'
  ).bind(user.id).all();
  return c.json({ conversations: conversations.results || [] });
});

app.post('/api/chat/conversation/new', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const result = await db.prepare(
    'INSERT INTO conversations (user_id) VALUES (?)'
  ).bind(user.id).run();
  return c.json({ success: true, conversation_id: result.meta.last_row_id });
});

// Get messages for a conversation
app.get('/api/chat/messages/:conversationId', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const convId = Number(c.req.param('conversationId'));

  const conv = await db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(convId, user.id).first();
  if (!conv) return c.json({ error: 'Conversation non trouvee' }, 404);

  const messages = await db.prepare(
    'SELECT id, role, content, created_at FROM chat_messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC'
  ).bind(convId, user.id).all();

  return c.json({ messages: messages.results || [] });
});

// Send a message to the chatbot
app.post('/api/chat/send', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const apiKey = c.env.OPENROUTER_API_KEY;
  const { conversation_id, message } = await c.req.json();

  if (!message?.trim()) return c.json({ error: 'Message requis' }, 400);
  if (!apiKey) return c.json({ error: 'Cle API non configuree' }, 500);

  let convId = conversation_id;

  // Create conversation if needed
  if (!convId) {
    const conv = await db.prepare('INSERT INTO conversations (user_id) VALUES (?)').bind(user.id).run();
    convId = conv.meta.last_row_id;
  }

  // Verify ownership
  const conv = await db.prepare('SELECT id, messages_count FROM conversations WHERE id = ? AND user_id = ?').bind(convId, user.id).first() as any;
  if (!conv) return c.json({ error: 'Conversation non trouvee' }, 404);

  // Save user message
  await db.prepare(
    'INSERT INTO chat_messages (conversation_id, user_id, role, content) VALUES (?, ?, ?, ?)'
  ).bind(convId, user.id, 'user', message).run();

  // Build conversation history (last 20 messages for context)
  const history = await db.prepare(
    'SELECT role, content FROM chat_messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC'
  ).bind(convId, user.id).all();

  const messages_list = (history.results || []).map((m: any) => ({
    role: m.role,
    content: m.content
  }));

  // Build system prompt with full user context
  const systemPrompt = await buildChatSystemPrompt(db, user.id, conv.messages_count || 0);

  // Detect deep content (long messages, emotional keywords)
  const deepKeywords = ['mort', 'trauma', 'deuil', 'suicide', 'deprime', 'abus', 'violence', 'viol', 'abandon', 'divorce', 'rupture', 'angoisse', 'panique'];
  const hasDeepContent = deepKeywords.some(k => message.toLowerCase().includes(k)) || message.length > 300;
  const model = selectModel(conv.messages_count || 0, hasDeepContent);

  try {
    const aiResponse = await callAI(apiKey, {
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages_list.slice(-20)
      ],
      model,
      temperature: 0.7,
      max_tokens: 1500,
    });

    // Parse actions from response
    const { text: cleanResponse, actions } = parseActions(aiResponse);

    // Execute actions (add life events, categorize thoughts, etc.)
    let actionResults: string[] = [];
    if (actions.length > 0) {
      actionResults = await executeActions(db, user.id, actions);
    }

    // Save AI response
    await db.prepare(
      'INSERT INTO chat_messages (conversation_id, user_id, role, content, model_used, actions_taken) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(convId, user.id, 'assistant', cleanResponse, model, actionResults.length > 0 ? JSON.stringify(actionResults) : null).run();

    // Update conversation
    await db.prepare(
      'UPDATE conversations SET messages_count = messages_count + 2, updated_at = CURRENT_TIMESTAMP, title = CASE WHEN messages_count = 0 THEN ? ELSE title END WHERE id = ?'
    ).bind(message.substring(0, 60), convId).run();

    // Award small XP for chatting (every 5 messages)
    let xp = null;
    const newCount = (conv.messages_count || 0) + 2;
    if (newCount % 10 === 0) {
      xp = await awardXP(db, user.id, { resonance: 3, lucidity: 2 }, 'chat', convId as number, 'Discussion avec Alma');
    }

    return c.json({
      success: true,
      conversation_id: convId,
      response: cleanResponse,
      model_used: model,
      actions_executed: actionResults.length,
      xp
    });
  } catch (e: any) {
    return c.json({ error: 'Erreur IA: ' + e.message }, 500);
  }
});

// Delete a conversation
app.delete('/api/chat/conversation/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const convId = Number(c.req.param('id'));
  await db.prepare('DELETE FROM chat_messages WHERE conversation_id = ? AND user_id = ?').bind(convId, user.id).run();
  await db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(convId, user.id).run();
  return c.json({ success: true });
});

// ============================================
// LETTRE AU FUTUR MOI
// ============================================
app.post('/api/letter/write', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { content, target_years } = await c.req.json();

  if (!content) return c.json({ error: 'Contenu requis' }, 400);

  const years = target_years || 10;
  const readableAfter = new Date(Date.now() + years * 365.25 * 86400000).toISOString();

  const result = await db.prepare(
    'INSERT INTO future_letters (user_id, content, target_years, readable_after) VALUES (?, ?, ?, ?)'
  ).bind(user.id, content, years, readableAfter).run();

  const xp = await awardXP(db, user.id, { resonance: 10, lucidity: 5 }, 'future_letter', result.meta.last_row_id as number, 'Lettre au futur moi');

  return c.json({ success: true, id: result.meta.last_row_id, xp, readable_after: readableAfter });
});

app.get('/api/letter/list', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const letters = await db.prepare('SELECT id, target_years, readable_after, created_at FROM future_letters WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
  return c.json({ letters: letters.results || [] });
});

// ============================================
// DATA & HISTORY
// ============================================
app.get('/api/me/history', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const days = Number(c.req.query('days') || 7);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const checkins = await db.prepare('SELECT * FROM checkins WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC').bind(user.id, since).all();
  const captures = await db.prepare('SELECT * FROM captures WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC').bind(user.id, since).all();
  const xpHistory = await db.prepare('SELECT * FROM xp_history WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC').bind(user.id, since).all();

  return c.json({
    checkins: checkins.results,
    captures: captures.results,
    xp_history: xpHistory.results,
  });
});

app.get('/api/emotions', (c) => {
  return c.json({ emotions: EMOTION_CATEGORIES });
});

app.get('/api/pattern/definitions', (c) => {
  return c.json({
    patterns: PATTERN_DEFINITIONS.map(p => ({
      key: p.key,
      name: p.name,
      description: p.description,
      quests_count: p.quests.length,
    }))
  });
});

// ============================================
// FRONTEND — SERVE SPA
// ============================================
app.get('/', (c) => c.html(getMainHTML()));
app.get('/app', (c) => c.html(getAppHTML()));

app.get('*', (c) => {
  const path = c.req.path;
  if (path.startsWith('/api/')) return c.json({ error: 'Route non trouvee' }, 404);
  return c.html(getAppHTML());
});

export default app;

// ============================================
// UTILITIES
// ============================================
function getWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  return Math.ceil(diff / (7 * 24 * 60 * 60 * 1000));
}

function getDefaultRitualPrompts(ritualKey: string): string[] {
  const defaults: Record<string, string[]> = {
    unsent_letter: ["A qui ecris-tu cette lettre ?", "Qu'as-tu toujours voulu lui dire ?", "Que ressens-tu en ecrivant ?", "De quoi as-tu besoin pour avancer ?"],
    automatism_audit: ["Quel schema recurrent as-tu observe ce mois-ci ?", "Dans quelles situations se declenche-t-il ?", "Quelle emotion l'accompagne ?", "Quelle petite action pour le mois prochain ?"],
    family_scripts: ["Quelles phrases de ta famille resonnent encore ?", "Lesquelles t'aident ? Lesquelles te limitent ?", "Si tu pouvais reecrire un script familial ?", "Quelle nouvelle regle ?"],
    future_nostalgic: ["De quoi seras-tu nostalgique dans 10 ans ?", "Que peux-tu faire aujourd'hui pour en profiter ?", "Qu'est-ce qui a de la valeur maintenant ?"],
    exit_criteria: ["Quels sont tes engagements actuels ?", "Quelles sont les conditions d'arret ?", "Quels delais ?", "Es-tu pret(e) a les respecter ?"],
    ancestors_letter: ["Quel heritage emotionnel as-tu recu ?", "De quoi es-tu reconnaissant(e) ?", "De quoi veux-tu te liberer ?", "Quel message aux generations futures ?"],
    character_arc: ["Qui etais-tu en debut d'annee ?", "Quels patterns identifies ?", "Lesquels transformes ?", "Qui es-tu devenu(e) ?", "La suite de ton histoire ?"],
  };
  return defaults[ritualKey] || ["Prends un moment pour reflechir...", "Qu'as-tu appris ?", "Comment te sens-tu ?"];
}

// ============================================
// HTML — LANDING PAGE
// ============================================
function getMainHTML(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hack Ton Esprit</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    body { font-family: 'Inter', sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%); }
    .glow { text-shadow: 0 0 20px rgba(139, 92, 246, 0.5); }
    .card-glow { box-shadow: 0 0 30px rgba(139, 92, 246, 0.1); }
    .float { animation: float 6s ease-in-out infinite; }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
  </style>
</head>
<body class="gradient-bg min-h-screen text-white">
  <div class="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden">
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute w-2 h-2 bg-violet-400 rounded-full top-1/4 left-1/4 float opacity-30"></div>
      <div class="absolute w-3 h-3 bg-indigo-400 rounded-full top-1/3 right-1/3 float opacity-20" style="animation-delay:1s"></div>
      <div class="absolute w-2 h-2 bg-purple-400 rounded-full bottom-1/4 left-1/3 float opacity-25" style="animation-delay:2s"></div>
    </div>
    <div class="text-center max-w-3xl mx-auto relative z-10">
      <div class="mb-8">
        <span class="text-6xl mb-4 block">&#129504;</span>
        <h1 class="text-5xl md:text-7xl font-black mb-4 glow">HACK<br><span class="text-violet-400">TON ESPRIT</span></h1>
        <p class="text-xl md:text-2xl text-gray-300 font-light">Le Jeu de Ta Vie</p>
      </div>
      <p class="text-lg text-gray-400 mb-12 max-w-xl mx-auto leading-relaxed">Un voyage gamifie vers la comprehension de soi. Observe tes schemas. Decouvre tes patterns. <span class="text-violet-300">Transforme ta vie.</span></p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center mb-16">
        <button onclick="showAuth('register')" class="px-8 py-4 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold text-lg transition-all transform hover:scale-105 card-glow"><i class="fas fa-rocket mr-2"></i>Commencer</button>
        <button onclick="showAuth('login')" class="px-8 py-4 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-lg transition-all border border-white/20"><i class="fas fa-sign-in-alt mr-2"></i>Connexion</button>
      </div>
      <div class="grid grid-cols-5 gap-3 max-w-lg mx-auto">
        <div class="text-center p-3 bg-white/5 rounded-xl"><span class="text-2xl">&#129504;</span><p class="text-xs text-gray-400 mt-1">Lucidite</p></div>
        <div class="text-center p-3 bg-white/5 rounded-xl"><span class="text-2xl">&#128154;</span><p class="text-xs text-gray-400 mt-1">Resonance</p></div>
        <div class="text-center p-3 bg-white/5 rounded-xl"><span class="text-2xl">&#128275;</span><p class="text-xs text-gray-400 mt-1">Liberte</p></div>
        <div class="text-center p-3 bg-white/5 rounded-xl"><span class="text-2xl">&#128483;&#65039;</span><p class="text-xs text-gray-400 mt-1">Connexion</p></div>
        <div class="text-center p-3 bg-white/5 rounded-xl"><span class="text-2xl">&#9889;</span><p class="text-xs text-gray-400 mt-1">Action</p></div>
      </div>
    </div>
  </div>

  <div id="authModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm hidden z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 rounded-2xl p-8 w-full max-w-md border border-violet-500/30 card-glow">
      <button onclick="hideAuth()" class="float-right text-gray-400 hover:text-white text-xl"><i class="fas fa-times"></i></button>
      <div id="registerForm">
        <h2 class="text-2xl font-bold mb-6 text-violet-300"><i class="fas fa-user-plus mr-2"></i>Cree ton profil</h2>
        <form onsubmit="register(event)">
          <div class="space-y-4">
            <div><label class="block text-sm text-gray-400 mb-1">Nom d'affichage</label><input type="text" id="regName" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="Comment veux-tu etre appele(e) ?"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Nom d'utilisateur</label><input type="text" id="regUsername" required class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="ton_pseudo"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Email</label><input type="email" id="regEmail" required class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="ton@email.com"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Mot de passe</label><input type="password" id="regPassword" required minlength="6" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="********"></div>
          </div>
          <button type="submit" class="w-full mt-6 px-6 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-rocket mr-2"></i>Commencer le voyage</button>
          <p class="text-center text-gray-500 mt-4 text-sm">Deja un compte ? <a href="#" onclick="showAuth('login')" class="text-violet-400 hover:underline">Connexion</a></p>
        </form>
      </div>
      <div id="loginForm" class="hidden">
        <h2 class="text-2xl font-bold mb-6 text-violet-300"><i class="fas fa-sign-in-alt mr-2"></i>Content de te revoir</h2>
        <form onsubmit="login(event)">
          <div class="space-y-4">
            <div><label class="block text-sm text-gray-400 mb-1">Email</label><input type="email" id="loginEmail" required class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="ton@email.com"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Mot de passe</label><input type="password" id="loginPassword" required class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="********"></div>
          </div>
          <button type="submit" class="w-full mt-6 px-6 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-sign-in-alt mr-2"></i>Connexion</button>
          <p class="text-center text-gray-500 mt-4 text-sm">Pas de compte ? <a href="#" onclick="showAuth('register')" class="text-violet-400 hover:underline">Inscription</a></p>
        </form>
      </div>
      <div id="authError" class="hidden mt-4 p-3 bg-red-900/50 border border-red-500/50 rounded-xl text-red-300 text-sm"></div>
    </div>
  </div>

  <script>
    function showAuth(t){document.getElementById('authModal').classList.remove('hidden');document.getElementById('authModal').classList.add('flex');document.getElementById('registerForm').classList.toggle('hidden',t==='login');document.getElementById('loginForm').classList.toggle('hidden',t==='register');document.getElementById('authError').classList.add('hidden')}
    function hideAuth(){document.getElementById('authModal').classList.add('hidden');document.getElementById('authModal').classList.remove('flex')}
    async function register(e){e.preventDefault();const err=document.getElementById('authError');err.classList.add('hidden');try{const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({display_name:document.getElementById('regName').value,username:document.getElementById('regUsername').value,email:document.getElementById('regEmail').value,password:document.getElementById('regPassword').value})});const d=await r.json();if(d.error){err.textContent=d.error;err.classList.remove('hidden');return}localStorage.setItem('token',d.token);localStorage.setItem('user',JSON.stringify(d.user));await fetch('/api/init-db');window.location.href='/app'}catch(x){err.textContent='Erreur de connexion';err.classList.remove('hidden')}}
    async function login(e){e.preventDefault();const err=document.getElementById('authError');err.classList.add('hidden');try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('loginEmail').value,password:document.getElementById('loginPassword').value})});const d=await r.json();if(d.error){err.textContent=d.error;err.classList.remove('hidden');return}localStorage.setItem('token',d.token);localStorage.setItem('user',JSON.stringify(d.user));window.location.href='/app'}catch(x){err.textContent='Erreur de connexion';err.classList.remove('hidden')}}
    if(localStorage.getItem('token'))window.location.href='/app';
  </script>
</body>
</html>`;
}

// ============================================
// HTML — APP DASHBOARD (v3 — Refactored Navigation)
// ============================================
function getAppHTML(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Hack Ton Esprit</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *{font-family:'Inter',sans-serif;-webkit-tap-highlight-color:transparent}
    .gradient-bg{background:linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%);min-height:100vh;min-height:100dvh}
    .card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);transition:all .2s}
    .card:hover{background:rgba(255,255,255,.08);border-color:rgba(139,92,246,.3)}
    .card-glow{box-shadow:0 0 30px rgba(139,92,246,.1)}
    .stat-bar{height:8px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden}
    .stat-fill{height:100%;border-radius:4px;transition:width 1s ease-out}
    .modal-overlay{background:rgba(0,0,0,.85);backdrop-filter:blur(12px)}
    .toast{animation:slideUp .3s ease-out}
    @keyframes slideUp{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}
    .fade-in{animation:fadeIn .4s ease-out}
    @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .emotion-chip{cursor:pointer;transition:all .2s}
    .emotion-chip:hover{transform:scale(1.05)}
    .emotion-chip.selected{background:rgba(139,92,246,.3)!important;border-color:#8b5cf6!important}
    /* Bottom nav for mobile */
    .bottom-nav{position:fixed;bottom:0;left:0;right:0;z-index:40;background:rgba(15,12,41,.97);backdrop-filter:blur(20px);border-top:1px solid rgba(139,92,246,.15);padding-bottom:env(safe-area-inset-bottom)}
    .bottom-nav-btn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;font-size:10px;color:rgba(156,163,175,.7);transition:all .2s;flex:1;min-width:0;-webkit-tap-highlight-color:transparent;position:relative}
    .bottom-nav-btn.active{color:#c4b5fd}
    .bottom-nav-btn.active i{color:#a78bfa}
    .bottom-nav-btn.active::before{content:'';position:absolute;top:-1px;left:25%;right:25%;height:2px;background:#a78bfa;border-radius:0 0 2px 2px}
    .bottom-nav-btn i{font-size:20px;transition:all .2s}
    /* Locked feature card */
    .locked-card{position:relative;overflow:hidden;pointer-events:auto;cursor:pointer}
    .locked-card::after{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(15,12,41,.75) 0%,rgba(30,27,75,.85) 100%);backdrop-filter:blur(3px);z-index:1;transition:all .3s}
    .locked-card:hover::after{background:linear-gradient(135deg,rgba(15,12,41,.65) 0%,rgba(30,27,75,.75) 100%)}
    .locked-card .lock-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:2;text-align:center;padding:12px}
    .lock-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.3);backdrop-filter:blur(4px)}
    .lock-badge i{font-size:10px;color:rgba(167,139,250,.7)}
    .lock-badge span{font-size:10px;font-weight:600;color:rgba(167,139,250,.8)}
    @keyframes lockPulse{0%,100%{opacity:.7}50%{opacity:1}}
    .lock-pulse{animation:lockPulse 2.5s ease-in-out infinite}
    /* Unlocked animation */
    @keyframes unlockGlow{from{box-shadow:0 0 0 0 rgba(139,92,246,.4)}to{box-shadow:0 0 20px 4px rgba(139,92,246,0)}}
    .unlock-glow{animation:unlockGlow .8s ease-out}
    @keyframes shake{0%,100%{transform:translateX(0)}15%,45%,75%{transform:translateX(-4px)}30%,60%,90%{transform:translateX(4px)}}
    /* Mobile touch improvements */
    @media(max-width:640px){.card{min-height:44px}.bottom-nav-btn{min-height:48px}}
    /* Capture FAB */
    .capture-fab{position:fixed;z-index:35;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);box-shadow:0 4px 20px rgba(139,92,246,.5);transition:all .3s;bottom:calc(72px + env(safe-area-inset-bottom));right:16px}
    .capture-fab:hover{transform:scale(1.1)}
    @media(min-width:768px){.capture-fab{bottom:24px;right:24px}}
    /* Section headers */
    .section-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(156,163,175,.7);margin-bottom:12px;padding-left:4px}
    /* XP ring */
    .xp-ring{position:relative;width:64px;height:64px}
    .xp-ring svg{transform:rotate(-90deg)}
    .xp-ring-text{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
    /* Scrollbar */
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:rgba(139,92,246,.3);border-radius:4px}
    /* Safe bottom padding for content */
    .safe-bottom{padding-bottom:calc(80px + env(safe-area-inset-bottom))}
    @media(min-width:768px){.safe-bottom{padding-bottom:32px}}
    /* Chat specific styles */
    #chatMessages{scrollbar-width:thin;scrollbar-color:rgba(139,92,246,.2) transparent}
    #chatInput{min-height:40px;max-height:120px}
    /* Desktop top tabs */
    @media(max-width:767px){.desktop-tabs{display:none!important}}
    @media(min-width:768px){.bottom-nav{display:none!important}}
  </style>
</head>
<body class="gradient-bg text-white">
  <!-- TOP BAR -->
  <nav class="sticky top-0 z-30 bg-gray-900/90 backdrop-blur-md border-b border-white/10">
    <div class="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between">
      <div class="flex items-center gap-2"><span class="text-xl">&#129504;</span><span class="font-bold text-sm sm:text-base">Hack Ton Esprit</span></div>
      <div class="flex items-center gap-2 sm:gap-3">
        <div class="flex items-center gap-1 px-2.5 py-1 bg-orange-500/20 rounded-full text-orange-300 text-xs"><i class="fas fa-fire text-[10px]"></i><span id="streakCount">0</span></div>
        <div id="xpBadge" class="flex items-center gap-1 px-2.5 py-1 bg-violet-500/20 rounded-full text-violet-300 text-xs cursor-pointer" onclick="showTab('dashboard')"><i class="fas fa-star text-[10px]"></i><span id="globalLevel">Nv.1</span></div>
        <button onclick="logout()" class="text-gray-500 hover:text-white text-sm p-1" title="Deconnexion"><i class="fas fa-sign-out-alt"></i></button>
      </div>
    </div>
    <!-- Desktop tabs -->
    <div class="desktop-tabs max-w-5xl mx-auto px-4 flex gap-1 border-t border-white/5">
      <button onclick="showTab('chat')" class="tab-btn px-3 py-2 text-xs text-gray-400 hover:text-white transition-all border-b-2 border-transparent whitespace-nowrap" data-tab="chat"><i class="fas fa-comments mr-1"></i>Alma</button>
      <button onclick="showTab('lifeline')" class="tab-btn px-3 py-2 text-xs text-gray-400 hover:text-white transition-all border-b-2 border-transparent whitespace-nowrap" data-tab="lifeline"><i class="fas fa-timeline mr-1"></i>Ligne de vie</button>
      <button onclick="showTab('psych')" class="tab-btn px-3 py-2 text-xs text-gray-400 hover:text-white transition-all border-b-2 border-transparent whitespace-nowrap" data-tab="psych"><i class="fas fa-user-doctor mr-1"></i>Profil Psy</button>
      <button onclick="showTab('thoughttree')" class="tab-btn px-3 py-2 text-xs text-gray-400 hover:text-white transition-all border-b-2 border-transparent whitespace-nowrap" data-tab="thoughttree"><i class="fas fa-sitemap mr-1"></i>Arbre</button>
      <button onclick="showTab('habits')" class="tab-btn px-3 py-2 text-xs text-gray-400 hover:text-white transition-all border-b-2 border-transparent whitespace-nowrap" data-tab="habits"><i class="fas fa-list-check mr-1"></i>Habitudes</button>
      <button onclick="showTab('dashboard')" class="tab-btn px-3 py-2 text-xs text-gray-400 hover:text-white transition-all border-b-2 border-transparent whitespace-nowrap" data-tab="dashboard"><i class="fas fa-home mr-1"></i>Accueil</button>
    </div>
  </nav>

  <!-- MAIN CONTENT -->
  <main id="mainContent" class="max-w-5xl mx-auto px-4 py-4 safe-bottom">
` + getAllTabsHTML() + `
  </main>

  <!-- MOBILE BOTTOM NAV -->
  <div class="bottom-nav">
    <div class="flex justify-around items-center px-1 pt-1">
      <button onclick="showTab('chat')" class="bottom-nav-btn active" data-tab="chat"><i class="fas fa-comments"></i><span>Alma</span></button>
      <button onclick="showTab('lifeline')" class="bottom-nav-btn" data-tab="lifeline"><i class="fas fa-timeline"></i><span>Vie</span></button>
      <button onclick="showTab('psych')" class="bottom-nav-btn" data-tab="psych"><i class="fas fa-user-doctor"></i><span>Profil</span></button>
      <button onclick="showTab('thoughttree')" class="bottom-nav-btn" data-tab="thoughttree"><i class="fas fa-sitemap"></i><span>Arbre</span></button>
      <button onclick="showTab('habits')" class="bottom-nav-btn" data-tab="habits"><i class="fas fa-list-check"></i><span>Habitudes</span></button>
    </div>
  </div>

  <!-- CAPTURE FAB -->
  <button onclick="openCapture()" class="capture-fab flex items-center justify-center text-white text-xl" title="Capture instantanee"><i class="fas fa-bolt"></i></button>

  <!-- MODALS -->
  <div id="captureModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <div class="bg-gray-900 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-md border-t sm:border border-violet-500/30">
      <div class="flex items-center justify-between mb-3"><h3 class="text-base font-bold text-violet-300"><i class="fas fa-bolt mr-2"></i>Capture instantanee</h3><button onclick="closeCapture()" class="text-gray-400 hover:text-white p-1"><i class="fas fa-times"></i></button></div>
      <textarea id="captureContent" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="3" placeholder="Ce qui se passe en moi..."></textarea>
      <div class="flex items-center gap-3 mt-2 mb-3"><label class="text-xs text-gray-400">Intensite:</label><input type="range" id="captureIntensity" min="1" max="10" value="5" class="flex-1 accent-violet-500" oninput="document.getElementById('captureIntVal').textContent=this.value"><span id="captureIntVal" class="text-violet-400 text-xs font-bold">5</span></div>
      <button onclick="submitCapture()" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold text-sm transition-all"><i class="fas fa-bolt mr-2"></i>Capturer</button>
    </div>
  </div>

  <div id="weeklyModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-lg border-t sm:border border-violet-500/30 sm:my-8 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-4"><h3 class="text-base font-bold text-violet-300" id="weeklyTitle"></h3><button onclick="closeWeeklyModal()" class="text-gray-400 hover:text-white p-1"><i class="fas fa-times"></i></button></div>
      <div id="weeklyContent"></div>
    </div>
  </div>

  <div id="questModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-lg border-t sm:border border-violet-500/30 sm:my-8 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-4"><h3 class="text-base font-bold text-violet-300" id="questTitle"></h3><button onclick="closeQuestModal()" class="text-gray-400 hover:text-white p-1"><i class="fas fa-times"></i></button></div>
      <div id="questContent"></div>
    </div>
  </div>

  <div id="selfDeclareModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-lg border-t sm:border border-violet-500/30 sm:my-8 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-4"><h3 class="text-base font-bold text-violet-300"><i class="fas fa-hand-point-up mr-2"></i>Autodeclarer un pattern</h3><button onclick="closeSelfDeclare()" class="text-gray-400 hover:text-white p-1"><i class="fas fa-times"></i></button></div>
      <div id="selfDeclareContent" class="space-y-3"></div>
    </div>
  </div>

  <div id="lifeEventModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-lg border-t sm:border border-violet-500/30 sm:my-8 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-4"><h3 class="text-base font-bold text-violet-300" id="lifeEventTitle"><i class="fas fa-timeline mr-2"></i>Evenement de vie</h3><button onclick="closeLifeEventModal()" class="text-gray-400 hover:text-white p-1"><i class="fas fa-times"></i></button></div>
      <div id="lifeEventContent"></div>
    </div>
  </div>

  <!-- Morning Modal -->
  <div id="morningModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-lg border-t sm:border border-amber-500/30 sm:my-8 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-4"><h3 class="text-base font-bold text-amber-300"><i class="fas fa-sun mr-2"></i>Check-in du matin</h3><button onclick="closeMorningModal()" class="text-gray-400 hover:text-white p-1"><i class="fas fa-times"></i></button></div>
      <p class="text-xs text-gray-400 mb-4">Comment te sens-tu ce matin ? (2 min)</p>
      <div id="morningForm">
        <div class="mb-4"><label class="block text-xs font-medium text-gray-300 mb-2">Emotion</label><div id="emotionWheel" class="space-y-2 max-h-48 overflow-y-auto"></div><input type="hidden" id="selectedEmotion" value=""></div>
        <div class="mb-4"><label class="block text-xs font-medium text-gray-300 mb-1">Precise (optionnel)</label><textarea id="emotionDetail" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Pourquoi tu te sens comme ca..."></textarea></div>
        <div class="mb-4"><label class="block text-xs font-medium text-gray-300 mb-1">Energie: <span id="energyValue" class="text-violet-400">5</span>/10</label><input type="range" id="energyLevel" min="1" max="10" value="5" class="w-full accent-violet-500" oninput="document.getElementById('energyValue').textContent=this.value"></div>
        <div class="mb-4"><label class="block text-xs font-medium text-gray-300 mb-1">Intention du jour</label><input type="text" id="intention" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="patience, avancer, ecouter..."></div>
        <button onclick="submitMorningCheckin()" class="w-full py-3 bg-amber-600 hover:bg-amber-500 rounded-xl font-bold text-sm transition-all"><i class="fas fa-check mr-2"></i>Valider le check-in</button>
      </div>
    </div>
  </div>

  <!-- Evening Modal -->
  <div id="eveningModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-lg border-t sm:border border-indigo-500/30 sm:my-8 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-4"><h3 class="text-base font-bold text-indigo-300"><i class="fas fa-moon mr-2"></i>Scan du soir</h3><button onclick="closeEveningModal()" class="text-gray-400 hover:text-white p-1"><i class="fas fa-times"></i></button></div>
      <p class="text-xs text-gray-400 mb-4">3 micro-exercices, fais-en au moins 1 (5 min)</p>
      <div id="eveningForm">
        <div class="card rounded-xl p-4 mb-3"><h4 class="font-semibold text-sm mb-2"><i class="fas fa-trophy text-amber-400 mr-2"></i>3 micro-victoires</h4><input type="text" id="victory1" class="w-full px-3 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none" placeholder="Victoire 1..."><input type="text" id="victory2" class="w-full px-3 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none" placeholder="Victoire 2..."><input type="text" id="victory3" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none" placeholder="Victoire 3..."></div>
        <div class="card rounded-xl p-4 mb-3"><h4 class="font-semibold text-sm mb-2"><i class="fas fa-eye text-green-400 mr-2"></i>Gratitude invisible</h4><textarea id="gratitude" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Ce dont je suis reconnaissant(e)..."></textarea></div>
        <div class="card rounded-xl p-4 mb-4"><h4 class="font-semibold text-sm mb-2"><i class="fas fa-heart text-red-400 mr-2"></i>Emotion forte</h4><input type="text" id="strongEmotion" class="w-full px-3 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none" placeholder="L'emotion..."><textarea id="emotionTrigger" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Son declencheur..."></textarea></div>
        <button onclick="submitEveningCheckin()" class="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-sm transition-all"><i class="fas fa-moon mr-2"></i>Enregistrer le scan</button>
      </div>
    </div>
  </div>

  <div id="toast" class="fixed bottom-20 sm:bottom-8 left-1/2 transform -translate-x-1/2 hidden z-50">
    <div class="toast bg-gray-900 border border-violet-500/30 rounded-xl px-5 py-2.5 flex items-center gap-2 shadow-2xl"><span id="toastIcon" class="text-lg"></span><span id="toastMsg" class="text-xs"></span></div>
  </div>

  <script>
` + getAppJS() + `
  </script>
</body>
</html>`;
}

// ============================================
// TAB FRAGMENTS (v4 — Enhanced Lock & Mobile)
// ============================================
function getAllTabsHTML(): string {
  return getChatTab() + getDashboardTab() + getLifelineTab() + getHabitsTab() + getPsychTab() + getThoughtTreeTab();
}

function getDashboardTab(): string {
  return `<div id="tab-dashboard" class="tab-content hidden fade-in">
  <!-- Header with XP ring -->
  <div class="flex items-center gap-4 mb-6">
    <div class="xp-ring flex-shrink-0"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="3"/><circle id="xpCircle" cx="18" cy="18" r="16" fill="none" stroke="#8b5cf6" stroke-width="3" stroke-dasharray="0 100" stroke-linecap="round"/></svg><div class="xp-ring-text"><span id="globalLevelNum" class="text-sm font-black text-violet-300">1</span><span class="text-[8px] text-gray-500 uppercase">Niveau</span></div></div>
    <div class="flex-1 min-w-0">
      <h2 class="text-lg font-bold truncate">Salut, <span id="userName"></span></h2>
      <p class="text-xs text-gray-400 truncate" id="awakeningTitle"></p>
      <div class="stat-bar mt-2"><div id="xpBar" class="stat-fill bg-violet-500" style="width:0%"></div></div>
      <p class="text-[10px] text-gray-500 mt-1"><span id="xpCurrent">0</span> / <span id="xpNext">100</span> XP</p>
    </div>
  </div>

  <!-- SECTION: Quotidien (Nv.1) — Always visible -->
  <div class="section-title flex items-center gap-2"><i class="fas fa-sun text-amber-400 text-[11px]"></i>Quotidien</div>
  <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
    <div id="morningCard" class="card rounded-xl p-3.5 cursor-pointer active:scale-[.98] transition-transform" onclick="openMorningModal()">
      <div class="flex items-center gap-2.5 mb-2"><div class="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center"><i class="fas fa-sun text-amber-400"></i></div><div class="min-w-0"><h3 class="font-semibold text-xs truncate">Check-in matin</h3><p class="text-[10px] text-gray-500" id="morningStatus">A faire</p></div></div>
      <div class="text-[10px] text-violet-400/80 font-medium">+5 XP resonance</div>
    </div>
    <div id="eveningCard" class="card rounded-xl p-3.5 cursor-pointer active:scale-[.98] transition-transform" data-unlock="2" onclick="handleLockedClick(2,'evening')">
      <div class="flex items-center gap-2.5 mb-2"><div class="w-9 h-9 rounded-lg bg-indigo-500/20 flex items-center justify-center"><i class="fas fa-moon text-indigo-400"></i></div><div class="min-w-0"><h3 class="font-semibold text-xs truncate">Scan du soir</h3><p class="text-[10px] text-gray-500" id="eveningStatus">A faire</p></div></div>
      <div class="text-[10px] text-violet-400/80 font-medium">+5-15 XP</div>
    </div>
    <div class="card rounded-xl p-3.5 cursor-pointer active:scale-[.98] transition-transform" onclick="openCapture()">
      <div class="flex items-center gap-2.5 mb-2"><div class="w-9 h-9 rounded-lg bg-purple-500/20 flex items-center justify-center"><i class="fas fa-bolt text-purple-400"></i></div><div class="min-w-0"><h3 class="font-semibold text-xs truncate">Capture</h3><p class="text-[10px] text-gray-500" id="captureCount">0 captures</p></div></div>
      <div class="text-[10px] text-violet-400/80 font-medium">+2 XP lucidite</div>
    </div>
  </div>

  <!-- SECTION: Hebdomadaire (Nv.3) -->
  <div class="section-title flex items-center gap-2"><i class="fas fa-calendar-week text-blue-400 text-[11px]"></i>Hebdomadaire <span id="weeklyLock" class="ml-1"></span></div>
  <div id="weeklySection" class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
    <div class="card rounded-xl p-3.5 cursor-pointer active:scale-[.98] transition-transform" data-unlock="3" onclick="handleLockedClick(3,'decontamination')"><div class="flex items-center gap-2.5"><div class="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center text-base">&#129529;</div><div class="flex-1 min-w-0"><h3 class="font-semibold text-xs">Decontamination</h3><p class="text-[10px] text-gray-500">15 min | +30 XP</p></div><i class="fas fa-chevron-right text-[10px] text-gray-600"></i></div></div>
    <div class="card rounded-xl p-3.5 cursor-pointer active:scale-[.98] transition-transform" data-unlock="3" onclick="handleLockedClick(3,'influence')"><div class="flex items-center gap-2.5"><div class="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center text-base">&#127919;</div><div class="flex-1 min-w-0"><h3 class="font-semibold text-xs">Cercle d'influence</h3><p class="text-[10px] text-gray-500">10 min | +25 XP</p></div><i class="fas fa-chevron-right text-[10px] text-gray-600"></i></div></div>
    <div class="card rounded-xl p-3.5 cursor-pointer active:scale-[.98] transition-transform" data-unlock="3" onclick="handleLockedClick(3,'worry')"><div class="flex items-center gap-2.5"><div class="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center text-base">&#128230;</div><div class="flex-1 min-w-0"><h3 class="font-semibold text-xs">Boite a soucis</h3><p class="text-[10px] text-gray-500">10 min | +25 XP</p></div><i class="fas fa-chevron-right text-[10px] text-gray-600"></i></div></div>
  </div>

  <!-- SECTION: Patterns & Quetes (Nv.4+) -->
  <div class="section-title flex items-center gap-2"><i class="fas fa-brain text-pink-400 text-[11px]"></i>Patterns & Quetes <span id="patternsLock" class="ml-1"></span></div>
  <div id="patternsSection" class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
    <div class="card rounded-xl p-3.5 cursor-pointer active:scale-[.98] transition-transform" data-unlock="4" onclick="handleLockedClick(4,'patterns')"><div class="flex items-center gap-2.5"><div class="w-9 h-9 rounded-lg bg-pink-500/20 flex items-center justify-center"><i class="fas fa-brain text-pink-400"></i></div><div class="flex-1 min-w-0"><h3 class="font-semibold text-xs">Mes patterns</h3><p class="text-[10px] text-gray-500" id="patternCount">0 detectes</p></div><i class="fas fa-chevron-right text-[10px] text-gray-600"></i></div></div>
    <div class="card rounded-xl p-3.5 cursor-pointer active:scale-[.98] transition-transform" data-unlock="4" onclick="handleLockedClick(4,'quests')"><div class="flex items-center gap-2.5"><div class="w-9 h-9 rounded-lg bg-violet-500/20 flex items-center justify-center"><i class="fas fa-scroll text-violet-400"></i></div><div class="flex-1 min-w-0"><h3 class="font-semibold text-xs">Quetes actives</h3><p class="text-[10px] text-gray-500" id="questCount">0 disponibles</p></div><i class="fas fa-chevron-right text-[10px] text-gray-600"></i></div></div>
  </div>

  <!-- SECTION: Rituels (Nv.5) -->
  <div class="section-title flex items-center gap-2"><i class="fas fa-gem text-emerald-400 text-[11px]"></i>Rituels <span id="ritualsLock" class="ml-1"></span></div>
  <div id="ritualsSection" class="mb-6">
    <div class="card rounded-xl p-3.5 cursor-pointer active:scale-[.98] transition-transform" data-unlock="5" onclick="handleLockedClick(5,'rituals')"><div class="flex items-center gap-2.5"><div class="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center"><i class="fas fa-gem text-emerald-400"></i></div><div class="flex-1 min-w-0"><h3 class="font-semibold text-xs">Introspections profondes</h3><p class="text-[10px] text-gray-500" id="ritualInfo">Mensuel, trimestriel, annuel</p></div><i class="fas fa-chevron-right text-[10px] text-gray-600"></i></div></div>
  </div>

  <!-- SECTION: Stats -->
  <div class="section-title flex items-center gap-2"><i class="fas fa-chart-bar text-cyan-400 text-[11px]"></i>Progression <span id="statsLock" class="ml-1"></span></div>
  <div id="statsSection">
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4" id="statsGrid"></div>
    <div id="historyPreview" class="card rounded-xl p-4 hidden" data-unlock="3"><h4 class="text-xs font-semibold text-gray-300 mb-3"><i class="fas fa-clock mr-1"></i>Activite recente</h4><div id="recentActivity" class="space-y-2"></div></div>
  </div>
</div>`;
}

// Morning & Evening are now modals (defined in getAppHTML), no separate tabs needed

function getLifelineTab(): string {
  return `<div id="tab-lifeline" class="tab-content hidden fade-in">
  <div class="flex items-center justify-between mb-4">
    <div><h2 class="text-lg font-bold"><i class="fas fa-timeline text-cyan-400 mr-2"></i>Ligne de vie</h2><p class="text-xs text-gray-400">Tes evenements majeurs</p></div>
    <button onclick="openLifeEventForm()" class="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-medium text-xs transition-all"><i class="fas fa-plus mr-1"></i>Ajouter</button>
  </div>
  <div id="onboardingPrompt" class="hidden card rounded-xl p-4 mb-4 border-cyan-500/20">
    <h3 class="font-bold text-cyan-300 text-sm mb-1"><i class="fas fa-info-circle mr-1"></i>Commence par 10 evenements</h3>
    <p class="text-xs text-gray-400 mb-2">Ajoute les 10 moments cles. Bonus XP au 10eme !</p>
    <div class="flex items-center gap-2"><div class="stat-bar flex-1"><div id="onboardingProgress" class="stat-fill bg-cyan-500" style="width:0%"></div></div><span id="onboardingCount" class="text-xs text-cyan-300">0/10</span></div>
  </div>
  <div id="lifelineContent" class="space-y-3"></div>
</div>`;
}

function getHabitsTab(): string {
  return `<div id="tab-habits" class="tab-content hidden fade-in">
  <div class="flex items-center justify-between mb-4">
    <div><h2 class="text-lg font-bold"><i class="fas fa-list-check text-emerald-400 mr-2"></i>Micro-habitudes</h2><p class="text-xs text-gray-400">Accumule des habitudes, une par semaine</p></div>
    <button onclick="openAddHabit()" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium text-xs transition-all"><i class="fas fa-plus mr-1"></i>Nouvelle</button>
  </div>
  <div id="habitsContent" class="space-y-2"></div>
  <div id="addHabitForm" class="hidden card rounded-xl p-4 mt-3">
    <h3 class="font-semibold text-sm mb-2">Nouvelle micro-habitude</h3>
    <input type="text" id="newHabitName" class="w-full px-3 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none" placeholder="Nom de l'habitude">
    <textarea id="newHabitDesc" class="w-full px-3 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Description (optionnel)"></textarea>
    <select id="newHabitFreq" class="w-full px-3 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs"><option value="daily">Quotidienne</option><option value="weekly">Hebdomadaire</option></select>
    <button onclick="submitNewHabit()" class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-bold text-xs transition-all">Ajouter</button>
  </div>
</div>`;
}

// Weekly is now integrated into dashboard, no separate tab

function getChatTab(): string {
  return `<div id="tab-chat" class="tab-content fade-in">
  <div class="flex flex-col" style="height:calc(100dvh - 130px)">
    <!-- Chat header -->
    <div class="flex items-center justify-between mb-2 flex-shrink-0">
      <div class="flex items-center gap-2">
        <div class="w-9 h-9 rounded-full bg-violet-500/30 flex items-center justify-center"><i class="fas fa-brain text-violet-300"></i></div>
        <div><h2 class="font-bold text-sm">Alma <span class="text-[10px] text-violet-400/60 font-normal">ta psy IA</span></h2><p class="text-[10px] text-gray-400" id="chatStatus">En ligne</p></div>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="loadConversationHistory()" class="text-gray-400 hover:text-white text-sm p-1.5" title="Historique"><i class="fas fa-clock-rotate-left"></i></button>
        <button onclick="startNewConversation()" class="text-gray-400 hover:text-white text-sm p-1.5" title="Nouvelle conversation"><i class="fas fa-plus"></i></button>
      </div>
    </div>

    <!-- Conversation history sidebar (hidden by default) -->
    <div id="chatHistoryPanel" class="hidden card rounded-xl p-3 mb-2 max-h-40 overflow-y-auto flex-shrink-0">
      <h4 class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Conversations</h4>
      <div id="chatHistoryList" class="space-y-1"></div>
    </div>

    <!-- Messages area -->
    <div id="chatMessages" class="flex-1 overflow-y-auto space-y-3 mb-2 px-1 scroll-smooth" style="min-height:0">
      <div class="flex gap-2">
        <div class="w-7 h-7 rounded-full bg-violet-500/30 flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-brain text-violet-300 text-xs"></i></div>
        <div class="card rounded-xl rounded-tl-sm p-3 max-w-[85%]">
          <p class="text-xs text-gray-300 leading-relaxed">Salut ! Moi c'est <span class="text-violet-300 font-medium">Alma</span>. Je suis ta psy IA dans Hack Ton Esprit.</p>
          <p class="text-xs text-gray-300 leading-relaxed mt-2">Mon objectif ? Te comprendre en profondeur. Tes schemas de pensee, tes reactions, ce qui te bloque, ce qui te fait avancer. Plus on discute, mieux je te connais.</p>
          <p class="text-xs text-gray-300 leading-relaxed mt-2">Pour commencer, dis-moi comment tu t'appelles et qu'est-ce qui t'amene ici ?</p>
        </div>
      </div>
    </div>

    <!-- Input area -->
    <div class="flex-shrink-0">
      <div class="flex gap-2 items-end">
        <textarea id="chatInput" class="flex-1 px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="1" placeholder="Ecris ici..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage()}" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"></textarea>
        <button onclick="sendChatMessage()" id="chatSendBtn" class="w-10 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 flex items-center justify-center text-white transition-all flex-shrink-0"><i class="fas fa-paper-plane text-sm"></i></button>
      </div>
    </div>
  </div>
</div>`;
}

function getPsychTab(): string {
  return `<div id="tab-psych" class="tab-content hidden fade-in">
  <div class="flex items-center justify-between mb-4">
    <div><h2 class="text-lg font-bold"><i class="fas fa-user-doctor text-pink-400 mr-2"></i>Profil Psychologique</h2><p class="text-xs text-gray-400">Analyse IA de ta personnalite</p></div>
    <button onclick="generatePsychProfile()" class="px-3 py-1.5 bg-pink-600 hover:bg-pink-500 rounded-lg font-medium text-xs transition-all" id="generatePsychBtn"><i class="fas fa-brain mr-1"></i>Generer</button>
  </div>
  <div id="psychSummary" class="hidden card rounded-xl p-4 mb-4 border-pink-500/20"></div>
  <div id="psychTraits" class="space-y-2"><p class="text-gray-500 text-xs">Aucun profil genere. Ajoute des donnees puis genere ton profil.</p></div>
</div>`;
}

function getThoughtTreeTab(): string {
  return `<div id="tab-thoughttree" class="tab-content hidden fade-in">
  <div class="flex items-center justify-between mb-4">
    <div><h2 class="text-lg font-bold"><i class="fas fa-sitemap text-teal-400 mr-2"></i>Arbre des Pensees</h2><p class="text-xs text-gray-400">Organisation de tes reflexions</p></div>
    <button onclick="categorizeThoughts()" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg font-medium text-xs transition-all"><i class="fas fa-wand-magic-sparkles mr-1"></i>Categoriser</button>
  </div>
  <div id="thoughtBranches" class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4"></div>
  <h3 class="font-semibold text-sm mb-2">Pensees recentes</h3>
  <div id="thoughtEntries" class="space-y-2"><p class="text-gray-500 text-xs">Aucune pensee categorisee. Clique sur "Categoriser".</p></div>
</div>`;
}

// Patterns, Quests, Rituals, History are now sub-views opened from Dashboard via modals/inline

// ============================================
// APP JAVASCRIPT (v3 — Refactored)
// ============================================
function getAppJS(): string {
  return `
const API='';let token=localStorage.getItem('token');let userData=null;let emotions={};let userLevel=1;
if(!token)window.location.href='/';
const headers=()=>({'Content-Type':'application/json','Authorization':'Bearer '+token});

// UNLOCK LEVELS: which global_level unlocks each feature
const UNLOCK={morning:1,capture:1,evening:2,weekly:3,stats:3,patterns:4,quests:4,rituals:5};

async function init(){try{
  await fetch(API+'/api/init-db');
  const r=await fetch(API+'/api/me/profile',{headers:headers()});
  if(!r.ok){logout();return}
  userData=await r.json();
  const er=await fetch(API+'/api/emotions');
  emotions=(await er.json()).emotions;
  renderDashboard();renderEmotionWheel();showTab('chat');
}catch(e){console.error('Init:',e)}}

// === TAB NAVIGATION ===
function showTab(t){
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.add('hidden'));
  // Desktop tabs
  document.querySelectorAll('.tab-btn').forEach(el=>{el.classList.remove('border-violet-500','text-violet-300');el.classList.add('border-transparent','text-gray-400')});
  // Mobile bottom nav
  document.querySelectorAll('.bottom-nav-btn').forEach(el=>el.classList.remove('active'));
  const te=document.getElementById('tab-'+t);if(te)te.classList.remove('hidden');
  document.querySelectorAll('[data-tab="'+t+'"]').forEach(btn=>{
    if(btn.classList.contains('tab-btn')){btn.classList.add('border-violet-500','text-violet-300');btn.classList.remove('border-transparent','text-gray-400')}
    if(btn.classList.contains('bottom-nav-btn'))btn.classList.add('active')
  });
  // Hide FAB on chat tab, show elsewhere
  const fab=document.querySelector('.capture-fab');if(fab){fab.style.display=t==='chat'?'none':'flex'}
  // Adjust padding for chat tab (no safe-bottom needed)
  const main=document.getElementById('mainContent');if(main){if(t==='chat'){main.classList.remove('safe-bottom');main.style.paddingBottom='0'}else{main.classList.add('safe-bottom');main.style.paddingBottom=''}}
  if(t==='lifeline')loadLifeline();if(t==='habits')loadHabits();
  if(t==='psych')loadPsychProfile();if(t==='thoughttree')loadThoughtTree();
  if(t==='dashboard')renderDashboard();if(t==='chat')initChat();
}

// === LOCK SYSTEM ===
function handleLockedClick(reqLevel,action){
  if(userLevel<reqLevel){
    const diff=reqLevel-userLevel;
    const msg=diff===1?'Encore 1 niveau !':'Encore '+diff+' niveaux';
    showToast('\\u{1F512}','Nv.'+reqLevel+' requis ('+msg+')');
    // Shake animation on the locked card
    const card=event?.target?.closest('[data-unlock]');
    if(card){card.style.animation='none';card.offsetHeight;card.style.animation='shake .4s ease-in-out'}
    return;
  }
  if(action==='evening')openEveningModal();
  else if(action==='decontamination')openWeeklyExercise('decontamination');
  else if(action==='influence')openWeeklyExercise('influence');
  else if(action==='worry')openWeeklyExercise('worry');
  else if(action==='patterns')openPatternsView();
  else if(action==='quests')openQuestsView();
  else if(action==='rituals')openRitualsView();
}

function applyLockStates(){
  document.querySelectorAll('[data-unlock]').forEach(el=>{
    const req=parseInt(el.dataset.unlock);
    if(userLevel<req){
      el.classList.add('locked-card');
      if(!el.querySelector('.lock-overlay')){
        const ov=document.createElement('div');ov.className='lock-overlay';
        ov.innerHTML='<div class="lock-badge lock-pulse"><i class="fas fa-lock"></i><span>Nv.'+req+'</span></div>';
        el.appendChild(ov);
      }
    } else {
      if(el.classList.contains('locked-card')){
        el.classList.remove('locked-card');
        el.classList.add('unlock-glow');
        setTimeout(()=>el.classList.remove('unlock-glow'),800);
      }
      const ov=el.querySelector('.lock-overlay');if(ov)ov.remove();
    }
  });
  // Section lock indicators
  const setLock=(id,lv)=>{const el=document.getElementById(id);if(!el)return;
    if(userLevel<lv){el.innerHTML='<span class="lock-badge" style="display:inline-flex"><i class="fas fa-lock"></i><span>Nv.'+lv+'</span></span>'}
    else{el.innerHTML=''}};
  setLock('weeklyLock',3);setLock('patternsLock',4);setLock('ritualsLock',5);setLock('statsLock',3);
}

// === DASHBOARD RENDER ===
function renderDashboard(){
  if(!userData)return;const u=userData.user;const s=userData.stats;
  userLevel=s?.global_level||1;
  document.getElementById('userName').textContent=u.display_name||u.username;
  document.getElementById('streakCount').textContent=u.current_streak||0;
  document.getElementById('globalLevel').textContent='Nv.'+userLevel;
  document.getElementById('globalLevelNum').textContent=userLevel;
  const aw=userData.awakening_names||[];
  document.getElementById('awakeningTitle').textContent=aw[userLevel-1]||'';

  // XP ring
  const th=userData.level_thresholds||[0,100,300,600,1000,1500,2200,3000,4000,5500];
  const totalXP=s?.total_xp||0;const curTh=th[userLevel-1]||0;const nextTh=th[userLevel]||th[th.length-1];
  const pct=nextTh>curTh?((totalXP-curTh)/(nextTh-curTh))*100:100;
  const circ=document.getElementById('xpCircle');if(circ)circ.setAttribute('stroke-dasharray',Math.min(pct,100)+' 100');
  const xpBar=document.getElementById('xpBar');if(xpBar)xpBar.style.width=Math.min(pct,100)+'%';
  const xpCur=document.getElementById('xpCurrent');if(xpCur)xpCur.textContent=totalXP;
  const xpNxt=document.getElementById('xpNext');if(xpNxt)xpNxt.textContent=nextTh;

  // Daily status
  const mCard=document.getElementById('morningCard');const eCard=document.getElementById('eveningCard');
  if(userData.today.morning_done){document.getElementById('morningStatus').innerHTML='<span class="text-green-400"><i class="fas fa-check-circle mr-0.5"></i>Fait</span>';if(mCard){mCard.style.borderColor='rgba(34,197,94,.3)';mCard.style.background='rgba(34,197,94,.05)'}}
  else{document.getElementById('morningStatus').textContent='A faire';if(mCard){mCard.style.borderColor='';mCard.style.background=''}}
  if(userData.today.evening_done){document.getElementById('eveningStatus').innerHTML='<span class="text-green-400"><i class="fas fa-check-circle mr-0.5"></i>Fait</span>';if(eCard){eCard.style.borderColor='rgba(34,197,94,.3)';eCard.style.background='rgba(34,197,94,.05)'}}
  else{document.getElementById('eveningStatus').textContent='A faire';if(eCard){eCard.style.borderColor='';eCard.style.background=''}}
  document.getElementById('captureCount').textContent=(userData.counts.total_captures||0)+' captures';
  document.getElementById('patternCount').textContent=(userData.counts.active_patterns||0)+' detectes';
  document.getElementById('questCount').textContent=(userData.counts.active_quests||0)+' disponibles';

  // Stats grid
  const sc=[{key:'lucidity',icon:'\\u{1F9E0}',color:'bg-blue-500',label:'Lucidite'},{key:'resonance',icon:'\\u{1F49A}',color:'bg-green-500',label:'Resonance'},{key:'liberty',icon:'\\u{1F513}',color:'bg-yellow-500',label:'Liberte'},{key:'connection',icon:'\\u{1F5E3}\\uFE0F',color:'bg-pink-500',label:'Connexion'},{key:'action',icon:'\\u26A1',color:'bg-orange-500',label:'Action'}];
  const ln=userData.level_names||{};
  let h='';for(const st of sc){const xp=s?.[st.key+'_xp']||0;const lv=s?.[st.key+'_level']||1;const nm=(ln[st.key]||[])[lv-1]||'';const nt=th[lv]||th[th.length-1];const pt=th[lv-1]||0;const pr=nt>pt?((xp-pt)/(nt-pt))*100:100;
    h+='<div class="card rounded-lg p-3"><div class="flex items-center gap-1.5 mb-1.5"><span class="text-base">'+st.icon+'</span><div class="min-w-0"><div class="font-semibold text-[11px] truncate">'+st.label+'</div><div class="text-[9px] text-gray-500 truncate">'+nm+'</div></div></div><div class="stat-bar"><div class="stat-fill '+st.color+'" style="width:'+Math.min(pr,100)+'%"></div></div><div class="text-[9px] text-gray-500 mt-1">'+xp+'/'+nt+'</div></div>'}
  document.getElementById('statsGrid').innerHTML=h;

  // Recent activity (if level >= 3)
  if(userLevel>=3){
    document.getElementById('historyPreview').classList.remove('hidden');
    loadRecentActivity();
  }

  // Apply lock states
  applyLockStates();
}

async function loadRecentActivity(){
  try{const r=await fetch(API+'/api/me/history?days=7',{headers:headers()});const d=await r.json();const el=document.getElementById('recentActivity');
  if(!el)return;
  const items=(d.xp_history||[]).slice(0,8);
  if(!items.length){el.innerHTML='<p class="text-[10px] text-gray-600">Aucune activite recente</p>';return}
  el.innerHTML=items.map(x=>{const t=(x.lucidity_xp||0)+(x.resonance_xp||0)+(x.liberty_xp||0)+(x.connection_xp||0)+(x.action_xp||0);
    const dt=new Date(x.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
    return '<div class="flex items-center justify-between text-[10px]"><span class="text-gray-500">'+dt+'</span><span class="text-gray-300 flex-1 mx-2 truncate">'+(x.description||x.source_type)+'</span><span class="text-violet-400 font-medium">+'+t+'</span></div>'}).join('')}catch(e){}}

// === EMOTION WHEEL ===
function renderEmotionWheel(){
  const ce={joy:'\\u{1F60A}',sadness:'\\u{1F622}',anger:'\\u{1F620}',fear:'\\u{1F630}',surprise:'\\u{1F632}',disgust:'\\u{1F922}',neutral:'\\u{1F610}'};
  const cn={joy:'Joie',sadness:'Tristesse',anger:'Colere',fear:'Peur',surprise:'Surprise',disgust:'Degout',neutral:'Neutre'};
  let h='';for(const[cat,emos]of Object.entries(emotions)){h+='<div class="mb-2"><div class="flex items-center gap-1 mb-1"><span class="text-sm">'+(ce[cat]||'')+'</span><span class="text-[10px] font-medium text-gray-400">'+(cn[cat]||cat)+'</span></div><div class="flex flex-wrap gap-1">';
    for(const em of emos){h+='<button type="button" class="emotion-chip px-2 py-1 rounded-full text-[10px] bg-white/5 border border-white/10" onclick="selectEmotion(this,\\''+em+'\\')">'+em+'</button>'}h+='</div></div>'}
  document.getElementById('emotionWheel').innerHTML=h}
function selectEmotion(el,e){document.querySelectorAll('.emotion-chip').forEach(x=>x.classList.remove('selected'));el.classList.add('selected');document.getElementById('selectedEmotion').value=e}

// === MORNING MODAL ===
function openMorningModal(){if(userData?.today?.morning_done){showToast('\\u2705','Deja fait ce matin !');return}document.getElementById('morningModal').classList.remove('hidden');document.getElementById('morningModal').classList.add('flex')}
function closeMorningModal(){document.getElementById('morningModal').classList.add('hidden');document.getElementById('morningModal').classList.remove('flex')}

async function submitMorningCheckin(){
  const em=document.getElementById('selectedEmotion').value;if(!em){showToast('\\u26A0','Choisis une emotion');return}
  try{const r=await fetch(API+'/api/checkin/morning',{method:'POST',headers:headers(),body:JSON.stringify({emotion:em,emotion_detail:document.getElementById('emotionDetail').value,energy_level:parseInt(document.getElementById('energyLevel').value),intention:document.getElementById('intention').value})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeMorningModal();showToast('\\u2728','+5 XP Resonance ! Streak: '+(d.streak?.current_streak||1));refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === EVENING MODAL ===
function openEveningModal(){if(userData?.today?.evening_done){showToast('\\u2705','Deja fait ce soir !');return}document.getElementById('eveningModal').classList.remove('hidden');document.getElementById('eveningModal').classList.add('flex')}
function closeEveningModal(){document.getElementById('eveningModal').classList.add('hidden');document.getElementById('eveningModal').classList.remove('flex')}

async function submitEveningCheckin(){
  const v=[document.getElementById('victory1').value,document.getElementById('victory2').value,document.getElementById('victory3').value].filter(x=>x.trim());
  const g=document.getElementById('gratitude').value;const se=document.getElementById('strongEmotion').value;const tr=document.getElementById('emotionTrigger').value;
  if(!v.length&&!g&&!se){showToast('\\u26A0','Complete au moins un exercice');return}
  try{const r=await fetch(API+'/api/checkin/evening',{method:'POST',headers:headers(),body:JSON.stringify({micro_victories:JSON.stringify(v),invisible_gratitude:g,strong_emotion:se,strong_emotion_trigger:tr})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeEveningModal();showToast('\\u{1F319}','Scan enregistre ! +'+(d.exercises_completed*5)+' XP');refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === CAPTURE ===
function openCapture(){document.getElementById('captureModal').classList.remove('hidden');document.getElementById('captureModal').classList.add('flex');document.getElementById('captureContent').focus()}
function closeCapture(){document.getElementById('captureModal').classList.add('hidden');document.getElementById('captureModal').classList.remove('flex')}
async function submitCapture(){
  const c=document.getElementById('captureContent').value;if(!c.trim()){showToast('\\u26A0','Ecris quelque chose');return}
  try{const r=await fetch(API+'/api/capture/new',{method:'POST',headers:headers(),body:JSON.stringify({content:c,intensity:parseInt(document.getElementById('captureIntensity').value)})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}document.getElementById('captureContent').value='';closeCapture();showToast('\\u26A1','+2 XP'+(d.analysis?.emotion?' | '+d.analysis.emotion:''));refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === LIFELINE ===
async function loadLifeline(){
  try{const r=await fetch(API+'/api/lifeline/events',{headers:headers()});const d=await r.json();const evts=d.events||[];
  const op=document.getElementById('onboardingPrompt');const cnt=evts.length;
  if(cnt<10){op.classList.remove('hidden');document.getElementById('onboardingProgress').style.width=(cnt*10)+'%';document.getElementById('onboardingCount').textContent=cnt+'/10'}else{op.classList.add('hidden')}
  const el=document.getElementById('lifelineContent');
  if(!evts.length){el.innerHTML='<p class="text-gray-500 text-xs text-center py-6">Aucun evenement. Ajoute tes 10 moments cles.</p>';return}
  el.innerHTML=evts.map(e=>{const emos=(e.emotions||[]).map(em=>'<span class="px-1.5 py-0.5 rounded-full text-[10px] bg-violet-500/20 text-violet-300">'+em.emotion+' '+em.intensity+'/10</span>').join(' ');
    const vc=e.valence==='positive'?'text-green-400':e.valence==='negative'?'text-red-400':'text-yellow-400';
    return '<div class="card rounded-xl p-3"><div class="flex items-center justify-between mb-1"><h3 class="font-semibold text-sm truncate flex-1">'+e.title+'</h3><div class="flex items-center gap-1.5 ml-2"><span class="text-[10px] '+vc+'">'+(e.valence||'mixed')+'</span>'+(e.age_at_event?'<span class="text-[10px] text-gray-500">'+e.age_at_event+'ans</span>':'')+'</div></div>'+(e.description?'<p class="text-xs text-gray-400 mb-1 line-clamp-2">'+e.description+'</p>':'')+'<div class="flex items-center gap-1.5 flex-wrap"><span class="text-[10px] text-gray-500">'+e.global_intensity+'/10</span><span class="text-[10px] text-gray-600">'+( e.life_domain||'')+'</span>'+emos+'</div></div>'}).join('')}catch(e){console.error(e)}}

function openLifeEventForm(){
  const m=document.getElementById('lifeEventModal');m.classList.remove('hidden');m.classList.add('flex');
  const domains=['famille','relation','travail','sante','argent','amitie','education','identite','perte','reussite','traumatisme','quotidien'];
  document.getElementById('lifeEventContent').innerHTML='<div class="space-y-3">'+
    '<div><label class="block text-xs text-gray-300 mb-1">Titre *</label><input type="text" id="evtTitle" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none" placeholder="Ex: Demenagement a Paris"></div>'+
    '<div><label class="block text-xs text-gray-300 mb-1">Description</label><textarea id="evtDesc" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Decris ce moment..."></textarea></div>'+
    '<div class="grid grid-cols-2 gap-2"><div><label class="block text-xs text-gray-300 mb-1">Age</label><input type="number" id="evtAge" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none" placeholder="15" min="0" max="120"></div><div><label class="block text-xs text-gray-300 mb-1">Domaine</label><select id="evtDomain" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs">'+domains.map(d=>'<option value="'+d+'">'+d+'</option>').join('')+'</select></div></div>'+
    '<div class="grid grid-cols-2 gap-2"><div><label class="block text-xs text-gray-300 mb-1">Intensite: <span id="evtIntVal">5</span>/10</label><input type="range" id="evtIntensity" min="1" max="10" value="5" class="w-full accent-violet-500" oninput="document.getElementById(\\'evtIntVal\\').textContent=this.value"></div><div><label class="block text-xs text-gray-300 mb-1">Valence</label><select id="evtValence" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs"><option value="positive">Positif</option><option value="negative">Negatif</option><option value="mixed" selected>Mixte</option></select></div></div>'+
    '<div><label class="block text-xs text-gray-300 mb-1">Emotions</label><div id="evtEmotions"><div class="flex gap-2 mb-1"><input type="text" class="evt-emo-name flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs" placeholder="Emotion"><input type="number" class="evt-emo-int w-16 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs" placeholder="1-10" min="1" max="10" value="5"></div></div><button type="button" onclick="addEmotionField()" class="text-[10px] text-violet-400"><i class="fas fa-plus mr-1"></i>Ajouter</button></div>'+
    '<button onclick="submitLifeEvent()" class="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-bold text-sm transition-all"><i class="fas fa-check mr-2"></i>Enregistrer</button></div>'}

function addEmotionField(){const d=document.getElementById('evtEmotions');const div=document.createElement('div');div.className='flex gap-2 mb-1';div.innerHTML='<input type="text" class="evt-emo-name flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs" placeholder="Emotion"><input type="number" class="evt-emo-int w-16 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs" placeholder="1-10" min="1" max="10" value="5">';d.appendChild(div)}
function closeLifeEventModal(){document.getElementById('lifeEventModal').classList.add('hidden');document.getElementById('lifeEventModal').classList.remove('flex')}

async function submitLifeEvent(){
  const title=document.getElementById('evtTitle').value;if(!title){showToast('\\u26A0','Titre requis');return}
  const emos=[];document.querySelectorAll('#evtEmotions > div').forEach(row=>{const n=row.querySelector('.evt-emo-name')?.value;const i=parseInt(row.querySelector('.evt-emo-int')?.value||'5');if(n?.trim())emos.push({emotion:n.trim(),intensity:i})});
  try{const r=await fetch(API+'/api/lifeline/event',{method:'POST',headers:headers(),body:JSON.stringify({title,description:document.getElementById('evtDesc').value,age_at_event:parseInt(document.getElementById('evtAge').value)||null,global_intensity:parseInt(document.getElementById('evtIntensity').value),valence:document.getElementById('evtValence').value,life_domain:document.getElementById('evtDomain').value,emotions:emos})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeLifeEventModal();showToast('\\u{1F4AB}','Evenement ajoute ! +'+((d.xp?.total_awarded)||15)+' XP');loadLifeline();refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === HABITS ===
async function loadHabits(){
  try{const r=await fetch(API+'/api/habits/list',{headers:headers()});const d=await r.json();const el=document.getElementById('habitsContent');
  if(!d.habits?.length){el.innerHTML='<p class="text-gray-500 text-xs text-center py-4">Aucune habitude.</p>';return}
  el.innerHTML=d.habits.map(h=>{const done=h.today_done;const sys=h.is_system_habit?'<span class="text-[9px] bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded-full">Systeme</span>':'';
    return '<div class="card rounded-xl p-3 flex items-center gap-3"><button onclick="'+(done?'':'logHabit('+h.id+')')+'" class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 '+(done?'bg-green-500/30 text-green-400':'bg-gray-700 text-gray-400 hover:bg-violet-500/30 hover:text-violet-300')+' transition-all text-sm"><i class="fas '+(done?'fa-check':'fa-circle')+'"></i></button><div class="flex-1 min-w-0"><div class="flex items-center gap-1.5"><h3 class="font-semibold text-xs truncate">'+h.name+'</h3>'+sys+'</div><div class="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5"><span><i class="fas fa-fire text-orange-400"></i> '+h.current_streak+'j</span><span>'+h.total_completions+'x</span><span>'+h.frequency+'</span></div></div>'+(h.is_system_habit?'':'<button onclick="deleteHabit('+h.id+')" class="text-gray-600 hover:text-red-400 text-xs flex-shrink-0"><i class="fas fa-trash"></i></button>')+'</div>'}).join('')}catch(e){console.error(e)}}

function openAddHabit(){document.getElementById('addHabitForm').classList.toggle('hidden')}
async function submitNewHabit(){
  const name=document.getElementById('newHabitName').value;if(!name){showToast('\\u26A0','Nom requis');return}
  try{const r=await fetch(API+'/api/habits/add',{method:'POST',headers:headers(),body:JSON.stringify({name,description:document.getElementById('newHabitDesc').value,frequency:document.getElementById('newHabitFreq').value})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}document.getElementById('newHabitName').value='';document.getElementById('newHabitDesc').value='';document.getElementById('addHabitForm').classList.add('hidden');showToast('\\u2705','Habitude ajoutee ! +10 XP');loadHabits();refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

async function logHabit(id){
  try{const r=await fetch(API+'/api/habits/log',{method:'POST',headers:headers(),body:JSON.stringify({habit_id:id})});
  const d=await r.json();if(d.error){showToast('\\u26A0',d.error);return}showToast('\\u2705','Streak: '+d.streak+'j');loadHabits();refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

async function deleteHabit(id){if(!confirm('Supprimer ?'))return;try{await fetch(API+'/api/habits/'+id,{method:'DELETE',headers:headers()});loadHabits()}catch(e){}}

// === CHATBOT PSY IA ===
let currentConvId=null;let chatInitialized=false;
function initChat(){if(chatInitialized)return;chatInitialized=true;loadActiveConversation()}

async function loadActiveConversation(){
  try{const r=await fetch(API+'/api/chat/conversations',{headers:headers()});const d=await r.json();
  const convs=d.conversations||[];
  const active=convs.find(c=>c.status==='active');
  if(active){currentConvId=active.id;await loadChatMessages(active.id)}
  }catch(e){console.error('Chat init error:',e)}}

async function loadChatMessages(convId){
  try{const r=await fetch(API+'/api/chat/messages/'+convId,{headers:headers()});const d=await r.json();
  const el=document.getElementById('chatMessages');
  // Keep welcome message then add history
  let h=el.innerHTML.split('</div>\\n    </div>')[0];
  h=''; // Clear and rebuild
  // Welcome message
  h+='<div class="flex gap-2"><div class="w-7 h-7 rounded-full bg-violet-500/30 flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-brain text-violet-300 text-xs"></i></div><div class="card rounded-xl rounded-tl-sm p-3 max-w-[85%]"><p class="text-xs text-gray-300 leading-relaxed">On se retrouve ! C'est Alma. Prete a continuer ?</p></div></div>';
  for(const m of (d.messages||[])){
    if(m.role==='user'){h+='<div class="flex gap-2 justify-end"><div class="bg-violet-600/30 border border-violet-500/20 rounded-xl rounded-tr-sm p-3 max-w-[85%]"><p class="text-xs text-white leading-relaxed">'+escapeHtml(m.content)+'</p></div></div>'}
    else{h+='<div class="flex gap-2"><div class="w-7 h-7 rounded-full bg-violet-500/30 flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-brain text-violet-300 text-xs"></i></div><div class="card rounded-xl rounded-tl-sm p-3 max-w-[85%]"><p class="text-xs text-gray-300 leading-relaxed">'+formatAIMessage(m.content)+'</p></div></div>'}
  }
  el.innerHTML=h;el.scrollTop=el.scrollHeight}catch(e){}}

function escapeHtml(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\\n/g,'<br>')}
function formatAIMessage(t){return escapeHtml(t).replace(/\\*\\*(.+?)\\*\\*/g,'<strong class="text-violet-300">$1</strong>').replace(/\\*(.+?)\\*/g,'<em>$1</em>')}

async function sendChatMessage(){
  const input=document.getElementById('chatInput');const msg=input.value.trim();if(!msg)return;
  const btn=document.getElementById('chatSendBtn');btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin text-sm"></i>';
  // Add user message to UI
  const el=document.getElementById('chatMessages');
  el.innerHTML+='<div class="flex gap-2 justify-end"><div class="bg-violet-600/30 border border-violet-500/20 rounded-xl rounded-tr-sm p-3 max-w-[85%]"><p class="text-xs text-white leading-relaxed">'+escapeHtml(msg)+'</p></div></div>';
  input.value='';input.style.height='auto';el.scrollTop=el.scrollHeight;
  // Show typing indicator
  const typingId='typing-'+Date.now();
  el.innerHTML+='<div id="'+typingId+'" class="flex gap-2"><div class="w-7 h-7 rounded-full bg-violet-500/30 flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-brain text-violet-300 text-xs"></i></div><div class="card rounded-xl rounded-tl-sm p-3"><p class="text-xs text-gray-500"><i class="fas fa-ellipsis fa-beat-fade"></i> Reflexion en cours...</p></div></div>';
  el.scrollTop=el.scrollHeight;
  document.getElementById('chatStatus').textContent='Ecrit...';
  try{const r=await fetch(API+'/api/chat/send',{method:'POST',headers:headers(),body:JSON.stringify({conversation_id:currentConvId,message:msg})});
  const d=await r.json();
  // Remove typing indicator
  const ti=document.getElementById(typingId);if(ti)ti.remove();
  if(d.error){el.innerHTML+='<div class="flex gap-2"><div class="w-7 h-7 rounded-full bg-red-500/30 flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-exclamation text-red-300 text-xs"></i></div><div class="card rounded-xl rounded-tl-sm p-3 border-red-500/20"><p class="text-xs text-red-300">'+d.error+'</p></div></div>';el.scrollTop=el.scrollHeight;return}
  if(!currentConvId)currentConvId=d.conversation_id;
  // Add AI response
  el.innerHTML+='<div class="flex gap-2"><div class="w-7 h-7 rounded-full bg-violet-500/30 flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-brain text-violet-300 text-xs"></i></div><div class="card rounded-xl rounded-tl-sm p-3 max-w-[85%]"><p class="text-xs text-gray-300 leading-relaxed">'+formatAIMessage(d.response)+'</p>'+(d.actions_executed>0?'<div class="flex items-center gap-1 mt-2 pt-2 border-t border-white/5"><i class="fas fa-wand-magic-sparkles text-[9px] text-violet-400"></i><span class="text-[9px] text-violet-400/70">'+d.actions_executed+' action(s) en arriere-plan</span></div>':'')+'</div></div>';
  el.scrollTop=el.scrollHeight;
  if(d.xp)showToast('\\u{1F9E0}','+5 XP conversation !');
  document.getElementById('chatStatus').textContent='En ligne'}
  catch(e){const ti=document.getElementById(typingId);if(ti)ti.remove();el.innerHTML+='<div class="text-center text-xs text-red-400 py-2">Erreur de connexion</div>';document.getElementById('chatStatus').textContent='En ligne'}
  finally{btn.disabled=false;btn.innerHTML='<i class="fas fa-paper-plane text-sm"></i>'}}

async function startNewConversation(){currentConvId=null;chatInitialized=false;
  const el=document.getElementById('chatMessages');
  el.innerHTML='<div class="flex gap-2"><div class="w-7 h-7 rounded-full bg-violet-500/30 flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-brain text-violet-300 text-xs"></i></div><div class="card rounded-xl rounded-tl-sm p-3 max-w-[85%]"><p class="text-xs text-gray-300 leading-relaxed">Nouvelle conversation ! De quoi veux-tu parler ?</p></div></div>';
  document.getElementById('chatHistoryPanel').classList.add('hidden');chatInitialized=true}

async function loadConversationHistory(){
  const panel=document.getElementById('chatHistoryPanel');
  if(!panel.classList.contains('hidden')){panel.classList.add('hidden');return}
  panel.classList.remove('hidden');
  try{const r=await fetch(API+'/api/chat/conversations',{headers:headers()});const d=await r.json();
  const el=document.getElementById('chatHistoryList');
  if(!d.conversations?.length){el.innerHTML='<p class="text-[10px] text-gray-500">Aucune conversation.</p>';return}
  el.innerHTML=d.conversations.map(c=>{const dt=new Date(c.updated_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
    return '<div class="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-all'+(c.id===currentConvId?' bg-violet-500/10':'')+'" onclick="switchConversation('+c.id+')"><div class="flex-1 min-w-0 mr-2"><p class="text-[11px] truncate">'+(c.title||'Conversation')+'</p><p class="text-[9px] text-gray-500">'+dt+' | '+c.messages_count+' msg</p></div><button onclick="event.stopPropagation();deleteConversation('+c.id+')" class="text-gray-600 hover:text-red-400 text-[10px] flex-shrink-0"><i class="fas fa-trash"></i></button></div>'}).join('')}catch(e){}}

async function switchConversation(id){currentConvId=id;await loadChatMessages(id);document.getElementById('chatHistoryPanel').classList.add('hidden')}
async function deleteConversation(id){if(!confirm('Supprimer cette conversation ?'))return;
  try{await fetch(API+'/api/chat/conversation/'+id,{method:'DELETE',headers:headers()});
  if(id===currentConvId){currentConvId=null;startNewConversation()}loadConversationHistory()}catch(e){}}

// === PSYCH PROFILE ===
async function loadPsychProfile(){
  try{const r=await fetch(API+'/api/psych/profile',{headers:headers()});const d=await r.json();
  const ts=d.traits||[];const snap=d.last_snapshot;
  const el=document.getElementById('psychTraits');const sum=document.getElementById('psychSummary');
  if(snap?.full_profile){sum.classList.remove('hidden');const p=snap.full_profile;
    sum.innerHTML='<h3 class="font-bold text-pink-300 text-sm mb-2"><i class="fas fa-clipboard-list mr-1"></i>Synthese</h3><p class="text-xs text-gray-300 mb-2">'+(p.global_summary||'')+'</p>'+(p.strengths?'<div class="mb-2"><span class="text-[10px] font-medium text-green-400">Forces:</span><div class="flex flex-wrap gap-1 mt-1">'+p.strengths.map(s=>'<span class="px-1.5 py-0.5 rounded-full text-[10px] bg-green-500/20 text-green-300">'+s+'</span>').join('')+'</div></div>':'')+(p.growth_areas?'<div><span class="text-[10px] font-medium text-amber-400">Axes:</span><div class="flex flex-wrap gap-1 mt-1">'+p.growth_areas.map(g=>'<span class="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300">'+g+'</span>').join('')+'</div></div>':'')+'<div class="text-[9px] text-gray-500 mt-2">'+( snap.data_points_count||0)+' points | '+new Date(snap.generated_at).toLocaleDateString('fr-FR')+'</div>'}
  else{sum.classList.add('hidden')}
  if(!ts.length){el.innerHTML='<p class="text-gray-500 text-xs">Aucun profil. Ajoute des donnees puis genere.</p>';return}
  const cats={attachment:'Attachement',defense:'Defenses',bias:'Biais',emotional_regulation:'Regulation emotionnelle',relational:'Relationnel',identity:'Identite',cognitive:'Cognitif'};
  const grouped={};ts.forEach(t=>{const c=t.category||'other';if(!grouped[c])grouped[c]=[];grouped[c].push(t)});
  let h='';for(const[cat,traits]of Object.entries(grouped)){h+='<div class="mb-3"><h4 class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">'+(cats[cat]||cat)+'</h4>';
    for(const t of traits){const pct=Math.round(t.probability*100);const color=pct>=80?'text-red-400':pct>=60?'text-amber-400':'text-blue-400';
      const ev=t.evidence?JSON.parse(t.evidence):[];
      h+='<div class="card rounded-lg p-3 mb-1.5"><div class="flex items-center justify-between mb-1"><span class="font-semibold text-xs">'+t.trait_name+'</span><span class="text-[10px] font-bold '+color+'">'+pct+'%</span></div><p class="text-[10px] text-gray-400 mb-1.5">'+t.description+'</p><div class="stat-bar"><div class="stat-fill '+(pct>=80?'bg-red-500':pct>=60?'bg-amber-500':'bg-blue-500')+'" style="width:'+pct+'%"></div></div>'+(ev.length?'<div class="text-[9px] text-gray-500 mt-1">'+ev.slice(0,2).map(e=>'\\u2022 '+e).join('<br>')+'</div>':'')+'</div>'}h+='</div>'}
  el.innerHTML=h}catch(e){console.error(e)}}

async function generatePsychProfile(){
  const btn=document.getElementById('generatePsychBtn');btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i>...';
  try{const r=await fetch(API+'/api/psych/generate',{method:'POST',headers:headers()});const d=await r.json();
  if(d.error){showToast('\\u274C',d.error);return}showToast('\\u{1F9E0}','Profil mis a jour !');loadPsychProfile();refreshProfile()}
  catch(e){showToast('\\u274C','Erreur')}finally{btn.disabled=false;btn.innerHTML='<i class="fas fa-brain mr-1"></i>Generer'}}

// === THOUGHT TREE ===
async function loadThoughtTree(){
  try{const r=await fetch(API+'/api/thought/tree',{headers:headers()});const d=await r.json();
  const bEl=document.getElementById('thoughtBranches');const eEl=document.getElementById('thoughtEntries');
  const branches=d.branches||[];const entries=d.entries||[];
  if(branches.length){bEl.innerHTML=branches.map(b=>{const w=Math.min(100,Math.round((b.thought_count||0)*5));
    return '<div class="card rounded-lg p-3"><div class="flex items-center justify-between mb-1"><h3 class="font-semibold text-xs truncate">'+b.branch_name+'</h3><span class="text-[9px] text-gray-500">'+b.thought_count+'</span></div><p class="text-[9px] text-gray-400 mb-1 line-clamp-1">'+b.description+'</p><div class="stat-bar"><div class="stat-fill bg-teal-500" style="width:'+w+'%"></div></div></div>'}).join('')}
  else{bEl.innerHTML='<p class="text-gray-500 text-xs col-span-3">Branches auto-creees.</p>'}
  if(entries.length){eEl.innerHTML=entries.slice(0,15).map(e=>'<div class="card rounded-lg p-3"><p class="text-xs mb-1">'+e.content+'</p><div class="flex items-center gap-1.5 text-[9px] text-gray-500"><span>'+e.source_type+'</span>'+(e.branch_names?'<span>| '+e.branch_names+'</span>':'')+'</div></div>').join('')}
  else{eEl.innerHTML='<p class="text-gray-500 text-xs">Aucune pensee categorisee.</p>'}}catch(e){console.error(e)}}

async function categorizeThoughts(){
  showToast('\\u{1FA84}','Categorisation...');
  try{const r=await fetch(API+'/api/thought/categorize',{method:'POST',headers:headers()});const d=await r.json();
  if(d.categorized>0){showToast('\\u{1F333}',d.categorized+' pensees !');loadThoughtTree();if(d.xp)refreshProfile()}
  else{showToast('\\u{1F50D}','Rien a categoriser')}}catch(e){showToast('\\u274C','Erreur')}}

// === WEEKLY EXERCISES (opened from dashboard) ===
function openWeeklyExercise(type){
  const m=document.getElementById('weeklyModal');m.classList.remove('hidden');m.classList.add('flex');
  const t=document.getElementById('weeklyTitle');const c=document.getElementById('weeklyContent');
  if(type==='decontamination'){t.innerHTML='<i class="fas fa-broom mr-1"></i>Decontamination';c.innerHTML='<div class="space-y-3"><div><label class="block text-xs text-gray-300 mb-1">Pensee envahissante</label><textarea id="wInvasive" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-xs text-gray-300 mb-1">Preuves POUR</label><textarea id="wProofsFor" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-xs text-gray-300 mb-1">Preuves CONTRE</label><textarea id="wProofsAgainst" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-xs text-gray-300 mb-1">Pire scenario</label><textarea id="wWorst" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-xs text-gray-300 mb-1">Plus probable</label><textarea id="wProbable" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-xs text-gray-300 mb-1">Meilleur</label><textarea id="wBest" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-xs text-gray-300 mb-1">Conclusion</label><textarea id="wConclusion" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><button onclick="submitDecontamination()" class="w-full py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg font-bold text-sm transition-all"><i class="fas fa-check mr-2"></i>Valider</button></div>'}
  else if(type==='influence'){t.innerHTML='<i class="fas fa-bullseye mr-1"></i>Cercle d\\'influence';c.innerHTML='<div class="space-y-3"><textarea id="iConcerns" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="4" placeholder="Tes preoccupations (une par ligne)"></textarea><textarea id="iReflections" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="3" placeholder="Que choisis-tu de relacher ?"></textarea><button onclick="submitInfluenceCircle()" class="w-full py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg font-bold text-sm transition-all"><i class="fas fa-check mr-2"></i>Valider</button></div>'}
  else if(type==='worry'){t.innerHTML='<i class="fas fa-box mr-1"></i>Boite a soucis';c.innerHTML='<div class="space-y-3"><textarea id="wItems" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="4" placeholder="Ce que tu craignais vs ce qui s\\'est passe"></textarea><textarea id="wInsight" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="3" placeholder="Insight global"></textarea><button onclick="submitWorryReview()" class="w-full py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg font-bold text-sm transition-all"><i class="fas fa-check mr-2"></i>Valider</button></div>'}}
function closeWeeklyModal(){document.getElementById('weeklyModal').classList.add('hidden');document.getElementById('weeklyModal').classList.remove('flex')}

async function submitDecontamination(){
  const inv=document.getElementById('wInvasive').value;if(!inv){showToast('\\u26A0','Requise');return}
  try{const r=await fetch(API+'/api/weekly/decontamination',{method:'POST',headers:headers(),body:JSON.stringify({invasive_thought:inv,proofs_for:JSON.stringify(document.getElementById('wProofsFor').value.split(',').map(s=>s.trim()).filter(Boolean)),proofs_against:JSON.stringify(document.getElementById('wProofsAgainst').value.split(',').map(s=>s.trim()).filter(Boolean)),scenario_worst:document.getElementById('wWorst').value,scenario_probable:document.getElementById('wProbable').value,scenario_best:document.getElementById('wBest').value,conclusion:document.getElementById('wConclusion').value})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeWeeklyModal();showToast('\\u{1F9F9}','+30 XP !');refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

async function submitInfluenceCircle(){
  const c=document.getElementById('iConcerns').value;if(!c){showToast('\\u26A0','Requise');return}
  try{const r=await fetch(API+'/api/weekly/influence-circle',{method:'POST',headers:headers(),body:JSON.stringify({concerns:c,reflections:document.getElementById('iReflections').value})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeWeeklyModal();showToast('\\u{1F3AF}','+25 XP !');refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

async function submitWorryReview(){
  const items=document.getElementById('wItems').value;if(!items){showToast('\\u26A0','Requis');return}
  try{const r=await fetch(API+'/api/weekly/worry-review',{method:'POST',headers:headers(),body:JSON.stringify({worried_items:items,overall_insight:document.getElementById('wInsight').value})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeWeeklyModal();showToast('\\u{1F4E6}','+25 XP !');refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === PATTERNS VIEW (opened from dashboard) ===
function openPatternsView(){
  const m=document.getElementById('questModal');m.classList.remove('hidden');m.classList.add('flex');
  document.getElementById('questTitle').innerHTML='<i class="fas fa-brain mr-1"></i>Patterns';
  document.getElementById('questContent').innerHTML='<div id="patternListView" class="space-y-3"><p class="text-xs text-gray-500">Chargement...</p></div>';
  loadPatternsInModal();
}

async function loadPatternsInModal(){
  try{const r=await fetch(API+'/api/pattern/list',{headers:headers()});const d=await r.json();const el=document.getElementById('patternListView');
  if(!d.patterns?.length){el.innerHTML='<p class="text-xs text-gray-500">Aucun pattern.</p><div class="flex gap-2 mt-3"><button onclick="triggerAnalysis()" class="flex-1 py-2 bg-violet-600/30 hover:bg-violet-600/50 rounded-lg text-xs font-medium"><i class="fas fa-brain mr-1"></i>Analyser</button><button onclick="openSelfDeclare()" class="flex-1 py-2 bg-violet-600/30 hover:bg-violet-600/50 rounded-lg text-xs font-medium"><i class="fas fa-hand-point-up mr-1"></i>Autodeclarer</button></div>';return}
  let h='';for(const p of d.patterns){const sc={detected:'text-yellow-400',active:'text-blue-400',maintenance:'text-green-400',resolved:'text-gray-400'};const sl={detected:'Detecte',active:'Actif',maintenance:'Maintenance',resolved:'Resolu'};
    const ev=JSON.parse(p.evidence||'[]');h+='<div class="card rounded-lg p-3"><div class="flex items-center justify-between mb-1"><h3 class="font-semibold text-xs">'+p.pattern_name+'</h3><span class="text-[10px] '+(sc[p.status]||'')+'">'+(sl[p.status]||p.status)+'</span></div><p class="text-[10px] text-gray-400">Confiance: '+Math.round(p.confidence*100)+'%</p>'+(ev.length?'<div class="text-[9px] text-gray-500 mt-1">'+ev.slice(0,2).map(e=>'\\u2022 '+e).join('<br>')+'</div>':'')+'</div>'}
  h+='<div class="flex gap-2 mt-3"><button onclick="triggerAnalysis()" class="flex-1 py-2 bg-violet-600/30 hover:bg-violet-600/50 rounded-lg text-xs font-medium"><i class="fas fa-brain mr-1"></i>Relancer</button><button onclick="openSelfDeclare()" class="flex-1 py-2 bg-violet-600/30 hover:bg-violet-600/50 rounded-lg text-xs font-medium"><i class="fas fa-hand-point-up mr-1"></i>Autodeclarer</button></div>';
  el.innerHTML=h}catch(e){}}

async function triggerAnalysis(){showToast('\\u{1F9E0}','Analyse...');try{const r=await fetch(API+'/api/pattern/analyze',{method:'POST',headers:headers()});const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}if(d.new_patterns?.length>0)showToast('\\u{1F3AF}',d.new_patterns.length+' pattern(s) !');else showToast('\\u{1F50D}','Rien de nouveau');loadPatternsInModal();refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

async function openSelfDeclare(){const m=document.getElementById('selfDeclareModal');m.classList.remove('hidden');m.classList.add('flex');
  try{const r=await fetch(API+'/api/pattern/definitions');const d=await r.json();document.getElementById('selfDeclareContent').innerHTML=d.patterns.map(p=>'<button onclick="selfDeclare(\\''+p.key+'\\',\\''+p.name.replace(/'/g,"\\\\'")+'\\')" class="w-full card rounded-lg p-3 text-left hover:border-violet-500/50 transition-all"><h4 class="font-semibold text-xs">'+p.name+'</h4><p class="text-[10px] text-gray-400 mt-0.5">'+p.description+'</p><p class="text-[10px] text-violet-300 mt-1">'+p.quests_count+' quetes</p></button>').join('')}catch(e){}}
function closeSelfDeclare(){document.getElementById('selfDeclareModal').classList.add('hidden');document.getElementById('selfDeclareModal').classList.remove('flex')}
async function selfDeclare(k,n){try{const r=await fetch(API+'/api/pattern/self-declare',{method:'POST',headers:headers(),body:JSON.stringify({pattern_key:k})});const d=await r.json();if(d.error){showToast('\\u26A0',d.error);return}closeSelfDeclare();showToast('\\u{1F3AF}','"'+n+'" active !');loadPatternsInModal();refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === QUESTS VIEW (opened from dashboard) ===
function openQuestsView(){
  const m=document.getElementById('questModal');m.classList.remove('hidden');m.classList.add('flex');
  document.getElementById('questTitle').innerHTML='<i class="fas fa-scroll mr-1"></i>Quetes';
  document.getElementById('questContent').innerHTML='<div id="questListView" class="space-y-3"><p class="text-xs text-gray-500">Chargement...</p></div>';
  loadQuestsInModal();
}

async function loadQuestsInModal(){
  try{const r=await fetch(API+'/api/quest/list',{headers:headers()});const d=await r.json();const el=document.getElementById('questListView');
  if(!d.quests?.length){el.innerHTML='<div class="text-center py-6"><div class="text-3xl mb-2">\\u{1F52E}</div><p class="text-xs text-gray-500">Les quetes emergent de tes patterns.</p></div>';return}
  el.innerHTML=d.quests.map(q=>{const xp=JSON.parse(q.xp_rewards||'{}');const xs=Object.entries(xp).map(([k,v])=>'+'+v+' '+k).join(', ');
    return '<div class="card rounded-lg p-3 cursor-pointer" onclick="openQuest('+q.id+','+JSON.stringify(JSON.stringify(q))+')"><div class="flex items-center gap-2"><div class="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center text-sm">\\u2694\\uFE0F</div><div class="flex-1 min-w-0"><h3 class="font-semibold text-xs truncate">'+q.quest_name+'</h3><p class="text-[10px] text-gray-400 truncate">'+q.description+'</p></div><div class="text-right flex-shrink-0"><div class="text-[9px] text-violet-300">'+xs+'</div><div class="text-[9px] text-gray-500">x'+(q.times_completed||0)+'</div></div></div></div>'}).join('')}catch(e){}}

function openQuest(id,qs){const q=JSON.parse(qs);const m=document.getElementById('questModal');m.classList.remove('hidden');m.classList.add('flex');document.getElementById('questTitle').innerHTML='\\u2694\\uFE0F '+q.quest_name;
  const ps=q.prompts||[];let h='<p class="text-xs text-gray-400 mb-3">'+q.description+'</p><div class="space-y-3">';
  ps.forEach((p,i)=>{h+='<div><label class="block text-xs text-gray-300 mb-1">'+p+'</label><textarea class="quest-response w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="2" data-prompt="'+i+'"></textarea></div>'});
  h+='<button onclick="submitQuest('+id+')" class="w-full py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg font-bold text-sm transition-all"><i class="fas fa-check mr-2"></i>Completer</button></div>';
  document.getElementById('questContent').innerHTML=h}
function closeQuestModal(){document.getElementById('questModal').classList.add('hidden');document.getElementById('questModal').classList.remove('flex')}

async function submitQuest(qid){
  const resp={};document.querySelectorAll('.quest-response').forEach(el=>{resp[el.dataset.prompt]=el.value});
  try{const r=await fetch(API+'/api/quest/complete',{method:'POST',headers:headers(),body:JSON.stringify({quest_id:qid,responses:resp})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeQuestModal();showToast('\\u2694\\uFE0F','Quete: '+d.quest_name);refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === RITUALS VIEW (opened from dashboard) ===
function openRitualsView(){
  const m=document.getElementById('questModal');m.classList.remove('hidden');m.classList.add('flex');
  document.getElementById('questTitle').innerHTML='<i class="fas fa-gem mr-1"></i>Rituels';
  document.getElementById('questContent').innerHTML='<div id="ritualListView" class="space-y-3"><p class="text-xs text-gray-500">Chargement...</p></div>';
  loadRitualsInModal();
}

async function loadRitualsInModal(){
  try{const r=await fetch(API+'/api/ritual/available',{headers:headers()});const d=await r.json();const el=document.getElementById('ritualListView');
  const fe={monthly:'\\u{1F4C5}',quarterly:'\\u{1F5D3}',yearly:'\\u{1F386}'};const fl={monthly:'Mensuel',quarterly:'Trimestriel',yearly:'Annuel'};
  let h='';if(d.available?.length>0){h+=d.available.map(r=>{const xs=Object.entries(r.xp).map(([k,v])=>'+'+v+' '+k).join(', ');return '<div class="card rounded-lg p-3 cursor-pointer" onclick="startRitual(\\''+r.key+'\\',\\''+r.name.replace(/'/g,"\\\\'")+'\\'  ,\\''+r.frequency+'\\')"><div class="flex items-center gap-2"><div class="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center text-sm">'+(fe[r.frequency]||'\\u{1F48E}')+'</div><div class="flex-1 min-w-0"><h3 class="font-semibold text-xs">'+r.name+'</h3><p class="text-[10px] text-gray-400">'+(fl[r.frequency]||'')+'</p></div><div class="text-[10px] text-violet-300 flex-shrink-0">'+xs+'</div></div></div>'}).join('')}
  if(d.locked?.length>0){h+='<div class="section-title mt-4">\\u{1F512} Bloques</div>';h+=d.locked.map(r=>'<div class="card rounded-lg p-3 opacity-40"><div class="flex items-center gap-2"><div class="w-8 h-8 rounded-lg bg-gray-700/50 flex items-center justify-center text-sm">\\u{1F512}</div><div><h3 class="font-semibold text-xs">'+r.name+'</h3><p class="text-[10px] text-gray-500">Nv.'+r.min_level+'</p></div></div></div>').join('')}
  if(!h)h='<div class="text-center py-6"><div class="text-3xl mb-2">\\u{1F512}</div><p class="text-xs text-gray-500">Nv.5 requis</p></div>';
  el.innerHTML=h}catch(e){}}

async function startRitual(k,n,f){showToast('\\u{1F48E}','Preparation...');try{const r=await fetch(API+'/api/ritual/start',{method:'POST',headers:headers(),body:JSON.stringify({ritual_key:k})});const d=await r.json();
  document.getElementById('questTitle').innerHTML='\\u{1F48E} '+n;
  const ps=d.prompts||[];let h='<div class="space-y-3">';ps.forEach((p,i)=>{h+='<div><label class="block text-xs text-gray-300 mb-1">'+p+'</label><textarea class="ritual-response w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:border-violet-500 focus:outline-none resize-none" rows="3" data-prompt="'+i+'"></textarea></div>'});
  h+='<button onclick="submitRitual(\\''+k+'\\',\\''+n.replace(/'/g,"\\\\'")+'\\'  ,\\''+f+'\\','+JSON.stringify(JSON.stringify(ps))+')" class="w-full py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg font-bold text-sm transition-all"><i class="fas fa-gem mr-2"></i>Terminer</button></div>';
  document.getElementById('questContent').innerHTML=h}catch(e){showToast('\\u274C','Erreur')}}

async function submitRitual(k,n,f,psStr){const content={};document.querySelectorAll('.ritual-response').forEach(el=>{content[el.dataset.prompt]=el.value});
  try{const r=await fetch(API+'/api/ritual/complete',{method:'POST',headers:headers(),body:JSON.stringify({ritual_key:k,ritual_name:n,frequency:f,content,prompts:JSON.parse(psStr)})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeQuestModal();showToast('\\u{1F48E}','Rituel complete !');refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === UTILS ===
async function refreshProfile(){try{const r=await fetch(API+'/api/me/profile',{headers:headers()});if(r.ok){userData=await r.json();renderDashboard()}}catch(e){}}
function showToast(i,m){const t=document.getElementById('toast');document.getElementById('toastIcon').textContent=i;document.getElementById('toastMsg').textContent=m;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),3500)}
function logout(){localStorage.removeItem('token');localStorage.removeItem('user');window.location.href='/'}
init();
`;
}
