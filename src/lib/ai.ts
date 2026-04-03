// ============================================
// AI ENGINE — OpenRouter Integration
// ============================================

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface AIRequest {
  messages: { role: string; content: string }[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export async function callAI(apiKey: string, request: AIRequest): Promise<string> {
  const model = request.model || 'google/gemini-2.0-flash-001';
  
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://hack-ton-esprit.pages.dev',
      'X-Title': 'Hack Ton Esprit'
    },
    body: JSON.stringify({
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens ?? 1000,
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI Error: ${response.status} - ${error}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

// Analyze patterns from user data
export async function analyzePatterns(apiKey: string, userData: {
  checkins: any[];
  captures: any[];
  decontaminations: any[];
  influenceCircles: any[];
}): Promise<{ patterns: { key: string; name: string; confidence: number; evidence: string[] }[] }> {
  const prompt = `Tu es un psychologue spécialisé en thérapie cognitive et comportementale. Analyse les données suivantes d'un utilisateur et identifie les patterns psychologiques dominants.

DONNÉES DE L'UTILISATEUR (2 dernières semaines) :

CHECK-INS MATINAUX :
${JSON.stringify(userData.checkins.filter(c => c.type === 'morning').slice(-14), null, 2)}

SCANS DU SOIR :
${JSON.stringify(userData.checkins.filter(c => c.type === 'evening').slice(-14), null, 2)}

CAPTURES INSTANTANÉES :
${JSON.stringify(userData.captures.slice(-30), null, 2)}

DÉCONTAMINATIONS HEBDO :
${JSON.stringify(userData.decontaminations.slice(-4), null, 2)}

CERCLES D'INFLUENCE :
${JSON.stringify(userData.influenceCircles.slice(-4), null, 2)}

PATTERNS POSSIBLES (retourne UNIQUEMENT ceux qui sont présents) :
- assertiveness_difficulty : Difficulté à s'affirmer / tendance à se soumettre
- control_need : Besoin de tout contrôler / anxiété face à l'imprévu
- emotional_suppression : Suppression émotionnelle / difficulté à exprimer
- abandonment_fear : Peur de l'abandon / hypervigilance relationnelle
- self_sacrifice : Abnégation / sacrifice de soi excessif
- mind_reading : Lecture de pensée / interprétation des intentions
- sunk_cost_bias : Biais d'engagement / incapacité à lâcher
- impulsivity : Impulsivité / difficulté à différer la gratification
- financial_guilt : Culpabilité financière / rapport toxique à l'argent
- manipulation_suffered : Manipulation subie / doute sur sa perception
- catastrophizing : Pessimisme chronique / catastrophisation
- nostalgia_paralysis : Nostalgie paralysante / difficulté avec les transitions

Réponds UNIQUEMENT en JSON valide avec ce format :
{
  "patterns": [
    {
      "key": "pattern_key",
      "name": "Nom du pattern en français",
      "confidence": 0.8,
      "evidence": ["preuve 1", "preuve 2"]
    }
  ]
}

Ne retourne que les patterns avec une confiance >= 0.6. Si pas assez de données, retourne un tableau vide.`;

  const response = await callAI(apiKey, {
    messages: [{ role: 'user', content: prompt }],
    model: 'google/gemini-2.0-flash-001',
    temperature: 0.3,
    max_tokens: 2000,
  });

  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { patterns: [] };
  } catch {
    return { patterns: [] };
  }
}

// Generate personalized ritual prompts
export async function generateRitualPrompts(apiKey: string, ritualKey: string, userPatterns: any[], recentData: any): Promise<string[]> {
  const prompt = `Tu es un guide bienveillant dans un jeu d'introspection appelé "Hack Ton Esprit".

L'utilisateur va faire le rituel : "${ritualKey}"

Ses patterns actifs sont :
${JSON.stringify(userPatterns, null, 2)}

Données récentes :
${JSON.stringify(recentData, null, 2)}

Génère 3 à 5 prompts/questions personnalisés pour ce rituel, adaptés aux patterns de l'utilisateur.
Le ton doit être bienveillant, non-jugeant, et encourageant l'introspection profonde.

Réponds en JSON : {"prompts": ["question 1", "question 2", ...]}`;

  const response = await callAI(apiKey, {
    messages: [{ role: 'user', content: prompt }],
    model: 'google/gemini-2.0-flash-001',
    temperature: 0.7,
    max_tokens: 1000,
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.prompts || [];
    }
    return [];
  } catch {
    return [];
  }
}

// Categorize a capture automatically
export async function categorizeCapture(apiKey: string, content: string): Promise<{ emotion: string; category: string; tags: string[]; is_anxious: boolean }> {
  const prompt = `Analyse cette capture instantanée d'un utilisateur et catégorise-la.

Capture : "${content}"

Réponds UNIQUEMENT en JSON :
{
  "emotion": "l'émotion principale (en français, un mot)",
  "category": "une des catégories : relation, travail, santé, argent, famille, identité, futur, passé, quotidien",
  "tags": ["tag1", "tag2"],
  "is_anxious": true/false
}`;

  const response = await callAI(apiKey, {
    messages: [{ role: 'user', content: prompt }],
    model: 'google/gemini-2.0-flash-001',
    temperature: 0.2,
    max_tokens: 300,
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {}
  
  return { emotion: 'neutre', category: 'quotidien', tags: [], is_anxious: false };
}
