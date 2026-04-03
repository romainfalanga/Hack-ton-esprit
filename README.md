# 🧠 Décode Ton Esprit — Le Jeu de Ta Vie

## Vue d'ensemble
Application web gamifiée de développement personnel et de compréhension de soi. Basée sur la thérapie cognitive et comportementale, elle aide les utilisateurs à observer leurs schémas mentaux, détecter leurs patterns psychologiques et les transformer.

## Architecture : 3 Couches

### Couche 1 — Le Socle Universel
Ce que tout être humain fait, la base de la conscience de soi :
- **Check-in du matin** (2 min) — Émotion, énergie, intention du jour → +5 XP Résonance
- **Scan du soir** (5 min) — 3 micro-victoires, gratitude invisible, émotion forte → +5 à +15 XP
- **Capture instantanée** — Bouton d'urgence pour capturer pensées/émotions → +2 XP Lucidité
- **Décontamination hebdo** (15 min) — Analyse d'une pensée envahissante → +30 XP
- **Cercle d'influence** (10 min) — Contrôle vs hors contrôle → +25 XP
- **Bilan boîte à soucis** (10 min) — Anticipé vs réalité → +25 XP

### Couche 2 — Quêtes Émergentes
Défis personnalisés basés sur 12 familles de patterns détectés par l'IA :
- Difficulté à s'affirmer, Besoin de contrôle, Suppression émotionnelle
- Peur de l'abandon, Abnégation, Lecture de pensée
- Biais d'engagement, Impulsivité, Culpabilité financière
- Manipulation subie, Catastrophisation, Nostalgie paralysante

### Couche 3 — Rituels de Profondeur
Introspections mensuelles, trimestrielles et annuelles au contenu personnalisé par l'IA.

## Système de Progression
5 stats : 🧠 Lucidité, 💚 Résonance, 🔓 Liberté, 🗣️ Connexion, ⚡ Action
10 niveaux d'Éveil global avec déblocage progressif des couches.

## Stack technique
- **Backend** : Hono (Cloudflare Workers)
- **Frontend** : HTML/JS/TailwindCSS (inline)
- **Base de données** : Cloudflare D1 (SQLite)
- **IA** : OpenRouter (Google Gemini Flash)
- **Déploiement** : Cloudflare Pages

## URLs API
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/init-db` | GET | Initialise la BDD |
| `/api/auth/register` | POST | Inscription |
| `/api/auth/login` | POST | Connexion |
| `/api/me/profile` | GET | Profil + stats |
| `/api/checkin/morning` | POST | Check-in matin |
| `/api/checkin/evening` | POST | Scan du soir |
| `/api/capture/new` | POST | Capture instantanée |
| `/api/capture/list` | GET | Liste des captures |
| `/api/weekly/decontamination` | POST | Décontamination |
| `/api/weekly/influence-circle` | POST | Cercle d'influence |
| `/api/weekly/worry-review` | POST | Bilan soucis |
| `/api/pattern/analyze` | POST | Analyse IA des patterns |
| `/api/pattern/list` | GET | Patterns détectés |
| `/api/pattern/self-declare` | POST | Auto-déclaration |
| `/api/pattern/definitions` | GET | Liste patterns dispo |
| `/api/quest/list` | GET | Quêtes actives |
| `/api/quest/complete` | POST | Compléter une quête |
| `/api/ritual/available` | GET | Rituels disponibles |
| `/api/ritual/start` | POST | Démarrer un rituel |
| `/api/ritual/complete` | POST | Compléter un rituel |
| `/api/me/history` | GET | Historique XP + captures |
| `/api/emotions` | GET | Roue des émotions |

## Déploiement
- **Plateforme** : Cloudflare Pages
- **Status** : ✅ Actif en dev
- **Dernière MAJ** : 2026-04-03
