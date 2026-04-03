// ============================================
// PATTERN DEFINITIONS & QUEST REGISTRY
// ============================================

export interface QuestDefinition {
  key: string;
  name: string;
  description: string;
  technique: string;
  frequency: 'daily' | 'weekly' | 'as_needed';
  xp_rewards: { lucidity?: number; resonance?: number; liberty?: number; connection?: number; action?: number };
  prompts: string[]; // Questions/instructions for the user
}

export interface PatternDefinition {
  key: string;
  name: string;
  description: string;
  detection_hints: string[];
  quests: QuestDefinition[];
}

export const PATTERN_DEFINITIONS: PatternDefinition[] = [
  {
    key: 'assertiveness_difficulty',
    name: "Difficulté à s'affirmer",
    description: "Tendance à se soumettre, peur de déplaire, difficulté à dire non",
    detection_hints: ["peur de déplaire", "conflit", "dire oui", "cédé", "pas osé", "réaction"],
    quests: [
      {
        key: 'petit_non',
        name: 'Le Défi du Petit Non',
        description: "Dire un micro-désaccord par jour sur un enjeu mineur.",
        technique: 'Mei',
        frequency: 'daily',
        xp_rewards: { connection: 10, liberty: 5 },
        prompts: [
          "Quelle était la situation ?",
          "Qu'as-tu dit exactement ?",
          "Comment l'autre a réagi ?",
          "Une catastrophe s'est-elle produite ? (spoiler : probablement pas)"
        ]
      },
      {
        key: 'thermometre_contrainte',
        name: 'Le Thermomètre de contrainte',
        description: "Avant de répondre à une demande, évaluer ta pression interne à dire oui.",
        technique: 'Mei',
        frequency: 'as_needed',
        xp_rewards: { liberty: 10, action: 5 },
        prompts: [
          "Quelle demande t'a été faite ?",
          "Niveau de pression à dire oui (1-10) ?",
          "As-tu pris une pause avant de répondre ?",
          "Qu'as-tu finalement répondu ?"
        ]
      },
      {
        key: 'dialogue_soumis',
        name: 'Le Dialogue soumis/protecteur',
        description: "Écrire ce que l'enfant en toi ressent, puis ce que l'adulte protecteur lui répond.",
        technique: 'Mei',
        frequency: 'weekly',
        xp_rewards: { liberty: 15, resonance: 10 },
        prompts: [
          "Face à quelle autorité/situation te sens-tu soumis(e) ?",
          "Que ressent l'enfant en toi ? (écris en 'je')",
          "Que lui répond l'adulte protecteur en toi ?"
        ]
      }
    ]
  },
  {
    key: 'control_need',
    name: "Besoin de tout contrôler",
    description: "Anxiété face à l'imprévu, planification excessive",
    detection_hints: ["contrôle", "imprévu", "planifier", "prévu", "agacement", "tension"],
    quests: [
      {
        key: 'exposition_imprevu',
        name: "L'Exposition à l'imprévu",
        description: "Planifier un moment de chaos intentionnel par semaine.",
        technique: 'Nadia',
        frequency: 'weekly',
        xp_rewards: { action: 15, liberty: 10 },
        prompts: [
          "Quel imprévu as-tu intentionnellement laissé se produire ?",
          "Quelles résistances as-tu observées en toi ?",
          "Quel a été le résultat réel ?",
          "Sur 10, à quel point c'était aussi grave que tu le craignais ?"
        ]
      },
      {
        key: 'consequences_reelles',
        name: 'Le Questionnement des conséquences réelles',
        description: "Face à un imprévu stressant : quelle conséquence dans 1 an ?",
        technique: 'Nadia',
        frequency: 'as_needed',
        xp_rewards: { lucidity: 10 },
        prompts: [
          "Quel imprévu te stresse en ce moment ?",
          "Quelle sera la conséquence réelle dans 1 an ?",
          "Et dans 5 ans ?"
        ]
      },
      {
        key: 'lacher_prise',
        name: 'Le Lâcher-prise progressif',
        description: "Identifier UNE chose que tu micro-manages et la déléguer entièrement.",
        technique: 'Nadia + Camille',
        frequency: 'weekly',
        xp_rewards: { liberty: 15, connection: 10 },
        prompts: [
          "Quelle chose as-tu délégué cette semaine ?",
          "À qui l'as-tu confié ?",
          "Qu'est-ce qui s'est passé ?",
          "Qu'as-tu ressenti en lâchant le contrôle ?"
        ]
      }
    ]
  },
  {
    key: 'emotional_suppression',
    name: "Suppression émotionnelle",
    description: "Difficulté à exprimer ses émotions, vocabulaire émotionnel pauvre",
    detection_hints: ["ça va", "normal", "fatigué", "rien", "sais pas", "pas grave"],
    quests: [
      {
        key: 'etiquetage_precis',
        name: "L'Étiquetage précis",
        description: "Le jeu refuse 'ça va' et propose un choix parmi 5 émotions proches.",
        technique: 'Youssef',
        frequency: 'daily',
        xp_rewards: { resonance: 10 },
        prompts: [
          "Parmi ces émotions, laquelle est la plus précise pour toi en ce moment ?",
          "Où dans ton corps ressens-tu cette émotion ?",
          "Si cette émotion avait une couleur, laquelle serait-ce ?"
        ]
      },
      {
        key: 'reevaluation_perspective',
        name: 'La Réévaluation par changement de perspective',
        description: "Écrire 3 interprétations alternatives d'un comportement stressant.",
        technique: 'Youssef',
        frequency: 'as_needed',
        xp_rewards: { lucidity: 15, connection: 10 },
        prompts: [
          "Quel événement/comportement te stresse ?",
          "Interprétation alternative 1 (positive) :",
          "Interprétation alternative 2 (neutre) :",
          "Interprétation alternative 3 (bienveillante) :"
        ]
      },
      {
        key: 'pause_transparence',
        name: 'La Pause de transparence',
        description: "Quand tu te fermes, dire à l'autre : 'Je me ferme, donne-moi une minute.'",
        technique: 'Youssef',
        frequency: 'as_needed',
        xp_rewards: { connection: 20, resonance: 10 },
        prompts: [
          "Dans quelle situation as-tu senti que tu te fermais ?",
          "As-tu réussi à le dire à la personne en face ?",
          "Comment a-t-elle réagi ?",
          "Comment te sentais-tu après ?"
        ]
      }
    ]
  },
  {
    key: 'abandonment_fear',
    name: "Peur de l'abandon",
    description: "Hypervigilance relationnelle, interprétation des silences comme du rejet",
    detection_hints: ["peur de perdre", "rejet", "silence", "aime encore", "abandonner", "partir"],
    quests: [
      {
        key: 'distinction_passe_present',
        name: 'La Distinction passé/présent',
        description: "Quand la panique monte, noter le déclencheur, l'émotion et la réalité actuelle.",
        technique: 'Hugo',
        frequency: 'as_needed',
        xp_rewards: { liberty: 15, lucidity: 10 },
        prompts: [
          "Quel est le déclencheur de ta panique ?",
          "Quelle émotion ressens-tu exactement ?",
          "Quelle est la réalité objective ACTUELLE ?",
          "Est-ce une menace réelle ou un vieux schéma qui se réveille ?"
        ]
      },
      {
        key: 'communication_vulnerable',
        name: 'La Communication vulnérable',
        description: "Exprimer l'émotion primaire (la peur) plutôt que la défense secondaire.",
        technique: 'Hugo',
        frequency: 'as_needed',
        xp_rewards: { connection: 20, resonance: 15 },
        prompts: [
          "Quelle situation relationnelle t'a activé ?",
          "Quelle était ta première réaction (défense) ?",
          "Quelle est l'émotion primaire en dessous ?",
          "As-tu réussi à exprimer cette émotion primaire ? Comment ?"
        ]
      },
      {
        key: 'auto_parentalite',
        name: "L'Auto-parentalité",
        description: "Dans un moment de crise, poser une main sur ton thorax et te rassurer.",
        technique: 'Hugo',
        frequency: 'as_needed',
        xp_rewards: { liberty: 15, resonance: 10 },
        prompts: [
          "Quel moment de crise as-tu traversé ?",
          "As-tu fait le geste (main sur le thorax) ?",
          "Quels mots t'es-tu dit ?",
          "Comment te sentais-tu après ?"
        ]
      }
    ]
  },
  {
    key: 'self_sacrifice',
    name: "Abnégation excessive",
    description: "Sacrifice de soi, victoires toujours pour les autres, énergie basse",
    detection_hints: ["épuisement", "pas assez", "culpabilité", "repos", "autres", "devoir"],
    quests: [
      {
        key: 'thermometre_besoins',
        name: 'Le Thermomètre des besoins',
        description: "3x/jour : fatigue (1-10), faim/soif (1-10), émotion présente.",
        technique: 'Camille',
        frequency: 'daily',
        xp_rewards: { resonance: 10 },
        prompts: [
          "Fatigue physique (1-10) :",
          "Faim/soif (1-10) :",
          "Émotion présente :",
          "As-tu fait quelque chose pour toi depuis la dernière mesure ?"
        ]
      },
      {
        key: 'soin_non_negociable',
        name: 'Le Soin non-négociable',
        description: "15 min dans ton agenda pour une activité UNIQUEMENT pour toi.",
        technique: 'Camille',
        frequency: 'daily',
        xp_rewards: { action: 15, resonance: 10 },
        prompts: [
          "Quelle activité as-tu choisie pour toi ?",
          "L'as-tu réellement faite sans culpabilité ?",
          "Comment te sentais-tu pendant ?",
          "Comment te sentais-tu après ?"
        ]
      },
      {
        key: 'enveloppe_plaisir',
        name: "L'Enveloppe plaisir",
        description: "Dédier une somme à des dépenses purement personnelles. Sans se justifier.",
        technique: 'Thomas',
        frequency: 'weekly',
        xp_rewards: { liberty: 15, action: 10 },
        prompts: [
          "Quel montant as-tu dédié cette semaine ?",
          "Qu'as-tu fait/acheté pour toi ?",
          "As-tu ressenti de la culpabilité ? Si oui, qu'en as-tu fait ?"
        ]
      },
      {
        key: 'dialogue_voix_interieure',
        name: 'Le Dialogue avec la voix intérieure',
        description: "Quand la culpabilité monte : est-ce MA voix ou celle de mon parent ?",
        technique: 'Camille',
        frequency: 'as_needed',
        xp_rewards: { liberty: 15, resonance: 10 },
        prompts: [
          "Quelle culpabilité ressens-tu ?",
          "Cette voix, à qui appartient-elle (toi ou un parent/figure d'autorité) ?",
          "Que dit l'adulte en toi à l'enfant qui se sent coupable ?"
        ]
      }
    ]
  },
  {
    key: 'mind_reading',
    name: "Lecture de pensée",
    description: "Interprétation des intentions des autres, certitudes sur ce que l'autre pense",
    detection_hints: ["il pense", "elle pense", "sûr que", "son regard", "silence veut dire", "pense que"],
    quests: [
      {
        key: 'preuves_contraires',
        name: 'La Recherche de preuves contraires',
        description: "Pour chaque certitude sur l'autre, lister les faits qui l'infirment.",
        technique: 'Léa',
        frequency: 'as_needed',
        xp_rewards: { lucidity: 15 },
        prompts: [
          "Quelle est ta certitude sur ce que l'autre pense ?",
          "Preuves POUR ton interprétation :",
          "Preuves CONTRE ton interprétation :",
          "En voyant les deux colonnes, que constates-tu ?"
        ]
      },
      {
        key: 'verification_directe',
        name: 'La Vérification directe',
        description: "Poser une question ouverte et non accusatoire à la personne.",
        technique: 'Léa',
        frequency: 'as_needed',
        xp_rewards: { connection: 20, action: 10 },
        prompts: [
          "Quelle interprétation avais-tu ?",
          "Quelle question as-tu posée ?",
          "Quelle a été la réponse réelle ?",
          "L'écart entre ton imagination et la réalité ?"
        ]
      },
      {
        key: 'carnet_non_observation',
        name: 'Le Carnet de preuves de non-observation',
        description: "Avant une situation sociale : anticiper les regards/jugements. Après : compter les réels.",
        technique: 'Mei',
        frequency: 'as_needed',
        xp_rewards: { lucidity: 15 },
        prompts: [
          "Quelle situation sociale approchait ?",
          "Combien de regards/jugements anticipais-tu ?",
          "Combien y en a-t-il réellement eu ?",
          "Que conclues-tu de cet écart ?"
        ]
      }
    ]
  },
  {
    key: 'sunk_cost_bias',
    name: "Biais d'engagement",
    description: "Incapacité à lâcher ses projets après investissement",
    detection_hints: ["après tout ce que", "investissement", "abandonner", "lâcher", "continuer", "trop tard"],
    quests: [
      {
        key: 'decideur_externe',
        name: 'Le Décideur externe express',
        description: "Décrire sa situation comme celle d'un inconnu. Que lui conseillerais-tu ?",
        technique: 'Karim',
        frequency: 'as_needed',
        xp_rewards: { lucidity: 20, action: 15 },
        prompts: [
          "Décris ta situation comme si c'était celle d'un(e) inconnu(e) :",
          "Que lui conseillerais-tu ?",
          "Pourquoi ne suis-tu pas toi-même ce conseil ?"
        ]
      },
      {
        key: 'comptabilite_prospective',
        name: 'La Comptabilité prospective',
        description: "En partant d'aujourd'hui, quel est le meilleur usage de mes ressources ?",
        technique: 'Karim',
        frequency: 'weekly',
        xp_rewards: { lucidity: 20, action: 15 },
        prompts: [
          "Quel projet/engagement questionnes-tu ?",
          "Oublie ce que tu as déjà investi. Quel serait le MEILLEUR usage de tes ressources restantes ?",
          "Si tu devais recommencer à zéro, referais-tu ce choix ?"
        ]
      },
      {
        key: 'criteres_sortie',
        name: 'Les Critères de sortie',
        description: "Définir 3 conditions non-négociables de sortie avec un délai.",
        technique: 'Karim',
        frequency: 'weekly',
        xp_rewards: { action: 25, liberty: 15 },
        prompts: [
          "Quel engagement nécessite des critères de sortie ?",
          "Critère de sortie 1 :",
          "Critère de sortie 2 :",
          "Critère de sortie 3 :",
          "Délai fixé :",
          "T'engages-tu à respecter ces critères ? (oui/non)"
        ]
      }
    ]
  },
  {
    key: 'impulsivity',
    name: "Impulsivité",
    description: "Décisions sur le coup, difficulté à différer la gratification",
    detection_hints: ["impulsion", "regret", "sur le coup", "trop vite", "sans réfléchir", "engagements"],
    quests: [
      {
        key: 'regle_24h',
        name: 'La Règle des 24h',
        description: "Pour toute décision non-urgente, attendre 24h.",
        technique: 'Karim',
        frequency: 'as_needed',
        xp_rewards: { action: 15, lucidity: 10 },
        prompts: [
          "Quelle décision as-tu mise en pause 24h ?",
          "Comment te sentais-tu pendant l'attente ?",
          "Après 24h, quelle est ta décision finale ?",
          "Est-elle différente de l'impulsion initiale ?"
        ]
      },
      {
        key: 'intentions_si_alors',
        name: 'Les Intentions "Si... Alors..."',
        description: "3 situations à haut risque + réponse automatique prédéfinie.",
        technique: 'Karim',
        frequency: 'weekly',
        xp_rewards: { action: 15, liberty: 10 },
        prompts: [
          "Situation à risque 1 : Si... Alors je...",
          "Situation à risque 2 : Si... Alors je...",
          "Situation à risque 3 : Si... Alors je...",
          "As-tu relu ces intentions ce matin ?"
        ]
      },
      {
        key: 'contrat_familial',
        name: 'Le Contrat familial',
        description: "Système de points avec tes proches : chaque impulsion résistée = 1 point.",
        technique: 'Karim',
        frequency: 'daily',
        xp_rewards: { connection: 20, action: 15 },
        prompts: [
          "Quelle impulsion as-tu résistée aujourd'hui ?",
          "Combien de points as-tu accumulés ?",
          "Quelle est la récompense partagée visée ?"
        ]
      }
    ]
  },
  {
    key: 'financial_guilt',
    name: "Culpabilité financière",
    description: "Rapport toxique à l'argent, culpabilité, honte autour des dépenses",
    detection_hints: ["argent", "dépense", "culpabilité", "cher", "mérite pas", "gaspillage"],
    quests: [
      {
        key: 'recu_reconnaissant',
        name: 'Le Reçu reconnaissant',
        description: "Pour les 3 plus grosses dépenses, écrire 3 bénéfices concrets.",
        technique: 'Monique',
        frequency: 'weekly',
        xp_rewards: { resonance: 15, lucidity: 10 },
        prompts: [
          "Dépense 1 — 3 bénéfices concrets :",
          "Dépense 2 — 3 bénéfices concrets :",
          "Dépense 3 — 3 bénéfices concrets :"
        ]
      },
      {
        key: 'scripts_financiers',
        name: 'Les Scripts financiers hérités',
        description: "Phrases entendues enfant sur l'argent → Tes propres règles d'adulte.",
        technique: 'Thomas',
        frequency: 'weekly',
        xp_rewards: { liberty: 20, lucidity: 15 },
        prompts: [
          "Phrase héritée 1 → Ta règle d'adulte :",
          "Phrase héritée 2 → Ta règle d'adulte :",
          "Phrase héritée 3 → Ta règle d'adulte :"
        ]
      },
      {
        key: 'autocompassion_financiere',
        name: "L'Auto-compassion financière",
        description: "Remplacer 'faute' par 'choix' à chaque décision d'achat.",
        technique: 'Thomas',
        frequency: 'daily',
        xp_rewards: { resonance: 10, liberty: 10 },
        prompts: [
          "Quel achat/dépense as-tu fait(e) ?",
          "As-tu dit 'c'est ma faute' ou 'c'est mon choix' ?",
          "Comment te sens-tu en reformulant ?"
        ]
      }
    ]
  },
  {
    key: 'manipulation_suffered',
    name: "Manipulation subie",
    description: "Doute sur sa propre perception, confusion récurrente",
    detection_hints: ["problème c'est moi", "fou", "folle", "mémoire", "honte", "confusion"],
    quests: [
      {
        key: 'journal_faits',
        name: 'Le Journal des faits objectifs',
        description: "Documenter les interactions : date, heure, personnes, paroles exactes.",
        technique: 'Djamila',
        frequency: 'as_needed',
        xp_rewards: { lucidity: 20, liberty: 15 },
        prompts: [
          "Date et heure :",
          "Personnes présentes :",
          "Paroles exactes échangées :",
          "Faits objectifs (sans jugement émotionnel) :"
        ]
      },
      {
        key: 'validation_tiers',
        name: 'La Validation par un tiers',
        description: "Partager les faits neutres à une personne de confiance.",
        technique: 'Djamila',
        frequency: 'weekly',
        xp_rewards: { connection: 15, lucidity: 10 },
        prompts: [
          "À qui as-tu partagé les faits ?",
          "Comment as-tu présenté la situation ?",
          "Quelle a été la réaction de cette personne ?",
          "Cela t'a-t-il aidé à voir plus clair ?"
        ]
      },
      {
        key: 'reponse_factuelle',
        name: 'La Réponse courte et factuelle',
        description: "S'entraîner à répondre aux attaques par des phrases neutres.",
        technique: 'Djamila',
        frequency: 'as_needed',
        xp_rewards: { connection: 15, liberty: 15 },
        prompts: [
          "Quelle attaque émotionnelle as-tu reçue ?",
          "Quelle phrase neutre as-tu utilisée ?",
          "Comment t'es-tu senti(e) en restant factuel(le) ?"
        ]
      }
    ]
  },
  {
    key: 'catastrophizing',
    name: "Pessimisme chronique",
    description: "Catastrophisation, scénarios systématiquement négatifs",
    detection_hints: ["et si", "catastrophe", "pire", "jamais", "toujours", "horrible"],
    quests: [
      {
        key: 'trois_possibilites',
        name: 'La Règle des 3 possibilités',
        description: "Pire, plus probable, et meilleur raisonnable avec preuves.",
        technique: 'Camille',
        frequency: 'as_needed',
        xp_rewards: { lucidity: 15 },
        prompts: [
          "Quel scénario catastrophique te préoccupe ?",
          "Le PIRE scénario (avec preuves) :",
          "Le PLUS PROBABLE (avec preuves) :",
          "Le MEILLEUR raisonnable (avec preuves) :"
        ]
      },
      {
        key: 'journal_preuves',
        name: 'Le Journal des preuves',
        description: "Pensée dramatique → intensité → éléments factuels → vérification le soir.",
        technique: 'Camille',
        frequency: 'daily',
        xp_rewards: { lucidity: 15, resonance: 10 },
        prompts: [
          "Pensée dramatique du jour :",
          "Intensité (0-10) :",
          "3 éléments factuels :",
          "3 éléments incertains :",
          "Action concrète possible :",
          "Ce soir : que s'est-il RÉELLEMENT passé ?"
        ]
      },
      {
        key: 'plage_inquietude',
        name: "La Plage d'inquiétude",
        description: "10 min/jour pour s'inquiéter, puis fermer avec une action banale.",
        technique: 'Camille',
        frequency: 'daily',
        xp_rewards: { action: 10, liberty: 10 },
        prompts: [
          "As-tu fait ta plage d'inquiétude aujourd'hui ?",
          "Quelles inquiétudes y as-tu mises ?",
          "Quelle action banale as-tu faite pour fermer ?",
          "Des inquiétudes sont-elles revenues en dehors de la plage ?"
        ]
      }
    ]
  },
  {
    key: 'nostalgia_paralysis',
    name: "Nostalgie paralysante",
    description: "Difficulté avec les transitions de vie, mélancolie du passé",
    detection_hints: ["avant", "c'était mieux", "nostalgie", "manque", "passé", "perte", "vide"],
    quests: [
      {
        key: 'nostalgie_narrative',
        name: 'La Nostalgie narrative',
        description: "Transformer un souvenir triste en ressource active.",
        technique: 'Margot',
        frequency: 'weekly',
        xp_rewards: { resonance: 15, action: 10 },
        prompts: [
          "Quel souvenir te rend triste ?",
          "Quelle qualité manifestais-tu à cette époque ?",
          "Comment utilises-tu ENCORE cette qualité aujourd'hui ?",
          "Comment ce souvenir peut-il devenir une force ?"
        ]
      },
      {
        key: 'rituel_transmission',
        name: 'Le Rituel de transmission',
        description: "Envoyer un message centré sur l'AUTRE au lieu de combler un vide.",
        technique: 'Margot',
        frequency: 'weekly',
        xp_rewards: { connection: 15, resonance: 10 },
        prompts: [
          "À qui as-tu envoyé un message ?",
          "Quel était le contenu (centré sur l'autre) ?",
          "Comment t'es-tu senti(e) après l'avoir envoyé ?"
        ]
      },
      {
        key: 'futur_soi_nostalgique',
        name: 'Le Futur soi nostalgique',
        description: "De quoi serai-je nostalgique dans 10 ans concernant ma vie d'aujourd'hui ?",
        technique: 'Margot',
        frequency: 'weekly',
        xp_rewards: { resonance: 20, action: 15 },
        prompts: [
          "Qu'est-ce qui, dans ta vie actuelle, te manquera dans 10 ans ?",
          "Pourquoi est-ce précieux ?",
          "Que peux-tu faire aujourd'hui pour en profiter pleinement ?"
        ]
      }
    ]
  }
];

// Get quest definitions for a pattern
export function getQuestsForPattern(patternKey: string): QuestDefinition[] {
  const pattern = PATTERN_DEFINITIONS.find(p => p.key === patternKey);
  return pattern?.quests || [];
}

// Get all pattern keys
export function getAllPatternKeys(): string[] {
  return PATTERN_DEFINITIONS.map(p => p.key);
}
