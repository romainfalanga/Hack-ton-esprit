// ============================================
// HACK TON ESPRIT — TYPES
// ============================================

export type Bindings = {
  DB: D1Database;
  OPENROUTER_API_KEY: string;
}

export type Variables = {
  user: UserSession;
}

export type UserSession = {
  id: number;
  email: string;
  username: string;
  display_name: string;
}

// Stats
export type StatKey = 'lucidity' | 'resonance' | 'liberty' | 'connection' | 'action';

export interface UserStats {
  lucidity_xp: number;
  resonance_xp: number;
  liberty_xp: number;
  connection_xp: number;
  action_xp: number;
  total_xp: number;
  lucidity_level: number;
  resonance_level: number;
  liberty_level: number;
  connection_level: number;
  action_level: number;
  global_level: number;
}

export interface XPReward {
  lucidity?: number;
  resonance?: number;
  liberty?: number;
  connection?: number;
  action?: number;
}

// Emotions wheel
export const EMOTION_CATEGORIES = {
  joy: ['heureux', 'enthousiaste', 'reconnaissant', 'serein', 'inspiré', 'fier', 'amusé', 'émerveillé', 'confiant', 'soulagé', 'satisfait', 'paisible'],
  sadness: ['triste', 'mélancolique', 'déçu', 'nostalgique', 'vide', 'abattu', 'résigné', 'impuissant', 'seul', 'incompris'],
  anger: ['en colère', 'frustré', 'agacé', 'irrité', 'révolté', 'amer', 'jaloux', 'trahi', 'exaspéré'],
  fear: ['anxieux', 'inquiet', 'paniqué', 'effrayé', 'nerveux', 'tendu', 'vulnérable', 'menacé', 'paralysé'],
  surprise: ['surpris', 'choqué', 'perplexe', 'déstabilisé', 'intrigué', 'stupéfait'],
  disgust: ['dégoûté', 'honteux', 'coupable', 'embarrassé', 'humilié', 'écœuré'],
  neutral: ['neutre', 'indifférent', 'détaché', 'fatigué', 'engourdi', 'confus']
} as const;

// Pattern keys
export const PATTERN_KEYS = {
  ASSERTIVENESS: 'assertiveness_difficulty',
  CONTROL: 'control_need',
  EMOTIONAL_SUPPRESSION: 'emotional_suppression',
  ABANDONMENT: 'abandonment_fear',
  SELF_SACRIFICE: 'self_sacrifice',
  MIND_READING: 'mind_reading',
  SUNK_COST: 'sunk_cost_bias',
  IMPULSIVITY: 'impulsivity',
  FINANCIAL_GUILT: 'financial_guilt',
  MANIPULATION: 'manipulation_suffered',
  CATASTROPHIZING: 'catastrophizing',
  NOSTALGIA: 'nostalgia_paralysis'
} as const;

export type PatternKey = typeof PATTERN_KEYS[keyof typeof PATTERN_KEYS];

// Level thresholds
export const LEVEL_THRESHOLDS = [
  0,      // Level 1
  100,    // Level 2
  300,    // Level 3
  600,    // Level 4
  1000,   // Level 5
  1500,   // Level 6
  2200,   // Level 7
  3000,   // Level 8
  4000,   // Level 9
  5500    // Level 10
];

export const LEVEL_NAMES: Record<StatKey, string[]> = {
  lucidity: ['Endormi', 'Éveillé', 'Observateur', 'Analyste', 'Investigateur', 'Clairvoyant', 'Illuminé', 'Visionnaire', 'Sage', 'Esprit libre'],
  resonance: ['Anesthésié', 'Sensible', 'Attentif', 'Empathique', 'Résonant', 'Connecté', 'Vibrant', 'Harmonieux', 'Profond', 'Cœur ouvert'],
  liberty: ['Prisonnier', 'Enchaîné', 'Questionnant', 'Détachant', 'Libérant', 'Autonome', 'Souverain', 'Émancipé', 'Libre', 'Affranchi'],
  connection: ['Muré', 'Entrouvert', 'Curieux', 'Communiquant', 'Authentique', 'Vulnérable', 'Intime', 'Profond', 'Tisseur', 'Relié'],
  action: ['Figé', 'Hésitant', 'Initiant', 'Engagé', 'Déterminé', 'Courageux', 'Transformateur', 'Impactant', 'Maître', 'Force tranquille']
};

export const AWAKENING_NAMES = [
  "L'Inconscient",
  "L'Observateur",
  "Le Découvreur", 
  "L'Explorateur",
  "Le Travailleur",
  "Le Plongeur",
  "L'Intégrateur",
  "Le Transformateur",
  "Le Transmetteur",
  "L'Éveillé"
];
