// ============================================
// DATABASE SCHEMA — All table creation statements
// ============================================

export const DB_STATEMENTS = [
  // === EXISTING TABLES ===
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_login DATETIME, onboarding_done INTEGER DEFAULT 0, onboarding_step INTEGER DEFAULT 0, awakening_level INTEGER DEFAULT 1, current_streak INTEGER DEFAULT 0, longest_streak INTEGER DEFAULT 0, last_checkin_date TEXT)`,
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

  // === MODULE 1 : LIGNE DE VIE ===
  `CREATE TABLE IF NOT EXISTS life_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    event_date TEXT,
    age_at_event INTEGER,
    global_intensity INTEGER DEFAULT 5,
    valence TEXT DEFAULT 'mixed',
    life_domain TEXT DEFAULT 'quotidien',
    source_type TEXT DEFAULT 'manual',
    source_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS life_event_emotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    emotion TEXT NOT NULL,
    intensity INTEGER NOT NULL DEFAULT 5,
    FOREIGN KEY (event_id) REFERENCES life_events(id)
  )`,

  // === MODULE 2 : PROFIL PSYCHOLOGIQUE ===
  `CREATE TABLE IF NOT EXISTS psych_profile_traits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    trait_key TEXT NOT NULL,
    trait_name TEXT NOT NULL,
    description TEXT NOT NULL,
    probability REAL NOT NULL DEFAULT 0.5,
    evidence TEXT,
    counter_evidence TEXT,
    first_detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_count INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS psych_profile_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    trait_id INTEGER NOT NULL,
    old_probability REAL,
    new_probability REAL,
    old_description TEXT,
    new_description TEXT,
    trigger_source TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trait_id) REFERENCES psych_profile_traits(id)
  )`,
  `CREATE TABLE IF NOT EXISTS psych_profile_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    full_profile TEXT NOT NULL,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    model_used TEXT,
    data_points_count INTEGER DEFAULT 0
  )`,

  // === MODULE 3 : ARBRE DES PENSEES ===
  `CREATE TABLE IF NOT EXISTS thought_branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    parent_id INTEGER,
    branch_key TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    description TEXT,
    thought_count INTEGER DEFAULT 0,
    dominant_emotion TEXT,
    dominant_pattern TEXT,
    weight REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS thought_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id INTEGER,
    ai_analysis TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS thought_entry_branches (
    entry_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    relevance REAL DEFAULT 1.0,
    PRIMARY KEY (entry_id, branch_id)
  )`,

  // === MODULE 4 : MICRO-HABITUDES ===
  `CREATE TABLE IF NOT EXISTS micro_habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'general',
    is_system_habit INTEGER DEFAULT 0,
    frequency TEXT DEFAULT 'daily',
    custom_days TEXT,
    target_value REAL,
    target_unit TEXT,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    total_completions INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paused_at DATETIME,
    week_number_started INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS micro_habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    completed INTEGER DEFAULT 1,
    value REAL,
    note TEXT,
    logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (habit_id) REFERENCES micro_habits(id)
  )`,

  // === MODULE 5 : VIDEOGRAPHIE ===
  `CREATE TABLE IF NOT EXISTS videographies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT,
    video_url TEXT,
    duration_seconds INTEGER,
    transcript TEXT,
    ai_summary TEXT,
    ai_key_themes TEXT,
    ai_emotions_detected TEXT,
    ai_life_events_extracted TEXT,
    week_number INTEGER,
    year INTEGER,
    processed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  // === LETTRES AU FUTUR MOI ===
  `CREATE TABLE IF NOT EXISTS future_letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    target_years INTEGER DEFAULT 10,
    readable_after DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
];

// Default thought branches created for each new user
export const DEFAULT_THOUGHT_BRANCHES = [
  { key: 'soi', name: 'Soi', description: 'Identite, estime, image de soi' },
  { key: 'relations', name: 'Relations', description: 'Amour, amitie, famille, social' },
  { key: 'travail', name: 'Travail', description: 'Carriere, ambitions, competences' },
  { key: 'sante', name: 'Sante', description: 'Physique, mentale, habitudes' },
  { key: 'argent', name: 'Argent', description: 'Finances, valeur, culpabilite' },
  { key: 'sens', name: 'Sens', description: 'Spiritualite, existentiel, valeurs' },
  { key: 'passe', name: 'Passe', description: 'Souvenirs, regrets, nostalgie' },
  { key: 'futur', name: 'Futur', description: 'Projets, peurs, espoirs' },
  { key: 'quotidien', name: 'Quotidien', description: 'Routine, irritants, plaisirs' },
];

export const LIFE_DOMAINS = [
  'famille', 'relation', 'travail', 'sante', 'argent', 'amitie', 'education', 'identite', 'perte', 'reussite', 'traumatisme', 'quotidien'
];
