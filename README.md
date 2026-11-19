# Pocket Bridge

Pilote tes conversations **Claude Code** et **Codex** de VS Code depuis ton téléphone Android.
Tout s'exécute sur le PC, avec les mêmes binaires et les mêmes historiques que les extensions VS Code
(`~/.claude`, `~/.codex`). Une conversation démarrée sur le téléphone apparaît dans VS Code, et inversement.

## Installation sur le téléphone (une seule fois)

1. Dans VS Code, clique **📱 Pocket** dans la barre d'état (en bas à droite).
2. **QR 1 : certificat.** Scanne-le, télécharge `pocket-bridge-ca.crt`, puis dans Android :
   Paramètres → Sécurité et confidentialité → Autres paramètres de sécurité → Installer depuis le stockage → **Certificat CA**.
3. **QR 2 : appairage.** Scanne-le. Chrome ouvre l'app, déjà connectée.
4. Menu ⋮ de Chrome → **Ajouter à l'écran d'accueil** → Installer, puis ⚙︎ → **Activer les notifications**.

## Utilisation

- **Claude / Codex** : bascule en haut ; recherche, filtre par projet ; badges « En cours » et « À valider ».
- **Nouvelle conversation** : choisis le dossier (espaces de travail VS Code, dossiers récents, ou un chemin quelconque).
- **Autorisations** : les demandes (commande, création ou modification de fichier, plan, question) s'affichent en carte,
  avec le diff. Elles arrivent aussi en notification sur le téléphone et en message dans VS Code. Réponds où tu veux.
- **Modèle / mode** : puces au-dessus de la zone de saisie.
- **🎤 Dictée** : le micro dans la zone de saisie transcrit ta voix.
- **Mode vocal** : mains libres. Tu parles, c'est envoyé ; la réponse est lue à voix haute, puis l'app réécoute.
  Pour une autorisation, dis « autoriser », « toujours » ou « refuser ». Dis « stop » pour quitter.
- **⋮ → Ouvrir dans VS Code** : affiche la conversation dans le panneau officiel Claude ou Codex du PC.
- **Miroir dans VS Code** : commande « Pocket Bridge : Ouvrir le miroir », qui affiche la même interface en direct dans VS Code.
- Une conversation qui tourne dans le panneau VS Code est suivie en direct depuis le téléphone (rafraîchissement toutes les 3 s).

## Hors de chez toi

Le téléphone doit atteindre `https://192.168.68.61:8788`. Le NAS (app TrueNAS « tailscale », nœud `truenas-scale`)
annonce le sous-réseau `192.168.68.0/24` (*subnet router*, configuré le 2026-11-19 ; la route doit être approuvée une fois
dans la console Tailscale → Machines → truenas-scale → Edit route settings). Avec Tailscale activé sur le téléphone,
la même adresse fonctionne donc de l'extérieur : même app, même appairage, même certificat. À la maison, laisse Tailscale coupé.
Conseil : réserve l'IP du PC dans le routeur (DHCP). Si l'IP change, le certificat du serveur est réémis
automatiquement ; l'autorité déjà installée sur le téléphone reste valable, seul le QR d'appairage est à rescanner.

## Sécurité

- Accès par jeton (cookie `HttpOnly`) remis par le QR d'appairage. Pour révoquer : commande
  « Pocket Bridge : Révoquer les téléphones connectés ».
- Le port HTTP 8787 ne sert sur le réseau que la page d'installation et le certificat. L'application complète n'y est
  servie qu'à ce PC (miroir VS Code).
- Un seul serveur par machine : la première fenêtre VS Code ouverte le porte et voit toutes les conversations.

## Développement

```bash
npm install
npm run build             # dist/extension.js + dist/web
npm run install-ext       # package le .vsix et l'installe dans VS Code
node scripts/build.mjs --dev && node dist/dev-server.js <claude.exe> <codex.exe>   # hors VS Code (ports 9787/9788)
node scripts/e2e.mjs claude <dossier>   # test de bout en bout (nouvelle conversation, flux, autorisations)
node scripts/ui-flow.mjs <sortie> <dossier>   # parcours UI headless (autorisation + mode vocal simulé)
node scripts/cleanup-e2e.mjs <codex.exe>   # supprime les conversations de test
```

Architecture : `src/agents/claude.ts` (Claude Agent SDK, binaire de l'extension Claude Code),
`src/agents/codex.ts` (JSON-RPC `codex app-server`, binaire de l'extension Codex), `src/server.ts` (HTTPS + WebSocket + Web Push),
`src/extension.ts` (barre d'état, QR, miroir, autorisations dans VS Code), `web/` (PWA Preact + htm, sans étape de build).
