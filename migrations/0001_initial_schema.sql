-- ============================================
-- DÉCODE TON ESPRIT — DATABASE SCHEMA
-- ============================================

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME,
  onboarding_done INTEGER DEFAULT 0,
  awakening_level INTEGER DEFAULT 1,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_checkin_date TEXT
);

-- XP & STATS
CREATE TABLE IF NOT EXISTS user_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  lucidity_xp INTEGER DEFAULT 0,
  resonance_xp INTEGER DEFAULT 0,
  liberty_xp INTEGER DEFAULT 0,
  connection_xp INTEGER DEFAULT 0,
  action_xp INTEGER DEFAULT 0,
  total_xp INTEGER DEFAULT 0,
  lucidity_level INTEGER DEFAULT 1,
  resonance_level INTEGER DEFAULT 1,
  liberty_level INTEGER DEFAULT 1,
  connection_level INTEGER DEFAULT 1,
  action_level INTEGER DEFAULT 1,
  global_level INTEGER DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- MORNING CHECK-INS
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('morning', 'evening')),
  emotion TEXT,
  emotion_detail TEXT,
  energy_level INTEGER CHECK(energy_level BETWEEN 1 AND 10),
  intention TEXT,
  -- Evening specific
  micro_victories TEXT, -- JSON array
  invisible_gratitude TEXT,
  strong_emotion TEXT,
  strong_emotion_trigger TEXT,
  depth_score INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- INSTANT CAPTURES
CREATE TABLE IF NOT EXISTS captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  emotion TEXT,
  intensity INTEGER CHECK(intensity BETWEEN 1 AND 10),
  category TEXT, -- auto-categorized by AI
  tags TEXT, -- JSON array of tags
  is_anxious INTEGER DEFAULT 0,
  anticipated_outcome TEXT,
  actual_outcome TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- WEEKLY: DECONTAMINATION
CREATE TABLE IF NOT EXISTS decontaminations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  invasive_thought TEXT NOT NULL,
  proofs_for TEXT, -- JSON array
  proofs_against TEXT, -- JSON array
  scenario_worst TEXT,
  scenario_probable TEXT,
  scenario_best TEXT,
  conclusion TEXT,
  week_number INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- WEEKLY: CIRCLE OF INFLUENCE
CREATE TABLE IF NOT EXISTS influence_circles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  concerns TEXT NOT NULL, -- JSON: [{text, circle: 'control'|'no_control', action}]
  reflections TEXT,
  week_number INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- WEEKLY: WORRY BOX REVIEW
CREATE TABLE IF NOT EXISTS worry_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  worried_items TEXT NOT NULL, -- JSON: [{worry, anticipated, actual, gap_score}]
  overall_insight TEXT,
  week_number INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- PATTERNS DETECTED
CREATE TABLE IF NOT EXISTS patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pattern_key TEXT NOT NULL,
  pattern_name TEXT NOT NULL,
  description TEXT,
  confidence REAL DEFAULT 0,
  status TEXT DEFAULT 'detected' CHECK(status IN ('detected', 'active', 'maintenance', 'resolved')),
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  evidence TEXT, -- JSON: array of evidence items
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- QUESTS (Couche 2)
CREATE TABLE IF NOT EXISTS quests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pattern_id INTEGER,
  quest_key TEXT NOT NULL,
  quest_name TEXT NOT NULL,
  description TEXT,
  technique TEXT,
  xp_rewards TEXT, -- JSON: {lucidity: 10, resonance: 5, ...}
  status TEXT DEFAULT 'available' CHECK(status IN ('available', 'active', 'completed', 'maintenance')),
  frequency TEXT DEFAULT 'daily', -- daily, weekly, monthly
  times_completed INTEGER DEFAULT 0,
  unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_completed_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (pattern_id) REFERENCES patterns(id)
);

-- QUEST COMPLETIONS (individual logs)
CREATE TABLE IF NOT EXISTS quest_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  quest_id INTEGER NOT NULL,
  response TEXT, -- JSON: user's responses to the quest
  reflection TEXT,
  xp_earned TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (quest_id) REFERENCES quests(id)
);

-- RITUALS (Couche 3)
CREATE TABLE IF NOT EXISTS rituals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ritual_key TEXT NOT NULL,
  ritual_name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('monthly', 'quarterly', 'yearly')),
  content TEXT, -- JSON: the full ritual response
  ai_prompts TEXT, -- JSON: personalized prompts from AI
  xp_earned TEXT, -- JSON
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- XP HISTORY (for tracking progression)
CREATE TABLE IF NOT EXISTS xp_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL, -- checkin, capture, decontamination, quest, ritual, etc.
  source_id INTEGER,
  lucidity_xp INTEGER DEFAULT 0,
  resonance_xp INTEGER DEFAULT 0,
  liberty_xp INTEGER DEFAULT 0,
  connection_xp INTEGER DEFAULT 0,
  action_xp INTEGER DEFAULT 0,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- AI ANALYSIS CACHE
CREATE TABLE IF NOT EXISTS ai_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  analysis_type TEXT NOT NULL, -- pattern_detection, ritual_prompt, quest_suggestion
  input_data TEXT, -- JSON: what was sent to AI
  output_data TEXT, -- JSON: AI response
  model_used TEXT,
  tokens_used INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_captures_user_date ON captures(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_patterns_user ON patterns(user_id, status);
CREATE INDEX IF NOT EXISTS idx_quests_user ON quests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_xp_history_user ON xp_history(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_captures_anxious ON captures(user_id, is_anxious);
