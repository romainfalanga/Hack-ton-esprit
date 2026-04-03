# 🧠 Hack Ton Esprit — Le Jeu de Ta Vie

## Vue d'ensemble
Application web gamifiée de développement personnel et de compréhension de soi. Basée sur la thérapie cognitive et comportementale, elle aide les utilisateurs à observer leurs schémas mentaux, détecter leurs patterns psychologiques et les transformer.

## Architecture : 3 Couches

### Couche 1 — Le Socle Universel
- **Check-in du matin** (2 min) — Émotion, énergie, intention → +5 XP Résonance
- **Scan du soir** (5 min) — Micro-victoires, gratitude, émotion forte → +5 à +15 XP
- **Capture instantanée** — Bouton d'urgence pensées/émotions → +2 XP Lucidité
- **Décontamination hebdo** (15 min) — Analyse pensée envahissante → +30 XP
- **Cercle d'influence** (10 min) — Contrôle vs hors contrôle → +25 XP
- **Bilan boîte à soucis** (10 min) — Anticipé vs réalité → +25 XP

### Couche 2 — Quêtes Émergentes
12 familles de patterns détectés par l'IA, 36+ quêtes personnalisées.

### Couche 3 — Rituels de Profondeur
Introspections mensuelles, trimestrielles et annuelles au contenu personnalisé.

## Stack technique
- **Backend** : Hono (Cloudflare Workers)
- **Frontend** : HTML/JS/TailwindCSS
- **Base de données** : Cloudflare D1 (SQLite)
- **IA** : OpenRouter (Google Gemini Flash)
- **CI/CD** : GitHub → Cloudflare Pages (déploiement auto)

## URLs
- **Production** : https://hack-ton-esprit.pages.dev
- **GitHub** : https://github.com/romainfalanga/Hack-ton-esprit

## Déploiement
Chaque push sur `main` déclenche un déploiement automatique via Cloudflare Pages.

```bash
# Dev local
npm run build
npm run dev:sandbox

# Déploiement manuel
npm run deploy
```
