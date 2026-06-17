const path = require('path');

module.exports = {
  // ── Serveur ──
  SERVER_HOST: 'play.neodium.fr',
  SERVER_PORT: 25565,
  MC_VERSION: '1.21.11', // Enforced by Neodium
  
  // ── Compte Microsoft ──
  // Le bot utilisera le Device Code Flow : au premier lancement,
  // un code s'affichera dans le terminal. Va sur https://www.microsoft.com/link
  // et entre le code. Après ça, c'est caché pour toujours.
  MC_EMAIL: 'jordan.lmb@hotmail.fr',
  
  // ── Mine GUI ──
  // Slot dans le menu /mine (0-indexé). Slot 4 = 5e position de gauche à droite.
  // Change ce slot quand tu changes de mine.
  MINE_SLOT: 14,  // Nether Quartz Ore (Slot 14)
  // MINE_SLOT: 15, // Redstone Ore (Slot 15, unlocked at 45)
  
  // ── Coordonnées de la mine ──
  // Spawn après clic dans le GUI /mine
  MINE_SPAWN: { x: 1656, y: 21, z: -1803 },
  
  // Rectangle de la mine (coins)
  MINE_BOUNDS: {
    minX: 1576,
    maxX: 1650,
    minZ: -1882,
    maxZ: -1808,
    topY: 21,      // Couche la plus haute (surface)
    bottomY: -54,  // Couche la plus basse (au-dessus de la bedrock)
  },
  
  // ── Paramètres de minage ──
  // Délai entre chaque bloc miné (en ms). 0 = aussi vite que possible.
  // Augmente si le serveur kick pour "mining too fast".
  DIG_DELAY_MS: 50,
  
  // Délai entre chaque déplacement (en ticks, 1 tick = 50ms)
  MOVE_TICKS: 3,
  
  // Dossier pour le cache d'authentification Microsoft
  AUTH_CACHE_DIR: path.join(__dirname, 'auth-cache'),
};
