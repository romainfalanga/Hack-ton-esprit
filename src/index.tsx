// ============================================
// HACK TON ESPRIT — MAIN APP
// ============================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings, Variables } from './lib/types';
import { EMOTION_CATEGORIES, LEVEL_NAMES, AWAKENING_NAMES, LEVEL_THRESHOLDS } from './lib/types';
import { hashPassword, authMiddleware, createToken } from './lib/auth';
import { awardXP, updateStreak } from './lib/xp';
import { categorizeCapture, analyzePatterns, generateRitualPrompts } from './lib/ai';
import { PATTERN_DEFINITIONS, getQuestsForPattern } from './lib/patterns';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', cors());

// ============================================
// INIT DATABASE
// ============================================
app.get('/api/init-db', async (c) => {
  const db = c.env.DB;
  // Read and execute migration (we'll do it inline for simplicity)
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_login DATETIME, onboarding_done INTEGER DEFAULT 0, awakening_level INTEGER DEFAULT 1, current_streak INTEGER DEFAULT 0, longest_streak INTEGER DEFAULT 0, last_checkin_date TEXT)`,
    `CREATE TABLE IF NOT EXISTS user_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, lucidity_xp INTEGER DEFAULT 0, resonance_xp INTEGER DEFAULT 0, liberty_xp INTEGER DEFAULT 0, connection_xp INTEGER DEFAULT 0, action_xp INTEGER DEFAULT 0, total_xp INTEGER DEFAULT 0, lucidity_level INTEGER DEFAULT 1, resonance_level INTEGER DEFAULT 1, liberty_level INTEGER DEFAULT 1, connection_level INTEGER DEFAULT 1, action_level INTEGER DEFAULT 1, global_level INTEGER DEFAULT 1, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS checkins (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, emotion TEXT, emotion_detail TEXT, energy_level INTEGER, intention TEXT, micro_victories TEXT, invisible_gratitude TEXT, strong_emotion TEXT, strong_emotion_trigger TEXT, depth_score INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS captures (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, content TEXT NOT NULL, emotion TEXT, intensity INTEGER, category TEXT, tags TEXT, is_anxious INTEGER DEFAULT 0, anticipated_outcome TEXT, actual_outcome TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS decontaminations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, invasive_thought TEXT NOT NULL, proofs_for TEXT, proofs_against TEXT, scenario_worst TEXT, scenario_probable TEXT, scenario_best TEXT, conclusion TEXT, week_number INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS influence_circles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, concerns TEXT NOT NULL, reflections TEXT, week_number INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS worry_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, worried_items TEXT NOT NULL, overall_insight TEXT, week_number INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS patterns (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, pattern_key TEXT NOT NULL, pattern_name TEXT NOT NULL, description TEXT, confidence REAL DEFAULT 0, status TEXT DEFAULT 'detected', detected_at DATETIME DEFAULT CURRENT_TIMESTAMP, resolved_at DATETIME, evidence TEXT, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS quests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, pattern_id INTEGER, quest_key TEXT NOT NULL, quest_name TEXT NOT NULL, description TEXT, technique TEXT, xp_rewards TEXT, status TEXT DEFAULT 'available', frequency TEXT DEFAULT 'daily', times_completed INTEGER DEFAULT 0, unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_completed_at DATETIME, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS quest_completions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, quest_id INTEGER NOT NULL, response TEXT, reflection TEXT, xp_earned TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS rituals (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, ritual_key TEXT NOT NULL, ritual_name TEXT NOT NULL, frequency TEXT NOT NULL, content TEXT, ai_prompts TEXT, xp_earned TEXT, completed_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS xp_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, source_type TEXT NOT NULL, source_id INTEGER, lucidity_xp INTEGER DEFAULT 0, resonance_xp INTEGER DEFAULT 0, liberty_xp INTEGER DEFAULT 0, connection_xp INTEGER DEFAULT 0, action_xp INTEGER DEFAULT 0, description TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS ai_analyses (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, analysis_type TEXT NOT NULL, input_data TEXT, output_data TEXT, model_used TEXT, tokens_used INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
  ];

  for (const sql of statements) {
    await db.prepare(sql).run();
  }

  return c.json({ success: true, message: 'Base de données initialisée' });
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
    return c.json({ error: 'Cet email ou nom d\'utilisateur existe déjà' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const result = await db.prepare(
    'INSERT INTO users (email, username, password_hash, display_name) VALUES (?, ?, ?, ?)'
  ).bind(email, username, passwordHash, display_name || username).run();

  const userId = result.meta.last_row_id;

  // Create initial stats
  await db.prepare('INSERT INTO user_stats (user_id) VALUES (?)').bind(userId).run();

  const user = { id: userId as number, email, username, display_name: display_name || username };
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

// ============================================
// PROFILE & STATS
// ============================================
app.get('/api/me/profile', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const stats = await db.prepare('SELECT * FROM user_stats WHERE user_id = ?').bind(user.id).first();
  const userData = await db.prepare('SELECT current_streak, longest_streak, awakening_level, onboarding_done FROM users WHERE id = ?').bind(user.id).first() as any;

  // Today's checkins
  const today = new Date().toISOString().split('T')[0];
  const todayCheckins = await db.prepare(
    "SELECT type FROM checkins WHERE user_id = ? AND date(created_at) = ?"
  ).bind(user.id, today).all();

  const hasMorningCheckin = todayCheckins.results?.some((c: any) => c.type === 'morning');
  const hasEveningCheckin = todayCheckins.results?.some((c: any) => c.type === 'evening');

  // Active patterns count
  const activePatterns = await db.prepare(
    "SELECT COUNT(*) as count FROM patterns WHERE user_id = ? AND status IN ('detected', 'active')"
  ).bind(user.id).first() as any;

  // Active quests count
  const activeQuests = await db.prepare(
    "SELECT COUNT(*) as count FROM quests WHERE user_id = ? AND status IN ('available', 'active')"
  ).bind(user.id).first() as any;

  // Total captures
  const totalCaptures = await db.prepare(
    "SELECT COUNT(*) as count FROM captures WHERE user_id = ?"
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
    return c.json({ error: 'Émotion et niveau d\'énergie requis' }, 400);
  }

  // Calculate depth score
  let depth = 0;
  if (emotion_detail && emotion_detail.length > 10) depth += 2;
  if (intention && intention.length > 5) depth += 1;
  if (energy_level) depth += 1;

  const result = await db.prepare(
    'INSERT INTO checkins (user_id, type, emotion, emotion_detail, energy_level, intention, depth_score) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, 'morning', emotion, emotion_detail || null, energy_level, intention || null, depth).run();

  // Award XP
  const xp = await awardXP(db, user.id, { resonance: 5 }, 'checkin', result.meta.last_row_id as number, 'Check-in du matin');

  // Update streak
  const streak = await updateStreak(db, user.id);

  return c.json({ success: true, id: result.meta.last_row_id, xp, streak });
});

app.post('/api/checkin/evening', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { micro_victories, invisible_gratitude, strong_emotion, strong_emotion_trigger } = await c.req.json();

  // Count completed exercises
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

  // XP: 5 base + 5 per additional exercise
  const xpAmount = 5 + (exercisesCount - 1) * 5;
  const xpReward: any = { resonance: Math.ceil(xpAmount / 2), lucidity: Math.floor(xpAmount / 2) };
  const xp = await awardXP(db, user.id, xpReward, 'checkin', result.meta.last_row_id as number, 'Scan du soir');

  return c.json({ success: true, id: result.meta.last_row_id, xp, exercises_completed: exercisesCount });
});

// ============================================
// COUCHE 1 — CAPTURES INSTANTANÉES
// ============================================
app.post('/api/capture/new', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { content, intensity } = await c.req.json();

  if (!content) {
    return c.json({ error: 'Contenu requis' }, 400);
  }

  // AI categorization
  let aiResult = { emotion: 'neutre', category: 'quotidien', tags: [] as string[], is_anxious: false };
  try {
    const apiKey = c.env.OPENROUTER_API_KEY;
    if (apiKey) {
      aiResult = await categorizeCapture(apiKey, content);
    }
  } catch (e) {
    // Fail silently, use defaults
  }

  const result = await db.prepare(
    'INSERT INTO captures (user_id, content, emotion, intensity, category, tags, is_anxious) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    user.id, content, aiResult.emotion, intensity || 5,
    aiResult.category, JSON.stringify(aiResult.tags), aiResult.is_anxious ? 1 : 0
  ).run();

  const xp = await awardXP(db, user.id, { lucidity: 2 }, 'capture', result.meta.last_row_id as number, 'Capture instantanée');

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

// Décontamination
app.post('/api/weekly/decontamination', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { invasive_thought, proofs_for, proofs_against, scenario_worst, scenario_probable, scenario_best, conclusion } = await c.req.json();

  if (!invasive_thought) {
    return c.json({ error: 'Pensée envahissante requise' }, 400);
  }

  const weekNumber = getWeekNumber();
  const result = await db.prepare(
    'INSERT INTO decontaminations (user_id, invasive_thought, proofs_for, proofs_against, scenario_worst, scenario_probable, scenario_best, conclusion, week_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, invasive_thought, proofs_for || '[]', proofs_against || '[]', scenario_worst || null, scenario_probable || null, scenario_best || null, conclusion || null, weekNumber).run();

  const xp = await awardXP(db, user.id, { lucidity: 20, action: 10 }, 'decontamination', result.meta.last_row_id as number, 'Décontamination hebdomadaire');

  return c.json({ success: true, id: result.meta.last_row_id, xp });
});

// Cercle d'influence
app.post('/api/weekly/influence-circle', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { concerns, reflections } = await c.req.json();

  if (!concerns) {
    return c.json({ error: 'Préoccupations requises' }, 400);
  }

  const weekNumber = getWeekNumber();
  const result = await db.prepare(
    'INSERT INTO influence_circles (user_id, concerns, reflections, week_number) VALUES (?, ?, ?, ?)'
  ).bind(user.id, concerns, reflections || null, weekNumber).run();

  const xp = await awardXP(db, user.id, { lucidity: 15, liberty: 10 }, 'influence_circle', result.meta.last_row_id as number, 'Cercle d\'influence');

  return c.json({ success: true, id: result.meta.last_row_id, xp });
});

// Bilan boîte à soucis
app.post('/api/weekly/worry-review', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { worried_items, overall_insight } = await c.req.json();

  if (!worried_items) {
    return c.json({ error: 'Éléments requis' }, 400);
  }

  const weekNumber = getWeekNumber();
  const result = await db.prepare(
    'INSERT INTO worry_reviews (user_id, worried_items, overall_insight, week_number) VALUES (?, ?, ?, ?)'
  ).bind(user.id, worried_items, overall_insight || null, weekNumber).run();

  const xp = await awardXP(db, user.id, { lucidity: 15, resonance: 10 }, 'worry_review', result.meta.last_row_id as number, 'Bilan de la boîte à soucis');

  return c.json({ success: true, id: result.meta.last_row_id, xp });
});

// ============================================
// COUCHE 2 — PATTERNS & QUESTS
// ============================================

// Trigger pattern analysis
app.post('/api/pattern/analyze', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const apiKey = c.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return c.json({ error: 'Clé API non configurée' }, 500);
  }

  // Gather user data
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

  // Save detected patterns and unlock quests
  const newPatterns = [];
  for (const pattern of result.patterns) {
    // Check if already exists
    const existing = await db.prepare(
      "SELECT id FROM patterns WHERE user_id = ? AND pattern_key = ? AND status != 'resolved'"
    ).bind(user.id, pattern.key).first();

    if (!existing) {
      const patternResult = await db.prepare(
        'INSERT INTO patterns (user_id, pattern_key, pattern_name, description, confidence, status, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(user.id, pattern.key, pattern.name, '', pattern.confidence, 'detected', JSON.stringify(pattern.evidence)).run();

      const patternId = patternResult.meta.last_row_id;

      // Unlock quests for this pattern
      const questDefs = getQuestsForPattern(pattern.key);
      for (const quest of questDefs) {
        await db.prepare(
          'INSERT INTO quests (user_id, pattern_id, quest_key, quest_name, description, technique, xp_rewards, frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(user.id, patternId, quest.key, quest.name, quest.description, quest.technique, JSON.stringify(quest.xp_rewards), quest.frequency).run();
      }

      newPatterns.push({ ...pattern, quests: questDefs.map(q => q.name) });
    }
  }

  // Save AI analysis
  await db.prepare(
    'INSERT INTO ai_analyses (user_id, analysis_type, output_data, model_used) VALUES (?, ?, ?, ?)'
  ).bind(user.id, 'pattern_detection', JSON.stringify(result), 'google/gemini-2.0-flash-001').run();

  return c.json({ success: true, new_patterns: newPatterns, total_detected: result.patterns.length });
});

// Get user's patterns
app.get('/api/pattern/list', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const patterns = await db.prepare(
    "SELECT * FROM patterns WHERE user_id = ? ORDER BY confidence DESC"
  ).bind(user.id).all();

  return c.json({ patterns: patterns.results });
});

// Self-declare a pattern
app.post('/api/pattern/self-declare', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { pattern_key } = await c.req.json();

  const patternDef = PATTERN_DEFINITIONS.find(p => p.key === pattern_key);
  if (!patternDef) {
    return c.json({ error: 'Pattern inconnu' }, 400);
  }

  // Check if already exists
  const existing = await db.prepare(
    "SELECT id FROM patterns WHERE user_id = ? AND pattern_key = ? AND status != 'resolved'"
  ).bind(user.id, pattern_key).first();

  if (existing) {
    return c.json({ error: 'Pattern déjà actif' }, 409);
  }

  const patternResult = await db.prepare(
    'INSERT INTO patterns (user_id, pattern_key, pattern_name, description, confidence, status, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, pattern_key, patternDef.name, patternDef.description, 1.0, 'active', JSON.stringify(['Auto-déclaré par l\'utilisateur'])).run();

  const patternId = patternResult.meta.last_row_id;

  // Unlock quests
  for (const quest of patternDef.quests) {
    await db.prepare(
      'INSERT INTO quests (user_id, pattern_id, quest_key, quest_name, description, technique, xp_rewards, frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(user.id, patternId, quest.key, quest.name, quest.description, quest.technique, JSON.stringify(quest.xp_rewards), quest.frequency).run();
  }

  return c.json({ success: true, pattern: patternDef.name, quests_unlocked: patternDef.quests.length });
});

// Get user's quests
app.get('/api/quest/list', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const quests = await db.prepare(
    "SELECT q.*, p.pattern_name, p.pattern_key FROM quests q LEFT JOIN patterns p ON q.pattern_id = p.id WHERE q.user_id = ? ORDER BY q.unlocked_at DESC"
  ).bind(user.id).all();

  // Add prompts from definitions
  const questsWithPrompts = (quests.results || []).map((q: any) => {
    const patternDef = PATTERN_DEFINITIONS.find(p => p.key === q.pattern_key);
    const questDef = patternDef?.quests.find(qd => qd.key === q.quest_key);
    return { ...q, prompts: questDef?.prompts || [] };
  });

  return c.json({ quests: questsWithPrompts });
});

// Complete a quest
app.post('/api/quest/complete', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { quest_id, responses, reflection } = await c.req.json();

  const quest = await db.prepare('SELECT * FROM quests WHERE id = ? AND user_id = ?').bind(quest_id, user.id).first() as any;
  if (!quest) {
    return c.json({ error: 'Quête non trouvée' }, 404);
  }

  // Log completion
  const result = await db.prepare(
    'INSERT INTO quest_completions (user_id, quest_id, response, reflection, xp_earned) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, quest_id, JSON.stringify(responses), reflection || null, quest.xp_rewards).run();

  // Update quest
  await db.prepare(
    'UPDATE quests SET times_completed = times_completed + 1, last_completed_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(quest_id).run();

  // Award XP
  const xpRewards = JSON.parse(quest.xp_rewards || '{}');
  const xp = await awardXP(db, user.id, xpRewards, 'quest', result.meta.last_row_id as number, `Quête : ${quest.quest_name}`);

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
    { key: 'unsent_letter', name: 'La Lettre non envoyée', frequency: 'monthly', min_level: 5, xp: { liberty: 30, resonance: 20 } },
    { key: 'automatism_audit', name: 'L\'Audit de mes automatismes', frequency: 'monthly', min_level: 5, xp: { liberty: 30, lucidity: 15 } },
    { key: 'family_scripts', name: 'Le Bilan des scripts familiaux', frequency: 'quarterly', min_level: 5, xp: { liberty: 50, lucidity: 30 } },
    { key: 'future_nostalgic', name: 'Le Futur soi nostalgique', frequency: 'quarterly', min_level: 5, xp: { resonance: 40, action: 20 } },
    { key: 'exit_criteria', name: 'Les Critères de sortie', frequency: 'quarterly', min_level: 5, xp: { action: 40, lucidity: 30 } },
    { key: 'ancestors_letter', name: 'La Grande Lettre aux ancêtres', frequency: 'yearly', min_level: 7, xp: { liberty: 100, resonance: 50 } },
    { key: 'character_arc', name: 'L\'Arc de mon personnage', frequency: 'yearly', min_level: 7, xp: { lucidity: 100, resonance: 100, liberty: 100, connection: 100, action: 100 } },
  ];

  const available = rituals.filter(r => globalLevel >= r.min_level);
  const locked = rituals.filter(r => globalLevel < r.min_level);

  // Check last completions
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

  // Get user patterns for personalization
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
    // Fallback prompts
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
// DATA & HISTORY
// ============================================
app.get('/api/me/history', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const days = Number(c.req.query('days') || 7);

  const since = new Date(Date.now() - days * 86400000).toISOString();

  const checkins = await db.prepare(
    'SELECT * FROM checkins WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC'
  ).bind(user.id, since).all();

  const captures = await db.prepare(
    'SELECT * FROM captures WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC'
  ).bind(user.id, since).all();

  const xpHistory = await db.prepare(
    'SELECT * FROM xp_history WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC'
  ).bind(user.id, since).all();

  return c.json({
    checkins: checkins.results,
    captures: captures.results,
    xp_history: xpHistory.results,
  });
});

// Emotions list for frontend
app.get('/api/emotions', (c) => {
  return c.json({ emotions: EMOTION_CATEGORIES });
});

// Pattern definitions for self-declare
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
app.get('/', (c) => {
  return c.html(getMainHTML());
});

app.get('/app', (c) => {
  return c.html(getAppHTML());
});

// Catch-all for SPA routing
app.get('*', (c) => {
  const path = c.req.path;
  if (path.startsWith('/api/')) {
    return c.json({ error: 'Route non trouvée' }, 404);
  }
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
    unsent_letter: [
      "À qui écris-tu cette lettre ?",
      "Qu'as-tu toujours voulu lui dire sans jamais oser ?",
      "Que ressens-tu en écrivant ces mots ?",
      "De quoi as-tu besoin pour avancer ?",
    ],
    automatism_audit: [
      "Quel schéma récurrent as-tu observé ce mois-ci ?",
      "Dans quelles situations se déclenche-t-il ?",
      "Quelle émotion l'accompagne ?",
      "Quelle petite action peux-tu mettre en place le mois prochain ?",
    ],
    family_scripts: [
      "Quelles phrases de ta famille résonnent encore en toi ?",
      "Lesquelles t'aident ? Lesquelles te limitent ?",
      "Si tu pouvais réécrire un script familial, lequel serait-ce ?",
      "Quelle nouvelle règle veux-tu te donner ?",
    ],
    future_nostalgic: [
      "De quoi seras-tu nostalgique dans 10 ans ?",
      "Que peux-tu faire aujourd'hui pour en profiter ?",
      "Qu'est-ce qui a de la valeur maintenant que tu ne vois pas ?",
    ],
    exit_criteria: [
      "Quels sont tes engagements actuels ?",
      "Pour chacun, quelles sont les conditions d'arrêt ?",
      "Quels délais te fixes-tu ?",
      "Es-tu prêt(e) à les respecter ?",
    ],
    ancestors_letter: [
      "Quel héritage émotionnel as-tu reçu ?",
      "De quoi es-tu reconnaissant(e) ?",
      "De quoi veux-tu te libérer ?",
      "Quel message envoies-tu aux générations futures ?",
    ],
    character_arc: [
      "Qui étais-tu en début d'année ?",
      "Quels patterns as-tu identifiés ?",
      "Lesquels as-tu réussi à transformer ?",
      "Qui es-tu devenu(e) ?",
      "Quelle est la suite de ton histoire ?",
    ],
  };
  return defaults[ritualKey] || ["Prends un moment pour réfléchir...", "Qu'as-tu appris ?", "Comment te sens-tu ?"];
}

// ============================================
// HTML TEMPLATES
// ============================================
function getMainHTML(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hack Ton Esprit — Le Jeu de Ta Vie</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    body { font-family: 'Inter', sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%); }
    .glow { text-shadow: 0 0 20px rgba(139, 92, 246, 0.5); }
    .card-glow { box-shadow: 0 0 30px rgba(139, 92, 246, 0.1); }
    .pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }
    .float { animation: float 6s ease-in-out infinite; }
    @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
  </style>
</head>
<body class="gradient-bg min-h-screen text-white">
  
  <!-- Hero -->
  <div class="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden">
    <!-- Particles -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute w-2 h-2 bg-violet-400 rounded-full top-1/4 left-1/4 float opacity-30"></div>
      <div class="absolute w-3 h-3 bg-indigo-400 rounded-full top-1/3 right-1/3 float opacity-20" style="animation-delay: 1s;"></div>
      <div class="absolute w-2 h-2 bg-purple-400 rounded-full bottom-1/4 left-1/3 float opacity-25" style="animation-delay: 2s;"></div>
      <div class="absolute w-4 h-4 bg-violet-300 rounded-full top-2/3 right-1/4 float opacity-15" style="animation-delay: 3s;"></div>
    </div>

    <div class="text-center max-w-3xl mx-auto relative z-10">
      <div class="mb-8">
        <span class="text-6xl mb-4 block">🧠</span>
        <h1 class="text-5xl md:text-7xl font-black mb-4 glow">
          HACK<br><span class="text-violet-400">TON ESPRIT</span>
        </h1>
        <p class="text-xl md:text-2xl text-gray-300 font-light">Le Jeu de Ta Vie</p>
      </div>

      <p class="text-lg text-gray-400 mb-12 max-w-xl mx-auto leading-relaxed">
        Un voyage gamifié vers la compréhension de soi. 
        Observe tes schémas. Découvre tes patterns. 
        <span class="text-violet-300">Transforme ta vie.</span>
      </p>

      <div class="flex flex-col sm:flex-row gap-4 justify-center mb-16">
        <button onclick="showAuth('register')" class="px-8 py-4 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold text-lg transition-all transform hover:scale-105 card-glow">
          <i class="fas fa-rocket mr-2"></i> Commencer l'aventure
        </button>
        <button onclick="showAuth('login')" class="px-8 py-4 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-lg transition-all border border-white/20">
          <i class="fas fa-sign-in-alt mr-2"></i> J'ai déjà un compte
        </button>
      </div>

      <!-- Stats preview -->
      <div class="grid grid-cols-5 gap-3 max-w-lg mx-auto">
        <div class="text-center p-3 bg-white/5 rounded-xl">
          <span class="text-2xl">🧠</span>
          <p class="text-xs text-gray-400 mt-1">Lucidité</p>
        </div>
        <div class="text-center p-3 bg-white/5 rounded-xl">
          <span class="text-2xl">💚</span>
          <p class="text-xs text-gray-400 mt-1">Résonance</p>
        </div>
        <div class="text-center p-3 bg-white/5 rounded-xl">
          <span class="text-2xl">🔓</span>
          <p class="text-xs text-gray-400 mt-1">Liberté</p>
        </div>
        <div class="text-center p-3 bg-white/5 rounded-xl">
          <span class="text-2xl">🗣️</span>
          <p class="text-xs text-gray-400 mt-1">Connexion</p>
        </div>
        <div class="text-center p-3 bg-white/5 rounded-xl">
          <span class="text-2xl">⚡</span>
          <p class="text-xs text-gray-400 mt-1">Action</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Auth Modal -->
  <div id="authModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm hidden z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 rounded-2xl p-8 w-full max-w-md border border-violet-500/30 card-glow">
      <button onclick="hideAuth()" class="float-right text-gray-400 hover:text-white text-xl"><i class="fas fa-times"></i></button>
      
      <div id="registerForm">
        <h2 class="text-2xl font-bold mb-6 text-violet-300"><i class="fas fa-user-plus mr-2"></i>Crée ton profil</h2>
        <form onsubmit="register(event)">
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Nom d'affichage</label>
              <input type="text" id="regName" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="Comment veux-tu être appelé(e) ?">
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Nom d'utilisateur</label>
              <input type="text" id="regUsername" required class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="ton_pseudo">
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Email</label>
              <input type="email" id="regEmail" required class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="ton@email.com">
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Mot de passe</label>
              <input type="password" id="regPassword" required minlength="6" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="••••••••">
            </div>
          </div>
          <button type="submit" class="w-full mt-6 px-6 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all">
            <i class="fas fa-rocket mr-2"></i>Commencer le voyage
          </button>
          <p class="text-center text-gray-500 mt-4 text-sm">Déjà un compte ? <a href="#" onclick="showAuth('login')" class="text-violet-400 hover:underline">Connexion</a></p>
        </form>
      </div>

      <div id="loginForm" class="hidden">
        <h2 class="text-2xl font-bold mb-6 text-violet-300"><i class="fas fa-sign-in-alt mr-2"></i>Content de te revoir</h2>
        <form onsubmit="login(event)">
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Email</label>
              <input type="email" id="loginEmail" required class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="ton@email.com">
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Mot de passe</label>
              <input type="password" id="loginPassword" required class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="••••••••">
            </div>
          </div>
          <button type="submit" class="w-full mt-6 px-6 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all">
            <i class="fas fa-sign-in-alt mr-2"></i>Connexion
          </button>
          <p class="text-center text-gray-500 mt-4 text-sm">Pas encore de compte ? <a href="#" onclick="showAuth('register')" class="text-violet-400 hover:underline">Inscription</a></p>
        </form>
      </div>

      <div id="authError" class="hidden mt-4 p-3 bg-red-900/50 border border-red-500/50 rounded-xl text-red-300 text-sm"></div>
    </div>
  </div>

  <script>
    function showAuth(type) {
      document.getElementById('authModal').classList.remove('hidden');
      document.getElementById('authModal').classList.add('flex');
      document.getElementById('registerForm').classList.toggle('hidden', type === 'login');
      document.getElementById('loginForm').classList.toggle('hidden', type === 'register');
      document.getElementById('authError').classList.add('hidden');
    }
    function hideAuth() {
      document.getElementById('authModal').classList.add('hidden');
      document.getElementById('authModal').classList.remove('flex');
    }

    async function register(e) {
      e.preventDefault();
      const errEl = document.getElementById('authError');
      errEl.classList.add('hidden');
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: document.getElementById('regName').value,
            username: document.getElementById('regUsername').value,
            email: document.getElementById('regEmail').value,
            password: document.getElementById('regPassword').value,
          })
        });
        const data = await res.json();
        if (data.error) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        // Init DB then redirect
        await fetch('/api/init-db');
        window.location.href = '/app';
      } catch(err) { errEl.textContent = 'Erreur de connexion'; errEl.classList.remove('hidden'); }
    }

    async function login(e) {
      e.preventDefault();
      const errEl = document.getElementById('authError');
      errEl.classList.add('hidden');
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('loginEmail').value,
            password: document.getElementById('loginPassword').value,
          })
        });
        const data = await res.json();
        if (data.error) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        window.location.href = '/app';
      } catch(err) { errEl.textContent = 'Erreur de connexion'; errEl.classList.remove('hidden'); }
    }

    // Check if already logged in
    if (localStorage.getItem('token')) {
      window.location.href = '/app';
    }
  </script>
</body>
</html>`;
}

function getAppHTML(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hack Ton Esprit — Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    body { font-family: 'Inter', sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%); }
    .glow { text-shadow: 0 0 20px rgba(139, 92, 246, 0.5); }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); }
    .card:hover { background: rgba(255,255,255,0.08); border-color: rgba(139, 92, 246, 0.3); }
    .card-glow { box-shadow: 0 0 30px rgba(139, 92, 246, 0.1); }
    .capture-btn { 
      position: fixed; bottom: 24px; right: 24px; z-index: 40;
      width: 64px; height: 64px; border-radius: 50%;
      background: linear-gradient(135deg, #7c3aed, #a855f7);
      box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
      transition: all 0.3s;
    }
    .capture-btn:hover { transform: scale(1.1); box-shadow: 0 6px 30px rgba(139, 92, 246, 0.6); }
    .stat-bar { height: 8px; border-radius: 4px; background: rgba(255,255,255,0.1); overflow: hidden; }
    .stat-fill { height: 100%; border-radius: 4px; transition: width 1s ease-out; }
    .tab-active { border-bottom: 2px solid #8b5cf6; color: #c4b5fd; }
    .modal-overlay { background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); }
    .toast { animation: slideUp 0.3s ease-out; }
    @keyframes slideUp { from { transform: translateY(100px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .emotion-chip { cursor: pointer; transition: all 0.2s; }
    .emotion-chip:hover { transform: scale(1.05); }
    .emotion-chip.selected { ring: 2px; ring-color: #8b5cf6; background: rgba(139, 92, 246, 0.3); }
    .fade-in { animation: fadeIn 0.5s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  </style>
</head>
<body class="gradient-bg min-h-screen text-white">
  
  <!-- Top Navigation -->
  <nav class="sticky top-0 z-30 bg-gray-900/80 backdrop-blur-md border-b border-white/10">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="text-2xl">🧠</span>
        <span class="font-bold text-lg hidden sm:block">Hack Ton Esprit</span>
      </div>
      <div class="flex items-center gap-4">
        <div id="streakBadge" class="flex items-center gap-1 px-3 py-1 bg-orange-500/20 rounded-full text-orange-300 text-sm">
          <i class="fas fa-fire"></i>
          <span id="streakCount">0</span>
        </div>
        <div id="levelBadge" class="flex items-center gap-1 px-3 py-1 bg-violet-500/20 rounded-full text-violet-300 text-sm">
          <i class="fas fa-star"></i>
          <span id="globalLevel">Nv. 1</span>
        </div>
        <button onclick="logout()" class="text-gray-400 hover:text-white" title="Déconnexion">
          <i class="fas fa-sign-out-alt"></i>
        </button>
      </div>
    </div>
  </nav>

  <!-- Tab Navigation -->
  <div class="max-w-6xl mx-auto px-4">
    <div class="flex gap-1 overflow-x-auto py-3 border-b border-white/10 text-sm">
      <button onclick="showTab('dashboard')" class="tab-btn px-4 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="dashboard">
        <i class="fas fa-home mr-1"></i>Tableau de bord
      </button>
      <button onclick="showTab('morning')" class="tab-btn px-4 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="morning">
        <i class="fas fa-sun mr-1"></i>Check-in
      </button>
      <button onclick="showTab('evening')" class="tab-btn px-4 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="evening">
        <i class="fas fa-moon mr-1"></i>Scan du soir
      </button>
      <button onclick="showTab('weekly')" class="tab-btn px-4 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="weekly">
        <i class="fas fa-calendar-week mr-1"></i>Hebdo
      </button>
      <button onclick="showTab('quests')" class="tab-btn px-4 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="quests">
        <i class="fas fa-scroll mr-1"></i>Quêtes
      </button>
      <button onclick="showTab('patterns')" class="tab-btn px-4 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="patterns">
        <i class="fas fa-brain mr-1"></i>Patterns
      </button>
      <button onclick="showTab('rituals')" class="tab-btn px-4 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="rituals">
        <i class="fas fa-gem mr-1"></i>Rituels
      </button>
      <button onclick="showTab('history')" class="tab-btn px-4 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="history">
        <i class="fas fa-chart-line mr-1"></i>Historique
      </button>
    </div>
  </div>

  <!-- Main Content -->
  <main class="max-w-6xl mx-auto px-4 py-6 pb-24">
    <!-- DASHBOARD TAB -->
    <div id="tab-dashboard" class="tab-content fade-in">
      <div class="mb-6">
        <h2 class="text-2xl font-bold mb-1">Bonjour, <span id="userName"></span> 👋</h2>
        <p class="text-gray-400" id="awakeningTitle"></p>
      </div>

      <!-- Today's actions -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div id="morningCard" class="card rounded-2xl p-5 cursor-pointer transition-all" onclick="showTab('morning')">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <i class="fas fa-sun text-amber-400"></i>
            </div>
            <div>
              <h3 class="font-semibold">Check-in du matin</h3>
              <p class="text-xs text-gray-400" id="morningStatus">En attente...</p>
            </div>
          </div>
          <div class="text-xs text-violet-300">+5 XP Résonance</div>
        </div>

        <div id="eveningCard" class="card rounded-2xl p-5 cursor-pointer transition-all" onclick="showTab('evening')">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center">
              <i class="fas fa-moon text-indigo-400"></i>
            </div>
            <div>
              <h3 class="font-semibold">Scan du soir</h3>
              <p class="text-xs text-gray-400" id="eveningStatus">En attente...</p>
            </div>
          </div>
          <div class="text-xs text-violet-300">+5 à +15 XP</div>
        </div>

        <div class="card rounded-2xl p-5 cursor-pointer transition-all" onclick="openCapture()">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
              <i class="fas fa-bolt text-purple-400"></i>
            </div>
            <div>
              <h3 class="font-semibold">Capture instantanée</h3>
              <p class="text-xs text-gray-400" id="captureCount">0 captures aujourd'hui</p>
            </div>
          </div>
          <div class="text-xs text-violet-300">+2 XP Lucidité par capture</div>
        </div>
      </div>

      <!-- Stats -->
      <h3 class="text-lg font-bold mb-4"><i class="fas fa-chart-bar mr-2 text-violet-400"></i>Tes stats</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-8" id="statsGrid">
        <!-- Filled by JS -->
      </div>

      <!-- Active quests preview -->
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold"><i class="fas fa-scroll mr-2 text-violet-400"></i>Quêtes actives</h3>
        <button onclick="showTab('quests')" class="text-sm text-violet-400 hover:text-violet-300">Voir tout →</button>
      </div>
      <div id="questPreview" class="space-y-3 mb-8">
        <p class="text-gray-500 text-sm">Les quêtes apparaissent quand le système détecte tes patterns (après ~2 semaines).</p>
      </div>
    </div>

    <!-- MORNING CHECK-IN TAB -->
    <div id="tab-morning" class="tab-content hidden fade-in">
      <div class="max-w-2xl mx-auto">
        <h2 class="text-2xl font-bold mb-2"><i class="fas fa-sun text-amber-400 mr-2"></i>Check-in du matin</h2>
        <p class="text-gray-400 mb-6">Comment te sens-tu là, maintenant ? (2 min)</p>

        <div id="morningForm">
          <!-- Emotion Wheel -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-300 mb-3">Comment te sens-tu ?</label>
            <div id="emotionWheel" class="space-y-3">
              <!-- Filled by JS -->
            </div>
            <input type="hidden" id="selectedEmotion" value="">
          </div>

          <!-- Emotion Detail -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-300 mb-2">Précise si tu veux (facultatif)</label>
            <textarea id="emotionDetail" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="En quelques mots, pourquoi tu te sens comme ça..."></textarea>
          </div>

          <!-- Energy Level -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-300 mb-2">Niveau d'énergie : <span id="energyValue" class="text-violet-400">5</span>/10</label>
            <input type="range" id="energyLevel" min="1" max="10" value="5" class="w-full accent-violet-500" oninput="document.getElementById('energyValue').textContent = this.value">
          </div>

          <!-- Intention -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-300 mb-2">Intention du jour (un mot ou une phrase)</label>
            <input type="text" id="intention" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="Ex : patience, avancer, écouter...">
          </div>

          <button onclick="submitMorningCheckin()" class="w-full py-4 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold text-lg transition-all">
            <i class="fas fa-check mr-2"></i>Valider mon check-in
          </button>
        </div>

        <div id="morningDone" class="hidden text-center py-12">
          <div class="text-6xl mb-4">✅</div>
          <h3 class="text-2xl font-bold text-green-400 mb-2">Check-in enregistré !</h3>
          <p class="text-gray-400">+5 XP Résonance. Bonne journée !</p>
        </div>
      </div>
    </div>

    <!-- EVENING SCAN TAB -->
    <div id="tab-evening" class="tab-content hidden fade-in">
      <div class="max-w-2xl mx-auto">
        <h2 class="text-2xl font-bold mb-2"><i class="fas fa-moon text-indigo-400 mr-2"></i>Scan du soir</h2>
        <p class="text-gray-400 mb-6">3 micro-exercices, fais-en au moins 1 (5 min)</p>

        <div id="eveningForm">
          <!-- Micro-victories -->
          <div class="card rounded-2xl p-5 mb-4">
            <h3 class="font-semibold mb-3"><i class="fas fa-trophy text-amber-400 mr-2"></i>3 micro-victoires du jour</h3>
            <p class="text-xs text-gray-400 mb-3">Aucune comparaison avec autrui. Juste toi.</p>
            <input type="text" id="victory1" class="w-full px-4 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Victoire 1...">
            <input type="text" id="victory2" class="w-full px-4 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Victoire 2...">
            <input type="text" id="victory3" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Victoire 3...">
          </div>

          <!-- Invisible gratitude -->
          <div class="card rounded-2xl p-5 mb-4">
            <h3 class="font-semibold mb-3"><i class="fas fa-eye text-green-400 mr-2"></i>1 gratitude invisible</h3>
            <p class="text-xs text-gray-400 mb-3">Quelque chose qui n'a pas de prix.</p>
            <textarea id="gratitude" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Ce dont je suis reconnaissant(e)..."></textarea>
          </div>

          <!-- Strong emotion -->
          <div class="card rounded-2xl p-5 mb-6">
            <h3 class="font-semibold mb-3"><i class="fas fa-heart text-red-400 mr-2"></i>1 émotion forte du jour</h3>
            <p class="text-xs text-gray-400 mb-3">Nomme-la avec précision + son déclencheur.</p>
            <input type="text" id="strongEmotion" class="w-full px-4 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="L'émotion précise...">
            <textarea id="emotionTrigger" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Ce qui l'a déclenchée..."></textarea>
          </div>

          <button onclick="submitEveningCheckin()" class="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-lg transition-all">
            <i class="fas fa-moon mr-2"></i>Enregistrer mon scan
          </button>
        </div>

        <div id="eveningDone" class="hidden text-center py-12">
          <div class="text-6xl mb-4">🌙</div>
          <h3 class="text-2xl font-bold text-indigo-400 mb-2">Scan du soir enregistré !</h3>
          <p class="text-gray-400">Bonne nuit. Tu fais un travail incroyable.</p>
        </div>
      </div>
    </div>

    <!-- WEEKLY TAB -->
    <div id="tab-weekly" class="tab-content hidden fade-in">
      <div class="max-w-2xl mx-auto">
        <h2 class="text-2xl font-bold mb-6"><i class="fas fa-calendar-week text-violet-400 mr-2"></i>Exercices hebdomadaires</h2>
        
        <div class="space-y-4">
          <!-- Decontamination -->
          <div class="card rounded-2xl p-5 cursor-pointer" onclick="openWeeklyExercise('decontamination')">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center text-2xl">🧹</div>
              <div class="flex-1">
                <h3 class="font-semibold">La Décontamination</h3>
                <p class="text-sm text-gray-400">15 min — Passe ta pensée envahissante au crible</p>
              </div>
              <div class="text-xs text-violet-300">+30 XP</div>
            </div>
          </div>

          <!-- Circle of Influence -->
          <div class="card rounded-2xl p-5 cursor-pointer" onclick="openWeeklyExercise('influence')">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-2xl">🎯</div>
              <div class="flex-1">
                <h3 class="font-semibold">Le Cercle d'influence</h3>
                <p class="text-sm text-gray-400">10 min — Ce que tu contrôles vs ce que tu ne contrôles pas</p>
              </div>
              <div class="text-xs text-violet-300">+25 XP</div>
            </div>
          </div>

          <!-- Worry Review -->
          <div class="card rounded-2xl p-5 cursor-pointer" onclick="openWeeklyExercise('worry')">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center text-2xl">📦</div>
              <div class="flex-1">
                <h3 class="font-semibold">Bilan de la boîte à soucis</h3>
                <p class="text-sm text-gray-400">10 min — Anticipé vs réalité</p>
              </div>
              <div class="text-xs text-violet-300">+25 XP</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- QUESTS TAB -->
    <div id="tab-quests" class="tab-content hidden fade-in">
      <div class="max-w-2xl mx-auto">
        <h2 class="text-2xl font-bold mb-2"><i class="fas fa-scroll text-violet-400 mr-2"></i>Tes Quêtes</h2>
        <p class="text-gray-400 mb-6">Quêtes personnalisées basées sur tes patterns détectés</p>
        <div id="questList" class="space-y-4">
          <div class="card rounded-2xl p-8 text-center">
            <div class="text-4xl mb-3">🔮</div>
            <h3 class="font-semibold mb-2">Les quêtes émergent de tes données</h3>
            <p class="text-sm text-gray-400">Continue tes check-ins quotidiens. Après ~2 semaines, le système détectera tes premiers patterns et débloquera des quêtes personnalisées.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- PATTERNS TAB -->
    <div id="tab-patterns" class="tab-content hidden fade-in">
      <div class="max-w-2xl mx-auto">
        <h2 class="text-2xl font-bold mb-2"><i class="fas fa-brain text-violet-400 mr-2"></i>Tes Patterns</h2>
        <p class="text-gray-400 mb-6">Les schémas que le système a détectés chez toi</p>
        
        <div id="patternList" class="space-y-4 mb-8">
          <p class="text-gray-500 text-sm">Aucun pattern détecté pour l'instant. Continue tes observations quotidiennes.</p>
        </div>

        <div class="border-t border-white/10 pt-6">
          <h3 class="font-semibold mb-3">Tu te reconnais dans un pattern ?</h3>
          <p class="text-sm text-gray-400 mb-4">Tu peux autodéclarer un pattern pour débloquer ses quêtes immédiatement.</p>
          <button onclick="openSelfDeclare()" class="px-6 py-3 bg-violet-600/50 hover:bg-violet-600 rounded-xl font-medium transition-all text-sm">
            <i class="fas fa-hand-point-up mr-2"></i>Je me reconnais dans un pattern
          </button>
        </div>
      </div>
    </div>

    <!-- RITUALS TAB -->
    <div id="tab-rituals" class="tab-content hidden fade-in">
      <div class="max-w-2xl mx-auto">
        <h2 class="text-2xl font-bold mb-2"><i class="fas fa-gem text-violet-400 mr-2"></i>Rituels de profondeur</h2>
        <p class="text-gray-400 mb-6">Les grandes introspections périodiques</p>
        <div id="ritualList" class="space-y-4">
          <div class="card rounded-2xl p-8 text-center">
            <div class="text-4xl mb-3">🔒</div>
            <h3 class="font-semibold mb-2">Niveau 5 requis</h3>
            <p class="text-sm text-gray-400">Les rituels de profondeur se débloquent au niveau 5. Continue à observer et à travailler tes patterns.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- HISTORY TAB -->
    <div id="tab-history" class="tab-content hidden fade-in">
      <div class="max-w-2xl mx-auto">
        <h2 class="text-2xl font-bold mb-6"><i class="fas fa-chart-line text-violet-400 mr-2"></i>Ton historique</h2>
        <div id="historyContent" class="space-y-4">
          <p class="text-gray-500 text-sm">Chargement...</p>
        </div>
      </div>
    </div>
  </main>

  <!-- Capture Button (always visible) -->
  <button onclick="openCapture()" class="capture-btn flex items-center justify-center text-white text-2xl" title="Capture instantanée">
    <i class="fas fa-bolt"></i>
  </button>

  <!-- Capture Modal -->
  <div id="captureModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-violet-500/30">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-violet-300"><i class="fas fa-bolt mr-2"></i>Capture instantanée</h3>
        <button onclick="closeCapture()" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <p class="text-sm text-gray-400 mb-4">Une pensée te traverse ? Une émotion te submerge ? Capture l'instant.</p>
      <textarea id="captureContent" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none resize-none" rows="4" placeholder="Ce qui se passe en moi là, maintenant..." autofocus></textarea>
      <div class="flex items-center gap-3 mt-3 mb-4">
        <label class="text-sm text-gray-400">Intensité :</label>
        <input type="range" id="captureIntensity" min="1" max="10" value="5" class="flex-1 accent-violet-500">
        <span id="captureIntVal" class="text-violet-400 text-sm">5</span>
      </div>
      <button onclick="submitCapture()" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all">
        <i class="fas fa-bolt mr-2"></i>Capturer
      </button>
    </div>
  </div>

  <!-- Weekly Exercise Modal -->
  <div id="weeklyModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-start justify-center p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-lg border border-violet-500/30 my-8">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-violet-300" id="weeklyTitle"></h3>
        <button onclick="closeWeeklyModal()" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <div id="weeklyContent"></div>
    </div>
  </div>

  <!-- Quest Modal -->
  <div id="questModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-start justify-center p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-lg border border-violet-500/30 my-8">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-violet-300" id="questTitle"></h3>
        <button onclick="closeQuestModal()" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <div id="questContent"></div>
    </div>
  </div>

  <!-- Self-Declare Modal -->
  <div id="selfDeclareModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-start justify-center p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-lg border border-violet-500/30 my-8">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-violet-300"><i class="fas fa-hand-point-up mr-2"></i>Autodéclarer un pattern</h3>
        <button onclick="closeSelfDeclare()" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <div id="selfDeclareContent" class="space-y-3"></div>
    </div>
  </div>

  <!-- Toast -->
  <div id="toast" class="fixed bottom-24 left-1/2 transform -translate-x-1/2 hidden z-50">
    <div class="toast bg-gray-900 border border-violet-500/30 rounded-xl px-6 py-3 flex items-center gap-3 shadow-2xl">
      <span id="toastIcon" class="text-xl"></span>
      <span id="toastMsg" class="text-sm"></span>
    </div>
  </div>

  <script>
    // ============================================
    // APP STATE
    // ============================================
    const API = '';
    let token = localStorage.getItem('token');
    let userData = null;
    let emotions = {};

    if (!token) window.location.href = '/';

    const headers = () => ({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
    });

    // ============================================
    // INIT
    // ============================================
    async function init() {
      try {
        // Init DB first
        await fetch(API + '/api/init-db');
        
        // Load profile
        const res = await fetch(API + '/api/me/profile', { headers: headers() });
        if (!res.ok) { logout(); return; }
        userData = await res.json();
        
        // Load emotions
        const emoRes = await fetch(API + '/api/emotions');
        emotions = (await emoRes.json()).emotions;
        
        renderDashboard();
        renderEmotionWheel();
        showTab('dashboard');
      } catch(e) {
        console.error('Init error:', e);
      }
    }

    // ============================================
    // TABS
    // ============================================
    function showTab(tab) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('tab-active');
        el.classList.add('text-gray-400');
      });
      const tabEl = document.getElementById('tab-' + tab);
      if (tabEl) { tabEl.classList.remove('hidden'); }
      const btn = document.querySelector('[data-tab="' + tab + '"]');
      if (btn) { btn.classList.add('tab-active'); btn.classList.remove('text-gray-400'); }

      // Lazy load tab content
      if (tab === 'quests') loadQuests();
      if (tab === 'patterns') loadPatterns();
      if (tab === 'rituals') loadRituals();
      if (tab === 'history') loadHistory();
    }

    // ============================================
    // RENDER DASHBOARD
    // ============================================
    function renderDashboard() {
      if (!userData) return;
      const u = userData.user;
      const s = userData.stats;

      document.getElementById('userName').textContent = u.display_name || u.username;
      document.getElementById('streakCount').textContent = u.current_streak || 0;
      document.getElementById('globalLevel').textContent = 'Nv. ' + (s?.global_level || 1);
      
      const awNames = userData.awakening_names || [];
      const lvl = (s?.global_level || 1) - 1;
      document.getElementById('awakeningTitle').textContent = awNames[lvl] || 'L\\'Inconscient';

      // Today status
      document.getElementById('morningStatus').textContent = userData.today.morning_done ? '✅ Complété' : '⏳ En attente';
      document.getElementById('eveningStatus').textContent = userData.today.evening_done ? '✅ Complété' : '⏳ En attente';
      if (userData.today.morning_done) document.getElementById('morningCard').style.borderColor = 'rgba(34,197,94,0.3)';
      if (userData.today.evening_done) document.getElementById('eveningCard').style.borderColor = 'rgba(34,197,94,0.3)';

      // Stats
      const statConfig = [
        { key: 'lucidity', icon: '🧠', color: 'bg-blue-500', label: 'Lucidité' },
        { key: 'resonance', icon: '💚', color: 'bg-green-500', label: 'Résonance' },
        { key: 'liberty', icon: '🔓', color: 'bg-yellow-500', label: 'Liberté' },
        { key: 'connection', icon: '🗣️', color: 'bg-pink-500', label: 'Connexion' },
        { key: 'action', icon: '⚡', color: 'bg-orange-500', label: 'Action' },
      ];

      const thresholds = userData.level_thresholds || [0,100,300,600,1000,1500,2200,3000,4000,5500];
      const levelNames = userData.level_names || {};

      let statsHTML = '';
      for (const stat of statConfig) {
        const xp = s?.[stat.key + '_xp'] || 0;
        const level = s?.[stat.key + '_level'] || 1;
        const names = levelNames[stat.key] || [];
        const name = names[level - 1] || '';
        const nextThreshold = thresholds[level] || thresholds[thresholds.length - 1];
        const prevThreshold = thresholds[level - 1] || 0;
        const progress = nextThreshold > prevThreshold ? ((xp - prevThreshold) / (nextThreshold - prevThreshold)) * 100 : 100;

        statsHTML += '<div class="card rounded-xl p-4">' +
          '<div class="flex items-center gap-2 mb-2"><span class="text-xl">' + stat.icon + '</span>' +
          '<div><div class="font-semibold text-sm">' + stat.label + '</div>' +
          '<div class="text-xs text-gray-400">' + name + ' (Nv.' + level + ')</div></div></div>' +
          '<div class="stat-bar"><div class="stat-fill ' + stat.color + '" style="width:' + Math.min(progress, 100) + '%"></div></div>' +
          '<div class="text-xs text-gray-500 mt-1">' + xp + ' / ' + nextThreshold + ' XP</div></div>';
      }
      document.getElementById('statsGrid').innerHTML = statsHTML;

      // Morning/Evening done states
      if (userData.today.morning_done) {
        document.getElementById('morningForm')?.classList.add('hidden');
        document.getElementById('morningDone')?.classList.remove('hidden');
      }
      if (userData.today.evening_done) {
        document.getElementById('eveningForm')?.classList.add('hidden');
        document.getElementById('eveningDone')?.classList.remove('hidden');
      }
    }

    // ============================================
    // EMOTION WHEEL
    // ============================================
    function renderEmotionWheel() {
      const categoryEmojis = { joy: '😊', sadness: '😢', anger: '😠', fear: '😰', surprise: '😲', disgust: '🤢', neutral: '😐' };
      const categoryNames = { joy: 'Joie', sadness: 'Tristesse', anger: 'Colère', fear: 'Peur', surprise: 'Surprise', disgust: 'Dégoût', neutral: 'Neutre' };
      
      let html = '';
      for (const [cat, emos] of Object.entries(emotions)) {
        html += '<div class="mb-3"><div class="flex items-center gap-2 mb-2"><span>' + (categoryEmojis[cat]||'') + '</span><span class="text-xs font-medium text-gray-300">' + (categoryNames[cat]||cat) + '</span></div>';
        html += '<div class="flex flex-wrap gap-2">';
        for (const emo of emos) {
          html += '<button type="button" class="emotion-chip px-3 py-1.5 rounded-full text-xs bg-white/5 border border-white/10 hover:border-violet-500/50" onclick="selectEmotion(this, \\''+emo+'\\')">' + emo + '</button>';
        }
        html += '</div></div>';
      }
      document.getElementById('emotionWheel').innerHTML = html;
    }

    function selectEmotion(el, emotion) {
      document.querySelectorAll('.emotion-chip').forEach(e => e.classList.remove('selected', 'bg-violet-500/30', 'border-violet-500'));
      el.classList.add('selected', 'bg-violet-500/30', 'border-violet-500');
      document.getElementById('selectedEmotion').value = emotion;
    }

    // ============================================
    // MORNING CHECK-IN
    // ============================================
    async function submitMorningCheckin() {
      const emotion = document.getElementById('selectedEmotion').value;
      if (!emotion) { showToast('⚠️', 'Choisis une émotion'); return; }

      const data = {
        emotion,
        emotion_detail: document.getElementById('emotionDetail').value,
        energy_level: parseInt(document.getElementById('energyLevel').value),
        intention: document.getElementById('intention').value,
      };

      try {
        const res = await fetch(API + '/api/checkin/morning', { method: 'POST', headers: headers(), body: JSON.stringify(data) });
        const result = await res.json();
        if (result.error) { showToast('❌', result.error); return; }
        
        document.getElementById('morningForm').classList.add('hidden');
        document.getElementById('morningDone').classList.remove('hidden');
        showToast('✨', '+5 XP Résonance ! Streak : ' + (result.streak?.current_streak || 1));
        refreshProfile();
      } catch(e) { showToast('❌', 'Erreur réseau'); }
    }

    // ============================================
    // EVENING SCAN
    // ============================================
    async function submitEveningCheckin() {
      const victories = [
        document.getElementById('victory1').value,
        document.getElementById('victory2').value,
        document.getElementById('victory3').value,
      ].filter(v => v.trim());

      const gratitude = document.getElementById('gratitude').value;
      const strongEmotion = document.getElementById('strongEmotion').value;
      const trigger = document.getElementById('emotionTrigger').value;

      if (victories.length === 0 && !gratitude && !strongEmotion) {
        showToast('⚠️', 'Complète au moins un exercice'); return;
      }

      const data = {
        micro_victories: JSON.stringify(victories),
        invisible_gratitude: gratitude,
        strong_emotion: strongEmotion,
        strong_emotion_trigger: trigger,
      };

      try {
        const res = await fetch(API + '/api/checkin/evening', { method: 'POST', headers: headers(), body: JSON.stringify(data) });
        const result = await res.json();
        if (result.error) { showToast('❌', result.error); return; }
        
        document.getElementById('eveningForm').classList.add('hidden');
        document.getElementById('eveningDone').classList.remove('hidden');
        showToast('🌙', 'Scan enregistré ! +' + (result.exercises_completed * 5) + ' XP');
        refreshProfile();
      } catch(e) { showToast('❌', 'Erreur réseau'); }
    }

    // ============================================
    // CAPTURES
    // ============================================
    function openCapture() {
      document.getElementById('captureModal').classList.remove('hidden');
      document.getElementById('captureModal').classList.add('flex');
      document.getElementById('captureContent').focus();
    }
    function closeCapture() {
      document.getElementById('captureModal').classList.add('hidden');
      document.getElementById('captureModal').classList.remove('flex');
    }

    document.getElementById('captureIntensity').oninput = function() {
      document.getElementById('captureIntVal').textContent = this.value;
    };

    async function submitCapture() {
      const content = document.getElementById('captureContent').value;
      if (!content.trim()) { showToast('⚠️', 'Écris quelque chose'); return; }

      try {
        const res = await fetch(API + '/api/capture/new', {
          method: 'POST', headers: headers(),
          body: JSON.stringify({ content, intensity: parseInt(document.getElementById('captureIntensity').value) })
        });
        const result = await res.json();
        if (result.error) { showToast('❌', result.error); return; }
        
        document.getElementById('captureContent').value = '';
        closeCapture();
        
        let msg = '+2 XP Lucidité';
        if (result.analysis?.emotion) msg += ' | Émotion détectée : ' + result.analysis.emotion;
        showToast('⚡', msg);
        refreshProfile();
      } catch(e) { showToast('❌', 'Erreur réseau'); }
    }

    // ============================================
    // WEEKLY EXERCISES
    // ============================================
    function openWeeklyExercise(type) {
      const modal = document.getElementById('weeklyModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');

      const title = document.getElementById('weeklyTitle');
      const content = document.getElementById('weeklyContent');

      if (type === 'decontamination') {
        title.innerHTML = '🧹 La Décontamination';
        content.innerHTML = '<p class="text-sm text-gray-400 mb-4">Choisis la pensée la plus envahissante de ta semaine et passe-la au crible.</p>' +
          '<div class="space-y-4">' +
          '<div><label class="block text-sm text-gray-300 mb-1">La pensée envahissante</label><textarea id="wInvasive" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div>' +
          '<div><label class="block text-sm text-gray-300 mb-1">Preuves POUR cette pensée</label><textarea id="wProofsFor" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Sépare par des virgules"></textarea></div>' +
          '<div><label class="block text-sm text-gray-300 mb-1">Preuves CONTRE cette pensée</label><textarea id="wProofsAgainst" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Sépare par des virgules"></textarea></div>' +
          '<div><label class="block text-sm text-gray-300 mb-1">🔴 Le pire scénario</label><textarea id="wWorst" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div>' +
          '<div><label class="block text-sm text-gray-300 mb-1">🟡 Le plus probable</label><textarea id="wProbable" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div>' +
          '<div><label class="block text-sm text-gray-300 mb-1">🟢 Le meilleur raisonnable</label><textarea id="wBest" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div>' +
          '<div><label class="block text-sm text-gray-300 mb-1">Conclusion</label><textarea id="wConclusion" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div>' +
          '<button onclick="submitDecontamination()" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-check mr-2"></i>Valider</button></div>';
      } else if (type === 'influence') {
        title.innerHTML = '🎯 Le Cercle d\\'influence';
        content.innerHTML = '<p class="text-sm text-gray-400 mb-4">Liste 3 à 5 préoccupations et place-les dans le bon cercle.</p>' +
          '<div class="space-y-4" id="influenceConcerns">' +
          buildConcernInput(1) + buildConcernInput(2) + buildConcernInput(3) +
          '<button type="button" onclick="addConcern()" class="text-sm text-violet-400 hover:text-violet-300"><i class="fas fa-plus mr-1"></i>Ajouter</button>' +
          '<div><label class="block text-sm text-gray-300 mb-1">Réflexions</label><textarea id="iReflections" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Que choisis-tu de relâcher ?"></textarea></div>' +
          '<button onclick="submitInfluenceCircle()" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-check mr-2"></i>Valider</button></div>';
      } else if (type === 'worry') {
        title.innerHTML = '📦 Bilan de la boîte à soucis';
        content.innerHTML = '<p class="text-sm text-gray-400 mb-4">Reprends tes captures anxieuses et compare : ce que tu craignais vs ce qui s\\'est passé.</p>' +
          '<div class="space-y-4" id="worryItems">' +
          buildWorryInput(1) + buildWorryInput(2) +
          '<button type="button" onclick="addWorryItem()" class="text-sm text-violet-400 hover:text-violet-300"><i class="fas fa-plus mr-1"></i>Ajouter</button>' +
          '<div><label class="block text-sm text-gray-300 mb-1">Insight global</label><textarea id="wInsight" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Que constates-tu sur l\\'écart entre tes peurs et la réalité ?"></textarea></div>' +
          '<button onclick="submitWorryReview()" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-check mr-2"></i>Valider</button></div>';
      }
    }

    function buildConcernInput(n) {
      return '<div class="concern-item"><div class="flex gap-2 items-start"><textarea class="concern-text flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="1" placeholder="Préoccupation ' + n + '"></textarea>' +
        '<select class="concern-circle px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs"><option value="control">Je contrôle</option><option value="no_control">Hors contrôle</option></select></div></div>';
    }
    let concernCount = 3;
    function addConcern() {
      concernCount++;
      const div = document.createElement('div');
      div.innerHTML = buildConcernInput(concernCount);
      const container = document.getElementById('influenceConcerns');
      container.insertBefore(div.firstChild, container.querySelector('button'));
    }

    function buildWorryInput(n) {
      return '<div class="worry-item card rounded-xl p-3"><p class="text-xs text-gray-400 mb-2">Souci ' + n + '</p>' +
        '<input class="worry-text w-full px-3 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Ce que je craignais...">' +
        '<input class="worry-actual w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Ce qui s\\'est réellement passé..."></div>';
    }
    let worryCount = 2;
    function addWorryItem() {
      worryCount++;
      const div = document.createElement('div');
      div.innerHTML = buildWorryInput(worryCount);
      const container = document.getElementById('worryItems');
      container.insertBefore(div.firstChild, container.querySelector('button'));
    }

    function closeWeeklyModal() {
      document.getElementById('weeklyModal').classList.add('hidden');
      document.getElementById('weeklyModal').classList.remove('flex');
    }

    async function submitDecontamination() {
      const data = {
        invasive_thought: document.getElementById('wInvasive').value,
        proofs_for: JSON.stringify(document.getElementById('wProofsFor').value.split(',').map(s=>s.trim()).filter(Boolean)),
        proofs_against: JSON.stringify(document.getElementById('wProofsAgainst').value.split(',').map(s=>s.trim()).filter(Boolean)),
        scenario_worst: document.getElementById('wWorst').value,
        scenario_probable: document.getElementById('wProbable').value,
        scenario_best: document.getElementById('wBest').value,
        conclusion: document.getElementById('wConclusion').value,
      };
      if (!data.invasive_thought) { showToast('⚠️', 'Pensée requise'); return; }
      try {
        const res = await fetch(API + '/api/weekly/decontamination', { method: 'POST', headers: headers(), body: JSON.stringify(data) });
        const result = await res.json();
        if (result.error) { showToast('❌', result.error); return; }
        closeWeeklyModal();
        showToast('🧹', 'Décontamination validée ! +30 XP');
        refreshProfile();
      } catch(e) { showToast('❌', 'Erreur'); }
    }

    async function submitInfluenceCircle() {
      const items = [];
      document.querySelectorAll('.concern-item').forEach(el => {
        const text = el.querySelector('.concern-text')?.value;
        const circle = el.querySelector('.concern-circle')?.value;
        if (text?.trim()) items.push({ text, circle });
      });
      if (items.length === 0) { showToast('⚠️', 'Ajoute au moins une préoccupation'); return; }
      try {
        const res = await fetch(API + '/api/weekly/influence-circle', {
          method: 'POST', headers: headers(),
          body: JSON.stringify({ concerns: JSON.stringify(items), reflections: document.getElementById('iReflections').value })
        });
        const result = await res.json();
        if (result.error) { showToast('❌', result.error); return; }
        closeWeeklyModal();
        showToast('🎯', 'Cercle d\\'influence validé ! +25 XP');
        refreshProfile();
      } catch(e) { showToast('❌', 'Erreur'); }
    }

    async function submitWorryReview() {
      const items = [];
      document.querySelectorAll('.worry-item').forEach(el => {
        const text = el.querySelector('.worry-text')?.value;
        const actual = el.querySelector('.worry-actual')?.value;
        if (text?.trim()) items.push({ worry: text, actual: actual || '' });
      });
      if (items.length === 0) { showToast('⚠️', 'Ajoute au moins un souci'); return; }
      try {
        const res = await fetch(API + '/api/weekly/worry-review', {
          method: 'POST', headers: headers(),
          body: JSON.stringify({ worried_items: JSON.stringify(items), overall_insight: document.getElementById('wInsight').value })
        });
        const result = await res.json();
        if (result.error) { showToast('❌', result.error); return; }
        closeWeeklyModal();
        showToast('📦', 'Bilan validé ! +25 XP');
        refreshProfile();
      } catch(e) { showToast('❌', 'Erreur'); }
    }

    // ============================================
    // QUESTS
    // ============================================
    async function loadQuests() {
      try {
        const res = await fetch(API + '/api/quest/list', { headers: headers() });
        const data = await res.json();
        const list = document.getElementById('questList');
        
        if (!data.quests || data.quests.length === 0) {
          list.innerHTML = '<div class="card rounded-2xl p-8 text-center"><div class="text-4xl mb-3">🔮</div><h3 class="font-semibold mb-2">Les quêtes émergent de tes données</h3><p class="text-sm text-gray-400">Continue tes check-ins quotidiens. Après ~2 semaines, le système détectera tes premiers patterns et débloquera des quêtes personnalisées.</p></div>';
          return;
        }

        list.innerHTML = data.quests.map(q => {
          const xp = JSON.parse(q.xp_rewards || '{}');
          const xpStr = Object.entries(xp).map(([k,v]) => '+' + v + ' ' + k).join(', ');
          return '<div class="card rounded-2xl p-5 cursor-pointer" onclick="openQuest(' + q.id + ', ' + JSON.stringify(JSON.stringify(q)) + ')">' +
            '<div class="flex items-center gap-3">' +
            '<div class="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center text-2xl">⚔️</div>' +
            '<div class="flex-1"><h3 class="font-semibold">' + q.quest_name + '</h3>' +
            '<p class="text-sm text-gray-400">' + q.description + '</p>' +
            '<p class="text-xs text-gray-500 mt-1">Pattern : ' + (q.pattern_name || '—') + ' | Technique de ' + (q.technique || '—') + '</p></div>' +
            '<div class="text-right"><div class="text-xs text-violet-300">' + xpStr + '</div>' +
            '<div class="text-xs text-gray-500 mt-1">×' + (q.times_completed || 0) + '</div></div></div></div>';
        }).join('');
      } catch(e) { console.error(e); }
    }

    function openQuest(id, questStr) {
      const quest = JSON.parse(questStr);
      const modal = document.getElementById('questModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.getElementById('questTitle').innerHTML = '⚔️ ' + quest.quest_name;
      
      const prompts = quest.prompts || [];
      let html = '<p class="text-sm text-gray-400 mb-4">' + quest.description + '</p>' +
        '<p class="text-xs text-gray-500 mb-4">Technique de ' + (quest.technique || '—') + '</p>' +
        '<div class="space-y-4">';
      
      prompts.forEach((p, i) => {
        html += '<div><label class="block text-sm text-gray-300 mb-1">' + p + '</label>' +
          '<textarea class="quest-response w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" data-prompt="' + i + '"></textarea></div>';
      });

      html += '<div><label class="block text-sm text-gray-300 mb-1">Réflexion libre (facultatif)</label>' +
        '<textarea id="questReflection" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div>' +
        '<button onclick="submitQuest(' + id + ')" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-check mr-2"></i>Compléter la quête</button></div>';

      document.getElementById('questContent').innerHTML = html;
    }

    function closeQuestModal() {
      document.getElementById('questModal').classList.add('hidden');
      document.getElementById('questModal').classList.remove('flex');
    }

    async function submitQuest(questId) {
      const responses = {};
      document.querySelectorAll('.quest-response').forEach(el => {
        responses[el.dataset.prompt] = el.value;
      });
      const reflection = document.getElementById('questReflection')?.value || '';

      try {
        const res = await fetch(API + '/api/quest/complete', {
          method: 'POST', headers: headers(),
          body: JSON.stringify({ quest_id: questId, responses, reflection })
        });
        const result = await res.json();
        if (result.error) { showToast('❌', result.error); return; }
        closeQuestModal();
        showToast('⚔️', 'Quête complétée : ' + result.quest_name);
        refreshProfile();
        loadQuests();
      } catch(e) { showToast('❌', 'Erreur'); }
    }

    // ============================================
    // PATTERNS
    // ============================================
    async function loadPatterns() {
      try {
        const res = await fetch(API + '/api/pattern/list', { headers: headers() });
        const data = await res.json();
        const list = document.getElementById('patternList');
        
        if (!data.patterns || data.patterns.length === 0) {
          list.innerHTML = '<p class="text-gray-500 text-sm">Aucun pattern détecté pour l\\'instant. Continue tes observations quotidiennes.</p>' +
            '<button onclick="triggerAnalysis()" class="mt-4 px-6 py-3 bg-violet-600/30 hover:bg-violet-600/50 rounded-xl font-medium transition-all text-sm"><i class="fas fa-brain mr-2"></i>Lancer une analyse manuelle</button>';
          return;
        }

        list.innerHTML = data.patterns.map(p => {
          const statusColors = { detected: 'text-yellow-400', active: 'text-blue-400', maintenance: 'text-green-400', resolved: 'text-gray-400' };
          const statusLabels = { detected: '🔍 Détecté', active: '🎯 Actif', maintenance: '✅ Maintenance', resolved: '🏆 Résolu' };
          const evidence = JSON.parse(p.evidence || '[]');
          return '<div class="card rounded-2xl p-5">' +
            '<div class="flex items-center justify-between mb-2"><h3 class="font-semibold">' + p.pattern_name + '</h3>' +
            '<span class="text-xs ' + (statusColors[p.status] || '') + '">' + (statusLabels[p.status] || p.status) + '</span></div>' +
            '<p class="text-sm text-gray-400 mb-2">Confiance : ' + Math.round(p.confidence * 100) + '%</p>' +
            (evidence.length > 0 ? '<div class="text-xs text-gray-500">' + evidence.slice(0, 3).map(e => '• ' + e).join('<br>') + '</div>' : '') +
            '</div>';
        }).join('') +
        '<button onclick="triggerAnalysis()" class="mt-4 px-6 py-3 bg-violet-600/30 hover:bg-violet-600/50 rounded-xl font-medium transition-all text-sm"><i class="fas fa-brain mr-2"></i>Relancer l\\'analyse</button>';
      } catch(e) { console.error(e); }
    }

    async function triggerAnalysis() {
      showToast('🧠', 'Analyse en cours...');
      try {
        const res = await fetch(API + '/api/pattern/analyze', { method: 'POST', headers: headers() });
        const data = await res.json();
        if (data.error) { showToast('❌', data.error); return; }
        if (data.new_patterns.length > 0) {
          showToast('🎯', data.new_patterns.length + ' nouveau(x) pattern(s) détecté(s) !');
        } else {
          showToast('🔍', 'Pas de nouveau pattern détecté. Continue tes observations.');
        }
        loadPatterns();
        loadQuests();
      } catch(e) { showToast('❌', 'Erreur d\\'analyse'); }
    }

    // Self-declare
    async function openSelfDeclare() {
      const modal = document.getElementById('selfDeclareModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');

      try {
        const res = await fetch(API + '/api/pattern/definitions');
        const data = await res.json();
        document.getElementById('selfDeclareContent').innerHTML = data.patterns.map(p => 
          '<button onclick="selfDeclare(\\''+p.key+'\\', \\''+p.name.replace(/'/g, "\\\\'")+'\\', '+p.quests_count+')" class="w-full card rounded-xl p-4 text-left hover:border-violet-500/50 transition-all">' +
          '<h4 class="font-semibold text-sm">' + p.name + '</h4>' +
          '<p class="text-xs text-gray-400 mt-1">' + p.description + '</p>' +
          '<p class="text-xs text-violet-300 mt-2">' + p.quests_count + ' quêtes à débloquer</p></button>'
        ).join('');
      } catch(e) { console.error(e); }
    }

    function closeSelfDeclare() {
      document.getElementById('selfDeclareModal').classList.add('hidden');
      document.getElementById('selfDeclareModal').classList.remove('flex');
    }

    async function selfDeclare(key, name, count) {
      try {
        const res = await fetch(API + '/api/pattern/self-declare', {
          method: 'POST', headers: headers(),
          body: JSON.stringify({ pattern_key: key })
        });
        const data = await res.json();
        if (data.error) { showToast('⚠️', data.error); return; }
        closeSelfDeclare();
        showToast('🎯', 'Pattern "' + name + '" activé ! ' + count + ' quêtes débloquées.');
        loadPatterns();
        loadQuests();
      } catch(e) { showToast('❌', 'Erreur'); }
    }

    // ============================================
    // RITUALS
    // ============================================
    async function loadRituals() {
      try {
        const res = await fetch(API + '/api/ritual/available', { headers: headers() });
        const data = await res.json();
        const list = document.getElementById('ritualList');

        const freqEmoji = { monthly: '📅', quarterly: '🗓️', yearly: '🎆' };
        const freqLabel = { monthly: 'Mensuel', quarterly: 'Trimestriel', yearly: 'Annuel' };

        let html = '';
        if (data.available?.length > 0) {
          html += data.available.map(r => {
            const xpStr = Object.entries(r.xp).map(([k,v]) => '+' + v + ' ' + k).join(', ');
            return '<div class="card rounded-2xl p-5 cursor-pointer" onclick="startRitual(\\''+r.key+'\\', \\''+r.name.replace(/'/g, "\\\\'")+'\\', \\''+r.frequency+'\\')">'+
              '<div class="flex items-center gap-3"><div class="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center text-2xl">' + (freqEmoji[r.frequency]||'💎') + '</div>' +
              '<div class="flex-1"><h3 class="font-semibold">' + r.name + '</h3><p class="text-xs text-gray-400">' + (freqLabel[r.frequency]||'') + '</p></div>' +
              '<div class="text-xs text-violet-300">' + xpStr + '</div></div></div>';
          }).join('');
        }

        if (data.locked?.length > 0) {
          html += '<h3 class="text-sm font-semibold text-gray-500 mt-6 mb-3">🔒 Bloqués (niveau requis)</h3>';
          html += data.locked.map(r => 
            '<div class="card rounded-2xl p-5 opacity-50"><div class="flex items-center gap-3"><div class="w-12 h-12 rounded-xl bg-gray-700/50 flex items-center justify-center text-2xl">🔒</div>' +
            '<div><h3 class="font-semibold">' + r.name + '</h3><p class="text-xs text-gray-500">Niveau ' + r.min_level + ' requis</p></div></div></div>'
          ).join('');
        }

        if (!html) html = '<div class="card rounded-2xl p-8 text-center"><div class="text-4xl mb-3">🔒</div><h3 class="font-semibold mb-2">Niveau 5 requis</h3><p class="text-sm text-gray-400">Les rituels se débloquent au niveau 5.</p></div>';
        
        list.innerHTML = html;
      } catch(e) { console.error(e); }
    }

    async function startRitual(key, name, frequency) {
      showToast('💎', 'Préparation du rituel...');
      try {
        const res = await fetch(API + '/api/ritual/start', { method: 'POST', headers: headers(), body: JSON.stringify({ ritual_key: key }) });
        const data = await res.json();
        
        const modal = document.getElementById('questModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.getElementById('questTitle').innerHTML = '💎 ' + name;
        
        const prompts = data.prompts || [];
        let html = '<div class="space-y-4">';
        prompts.forEach((p, i) => {
          html += '<div><label class="block text-sm text-gray-300 mb-1">' + p + '</label>' +
            '<textarea class="ritual-response w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="3" data-prompt="' + i + '"></textarea></div>';
        });
        html += '<button onclick="submitRitual(\\''+key+'\\', \\''+name.replace(/'/g, "\\\\'")+'\\', \\''+frequency+'\\', '+JSON.stringify(JSON.stringify(prompts))+')" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-gem mr-2"></i>Terminer le rituel</button></div>';
        
        document.getElementById('questContent').innerHTML = html;
      } catch(e) { showToast('❌', 'Erreur'); }
    }

    async function submitRitual(key, name, frequency, promptsStr) {
      const content = {};
      document.querySelectorAll('.ritual-response').forEach(el => {
        content[el.dataset.prompt] = el.value;
      });
      try {
        const res = await fetch(API + '/api/ritual/complete', {
          method: 'POST', headers: headers(),
          body: JSON.stringify({ ritual_key: key, ritual_name: name, frequency, content, prompts: JSON.parse(promptsStr) })
        });
        const result = await res.json();
        if (result.error) { showToast('❌', result.error); return; }
        closeQuestModal();
        showToast('💎', 'Rituel complété ! XP massif gagné !');
        refreshProfile();
      } catch(e) { showToast('❌', 'Erreur'); }
    }

    // ============================================
    // HISTORY
    // ============================================
    async function loadHistory() {
      try {
        const res = await fetch(API + '/api/me/history?days=14', { headers: headers() });
        const data = await res.json();
        const container = document.getElementById('historyContent');

        let html = '<h3 class="font-semibold mb-3">📊 Derniers 14 jours</h3>';

        // XP timeline
        if (data.xp_history?.length > 0) {
          html += '<div class="card rounded-2xl p-5 mb-4"><h4 class="font-medium text-sm mb-3 text-violet-300">Historique XP</h4><div class="space-y-2">';
          for (const xp of data.xp_history.slice(0, 20)) {
            const total = (xp.lucidity_xp||0) + (xp.resonance_xp||0) + (xp.liberty_xp||0) + (xp.connection_xp||0) + (xp.action_xp||0);
            const date = new Date(xp.created_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
            html += '<div class="flex items-center justify-between text-xs"><span class="text-gray-400">' + date + '</span><span>' + (xp.description || xp.source_type) + '</span><span class="text-violet-300">+' + total + ' XP</span></div>';
          }
          html += '</div></div>';
        }

        // Recent captures
        if (data.captures?.length > 0) {
          html += '<div class="card rounded-2xl p-5 mb-4"><h4 class="font-medium text-sm mb-3 text-violet-300">Captures récentes</h4><div class="space-y-3">';
          for (const c of data.captures.slice(0, 10)) {
            const date = new Date(c.created_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
            html += '<div class="p-3 bg-white/5 rounded-lg"><div class="flex items-center justify-between text-xs text-gray-400 mb-1"><span>' + date + '</span><span>' + (c.emotion || '') + ' | ' + (c.category || '') + '</span></div><p class="text-sm">' + c.content + '</p></div>';
          }
          html += '</div></div>';
        }

        if (!data.xp_history?.length && !data.captures?.length) {
          html += '<p class="text-gray-500 text-sm">Aucune donnée pour l\\'instant. Commence par un check-in !</p>';
        }

        container.innerHTML = html;
      } catch(e) { console.error(e); }
    }

    // ============================================
    // UTILITIES
    // ============================================
    async function refreshProfile() {
      try {
        const res = await fetch(API + '/api/me/profile', { headers: headers() });
        if (res.ok) {
          userData = await res.json();
          renderDashboard();
        }
      } catch(e) {}
    }

    function showToast(icon, msg) {
      const toast = document.getElementById('toast');
      document.getElementById('toastIcon').textContent = icon;
      document.getElementById('toastMsg').textContent = msg;
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 4000);
    }

    function logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/';
    }

    // Start
    init();
  </script>
</body>
</html>`;
}
