# Hack Ton Esprit -- Le Jeu de Ta Vie

## Vue d'ensemble
Application web gamifiee de developpement personnel et de comprehension de soi. Basee sur la therapie cognitive et comportementale, elle aide les utilisateurs a observer leurs schemas mentaux, detecter leurs patterns psychologiques et les transformer.

## Architecture : 3 Couches + 5 Modules

### Couche 1 -- Le Socle Universel
- **Check-in du matin** (2 min) -- Emotion, energie, intention -> +5 XP Resonance
- **Scan du soir** (5 min) -- Micro-victoires, gratitude, emotion forte -> +5 a +15 XP
- **Capture instantanee** -- Bouton d'urgence pensees/emotions -> +2 XP Lucidite
- **Decontamination hebdo** (15 min) -- Analyse pensee envahissante -> +30 XP
- **Cercle d'influence** (10 min) -- Controle vs hors controle -> +25 XP
- **Bilan boite a soucis** (10 min) -- Anticipe vs realite -> +25 XP

### Couche 2 -- Quetes Emergentes
12 familles de patterns detectes par l'IA, 36+ quetes personnalisees.

### Couche 3 -- Rituels de Profondeur
Introspections mensuelles, trimestrielles et annuelles au contenu personnalise.

### Module 1 -- Ligne de Vie
- Enregistrement de 10+ evenements majeurs de vie avec emotions et intensite
- Onboarding: bonus XP au 10eme evenement
- Chaque evenement: titre, description, age, intensite, valence, domaine, emotions multiples
- XP: +10 Lucidite +5 Resonance par evenement, +25 au 10eme

### Module 2 -- Profil Psychologique
- Analyse IA (Gemini 2.5 Flash) de toutes les donnees utilisateur
- Traits par categories: attachement, defenses, biais, regulation emotionnelle, relationnel, identite, cognitif
- Probabilite 0-1 par trait avec evidence et contre-evidence
- Historique des evolutions, snapshots complets
- XP: +15 Lucidite +5 Resonance par generation

### Module 3 -- Arbre des Pensees
- 9 branches par defaut: Soi, Relations, Travail, Sante, Argent, Sens, Passe, Futur, Quotidien
- Categorisation IA automatique des captures et check-ins dans les branches
- Poids des branches ajuste par le volume de pensees
- XP: +5 Lucidite par categorisation

### Module 4 -- Micro-habitudes
- 3 habitudes systeme par defaut (Rituel Fondateur):
  - Videographie hebdomadaire
  - Emotion forte du soir
  - Lettre au futur moi
- Ajout/suppression d'habitudes personnalisees
- Tracking quotidien avec streaks
- XP: +3 Action/jour, +15 streak 7j, +50 streak 30j, +10 nouvelle habitude

### Module 5 -- Videographie
- Resume texte hebdomadaire de la semaine
- Analyse IA: themes, emotions, evenements de vie extraits automatiquement
- Les evenements extraits sont ajoutes a la Ligne de Vie
- XP: +25 Resonance +15 Lucidite +10 Action

### Lettre au Futur Moi
- Ecrire un message a son futur soi (10 ans par defaut)
- Stocke avec date de lisibilite
- XP: +10 Resonance +5 Lucidite

## Navigation (v4)
Navigation reduite a **6 onglets** : Accueil, Ligne de vie, Habitudes, Video, Profil Psy, Arbre de pensee.

Les pages suivantes sont integrees dans la page **Accueil** avec deblocage progressif par niveau XP :
- **Nv.1** : Check-in matin + Capture instantanee (toujours disponible)
- **Nv.2** : Scan du soir
- **Nv.3** : Exercices hebdomadaires (Decontamination, Cercle d'influence, Boite a soucis) + Stats detaillees
- **Nv.4** : Detection de patterns + Quetes emergentes
- **Nv.5** : Rituels de profondeur

### Indicateurs de verrouillage
- Badge pulsant avec icone cadenas et niveau requis
- Overlay gradient avec blur sur les cartes verrouillees
- Animation "shake" quand l'utilisateur tente d'acceder a du contenu verrouille
- Animation "glow" quand un contenu se debloque
- Toast informatif indiquant le nombre de niveaux restants

### Responsive (Mobile / Desktop)
- **Mobile** : Bottom navigation fixe avec indicateur actif, touch targets 44px+, FAB capture
- **Desktop** : Top tabs avec bordure active, layout large

## Stack technique
- **Backend** : Hono (Cloudflare Workers)
- **Frontend** : HTML/JS/TailwindCSS (inline)
- **Base de donnees** : Cloudflare D1 (SQLite) -- 21 tables
- **IA** : OpenRouter (Gemini 2.5 Flash pour analyses profondes, 2.0 Flash pour taches legeres)
- **CI/CD** : GitHub -> Cloudflare Workers (deploiement auto via Git)

## URLs
- **Production** : https://hack-ton-esprit.romainfalanga83.workers.dev
- **GitHub** : https://github.com/romainfalanga/Hack-ton-esprit

## Configuration Build (Dashboard Cloudflare)
- **Build command** : `npm run build`
- **Deploy command** : `npx wrangler deploy`

## Deploiement
```bash
# Dev local
npm run build
npm run dev:sandbox

# Deploiement manuel
npm run deploy
```

## API Endpoints

### Publics
- `GET /` -- Page d'accueil
- `GET /app` -- Dashboard
- `GET /api/init-db` -- Initialiser DB (21 tables)
- `GET /api/emotions` -- 58 emotions (7 categories)
- `POST /api/auth/register` -- Inscription (cree stats, branches, habitudes)
- `POST /api/auth/login` -- Connexion

### Proteges (Bearer token)
**Core**
- `GET /api/me/profile` -- Profil + stats + counts (events, habits)
- `GET /api/me/history` -- Historique XP/captures
- `POST /api/checkin/morning` -- Check-in matin
- `POST /api/checkin/evening` -- Scan du soir
- `POST /api/capture/new` -- Capture instantanee (IA)
- `GET /api/capture/list` -- Liste des captures

**Hebdo**
- `POST /api/weekly/decontamination` -- Decontamination
- `POST /api/weekly/influence-circle` -- Cercle d'influence
- `POST /api/weekly/worry-review` -- Boite a soucis

**Patterns & Quetes**
- `GET /api/pattern/list` -- Patterns detectes
- `POST /api/pattern/analyze` -- Analyse IA
- `POST /api/pattern/self-declare` -- Autodeclarer
- `GET /api/pattern/definitions` -- 12 patterns disponibles
- `GET /api/quest/list` -- Quetes actives
- `POST /api/quest/complete` -- Completer

**Rituels**
- `GET /api/ritual/available` -- Rituels disponibles
- `POST /api/ritual/start` -- Demarrer (IA)
- `POST /api/ritual/complete` -- Completer

**Ligne de Vie** (nouveau)
- `POST /api/lifeline/event` -- Ajouter evenement
- `GET /api/lifeline/events` -- Liste (avec emotions)
- `PUT /api/lifeline/event/:id` -- Modifier
- `DELETE /api/lifeline/event/:id` -- Supprimer

**Profil Psychologique** (nouveau)
- `GET /api/psych/profile` -- Traits + dernier snapshot
- `POST /api/psych/generate` -- Generer/MaJ profil (IA)

**Arbre des Pensees** (nouveau)
- `GET /api/thought/tree` -- Branches + pensees
- `POST /api/thought/categorize` -- Categoriser captures/checkins (IA)
- `POST /api/thought/branch` -- Creer branche

**Micro-habitudes** (nouveau)
- `GET /api/habits/list` -- Liste + statut today
- `POST /api/habits/add` -- Ajouter
- `POST /api/habits/log` -- Logger completion
- `PUT /api/habits/:id/status` -- Changer statut
- `DELETE /api/habits/:id` -- Supprimer

**Videographie** (nouveau)
- `POST /api/video/submit` -- Envoyer resume (IA)
- `GET /api/video/list` -- Historique

**Lettres** (nouveau)
- `POST /api/letter/write` -- Ecrire
- `GET /api/letter/list` -- Liste

## Modele de donnees (21 tables)
users, user_stats, checkins, captures, decontaminations, influence_circles, worry_reviews, patterns, quests, quest_completions, rituals, xp_history, ai_analyses, life_events, life_event_emotions, psych_profile_traits, psych_profile_history, psych_profile_snapshots, thought_branches, thought_entries, thought_entry_branches, micro_habits, micro_habit_logs, videographies, future_letters

## Variables d'environnement
- `OPENROUTER_API_KEY` -- Cle API OpenRouter (secret Cloudflare)
- `DB` -- Binding D1 (configure dans wrangler.jsonc)
