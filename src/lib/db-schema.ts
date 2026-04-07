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

  // === MODULE 5 : VIDEOGRAPHIE (legacy — table kept for data migration) ===
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

  // === MODULE 6 : CHATBOT PSY (Mon Psy IA) ===
  `CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT DEFAULT 'Nouvelle conversation',
    context_summary TEXT,
    status TEXT DEFAULT 'active',
    messages_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model_used TEXT,
    tokens_used INTEGER,
    actions_taken TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
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

  // === MODULE 7 : DIMENSIONS PSYCHOLOGIQUES STRUCTUREES ===
  `CREATE TABLE IF NOT EXISTS psych_dimensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    framework TEXT NOT NULL,
    dimension_key TEXT NOT NULL,
    dimension_name TEXT NOT NULL,
    score REAL,
    confidence REAL DEFAULT 0.0,
    description TEXT,
    evidence TEXT,
    first_assessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_count INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  // === MODULE 8 : LIENS ENTRE EVENEMENTS DE VIE (graphe causal) ===
  `CREATE TABLE IF NOT EXISTS life_event_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_a_id INTEGER NOT NULL,
    event_b_id INTEGER NOT NULL,
    link_type TEXT NOT NULL,
    description TEXT,
    strength REAL DEFAULT 0.5,
    detected_by TEXT DEFAULT 'alma',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (event_a_id) REFERENCES life_events(id),
    FOREIGN KEY (event_b_id) REFERENCES life_events(id)
  )`,

  // === MODULE 9 : CROYANCES CENTRALES (core beliefs) ===
  `CREATE TABLE IF NOT EXISTS core_beliefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    belief_key TEXT NOT NULL,
    belief_text TEXT NOT NULL,
    target TEXT NOT NULL,
    valence TEXT DEFAULT 'negative',
    strength REAL DEFAULT 0.5,
    origin_hypothesis TEXT,
    evidence TEXT,
    counter_evidence TEXT,
    status TEXT DEFAULT 'active',
    first_detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_count INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  // === MODULE 10 : LIENS CROISES (trait <-> event, trait <-> thought, belief <-> event) ===
  `CREATE TABLE IF NOT EXISTS psych_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    link_nature TEXT,
    confidence REAL DEFAULT 0.5,
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

// Frameworks psychologiques structurés
export const PSYCH_FRAMEWORKS = {
  big_five: {
    name: 'Big Five (OCEAN)',
    dimensions: [
      { key: 'openness', name: 'Ouverture', description: 'Curiosite intellectuelle, imagination, ouverture aux experiences nouvelles' },
      { key: 'conscientiousness', name: 'Conscienciosite', description: 'Organisation, discipline, fiabilite, perseverance' },
      { key: 'extraversion', name: 'Extraversion', description: 'Sociabilite, energie, assertivite, emotions positives' },
      { key: 'agreeableness', name: 'Agreabilite', description: 'Cooperation, empathie, confiance, altruisme' },
      { key: 'neuroticism', name: 'Nevrosisme', description: 'Instabilite emotionnelle, anxiete, vulnerabilite au stress' },
    ]
  },
  mbti: {
    name: 'MBTI (indicatif)',
    dimensions: [
      { key: 'ei', name: 'Extraversion / Introversion', description: 'Source d energie : le monde exterieur ou interieur' },
      { key: 'sn', name: 'Sensation / Intuition', description: 'Traitement de l info : concret et present vs abstrait et futur' },
      { key: 'tf', name: 'Pensee / Sentiment', description: 'Prise de decision : logique vs valeurs et harmonie' },
      { key: 'jp', name: 'Jugement / Perception', description: 'Mode de vie : structure et planification vs flexibilite et spontaneite' },
    ]
  },
  enneagram: {
    name: 'Enneagramme',
    dimensions: [
      { key: 'type', name: 'Type principal', description: 'Le type dominant parmi les 9 (1-Perfectionniste, 2-Altruiste, 3-Battant, 4-Romantique, 5-Observateur, 6-Loyaliste, 7-Epicurien, 8-Chef, 9-Mediateur)' },
      { key: 'wing', name: 'Aile', description: 'Le type adjacent qui colore le type principal' },
      { key: 'integration', name: 'Direction d integration', description: 'Vers quel type la personne evolue en sante' },
      { key: 'disintegration', name: 'Direction de desintegration', description: 'Vers quel type la personne regresse sous stress' },
    ]
  },
  attachment: {
    name: 'Style d attachement',
    dimensions: [
      { key: 'secure', name: 'Securise', description: 'Confiance en soi et en l autre, intimite confortable' },
      { key: 'anxious', name: 'Anxieux-preoccupe', description: 'Besoin de reassurance, peur de l abandon, hypervigilance' },
      { key: 'avoidant', name: 'Evitant-detache', description: 'Independance excessive, evitement de l intimite, autosuffisance' },
      { key: 'disorganized', name: 'Desorganise-craintif', description: 'Oscillation entre recherche et fuite de l intimite, vecu traumatique' },
    ]
  },
  young_schemas: {
    name: 'Schemas de Young',
    dimensions: [
      { key: 'abandonment', name: 'Abandon / Instabilite', description: 'Conviction que les proches vont partir ou etre imprevisibles' },
      { key: 'mistrust', name: 'Mefiance / Abus', description: 'Attente d etre blesse, manipule, humilie' },
      { key: 'emotional_deprivation', name: 'Carence affective', description: 'Sentiment que ses besoins emotionnels ne seront jamais combles' },
      { key: 'defectiveness', name: 'Imperfection / Honte', description: 'Conviction d etre fondamentalement defectueux ou indigne' },
      { key: 'social_isolation', name: 'Isolement social', description: 'Sentiment d etre different, de ne pas appartenir' },
      { key: 'dependence', name: 'Dependance / Incompetence', description: 'Conviction de ne pas pouvoir gerer seul la vie quotidienne' },
      { key: 'vulnerability', name: 'Vulnerabilite', description: 'Peur exageree d une catastrophe imminente' },
      { key: 'enmeshment', name: 'Fusion / Soi peu developpe', description: 'Implication excessive avec un proche au detriment de sa propre identite' },
      { key: 'failure', name: 'Echec', description: 'Conviction d etre incapable de reussir, inferieur aux autres' },
      { key: 'entitlement', name: 'Droits personnels exageres', description: 'Croire meriter des privileges, difficulte avec les regles' },
      { key: 'insufficient_self_control', name: 'Controle de soi insuffisant', description: 'Difficulte a tolerer la frustration et a se discipliner' },
      { key: 'subjugation', name: 'Assujettissement', description: 'Soumission aux desirs des autres par peur du rejet ou de represailles' },
      { key: 'self_sacrifice', name: 'Sacrifice de soi', description: 'Focus excessif sur les besoins des autres au detriment des siens' },
      { key: 'approval_seeking', name: 'Recherche d approbation', description: 'Besoin excessif de l approbation et de l attention des autres' },
      { key: 'negativity', name: 'Negativite / Pessimisme', description: 'Focus sur le negatif, minimisation du positif' },
      { key: 'emotional_inhibition', name: 'Inhibition emotionnelle', description: 'Repression des emotions, de la spontaneite, de la communication' },
      { key: 'unrelenting_standards', name: 'Exigences elevees', description: 'Perfectionnisme, regles rigides, critique de soi et des autres' },
      { key: 'punitiveness', name: 'Punitivite', description: 'Conviction que les erreurs meritent punition, intolerance' },
    ]
  },
  defense_mechanisms: {
    name: 'Mecanismes de defense',
    dimensions: [
      { key: 'denial', name: 'Deni', description: 'Refus de reconnaitre une realite menacante' },
      { key: 'projection', name: 'Projection', description: 'Attribuer ses propres sentiments inacceptables aux autres' },
      { key: 'rationalization', name: 'Rationalisation', description: 'Justifier des comportements par des explications logiques fausses' },
      { key: 'displacement', name: 'Deplacement', description: 'Reporter ses emotions sur une cible moins menacante' },
      { key: 'regression', name: 'Regression', description: 'Retour a des comportements immatures face au stress' },
      { key: 'sublimation', name: 'Sublimation', description: 'Canaliser des pulsions inacceptables en activites socialement valorisees' },
      { key: 'intellectualization', name: 'Intellectualisation', description: 'Traiter les emotions par la pensee abstraite pour eviter de les ressentir' },
      { key: 'reaction_formation', name: 'Formation reactionnelle', description: 'Adopter l attitude opposee a ses vrais sentiments' },
      { key: 'repression', name: 'Refoulement', description: 'Bannir inconsciemment les pensees ou souvenirs douloureux' },
      { key: 'humor', name: 'Humour', description: 'Utiliser l humour pour gerer l anxiete ou les situations difficiles' },
    ]
  },
  values: {
    name: 'Valeurs fondamentales',
    dimensions: [
      { key: 'autonomy', name: 'Autonomie', description: 'Liberte, independance, autodetermination' },
      { key: 'security', name: 'Securite', description: 'Stabilite, protection, previsibilite' },
      { key: 'achievement', name: 'Accomplissement', description: 'Reussite, competence, reconnaissance' },
      { key: 'benevolence', name: 'Bienveillance', description: 'Aide, loyaute, prendre soin des proches' },
      { key: 'universalism', name: 'Universalisme', description: 'Justice, egalite, protection de la nature et des plus faibles' },
      { key: 'stimulation', name: 'Stimulation', description: 'Nouveaute, defi, excitation' },
      { key: 'hedonism', name: 'Hedonisme', description: 'Plaisir, gratification sensorielle, confort' },
      { key: 'power', name: 'Pouvoir', description: 'Statut, prestige, controle sur les ressources ou les personnes' },
      { key: 'tradition', name: 'Tradition', description: 'Respect des coutumes, humilite, devouement' },
      { key: 'conformity', name: 'Conformite', description: 'Obeissance aux normes sociales, politesse, autodiscipline' },
    ]
  },
};

// Types de liens entre événements de vie
export const LIFE_EVENT_LINK_TYPES = [
  'cause',           // A a causé B
  'consequence',     // B est une conséquence de A
  'repetition',      // B répète le même schéma que A
  'mirror',          // B est un miroir/écho de A dans un autre contexte
  'rupture',         // B représente une rupture avec le pattern de A
  'compensation',    // B est une tentative de compenser A
  'trigger',         // A déclenche le souvenir/la réaction de B
  'evolution',       // B montre une évolution par rapport à A
];

// Cibles des croyances centrales
export const CORE_BELIEF_TARGETS = [
  'self',    // Sur soi-même ("je suis nul", "je suis indigne")
  'others',  // Sur les autres ("les gens sont égoïstes", "on ne peut faire confiance à personne")
  'world',   // Sur le monde ("le monde est dangereux", "la vie est injuste")
  'future',  // Sur l'avenir ("rien ne changera jamais", "ça va forcément mal finir")
];

// Types de liens croisés dans psych_links
export const PSYCH_LINK_TYPES = {
  source_types: ['trait', 'event', 'thought', 'belief', 'pattern', 'dimension'],
  target_types: ['trait', 'event', 'thought', 'belief', 'pattern', 'dimension'],
  natures: [
    'causes',          // La source cause la cible
    'reinforces',      // La source renforce la cible
    'contradicts',     // La source contredit la cible
    'originates_from', // La source trouve son origine dans la cible
    'manifests_as',    // La source se manifeste comme la cible
    'compensates',     // La source compense la cible
    'triggers',        // La source déclenche la cible
  ],
};
