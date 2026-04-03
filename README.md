# Hack Ton Esprit -- Le Jeu de Ta Vie

## Vue d'ensemble
Application web gamifiee de developpement personnel et de comprehension de soi. Basee sur la therapie cognitive et comportementale, elle aide les utilisateurs a observer leurs schemas mentaux, detecter leurs patterns psychologiques et les transformer.

## Architecture : 3 Couches

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

## Stack technique
- **Backend** : Hono (Cloudflare Workers)
- **Frontend** : HTML/JS/TailwindCSS
- **Base de donnees** : Cloudflare D1 (SQLite)
- **IA** : OpenRouter (Google Gemini Flash)
- **CI/CD** : GitHub -> Cloudflare Workers (deploiement auto via Git)

## URLs
- **Production** : https://hack-ton-esprit.romainfalanga83.workers.dev
- **GitHub** : https://github.com/romainfalanga/Hack-ton-esprit

## Configuration Build (Dashboard Cloudflare)
- **Build command** : `npm run build`
- **Deploy command** : `npx wrangler deploy`

## Deploiement
Chaque push sur `main` declenche un deploiement automatique via Cloudflare Workers.

```bash
# Dev local
npm run build
npm run dev:sandbox

# Deploiement manuel
npm run deploy
```

## API Endpoints

### Publics
- `GET /` -- Page d'accueil (landing)
- `GET /app` -- Dashboard utilisateur
- `GET /api/init-db` -- Initialiser la base de donnees
- `GET /api/emotions` -- Liste des 58 emotions (7 categories)
- `POST /api/auth/register` -- Inscription
- `POST /api/auth/login` -- Connexion

### Proteges (token requis)
- `GET /api/me/profile` -- Profil + stats + streak
- `GET /api/me/history` -- Historique XP/captures
- `POST /api/checkin/morning` -- Check-in du matin
- `POST /api/checkin/evening` -- Scan du soir
- `POST /api/capture/new` -- Capture instantanee (IA)
- `POST /api/weekly/decontamination` -- Exercice hebdo
- `POST /api/weekly/influence-circle` -- Cercle d'influence
- `POST /api/weekly/worry-review` -- Bilan boite a soucis
- `GET /api/pattern/list` -- Patterns detectes
- `POST /api/pattern/analyze` -- Lancer analyse IA
- `POST /api/pattern/self-declare` -- Autodeclarer un pattern
- `GET /api/pattern/definitions` -- Liste des 12 patterns
- `GET /api/quest/list` -- Quetes actives
- `POST /api/quest/complete` -- Completer une quete
- `GET /api/ritual/available` -- Rituels disponibles
- `POST /api/ritual/start` -- Demarrer un rituel (IA)
- `POST /api/ritual/complete` -- Completer un rituel

## Variables d'environnement
- `OPENROUTER_API_KEY` -- Cle API OpenRouter (secret Cloudflare)
- `DB` -- Binding D1 (configure dans wrangler.jsonc)
