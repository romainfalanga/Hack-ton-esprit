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

  // Create 3 default system micro-habits
  const defaultHabits = [
    { name: 'Videographie hebdomadaire', description: 'Enregistrer un resume video/texte de ta semaine chaque weekend', category: 'fondateur', frequency: 'weekly' },
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
app.use('/api/video/*', authMiddleware);
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
  const videos = await db.prepare('SELECT ai_summary, ai_key_themes, ai_emotions_detected FROM videographies WHERE user_id = ? AND processed = 1 ORDER BY created_at DESC LIMIT 10').bind(user.id).all();

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

RESUMES VIDEO HEBDO :
${JSON.stringify(videos.results || [], null, 2)}

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
// MODULE 5 — VIDEOGRAPHIE (text-based MVP)
// ============================================
app.post('/api/video/submit', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const apiKey = c.env.OPENROUTER_API_KEY;
  const { title, text_summary } = await c.req.json();

  if (!text_summary) return c.json({ error: 'Resume requis' }, 400);

  const now = new Date();
  const weekNumber = getWeekNumber();
  const year = now.getFullYear();

  const result = await db.prepare(
    'INSERT INTO videographies (user_id, title, transcript, week_number, year) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, title || `Semaine ${weekNumber}`, text_summary, weekNumber, year).run();

  const videoId = result.meta.last_row_id as number;

  // AI analysis of the summary
  if (apiKey) {
    try {
      const prompt = `Analyse ce resume hebdomadaire d'un utilisateur dans une application de developpement personnel.

RESUME DE LA SEMAINE :
"${text_summary}"

Reponds en JSON:
{
  "summary": "Resume structure (3-4 phrases)",
  "key_themes": ["theme1", "theme2", "theme3"],
  "emotions_detected": [{"emotion": "nom", "intensity": 7}],
  "life_events_extracted": [{"title": "titre court", "description": "description", "valence": "positive|negative|mixed", "life_domain": "famille|travail|sante|relation|identite|quotidien", "intensity": 7}],
  "patterns_observed": ["observation1", "observation2"],
  "growth_signals": ["signal positif 1"]
}`;

      const response = await callAI(apiKey, {
        messages: [{ role: 'user', content: prompt }],
        model: 'google/gemini-2.0-flash-001',
        temperature: 0.3,
        max_tokens: 2000,
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);

        await db.prepare(
          'UPDATE videographies SET ai_summary = ?, ai_key_themes = ?, ai_emotions_detected = ?, ai_life_events_extracted = ?, processed = 1 WHERE id = ?'
        ).bind(
          analysis.summary,
          JSON.stringify(analysis.key_themes || []),
          JSON.stringify(analysis.emotions_detected || []),
          JSON.stringify(analysis.life_events_extracted || []),
          videoId
        ).run();

        // Auto-create life events from video
        for (const evt of (analysis.life_events_extracted || [])) {
          const evtResult = await db.prepare(
            'INSERT INTO life_events (user_id, title, description, global_intensity, valence, life_domain, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(user.id, evt.title, evt.description || null, evt.intensity || 5, evt.valence || 'mixed', evt.life_domain || 'quotidien', 'video', videoId).run();

          // Add detected emotions
          for (const emo of (analysis.emotions_detected || []).slice(0, 3)) {
            await db.prepare('INSERT INTO life_event_emotions (event_id, emotion, intensity) VALUES (?, ?, ?)').bind(evtResult.meta.last_row_id, emo.emotion, emo.intensity || 5).run();
          }
        }

        // Award XP
        const xp = await awardXP(db, user.id, { resonance: 25, lucidity: 15, action: 10 }, 'videography', videoId, `Videographie semaine ${weekNumber}`);

        return c.json({ success: true, id: videoId, analysis, xp, life_events_created: (analysis.life_events_extracted || []).length });
      }
    } catch (e: any) {
      // Fallback: still save without AI
    }
  }

  // No AI fallback
  await db.prepare('UPDATE videographies SET ai_summary = ?, processed = 1 WHERE id = ?').bind(text_summary, videoId).run();
  const xp = await awardXP(db, user.id, { resonance: 15, action: 5 }, 'videography', videoId, `Videographie semaine ${weekNumber}`);

  return c.json({ success: true, id: videoId, xp });
});

app.get('/api/video/list', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const videos = await db.prepare('SELECT * FROM videographies WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
  return c.json({ videos: videos.results || [] });
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
// HTML — APP DASHBOARD
// ============================================
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
    body{font-family:'Inter',sans-serif}
    .gradient-bg{background:linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)}
    .glow{text-shadow:0 0 20px rgba(139,92,246,.5)}
    .card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}
    .card:hover{background:rgba(255,255,255,.08);border-color:rgba(139,92,246,.3)}
    .card-glow{box-shadow:0 0 30px rgba(139,92,246,.1)}
    .capture-btn{position:fixed;bottom:24px;right:24px;z-index:40;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);box-shadow:0 4px 20px rgba(139,92,246,.4);transition:all .3s}
    .capture-btn:hover{transform:scale(1.1)}
    .stat-bar{height:8px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden}
    .stat-fill{height:100%;border-radius:4px;transition:width 1s ease-out}
    .tab-active{border-bottom:2px solid #8b5cf6;color:#c4b5fd}
    .modal-overlay{background:rgba(0,0,0,.8);backdrop-filter:blur(8px)}
    .toast{animation:slideUp .3s ease-out}
    @keyframes slideUp{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}
    .emotion-chip{cursor:pointer;transition:all .2s}
    .emotion-chip:hover{transform:scale(1.05)}
    .emotion-chip.selected{background:rgba(139,92,246,.3);border-color:#8b5cf6}
    .fade-in{animation:fadeIn .5s ease-out}
    @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    .timeline-line{position:absolute;left:50%;width:2px;background:rgba(139,92,246,.3);top:0;bottom:0;transform:translateX(-50%)}
    .intensity-dot{width:12px;height:12px;border-radius:50%;display:inline-block}
  </style>
</head>
<body class="gradient-bg min-h-screen text-white">
  <nav class="sticky top-0 z-30 bg-gray-900/80 backdrop-blur-md border-b border-white/10">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3"><span class="text-2xl">&#129504;</span><span class="font-bold text-lg hidden sm:block">Hack Ton Esprit</span></div>
      <div class="flex items-center gap-4">
        <div id="streakBadge" class="flex items-center gap-1 px-3 py-1 bg-orange-500/20 rounded-full text-orange-300 text-sm"><i class="fas fa-fire"></i><span id="streakCount">0</span></div>
        <div id="levelBadge" class="flex items-center gap-1 px-3 py-1 bg-violet-500/20 rounded-full text-violet-300 text-sm"><i class="fas fa-star"></i><span id="globalLevel">Nv. 1</span></div>
        <button onclick="logout()" class="text-gray-400 hover:text-white" title="Deconnexion"><i class="fas fa-sign-out-alt"></i></button>
      </div>
    </div>
  </nav>

  <div class="max-w-6xl mx-auto px-4">
    <div class="flex gap-1 overflow-x-auto py-3 border-b border-white/10 text-sm" id="tabBar">
      <button onclick="showTab('dashboard')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="dashboard"><i class="fas fa-home mr-1"></i>Accueil</button>
      <button onclick="showTab('morning')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="morning"><i class="fas fa-sun mr-1"></i>Matin</button>
      <button onclick="showTab('evening')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="evening"><i class="fas fa-moon mr-1"></i>Soir</button>
      <button onclick="showTab('lifeline')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="lifeline"><i class="fas fa-timeline mr-1"></i>Ligne de vie</button>
      <button onclick="showTab('habits')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="habits"><i class="fas fa-list-check mr-1"></i>Habitudes</button>
      <button onclick="showTab('weekly')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="weekly"><i class="fas fa-calendar-week mr-1"></i>Hebdo</button>
      <button onclick="showTab('video')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="video"><i class="fas fa-video mr-1"></i>Video</button>
      <button onclick="showTab('psych')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="psych"><i class="fas fa-user-doctor mr-1"></i>Profil Psy</button>
      <button onclick="showTab('thoughttree')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="thoughttree"><i class="fas fa-sitemap mr-1"></i>Arbre</button>
      <button onclick="showTab('patterns')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="patterns"><i class="fas fa-brain mr-1"></i>Patterns</button>
      <button onclick="showTab('quests')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="quests"><i class="fas fa-scroll mr-1"></i>Quetes</button>
      <button onclick="showTab('rituals')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="rituals"><i class="fas fa-gem mr-1"></i>Rituels</button>
      <button onclick="showTab('history')" class="tab-btn px-3 py-2 rounded-lg whitespace-nowrap text-gray-400 hover:text-white transition-all" data-tab="history"><i class="fas fa-chart-line mr-1"></i>Stats</button>
    </div>
  </div>

  <main class="max-w-6xl mx-auto px-4 py-6 pb-24">
` + getDashboardTab() + getMorningTab() + getEveningTab() + getLifelineTab() + getHabitsTab() + getWeeklyTab() + getVideoTab() + getPsychTab() + getThoughtTreeTab() + getPatternsTab() + getQuestsTab() + getRitualsTab() + getHistoryTab() + `
  </main>

  <button onclick="openCapture()" class="capture-btn flex items-center justify-center text-white text-2xl" title="Capture instantanee"><i class="fas fa-bolt"></i></button>

  <!-- Modals -->
  <div id="captureModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-violet-500/30">
      <div class="flex items-center justify-between mb-4"><h3 class="text-lg font-bold text-violet-300"><i class="fas fa-bolt mr-2"></i>Capture</h3><button onclick="closeCapture()" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button></div>
      <textarea id="captureContent" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none resize-none" rows="4" placeholder="Ce qui se passe en moi..."></textarea>
      <div class="flex items-center gap-3 mt-3 mb-4"><label class="text-sm text-gray-400">Intensite:</label><input type="range" id="captureIntensity" min="1" max="10" value="5" class="flex-1 accent-violet-500" oninput="document.getElementById('captureIntVal').textContent=this.value"><span id="captureIntVal" class="text-violet-400 text-sm">5</span></div>
      <button onclick="submitCapture()" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-bolt mr-2"></i>Capturer</button>
    </div>
  </div>

  <div id="weeklyModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-start justify-center p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-lg border border-violet-500/30 my-8">
      <div class="flex items-center justify-between mb-4"><h3 class="text-lg font-bold text-violet-300" id="weeklyTitle"></h3><button onclick="closeWeeklyModal()" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button></div>
      <div id="weeklyContent"></div>
    </div>
  </div>

  <div id="questModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-start justify-center p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-lg border border-violet-500/30 my-8">
      <div class="flex items-center justify-between mb-4"><h3 class="text-lg font-bold text-violet-300" id="questTitle"></h3><button onclick="closeQuestModal()" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button></div>
      <div id="questContent"></div>
    </div>
  </div>

  <div id="selfDeclareModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-start justify-center p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-lg border border-violet-500/30 my-8">
      <div class="flex items-center justify-between mb-4"><h3 class="text-lg font-bold text-violet-300"><i class="fas fa-hand-point-up mr-2"></i>Autodeclarer un pattern</h3><button onclick="closeSelfDeclare()" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button></div>
      <div id="selfDeclareContent" class="space-y-3"></div>
    </div>
  </div>

  <div id="lifeEventModal" class="fixed inset-0 modal-overlay hidden z-50 flex items-start justify-center p-4 overflow-y-auto">
    <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-lg border border-violet-500/30 my-8">
      <div class="flex items-center justify-between mb-4"><h3 class="text-lg font-bold text-violet-300" id="lifeEventTitle"><i class="fas fa-timeline mr-2"></i>Evenement de vie</h3><button onclick="closeLifeEventModal()" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button></div>
      <div id="lifeEventContent"></div>
    </div>
  </div>

  <div id="toast" class="fixed bottom-24 left-1/2 transform -translate-x-1/2 hidden z-50">
    <div class="toast bg-gray-900 border border-violet-500/30 rounded-xl px-6 py-3 flex items-center gap-3 shadow-2xl"><span id="toastIcon" class="text-xl"></span><span id="toastMsg" class="text-sm"></span></div>
  </div>

  <script>
` + getAppJS() + `
  </script>
</body>
</html>`;
}

// ============================================
// TAB FRAGMENTS
// ============================================
function getDashboardTab(): string {
  return `<div id="tab-dashboard" class="tab-content fade-in">
  <div class="mb-6"><h2 class="text-2xl font-bold mb-1">Bonjour, <span id="userName"></span> &#128075;</h2><p class="text-gray-400" id="awakeningTitle"></p></div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
    <div id="morningCard" class="card rounded-2xl p-5 cursor-pointer transition-all" onclick="showTab('morning')"><div class="flex items-center gap-3 mb-3"><div class="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center"><i class="fas fa-sun text-amber-400"></i></div><div><h3 class="font-semibold">Check-in matin</h3><p class="text-xs text-gray-400" id="morningStatus">En attente...</p></div></div><div class="text-xs text-violet-300">+5 XP Resonance</div></div>
    <div id="eveningCard" class="card rounded-2xl p-5 cursor-pointer transition-all" onclick="showTab('evening')"><div class="flex items-center gap-3 mb-3"><div class="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center"><i class="fas fa-moon text-indigo-400"></i></div><div><h3 class="font-semibold">Scan du soir</h3><p class="text-xs text-gray-400" id="eveningStatus">En attente...</p></div></div><div class="text-xs text-violet-300">+5 a +15 XP</div></div>
    <div class="card rounded-2xl p-5 cursor-pointer transition-all" onclick="openCapture()"><div class="flex items-center gap-3 mb-3"><div class="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center"><i class="fas fa-bolt text-purple-400"></i></div><div><h3 class="font-semibold">Capture instantanee</h3><p class="text-xs text-gray-400" id="captureCount">0 captures</p></div></div><div class="text-xs text-violet-300">+2 XP Lucidite</div></div>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
    <div class="card rounded-2xl p-5 cursor-pointer" onclick="showTab('lifeline')"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center"><i class="fas fa-timeline text-cyan-400"></i></div><div><h3 class="font-semibold">Ligne de vie</h3><p class="text-xs text-gray-400"><span id="lifeEventsCount">0</span> evenements</p></div><div class="text-xs text-violet-300 ml-auto">+10 XP</div></div></div>
    <div class="card rounded-2xl p-5 cursor-pointer" onclick="showTab('habits')"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center"><i class="fas fa-list-check text-emerald-400"></i></div><div><h3 class="font-semibold">Micro-habitudes</h3><p class="text-xs text-gray-400"><span id="habitsCount">0</span> actives</p></div><div class="text-xs text-violet-300 ml-auto">+3 XP/jour</div></div></div>
  </div>
  <h3 class="text-lg font-bold mb-4"><i class="fas fa-chart-bar mr-2 text-violet-400"></i>Stats</h3>
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-8" id="statsGrid"></div>
</div>`;
}

function getMorningTab(): string {
  return `<div id="tab-morning" class="tab-content hidden fade-in"><div class="max-w-2xl mx-auto">
  <h2 class="text-2xl font-bold mb-2"><i class="fas fa-sun text-amber-400 mr-2"></i>Check-in du matin</h2><p class="text-gray-400 mb-6">Comment te sens-tu ? (2 min)</p>
  <div id="morningForm">
    <div class="mb-6"><label class="block text-sm font-medium text-gray-300 mb-3">Comment te sens-tu ?</label><div id="emotionWheel" class="space-y-3"></div><input type="hidden" id="selectedEmotion" value=""></div>
    <div class="mb-6"><label class="block text-sm font-medium text-gray-300 mb-2">Precise (facultatif)</label><textarea id="emotionDetail" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Pourquoi tu te sens comme ca..."></textarea></div>
    <div class="mb-6"><label class="block text-sm font-medium text-gray-300 mb-2">Energie: <span id="energyValue" class="text-violet-400">5</span>/10</label><input type="range" id="energyLevel" min="1" max="10" value="5" class="w-full accent-violet-500" oninput="document.getElementById('energyValue').textContent=this.value"></div>
    <div class="mb-6"><label class="block text-sm font-medium text-gray-300 mb-2">Intention du jour</label><input type="text" id="intention" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none" placeholder="patience, avancer, ecouter..."></div>
    <button onclick="submitMorningCheckin()" class="w-full py-4 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold text-lg transition-all"><i class="fas fa-check mr-2"></i>Valider</button>
  </div>
  <div id="morningDone" class="hidden text-center py-12"><div class="text-6xl mb-4">&#9989;</div><h3 class="text-2xl font-bold text-green-400 mb-2">Check-in enregistre !</h3><p class="text-gray-400">+5 XP Resonance</p></div>
</div></div>`;
}

function getEveningTab(): string {
  return `<div id="tab-evening" class="tab-content hidden fade-in"><div class="max-w-2xl mx-auto">
  <h2 class="text-2xl font-bold mb-2"><i class="fas fa-moon text-indigo-400 mr-2"></i>Scan du soir</h2><p class="text-gray-400 mb-6">3 micro-exercices, fais-en au moins 1 (5 min)</p>
  <div id="eveningForm">
    <div class="card rounded-2xl p-5 mb-4"><h3 class="font-semibold mb-3"><i class="fas fa-trophy text-amber-400 mr-2"></i>3 micro-victoires</h3><input type="text" id="victory1" class="w-full px-4 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Victoire 1..."><input type="text" id="victory2" class="w-full px-4 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Victoire 2..."><input type="text" id="victory3" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Victoire 3..."></div>
    <div class="card rounded-2xl p-5 mb-4"><h3 class="font-semibold mb-3"><i class="fas fa-eye text-green-400 mr-2"></i>1 gratitude invisible</h3><textarea id="gratitude" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Ce dont je suis reconnaissant(e)..."></textarea></div>
    <div class="card rounded-2xl p-5 mb-6"><h3 class="font-semibold mb-3"><i class="fas fa-heart text-red-400 mr-2"></i>1 emotion forte</h3><input type="text" id="strongEmotion" class="w-full px-4 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="L'emotion..."><textarea id="emotionTrigger" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Son declencheur..."></textarea></div>
    <button onclick="submitEveningCheckin()" class="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-lg transition-all"><i class="fas fa-moon mr-2"></i>Enregistrer</button>
  </div>
  <div id="eveningDone" class="hidden text-center py-12"><div class="text-6xl mb-4">&#127769;</div><h3 class="text-2xl font-bold text-indigo-400 mb-2">Scan enregistre !</h3><p class="text-gray-400">Bonne nuit.</p></div>
</div></div>`;
}

function getLifelineTab(): string {
  return `<div id="tab-lifeline" class="tab-content hidden fade-in"><div class="max-w-3xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div><h2 class="text-2xl font-bold"><i class="fas fa-timeline text-cyan-400 mr-2"></i>Ligne de vie</h2><p class="text-gray-400 text-sm">Tes evenements majeurs</p></div>
    <button onclick="openLifeEventForm()" class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-medium text-sm transition-all"><i class="fas fa-plus mr-1"></i>Ajouter</button>
  </div>
  <div id="onboardingPrompt" class="hidden card rounded-2xl p-6 mb-6 border-cyan-500/30">
    <h3 class="font-bold text-cyan-300 mb-2"><i class="fas fa-info-circle mr-2"></i>Commence par 10 evenements</h3>
    <p class="text-sm text-gray-400 mb-3">Pour construire ta ligne de vie, ajoute les 10 evenements les plus importants de ta vie. Bonus XP au 10eme !</p>
    <div class="flex items-center gap-2"><div class="stat-bar flex-1"><div id="onboardingProgress" class="stat-fill bg-cyan-500" style="width:0%"></div></div><span id="onboardingCount" class="text-sm text-cyan-300">0/10</span></div>
  </div>
  <div id="lifelineContent" class="space-y-4"></div>
</div></div>`;
}

function getHabitsTab(): string {
  return `<div id="tab-habits" class="tab-content hidden fade-in"><div class="max-w-2xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div><h2 class="text-2xl font-bold"><i class="fas fa-list-check text-emerald-400 mr-2"></i>Micro-habitudes</h2><p class="text-gray-400 text-sm">Accumule des habitudes, une par semaine</p></div>
    <button onclick="openAddHabit()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-medium text-sm transition-all"><i class="fas fa-plus mr-1"></i>Nouvelle</button>
  </div>
  <div id="habitsContent" class="space-y-3"></div>
  <div id="addHabitForm" class="hidden card rounded-2xl p-5 mt-4">
    <h3 class="font-semibold mb-3">Nouvelle micro-habitude</h3>
    <input type="text" id="newHabitName" class="w-full px-4 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Nom de l'habitude">
    <textarea id="newHabitDesc" class="w-full px-4 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" placeholder="Description (optionnel)"></textarea>
    <select id="newHabitFreq" class="w-full px-4 py-2 mb-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"><option value="daily">Quotidienne</option><option value="weekly">Hebdomadaire</option></select>
    <button onclick="submitNewHabit()" class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-bold text-sm transition-all">Ajouter</button>
  </div>
</div></div>`;
}

function getWeeklyTab(): string {
  return `<div id="tab-weekly" class="tab-content hidden fade-in"><div class="max-w-2xl mx-auto">
  <h2 class="text-2xl font-bold mb-6"><i class="fas fa-calendar-week text-violet-400 mr-2"></i>Exercices hebdomadaires</h2>
  <div class="space-y-4">
    <div class="card rounded-2xl p-5 cursor-pointer" onclick="openWeeklyExercise('decontamination')"><div class="flex items-center gap-3"><div class="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center text-2xl">&#129529;</div><div class="flex-1"><h3 class="font-semibold">La Decontamination</h3><p class="text-sm text-gray-400">15 min</p></div><div class="text-xs text-violet-300">+30 XP</div></div></div>
    <div class="card rounded-2xl p-5 cursor-pointer" onclick="openWeeklyExercise('influence')"><div class="flex items-center gap-3"><div class="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-2xl">&#127919;</div><div class="flex-1"><h3 class="font-semibold">Cercle d'influence</h3><p class="text-sm text-gray-400">10 min</p></div><div class="text-xs text-violet-300">+25 XP</div></div></div>
    <div class="card rounded-2xl p-5 cursor-pointer" onclick="openWeeklyExercise('worry')"><div class="flex items-center gap-3"><div class="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center text-2xl">&#128230;</div><div class="flex-1"><h3 class="font-semibold">Boite a soucis</h3><p class="text-sm text-gray-400">10 min</p></div><div class="text-xs text-violet-300">+25 XP</div></div></div>
  </div>
</div></div>`;
}

function getVideoTab(): string {
  return `<div id="tab-video" class="tab-content hidden fade-in"><div class="max-w-2xl mx-auto">
  <h2 class="text-2xl font-bold mb-2"><i class="fas fa-video text-rose-400 mr-2"></i>Videographie hebdo</h2>
  <p class="text-gray-400 mb-6 text-sm">Chaque weekend, resume ta semaine. L'IA analysera et extraira des evenements de vie.</p>
  <div class="card rounded-2xl p-5 mb-6">
    <h3 class="font-semibold mb-3">Resume de la semaine</h3>
    <input type="text" id="videoTitle" class="w-full px-4 py-2 mb-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Titre (optionnel)">
    <textarea id="videoSummary" class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-violet-500 focus:outline-none resize-none" rows="8" placeholder="Raconte ta semaine... les moments forts, les emotions, les surprises, les difficultes..."></textarea>
    <button onclick="submitVideo()" class="w-full mt-3 py-3 bg-rose-600 hover:bg-rose-500 rounded-xl font-bold transition-all"><i class="fas fa-paper-plane mr-2"></i>Envoyer (+25 XP)</button>
  </div>
  <h3 class="font-semibold mb-3">Historique</h3>
  <div id="videoList" class="space-y-3"><p class="text-gray-500 text-sm">Aucune videographie encore.</p></div>
</div></div>`;
}

function getPsychTab(): string {
  return `<div id="tab-psych" class="tab-content hidden fade-in"><div class="max-w-3xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div><h2 class="text-2xl font-bold"><i class="fas fa-user-doctor text-pink-400 mr-2"></i>Profil Psychologique</h2><p class="text-gray-400 text-sm">Analyse IA de ta personnalite</p></div>
    <button onclick="generatePsychProfile()" class="px-4 py-2 bg-pink-600 hover:bg-pink-500 rounded-xl font-medium text-sm transition-all" id="generatePsychBtn"><i class="fas fa-brain mr-1"></i>Generer / Mettre a jour</button>
  </div>
  <div id="psychSummary" class="hidden card rounded-2xl p-5 mb-6 border-pink-500/20"></div>
  <div id="psychTraits" class="space-y-3"><p class="text-gray-500 text-sm">Aucun profil genere. Ajoute des donnees (ligne de vie, check-ins, captures) puis genere ton profil.</p></div>
</div></div>`;
}

function getThoughtTreeTab(): string {
  return `<div id="tab-thoughttree" class="tab-content hidden fade-in"><div class="max-w-3xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div><h2 class="text-2xl font-bold"><i class="fas fa-sitemap text-teal-400 mr-2"></i>Arbre des Pensees</h2><p class="text-gray-400 text-sm">Organisation de tes reflexions par branches</p></div>
    <button onclick="categorizeThoughts()" class="px-4 py-2 bg-teal-600 hover:bg-teal-500 rounded-xl font-medium text-sm transition-all"><i class="fas fa-wand-magic-sparkles mr-1"></i>Categoriser</button>
  </div>
  <div id="thoughtBranches" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6"></div>
  <h3 class="font-semibold mb-3">Pensees recentes</h3>
  <div id="thoughtEntries" class="space-y-3"><p class="text-gray-500 text-sm">Aucune pensee categorisee. Clique sur "Categoriser" pour analyser tes captures et check-ins.</p></div>
</div></div>`;
}

function getPatternsTab(): string {
  return `<div id="tab-patterns" class="tab-content hidden fade-in"><div class="max-w-2xl mx-auto">
  <h2 class="text-2xl font-bold mb-2"><i class="fas fa-brain text-violet-400 mr-2"></i>Patterns</h2><p class="text-gray-400 mb-6">Schemas detectes</p>
  <div id="patternList" class="space-y-4 mb-8"><p class="text-gray-500 text-sm">Aucun pattern detecte.</p></div>
  <div class="border-t border-white/10 pt-6">
    <h3 class="font-semibold mb-3">Autodeclarer un pattern</h3>
    <button onclick="openSelfDeclare()" class="px-6 py-3 bg-violet-600/50 hover:bg-violet-600 rounded-xl font-medium transition-all text-sm"><i class="fas fa-hand-point-up mr-2"></i>Je me reconnais</button>
  </div>
</div></div>`;
}

function getQuestsTab(): string {
  return `<div id="tab-quests" class="tab-content hidden fade-in"><div class="max-w-2xl mx-auto">
  <h2 class="text-2xl font-bold mb-2"><i class="fas fa-scroll text-violet-400 mr-2"></i>Quetes</h2><p class="text-gray-400 mb-6">Basees sur tes patterns</p>
  <div id="questList" class="space-y-4"><div class="card rounded-2xl p-8 text-center"><div class="text-4xl mb-3">&#128302;</div><h3 class="font-semibold mb-2">Les quetes emergent de tes donnees</h3><p class="text-sm text-gray-400">Continue tes check-ins.</p></div></div>
</div></div>`;
}

function getRitualsTab(): string {
  return `<div id="tab-rituals" class="tab-content hidden fade-in"><div class="max-w-2xl mx-auto">
  <h2 class="text-2xl font-bold mb-2"><i class="fas fa-gem text-violet-400 mr-2"></i>Rituels</h2><p class="text-gray-400 mb-6">Introspections periodiques</p>
  <div id="ritualList" class="space-y-4"><div class="card rounded-2xl p-8 text-center"><div class="text-4xl mb-3">&#128274;</div><h3 class="font-semibold mb-2">Niveau 5 requis</h3><p class="text-sm text-gray-400">Continue a travailler tes patterns.</p></div></div>
</div></div>`;
}

function getHistoryTab(): string {
  return `<div id="tab-history" class="tab-content hidden fade-in"><div class="max-w-2xl mx-auto">
  <h2 class="text-2xl font-bold mb-6"><i class="fas fa-chart-line text-violet-400 mr-2"></i>Historique</h2>
  <div id="historyContent" class="space-y-4"><p class="text-gray-500 text-sm">Chargement...</p></div>
</div></div>`;
}

// ============================================
// APP JAVASCRIPT
// ============================================
function getAppJS(): string {
  return `
const API='';let token=localStorage.getItem('token');let userData=null;let emotions={};
if(!token)window.location.href='/';
const headers=()=>({'Content-Type':'application/json','Authorization':'Bearer '+token});

async function init(){try{
  await fetch(API+'/api/init-db');
  const r=await fetch(API+'/api/me/profile',{headers:headers()});
  if(!r.ok){logout();return}
  userData=await r.json();
  const er=await fetch(API+'/api/emotions');
  emotions=(await er.json()).emotions;
  renderDashboard();renderEmotionWheel();showTab('dashboard');
}catch(e){console.error('Init:',e)}}

function showTab(t){
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el=>{el.classList.remove('tab-active');el.classList.add('text-gray-400')});
  const te=document.getElementById('tab-'+t);if(te)te.classList.remove('hidden');
  const btn=document.querySelector('[data-tab="'+t+'"]');if(btn){btn.classList.add('tab-active');btn.classList.remove('text-gray-400')}
  if(t==='quests')loadQuests();if(t==='patterns')loadPatterns();if(t==='rituals')loadRituals();if(t==='history')loadHistory();
  if(t==='lifeline')loadLifeline();if(t==='habits')loadHabits();if(t==='video')loadVideos();
  if(t==='psych')loadPsychProfile();if(t==='thoughttree')loadThoughtTree();
}

function renderDashboard(){
  if(!userData)return;const u=userData.user;const s=userData.stats;
  document.getElementById('userName').textContent=u.display_name||u.username;
  document.getElementById('streakCount').textContent=u.current_streak||0;
  document.getElementById('globalLevel').textContent='Nv. '+(s?.global_level||1);
  const aw=userData.awakening_names||[];document.getElementById('awakeningTitle').textContent=aw[(s?.global_level||1)-1]||'';
  document.getElementById('morningStatus').textContent=userData.today.morning_done?'\\u2705 Complete':'\\u23F3 En attente';
  document.getElementById('eveningStatus').textContent=userData.today.evening_done?'\\u2705 Complete':'\\u23F3 En attente';
  if(userData.today.morning_done)document.getElementById('morningCard').style.borderColor='rgba(34,197,94,.3)';
  if(userData.today.evening_done)document.getElementById('eveningCard').style.borderColor='rgba(34,197,94,.3)';
  document.getElementById('lifeEventsCount').textContent=userData.counts.life_events||0;
  document.getElementById('habitsCount').textContent=userData.counts.active_habits||0;
  const sc=[{key:'lucidity',icon:'\\u{1F9E0}',color:'bg-blue-500',label:'Lucidite'},{key:'resonance',icon:'\\u{1F49A}',color:'bg-green-500',label:'Resonance'},{key:'liberty',icon:'\\u{1F513}',color:'bg-yellow-500',label:'Liberte'},{key:'connection',icon:'\\u{1F5E3}\\uFE0F',color:'bg-pink-500',label:'Connexion'},{key:'action',icon:'\\u26A1',color:'bg-orange-500',label:'Action'}];
  const th=userData.level_thresholds||[0,100,300,600,1000,1500,2200,3000,4000,5500];const ln=userData.level_names||{};
  let h='';for(const st of sc){const xp=s?.[st.key+'_xp']||0;const lv=s?.[st.key+'_level']||1;const nm=(ln[st.key]||[])[lv-1]||'';const nt=th[lv]||th[th.length-1];const pt=th[lv-1]||0;const pr=nt>pt?((xp-pt)/(nt-pt))*100:100;
    h+='<div class="card rounded-xl p-4"><div class="flex items-center gap-2 mb-2"><span class="text-xl">'+st.icon+'</span><div><div class="font-semibold text-sm">'+st.label+'</div><div class="text-xs text-gray-400">'+nm+' (Nv.'+lv+')</div></div></div><div class="stat-bar"><div class="stat-fill '+st.color+'" style="width:'+Math.min(pr,100)+'%"></div></div><div class="text-xs text-gray-500 mt-1">'+xp+' / '+nt+' XP</div></div>'}
  document.getElementById('statsGrid').innerHTML=h;
  if(userData.today.morning_done){document.getElementById('morningForm')?.classList.add('hidden');document.getElementById('morningDone')?.classList.remove('hidden')}
  if(userData.today.evening_done){document.getElementById('eveningForm')?.classList.add('hidden');document.getElementById('eveningDone')?.classList.remove('hidden')}
}

function renderEmotionWheel(){
  const ce={joy:'\\u{1F60A}',sadness:'\\u{1F622}',anger:'\\u{1F620}',fear:'\\u{1F630}',surprise:'\\u{1F632}',disgust:'\\u{1F922}',neutral:'\\u{1F610}'};
  const cn={joy:'Joie',sadness:'Tristesse',anger:'Colere',fear:'Peur',surprise:'Surprise',disgust:'Degout',neutral:'Neutre'};
  let h='';for(const[cat,emos]of Object.entries(emotions)){h+='<div class="mb-3"><div class="flex items-center gap-2 mb-2"><span>'+(ce[cat]||'')+'</span><span class="text-xs font-medium text-gray-300">'+(cn[cat]||cat)+'</span></div><div class="flex flex-wrap gap-2">';
    for(const em of emos){h+='<button type="button" class="emotion-chip px-3 py-1.5 rounded-full text-xs bg-white/5 border border-white/10 hover:border-violet-500/50" onclick="selectEmotion(this,\\''+em+'\\')">'+em+'</button>'}h+='</div></div>'}
  document.getElementById('emotionWheel').innerHTML=h}
function selectEmotion(el,e){document.querySelectorAll('.emotion-chip').forEach(x=>x.classList.remove('selected','bg-violet-500/30','border-violet-500'));el.classList.add('selected','bg-violet-500/30','border-violet-500');document.getElementById('selectedEmotion').value=e}

async function submitMorningCheckin(){
  const em=document.getElementById('selectedEmotion').value;if(!em){showToast('\\u26A0','Choisis une emotion');return}
  try{const r=await fetch(API+'/api/checkin/morning',{method:'POST',headers:headers(),body:JSON.stringify({emotion:em,emotion_detail:document.getElementById('emotionDetail').value,energy_level:parseInt(document.getElementById('energyLevel').value),intention:document.getElementById('intention').value})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}document.getElementById('morningForm').classList.add('hidden');document.getElementById('morningDone').classList.remove('hidden');showToast('\\u2728','+5 XP Resonance ! Streak: '+(d.streak?.current_streak||1));refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

async function submitEveningCheckin(){
  const v=[document.getElementById('victory1').value,document.getElementById('victory2').value,document.getElementById('victory3').value].filter(x=>x.trim());
  const g=document.getElementById('gratitude').value;const se=document.getElementById('strongEmotion').value;const tr=document.getElementById('emotionTrigger').value;
  if(!v.length&&!g&&!se){showToast('\\u26A0','Complete au moins un exercice');return}
  try{const r=await fetch(API+'/api/checkin/evening',{method:'POST',headers:headers(),body:JSON.stringify({micro_victories:JSON.stringify(v),invisible_gratitude:g,strong_emotion:se,strong_emotion_trigger:tr})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}document.getElementById('eveningForm').classList.add('hidden');document.getElementById('eveningDone').classList.remove('hidden');showToast('\\u{1F319}','Scan enregistre ! +'+(d.exercises_completed*5)+' XP');refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

function openCapture(){document.getElementById('captureModal').classList.remove('hidden');document.getElementById('captureModal').classList.add('flex');document.getElementById('captureContent').focus()}
function closeCapture(){document.getElementById('captureModal').classList.add('hidden');document.getElementById('captureModal').classList.remove('flex')}
async function submitCapture(){
  const c=document.getElementById('captureContent').value;if(!c.trim()){showToast('\\u26A0','Ecris quelque chose');return}
  try{const r=await fetch(API+'/api/capture/new',{method:'POST',headers:headers(),body:JSON.stringify({content:c,intensity:parseInt(document.getElementById('captureIntensity').value)})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}document.getElementById('captureContent').value='';closeCapture();showToast('\\u26A1','+2 XP Lucidite'+(d.analysis?.emotion?' | '+d.analysis.emotion:''));refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === LIFELINE ===
async function loadLifeline(){
  try{const r=await fetch(API+'/api/lifeline/events',{headers:headers()});const d=await r.json();const evts=d.events||[];
  const op=document.getElementById('onboardingPrompt');const cnt=evts.length;
  if(cnt<10){op.classList.remove('hidden');document.getElementById('onboardingProgress').style.width=(cnt*10)+'%';document.getElementById('onboardingCount').textContent=cnt+'/10'}else{op.classList.add('hidden')}
  const el=document.getElementById('lifelineContent');
  if(!evts.length){el.innerHTML='<p class="text-gray-500 text-sm text-center py-8">Aucun evenement. Commence par ajouter les 10 moments les plus importants de ta vie.</p>';return}
  el.innerHTML=evts.map(e=>{const emos=(e.emotions||[]).map(em=>'<span class="px-2 py-0.5 rounded-full text-xs bg-violet-500/20 text-violet-300">'+em.emotion+' ('+em.intensity+'/10)</span>').join(' ');
    const valColor=e.valence==='positive'?'text-green-400':e.valence==='negative'?'text-red-400':'text-yellow-400';
    return '<div class="card rounded-2xl p-5"><div class="flex items-center justify-between mb-2"><h3 class="font-semibold">'+e.title+'</h3><div class="flex items-center gap-2"><span class="text-xs '+valColor+'">'+(e.valence||'mixed')+'</span><span class="text-xs text-gray-500">'+(e.age_at_event?e.age_at_event+' ans':'')+'</span></div></div>'+(e.description?'<p class="text-sm text-gray-400 mb-2">'+e.description+'</p>':'')+'<div class="flex items-center gap-2 mb-2"><span class="text-xs text-gray-500">Intensite: '+e.global_intensity+'/10</span><span class="text-xs text-gray-500">|</span><span class="text-xs text-gray-500">'+(e.life_domain||'')+'</span></div><div class="flex flex-wrap gap-1">'+emos+'</div></div>'}).join('')}catch(e){console.error(e)}}

function openLifeEventForm(evt){
  const m=document.getElementById('lifeEventModal');m.classList.remove('hidden');m.classList.add('flex');
  const domains=['famille','relation','travail','sante','argent','amitie','education','identite','perte','reussite','traumatisme','quotidien'];
  document.getElementById('lifeEventContent').innerHTML='<div class="space-y-4">'+
    '<div><label class="block text-sm text-gray-300 mb-1">Titre *</label><input type="text" id="evtTitle" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Ex: Demenagement a Paris"></div>'+
    '<div><label class="block text-sm text-gray-300 mb-1">Description</label><textarea id="evtDesc" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="3" placeholder="Decris ce moment..."></textarea></div>'+
    '<div class="grid grid-cols-2 gap-3"><div><label class="block text-sm text-gray-300 mb-1">Age</label><input type="number" id="evtAge" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="ex: 15" min="0" max="120"></div><div><label class="block text-sm text-gray-300 mb-1">Domaine</label><select id="evtDomain" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm">'+domains.map(d=>'<option value="'+d+'">'+d+'</option>').join('')+'</select></div></div>'+
    '<div class="grid grid-cols-2 gap-3"><div><label class="block text-sm text-gray-300 mb-1">Intensite: <span id="evtIntVal">5</span>/10</label><input type="range" id="evtIntensity" min="1" max="10" value="5" class="w-full accent-violet-500" oninput="document.getElementById(\\'evtIntVal\\').textContent=this.value"></div><div><label class="block text-sm text-gray-300 mb-1">Valence</label><select id="evtValence" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"><option value="positive">Positif</option><option value="negative">Negatif</option><option value="mixed" selected>Mixte</option></select></div></div>'+
    '<div><label class="block text-sm text-gray-300 mb-2">Emotions associees</label><div id="evtEmotions"><div class="flex gap-2 mb-2"><input type="text" class="evt-emo-name flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm" placeholder="Emotion"><input type="number" class="evt-emo-int w-20 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm" placeholder="1-10" min="1" max="10" value="5"></div></div><button type="button" onclick="addEmotionField()" class="text-xs text-violet-400 hover:text-violet-300"><i class="fas fa-plus mr-1"></i>Ajouter emotion</button></div>'+
    '<button onclick="submitLifeEvent()" class="w-full py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold transition-all"><i class="fas fa-check mr-2"></i>Enregistrer</button></div>'}

function addEmotionField(){const d=document.getElementById('evtEmotions');const div=document.createElement('div');div.className='flex gap-2 mb-2';div.innerHTML='<input type="text" class="evt-emo-name flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm" placeholder="Emotion"><input type="number" class="evt-emo-int w-20 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm" placeholder="1-10" min="1" max="10" value="5">';d.appendChild(div)}
function closeLifeEventModal(){document.getElementById('lifeEventModal').classList.add('hidden');document.getElementById('lifeEventModal').classList.remove('flex')}

async function submitLifeEvent(){
  const title=document.getElementById('evtTitle').value;if(!title){showToast('\\u26A0','Titre requis');return}
  const emos=[];document.querySelectorAll('#evtEmotions > div').forEach(row=>{const n=row.querySelector('.evt-emo-name')?.value;const i=parseInt(row.querySelector('.evt-emo-int')?.value||'5');if(n?.trim())emos.push({emotion:n.trim(),intensity:i})});
  try{const r=await fetch(API+'/api/lifeline/event',{method:'POST',headers:headers(),body:JSON.stringify({title,description:document.getElementById('evtDesc').value,age_at_event:parseInt(document.getElementById('evtAge').value)||null,global_intensity:parseInt(document.getElementById('evtIntensity').value),valence:document.getElementById('evtValence').value,life_domain:document.getElementById('evtDomain').value,emotions:emos})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeLifeEventModal();showToast('\\u{1F4AB}','Evenement ajoute ! +'+((d.xp?.total_awarded)||15)+' XP');loadLifeline();refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === HABITS ===
async function loadHabits(){
  try{const r=await fetch(API+'/api/habits/list',{headers:headers()});const d=await r.json();const el=document.getElementById('habitsContent');
  if(!d.habits?.length){el.innerHTML='<p class="text-gray-500 text-sm text-center py-4">Aucune habitude. Ajoute-en une !</p>';return}
  el.innerHTML=d.habits.map(h=>{const done=h.today_done;const sys=h.is_system_habit?'<span class="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">Fondateur</span>':'';
    return '<div class="card rounded-2xl p-4 flex items-center gap-4"><button onclick="'+(done?'':'logHabit('+h.id+')')+'" class="w-10 h-10 rounded-full flex items-center justify-center '+(done?'bg-green-500/30 text-green-400':'bg-gray-700 text-gray-400 hover:bg-violet-500/30 hover:text-violet-300')+' transition-all"><i class="fas '+(done?'fa-check':'fa-circle')+' text-lg"></i></button><div class="flex-1"><div class="flex items-center gap-2"><h3 class="font-semibold text-sm">'+h.name+'</h3>'+sys+'</div><div class="flex items-center gap-3 text-xs text-gray-500 mt-1"><span><i class="fas fa-fire text-orange-400 mr-1"></i>'+h.current_streak+'j</span><span>'+h.total_completions+' total</span><span>'+h.frequency+'</span></div></div>'+(h.is_system_habit?'':'<button onclick="deleteHabit('+h.id+')" class="text-gray-600 hover:text-red-400 text-sm"><i class="fas fa-trash"></i></button>')+'</div>'}).join('')}catch(e){console.error(e)}}

function openAddHabit(){document.getElementById('addHabitForm').classList.toggle('hidden')}
async function submitNewHabit(){
  const name=document.getElementById('newHabitName').value;if(!name){showToast('\\u26A0','Nom requis');return}
  try{const r=await fetch(API+'/api/habits/add',{method:'POST',headers:headers(),body:JSON.stringify({name,description:document.getElementById('newHabitDesc').value,frequency:document.getElementById('newHabitFreq').value})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}document.getElementById('newHabitName').value='';document.getElementById('newHabitDesc').value='';document.getElementById('addHabitForm').classList.add('hidden');showToast('\\u2705','Habitude ajoutee ! +10 XP');loadHabits();refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

async function logHabit(id){
  try{const r=await fetch(API+'/api/habits/log',{method:'POST',headers:headers(),body:JSON.stringify({habit_id:id})});
  const d=await r.json();if(d.error){showToast('\\u26A0',d.error);return}showToast('\\u2705','Habitude validee ! Streak: '+d.streak+'j');loadHabits();refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

async function deleteHabit(id){if(!confirm('Supprimer cette habitude ?'))return;
  try{await fetch(API+'/api/habits/'+id,{method:'DELETE',headers:headers()});loadHabits()}catch(e){showToast('\\u274C','Erreur')}}

// === VIDEO ===
async function loadVideos(){
  try{const r=await fetch(API+'/api/video/list',{headers:headers()});const d=await r.json();const el=document.getElementById('videoList');
  if(!d.videos?.length){el.innerHTML='<p class="text-gray-500 text-sm">Aucune videographie.</p>';return}
  el.innerHTML=d.videos.map(v=>{const themes=v.ai_key_themes?JSON.parse(v.ai_key_themes).map(t=>'<span class="px-2 py-0.5 rounded-full text-xs bg-rose-500/20 text-rose-300">'+t+'</span>').join(' '):'';
    return '<div class="card rounded-2xl p-5"><div class="flex items-center justify-between mb-2"><h3 class="font-semibold">'+(v.title||'Semaine '+v.week_number)+'</h3><span class="text-xs text-gray-500">S'+v.week_number+' / '+v.year+'</span></div>'+(v.ai_summary?'<p class="text-sm text-gray-400 mb-2">'+v.ai_summary+'</p>':'')+'<div class="flex flex-wrap gap-1">'+themes+'</div></div>'}).join('')}catch(e){console.error(e)}}

async function submitVideo(){
  const txt=document.getElementById('videoSummary').value;if(!txt.trim()){showToast('\\u26A0','Ecris un resume');return}
  showToast('\\u{1F3AC}','Analyse en cours...');
  try{const r=await fetch(API+'/api/video/submit',{method:'POST',headers:headers(),body:JSON.stringify({title:document.getElementById('videoTitle').value,text_summary:txt})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}document.getElementById('videoSummary').value='';document.getElementById('videoTitle').value='';
  showToast('\\u{1F3AC}','Videographie enregistree ! +'+(d.xp?.total_awarded||25)+' XP'+(d.life_events_created?' | '+d.life_events_created+' evenements extraits':''));loadVideos();refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === PSYCH PROFILE ===
async function loadPsychProfile(){
  try{const r=await fetch(API+'/api/psych/profile',{headers:headers()});const d=await r.json();
  const ts=d.traits||[];const snap=d.last_snapshot;
  const el=document.getElementById('psychTraits');const sum=document.getElementById('psychSummary');
  if(snap?.full_profile){sum.classList.remove('hidden');const p=snap.full_profile;
    sum.innerHTML='<h3 class="font-bold text-pink-300 mb-2"><i class="fas fa-clipboard-list mr-2"></i>Synthese</h3><p class="text-sm text-gray-300 mb-3">'+(p.global_summary||'')+'</p>'+(p.strengths?'<div class="mb-2"><span class="text-xs font-medium text-green-400">Forces:</span><div class="flex flex-wrap gap-1 mt-1">'+p.strengths.map(s=>'<span class="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-300">'+s+'</span>').join('')+'</div></div>':'')+(p.growth_areas?'<div><span class="text-xs font-medium text-amber-400">Axes:</span><div class="flex flex-wrap gap-1 mt-1">'+p.growth_areas.map(g=>'<span class="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-300">'+g+'</span>').join('')+'</div></div>':'')+'<div class="text-xs text-gray-500 mt-3">Points de donnees: '+(snap.data_points_count||0)+' | '+new Date(snap.generated_at).toLocaleDateString('fr-FR')+'</div>'}
  else{sum.classList.add('hidden')}
  if(!ts.length){el.innerHTML='<p class="text-gray-500 text-sm">Aucun profil. Ajoute des donnees puis genere.</p>';return}
  const cats={attachment:'Attachement',defense:'Defenses',bias:'Biais',emotional_regulation:'Regulation emotionnelle',relational:'Relationnel',identity:'Identite',cognitive:'Cognitif'};
  const grouped={};ts.forEach(t=>{const c=t.category||'other';if(!grouped[c])grouped[c]=[];grouped[c].push(t)});
  let h='';for(const[cat,traits]of Object.entries(grouped)){h+='<div class="mb-4"><h4 class="text-sm font-medium text-gray-400 mb-2">'+(cats[cat]||cat)+'</h4>';
    for(const t of traits){const pct=Math.round(t.probability*100);const color=pct>=80?'text-red-400':pct>=60?'text-amber-400':'text-blue-400';
      const ev=t.evidence?JSON.parse(t.evidence):[];
      h+='<div class="card rounded-xl p-4 mb-2"><div class="flex items-center justify-between mb-1"><span class="font-semibold text-sm">'+t.trait_name+'</span><span class="text-xs font-bold '+color+'">'+pct+'%</span></div><p class="text-xs text-gray-400 mb-2">'+t.description+'</p><div class="stat-bar mb-1"><div class="stat-fill '+(pct>=80?'bg-red-500':pct>=60?'bg-amber-500':'bg-blue-500')+'" style="width:'+pct+'%"></div></div>'+(ev.length?'<div class="text-xs text-gray-500 mt-1">'+ev.slice(0,2).map(e=>'\\u2022 '+e).join('<br>')+'</div>':'')+'</div>'}h+='</div>'}
  el.innerHTML=h}catch(e){console.error(e)}}

async function generatePsychProfile(){
  const btn=document.getElementById('generatePsychBtn');btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i>Analyse...';
  try{const r=await fetch(API+'/api/psych/generate',{method:'POST',headers:headers()});const d=await r.json();
  if(d.error){showToast('\\u274C',d.error);return}showToast('\\u{1F9E0}','Profil mis a jour ! +'+((d.xp?.total_awarded)||20)+' XP');loadPsychProfile();refreshProfile()}
  catch(e){showToast('\\u274C','Erreur')}finally{btn.disabled=false;btn.innerHTML='<i class="fas fa-brain mr-1"></i>Generer / Mettre a jour'}}

// === THOUGHT TREE ===
async function loadThoughtTree(){
  try{const r=await fetch(API+'/api/thought/tree',{headers:headers()});const d=await r.json();
  const bEl=document.getElementById('thoughtBranches');const eEl=document.getElementById('thoughtEntries');
  const branches=d.branches||[];const entries=d.entries||[];
  if(branches.length){bEl.innerHTML=branches.map(b=>{const w=Math.min(100,Math.round((b.thought_count||0)*5));
    return '<div class="card rounded-xl p-4"><div class="flex items-center justify-between mb-2"><h3 class="font-semibold text-sm">'+b.branch_name+'</h3><span class="text-xs text-gray-500">'+b.thought_count+' pensees</span></div><p class="text-xs text-gray-400 mb-2">'+b.description+'</p><div class="stat-bar"><div class="stat-fill bg-teal-500" style="width:'+w+'%"></div></div></div>'}).join('')}
  else{bEl.innerHTML='<p class="text-gray-500 text-sm col-span-3">Les branches seront creees automatiquement.</p>'}
  if(entries.length){eEl.innerHTML=entries.slice(0,20).map(e=>'<div class="card rounded-xl p-4"><p class="text-sm mb-1">'+e.content+'</p><div class="flex items-center gap-2 text-xs text-gray-500"><span>'+e.source_type+'</span>'+(e.branch_names?'<span>| '+e.branch_names+'</span>':'')+(e.ai_analysis?'<span>| '+e.ai_analysis+'</span>':'')+'</div></div>').join('')}
  else{eEl.innerHTML='<p class="text-gray-500 text-sm">Aucune pensee categorisee.</p>'}}catch(e){console.error(e)}}

async function categorizeThoughts(){
  showToast('\\u{1FA84}','Categorisation en cours...');
  try{const r=await fetch(API+'/api/thought/categorize',{method:'POST',headers:headers()});const d=await r.json();
  if(d.categorized>0){showToast('\\u{1F333}',d.categorized+' pensees categorisees !');loadThoughtTree();if(d.xp)refreshProfile()}
  else{showToast('\\u{1F50D}','Aucune nouvelle pensee a categoriser')}}catch(e){showToast('\\u274C','Erreur')}}

// === WEEKLY ===
function openWeeklyExercise(type){
  const m=document.getElementById('weeklyModal');m.classList.remove('hidden');m.classList.add('flex');
  const t=document.getElementById('weeklyTitle');const c=document.getElementById('weeklyContent');
  if(type==='decontamination'){t.innerHTML='\\u{1F9F9} La Decontamination';c.innerHTML='<div class="space-y-4"><div><label class="block text-sm text-gray-300 mb-1">Pensee envahissante</label><textarea id="wInvasive" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-sm text-gray-300 mb-1">Preuves POUR</label><textarea id="wProofsFor" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-sm text-gray-300 mb-1">Preuves CONTRE</label><textarea id="wProofsAgainst" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-sm text-gray-300 mb-1">Pire scenario</label><textarea id="wWorst" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-sm text-gray-300 mb-1">Plus probable</label><textarea id="wProbable" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-sm text-gray-300 mb-1">Meilleur raisonnable</label><textarea id="wBest" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><div><label class="block text-sm text-gray-300 mb-1">Conclusion</label><textarea id="wConclusion" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2"></textarea></div><button onclick="submitDecontamination()" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-check mr-2"></i>Valider</button></div>'}
  else if(type==='influence'){t.innerHTML='\\u{1F3AF} Cercle d\\'influence';c.innerHTML='<div class="space-y-4"><textarea id="iConcerns" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="4" placeholder="Tes preoccupations (une par ligne)"></textarea><textarea id="iReflections" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="3" placeholder="Reflexions: que choisis-tu de relacher ?"></textarea><button onclick="submitInfluenceCircle()" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-check mr-2"></i>Valider</button></div>'}
  else if(type==='worry'){t.innerHTML='\\u{1F4E6} Boite a soucis';c.innerHTML='<div class="space-y-4"><textarea id="wItems" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="4" placeholder="Ce que tu craignais vs ce qui s\\'est passe (un par ligne)"></textarea><textarea id="wInsight" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="3" placeholder="Insight global"></textarea><button onclick="submitWorryReview()" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-check mr-2"></i>Valider</button></div>'}}
function closeWeeklyModal(){document.getElementById('weeklyModal').classList.add('hidden');document.getElementById('weeklyModal').classList.remove('flex')}

async function submitDecontamination(){
  const inv=document.getElementById('wInvasive').value;if(!inv){showToast('\\u26A0','Pensee requise');return}
  try{const r=await fetch(API+'/api/weekly/decontamination',{method:'POST',headers:headers(),body:JSON.stringify({invasive_thought:inv,proofs_for:JSON.stringify(document.getElementById('wProofsFor').value.split(',').map(s=>s.trim()).filter(Boolean)),proofs_against:JSON.stringify(document.getElementById('wProofsAgainst').value.split(',').map(s=>s.trim()).filter(Boolean)),scenario_worst:document.getElementById('wWorst').value,scenario_probable:document.getElementById('wProbable').value,scenario_best:document.getElementById('wBest').value,conclusion:document.getElementById('wConclusion').value})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeWeeklyModal();showToast('\\u{1F9F9}','Decontamination validee ! +30 XP');refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

async function submitInfluenceCircle(){
  const c=document.getElementById('iConcerns').value;if(!c){showToast('\\u26A0','Preoccupations requises');return}
  try{const r=await fetch(API+'/api/weekly/influence-circle',{method:'POST',headers:headers(),body:JSON.stringify({concerns:c,reflections:document.getElementById('iReflections').value})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeWeeklyModal();showToast('\\u{1F3AF}','Cercle valide ! +25 XP');refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

async function submitWorryReview(){
  const items=document.getElementById('wItems').value;if(!items){showToast('\\u26A0','Soucis requis');return}
  try{const r=await fetch(API+'/api/weekly/worry-review',{method:'POST',headers:headers(),body:JSON.stringify({worried_items:items,overall_insight:document.getElementById('wInsight').value})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeWeeklyModal();showToast('\\u{1F4E6}','Bilan valide ! +25 XP');refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === QUESTS ===
async function loadQuests(){
  try{const r=await fetch(API+'/api/quest/list',{headers:headers()});const d=await r.json();const el=document.getElementById('questList');
  if(!d.quests?.length){el.innerHTML='<div class="card rounded-2xl p-8 text-center"><div class="text-4xl mb-3">\\u{1F52E}</div><h3 class="font-semibold mb-2">Les quetes emergent de tes donnees</h3><p class="text-sm text-gray-400">Continue tes check-ins.</p></div>';return}
  el.innerHTML=d.quests.map(q=>{const xp=JSON.parse(q.xp_rewards||'{}');const xs=Object.entries(xp).map(([k,v])=>'+'+v+' '+k).join(', ');
    return '<div class="card rounded-2xl p-5 cursor-pointer" onclick="openQuest('+q.id+','+JSON.stringify(JSON.stringify(q))+')"><div class="flex items-center gap-3"><div class="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center text-2xl">\\u2694\\uFE0F</div><div class="flex-1"><h3 class="font-semibold">'+q.quest_name+'</h3><p class="text-sm text-gray-400">'+q.description+'</p></div><div class="text-right"><div class="text-xs text-violet-300">'+xs+'</div><div class="text-xs text-gray-500">x'+(q.times_completed||0)+'</div></div></div></div>'}).join('')}catch(e){console.error(e)}}

function openQuest(id,qs){const q=JSON.parse(qs);const m=document.getElementById('questModal');m.classList.remove('hidden');m.classList.add('flex');document.getElementById('questTitle').innerHTML='\\u2694\\uFE0F '+q.quest_name;
  const ps=q.prompts||[];let h='<p class="text-sm text-gray-400 mb-4">'+q.description+'</p><div class="space-y-4">';
  ps.forEach((p,i)=>{h+='<div><label class="block text-sm text-gray-300 mb-1">'+p+'</label><textarea class="quest-response w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="2" data-prompt="'+i+'"></textarea></div>'});
  h+='<button onclick="submitQuest('+id+')" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-check mr-2"></i>Completer</button></div>';
  document.getElementById('questContent').innerHTML=h}
function closeQuestModal(){document.getElementById('questModal').classList.add('hidden');document.getElementById('questModal').classList.remove('flex')}

async function submitQuest(qid){
  const resp={};document.querySelectorAll('.quest-response').forEach(el=>{resp[el.dataset.prompt]=el.value});
  try{const r=await fetch(API+'/api/quest/complete',{method:'POST',headers:headers(),body:JSON.stringify({quest_id:qid,responses:resp})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeQuestModal();showToast('\\u2694\\uFE0F','Quete completee: '+d.quest_name);refreshProfile();loadQuests()}catch(e){showToast('\\u274C','Erreur')}}

// === PATTERNS ===
async function loadPatterns(){
  try{const r=await fetch(API+'/api/pattern/list',{headers:headers()});const d=await r.json();const el=document.getElementById('patternList');
  if(!d.patterns?.length){el.innerHTML='<p class="text-gray-500 text-sm">Aucun pattern detecte.</p><button onclick="triggerAnalysis()" class="mt-4 px-6 py-3 bg-violet-600/30 hover:bg-violet-600/50 rounded-xl font-medium transition-all text-sm"><i class="fas fa-brain mr-2"></i>Lancer analyse</button>';return}
  el.innerHTML=d.patterns.map(p=>{const sc={detected:'text-yellow-400',active:'text-blue-400',maintenance:'text-green-400',resolved:'text-gray-400'};const sl={detected:'Detecte',active:'Actif',maintenance:'Maintenance',resolved:'Resolu'};
    const ev=JSON.parse(p.evidence||'[]');return '<div class="card rounded-2xl p-5"><div class="flex items-center justify-between mb-2"><h3 class="font-semibold">'+p.pattern_name+'</h3><span class="text-xs '+(sc[p.status]||'')+'">'+( sl[p.status]||p.status)+'</span></div><p class="text-sm text-gray-400 mb-2">Confiance: '+Math.round(p.confidence*100)+'%</p>'+(ev.length?'<div class="text-xs text-gray-500">'+ev.slice(0,3).map(e=>'\\u2022 '+e).join('<br>')+'</div>':'')+'</div>'}).join('')+
  '<button onclick="triggerAnalysis()" class="mt-4 px-6 py-3 bg-violet-600/30 hover:bg-violet-600/50 rounded-xl font-medium transition-all text-sm"><i class="fas fa-brain mr-2"></i>Relancer</button>'}catch(e){console.error(e)}}

async function triggerAnalysis(){showToast('\\u{1F9E0}','Analyse...');try{const r=await fetch(API+'/api/pattern/analyze',{method:'POST',headers:headers()});const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}if(d.new_patterns?.length>0)showToast('\\u{1F3AF}',d.new_patterns.length+' pattern(s) !');else showToast('\\u{1F50D}','Pas de nouveau pattern');loadPatterns();loadQuests()}catch(e){showToast('\\u274C','Erreur')}}

async function openSelfDeclare(){const m=document.getElementById('selfDeclareModal');m.classList.remove('hidden');m.classList.add('flex');
  try{const r=await fetch(API+'/api/pattern/definitions');const d=await r.json();document.getElementById('selfDeclareContent').innerHTML=d.patterns.map(p=>'<button onclick="selfDeclare(\\''+p.key+'\\',\\''+p.name.replace(/'/g,"\\\\'")+'\\')" class="w-full card rounded-xl p-4 text-left hover:border-violet-500/50 transition-all"><h4 class="font-semibold text-sm">'+p.name+'</h4><p class="text-xs text-gray-400 mt-1">'+p.description+'</p><p class="text-xs text-violet-300 mt-2">'+p.quests_count+' quetes</p></button>').join('')}catch(e){}}
function closeSelfDeclare(){document.getElementById('selfDeclareModal').classList.add('hidden');document.getElementById('selfDeclareModal').classList.remove('flex')}
async function selfDeclare(k,n){try{const r=await fetch(API+'/api/pattern/self-declare',{method:'POST',headers:headers(),body:JSON.stringify({pattern_key:k})});const d=await r.json();if(d.error){showToast('\\u26A0',d.error);return}closeSelfDeclare();showToast('\\u{1F3AF}','Pattern "'+n+'" active !');loadPatterns();loadQuests()}catch(e){showToast('\\u274C','Erreur')}}

// === RITUALS ===
async function loadRituals(){
  try{const r=await fetch(API+'/api/ritual/available',{headers:headers()});const d=await r.json();const el=document.getElementById('ritualList');
  const fe={monthly:'\\u{1F4C5}',quarterly:'\\u{1F5D3}',yearly:'\\u{1F386}'};const fl={monthly:'Mensuel',quarterly:'Trimestriel',yearly:'Annuel'};
  let h='';if(d.available?.length>0){h+=d.available.map(r=>{const xs=Object.entries(r.xp).map(([k,v])=>'+'+v+' '+k).join(', ');return '<div class="card rounded-2xl p-5 cursor-pointer" onclick="startRitual(\\''+r.key+'\\',\\''+r.name.replace(/'/g,"\\\\'")+'\\'  ,\\''+r.frequency+'\\')"><div class="flex items-center gap-3"><div class="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center text-2xl">'+(fe[r.frequency]||'\\u{1F48E}')+'</div><div class="flex-1"><h3 class="font-semibold">'+r.name+'</h3><p class="text-xs text-gray-400">'+(fl[r.frequency]||'')+'</p></div><div class="text-xs text-violet-300">'+xs+'</div></div></div>'}).join('')}
  if(d.locked?.length>0){h+='<h3 class="text-sm font-semibold text-gray-500 mt-6 mb-3">\\u{1F512} Bloques</h3>';h+=d.locked.map(r=>'<div class="card rounded-2xl p-5 opacity-50"><div class="flex items-center gap-3"><div class="w-12 h-12 rounded-xl bg-gray-700/50 flex items-center justify-center text-2xl">\\u{1F512}</div><div><h3 class="font-semibold">'+r.name+'</h3><p class="text-xs text-gray-500">Niveau '+r.min_level+'</p></div></div></div>').join('')}
  if(!h)h='<div class="card rounded-2xl p-8 text-center"><div class="text-4xl mb-3">\\u{1F512}</div><h3 class="font-semibold mb-2">Niveau 5 requis</h3></div>';
  el.innerHTML=h}catch(e){console.error(e)}}

async function startRitual(k,n,f){showToast('\\u{1F48E}','Preparation...');try{const r=await fetch(API+'/api/ritual/start',{method:'POST',headers:headers(),body:JSON.stringify({ritual_key:k})});const d=await r.json();
  const m=document.getElementById('questModal');m.classList.remove('hidden');m.classList.add('flex');document.getElementById('questTitle').innerHTML='\\u{1F48E} '+n;
  const ps=d.prompts||[];let h='<div class="space-y-4">';ps.forEach((p,i)=>{h+='<div><label class="block text-sm text-gray-300 mb-1">'+p+'</label><textarea class="ritual-response w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none" rows="3" data-prompt="'+i+'"></textarea></div>'});
  h+='<button onclick="submitRitual(\\''+k+'\\',\\''+n.replace(/'/g,"\\\\'")+'\\'  ,\\''+f+'\\','+JSON.stringify(JSON.stringify(ps))+')" class="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-bold transition-all"><i class="fas fa-gem mr-2"></i>Terminer</button></div>';
  document.getElementById('questContent').innerHTML=h}catch(e){showToast('\\u274C','Erreur')}}

async function submitRitual(k,n,f,psStr){const content={};document.querySelectorAll('.ritual-response').forEach(el=>{content[el.dataset.prompt]=el.value});
  try{const r=await fetch(API+'/api/ritual/complete',{method:'POST',headers:headers(),body:JSON.stringify({ritual_key:k,ritual_name:n,frequency:f,content,prompts:JSON.parse(psStr)})});
  const d=await r.json();if(d.error){showToast('\\u274C',d.error);return}closeQuestModal();showToast('\\u{1F48E}','Rituel complete ! XP massif !');refreshProfile()}catch(e){showToast('\\u274C','Erreur')}}

// === HISTORY ===
async function loadHistory(){
  try{const r=await fetch(API+'/api/me/history?days=14',{headers:headers()});const d=await r.json();const el=document.getElementById('historyContent');
  let h='<h3 class="font-semibold mb-3">14 derniers jours</h3>';
  if(d.xp_history?.length>0){h+='<div class="card rounded-2xl p-5 mb-4"><h4 class="font-medium text-sm mb-3 text-violet-300">XP</h4><div class="space-y-2">';
    for(const x of d.xp_history.slice(0,20)){const t=(x.lucidity_xp||0)+(x.resonance_xp||0)+(x.liberty_xp||0)+(x.connection_xp||0)+(x.action_xp||0);const dt=new Date(x.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});h+='<div class="flex items-center justify-between text-xs"><span class="text-gray-400">'+dt+'</span><span>'+(x.description||x.source_type)+'</span><span class="text-violet-300">+'+t+' XP</span></div>'}h+='</div></div>'}
  if(d.captures?.length>0){h+='<div class="card rounded-2xl p-5 mb-4"><h4 class="font-medium text-sm mb-3 text-violet-300">Captures</h4><div class="space-y-2">';
    for(const c of d.captures.slice(0,10)){const dt=new Date(c.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});h+='<div class="p-3 bg-white/5 rounded-lg"><div class="flex items-center justify-between text-xs text-gray-400 mb-1"><span>'+dt+'</span><span>'+(c.emotion||'')+' | '+(c.category||'')+'</span></div><p class="text-sm">'+c.content+'</p></div>'}h+='</div></div>'}
  if(!d.xp_history?.length&&!d.captures?.length)h+='<p class="text-gray-500 text-sm">Aucune donnee. Commence par un check-in !</p>';
  el.innerHTML=h}catch(e){console.error(e)}}

// === UTILS ===
async function refreshProfile(){try{const r=await fetch(API+'/api/me/profile',{headers:headers()});if(r.ok){userData=await r.json();renderDashboard()}}catch(e){}}
function showToast(i,m){const t=document.getElementById('toast');document.getElementById('toastIcon').textContent=i;document.getElementById('toastMsg').textContent=m;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),4000)}
function logout(){localStorage.removeItem('token');localStorage.removeItem('user');window.location.href='/'}
init();
`;
}
