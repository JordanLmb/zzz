const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const config = require('./config');
const logger = require('./src/logger');
const { openMineAndTeleport } = require('./src/mine-gui');
const Miner = require('./src/miner');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

async function main() {
  logger.info('=== Neodium Mining Bot ===');
  logger.info(`Connecting to ${config.SERVER_HOST}:${config.SERVER_PORT} (MC ${config.MC_VERSION})...`);
  
  const bot = mineflayer.createBot({
    host: config.SERVER_HOST,
    port: config.SERVER_PORT,
    username: config.MC_EMAIL,
    auth: 'microsoft',
    version: config.MC_VERSION,
    profilesFolder: config.AUTH_CACHE_DIR,
    // Don't auto-reconnect, we handle it manually
  });
  
  // Load pathfinder AI
  bot.loadPlugin(pathfinder);
  
  // ── Event handlers ──
  
  // Accept resource packs automatically to avoid internal server errors from BungeeCord
  bot.on('resourcePack', (url, hash) => {
    logger.info(`Server sent resource pack. Automatically accepting it...`);
    try {
      bot.acceptResourcePack();
    } catch (e) {
      logger.error(`Failed to accept resource pack: ${e.message}`);
    }
  });
  
  bot.on('login', () => {
    logger.success(`Logged in as ${bot.username}!`);
  });
  
  bot.on('error', (err) => {
    logger.error(`Bot error: ${err.message}`);
  });
  
  bot.on('kicked', (reason) => {
    let reasonText = reason;
    try {
      if (typeof reason === 'object') reasonText = JSON.stringify(reason);
    } catch (e) {}
    logger.error(`Kicked from server: ${reasonText}`);
    process.exit(1);
  });
  
  bot.on('end', () => {
    logger.warn('Bot disconnected.');
    process.exit(1);
  });
  
  // Log chat messages (useful for debugging server responses)
  bot.on('messagestr', (message) => {
    logger.debug(`[CHAT] ${message}`);
  });
  
  // ── Wait for spawn ──
  await new Promise((resolve) => {
    bot.once('spawn', () => {
      logger.success('Spawned on server!');
      resolve();
    });
  });
  
  // Small delay to let the world load
  await sleep(3000);
  
  // Initialize Pathfinder default movements now that chunks might be loaded
  const defaultMove = new Movements(bot);
  // We can disable risky movements if we want to avoid anti-cheat, but default is usually fine
  bot.pathfinder.setMovements(defaultMove);
  
  global.isTeleporting = false;
  
  // GrimAC 1.21+ workaround: send tick_end packet every physics tick.
  // Without this, GrimAC rejects ALL movement packets because it expects
  // the vanilla client's tick cycle synchronization.
  bot.on('physicsTick', () => {
    try {
      // ONLY send during 'play' state and not during server transitions
      if (bot._client && bot._client.state === 'play' && !global.isTeleporting) {
        bot._client.write('tick_end', {});
      }
    } catch (e) {
      // Silently ignore
    }
  });
  
  logger.info(`Current position: ${bot.entity.position.toString()}`);
  
  // Viewer initialization moved to after lobby navigation
  
  // ── Lobby navigation ──
  // The server has a hub/lobby. The bot needs to:
  // 1. Right-click in the air to open a GUI menu
  // 2. Click on the correct slot to join the game world
  // 3. Wait for teleportation to the game world
  await navigateLobby(bot);
  
  // ── Start 3D Viewer ──
  try {
    mineflayerViewer(bot, { port: 3000, firstPerson: false });
    logger.success('3D Viewer running at http://localhost:3000 — open this in your browser!');
  } catch (err) {
    logger.warn(`Could not start viewer: ${err.message}`);
  }
  
  // ── Main loop ──
  const miner = new Miner(bot, config);
  
  while (true) {
    try {
      // Step 1: Open /mine GUI and teleport to the mine
      // We must ALWAYS do this after joining Farmrun, because Farmrun spawns us in the Lobby, not in the actual mine!
      logger.info('Opening /mine GUI to teleport to Quartz Mine...');
      await openMineAndTeleport(bot, config.MINE_SLOT, config.MINE_SPAWN);
      
      // Small delay to let chunks load after teleport
      await sleep(2000);
      
      logger.info(`Position after teleport: ${bot.entity.position.toString()}`);
      
      // FIX ANTI-CHEAT ROLLBACK: Reset speed to vanilla so Mineflayer physics are accurate
      logger.info('Sending /speedoff to prevent anti-cheat movement rollbacks...');
      bot.chat('/speedoff');
      await sleep(1000);
      
      // Step 2: If we're above the mine (e.g. after a reset, Y=51), wait to fall down
      await waitForGround(bot);
      
      logger.info(`Landed at Y=${bot.entity.position.y}`);
    
      // DEBUG: Let's check what block the bot ACTUALLY sees under its feet!
      const feetPos = bot.entity.position.offset(0, -0.5, 0);
      const blockUnder = bot.blockAt(feetPos);
      logger.info(`[DEBUG] Block under feet is: ${blockUnder ? blockUnder.name : 'null/unloaded'}`);
      
      // Step 3: Start mining
      logger.info('Starting mining...');
      const result = await miner.mineAll();
      
      if (result === 'reset') {
        logger.warn('Mine reset detected! Restarting from /mine command...');
        await sleep(2000);
        // Loop will restart: /mine → teleport → mine again
        continue;
      }
      
      if (result === 'complete') {
        logger.success('Mine fully cleared! Waiting for next reset (30 minutes)...');
        // Wait for the mine to reset (the server will teleport us)
        await waitForReset(bot, miner);
        logger.info('Reset detected after waiting. Restarting...');
        continue;
      }
      
    } catch (err) {
      logger.error(`Error in main loop: ${err.message}`);
      logger.error(err.stack);
      await sleep(5000);
    }
  }
}

/**
 * Wait for the bot to land on the ground.
 * Useful after being teleported above the mine (Y=51 after reset).
 */
async function waitForGround(bot) {
  if (bot.entity.onGround) return;
  
  logger.info('Waiting to land on the ground...');
  
  let attempts = 0;
  while (!bot.entity.onGround && attempts < 100) {
    await sleep(100);
    attempts++;
  }
  
  if (bot.entity.onGround) {
    logger.success(`Landed at Y=${bot.entity.position.y.toFixed(1)}`);
  } else {
    logger.warn('Still not on ground after 10 seconds. Continuing anyway...');
  }
}

/**
 * Wait for the mine to reset (detected via forced teleportation).
 * The bot stays idle until it detects a position change.
 */
async function waitForReset(bot, miner) {
  logger.info('Waiting for mine reset (teleportation)...');
  
  return new Promise((resolve) => {
    function onForcedMove() {
      logger.info('Teleportation detected! Mine has reset.');
      bot.removeListener('forcedMove', onForcedMove);
      resolve();
    }
    
    bot.on('forcedMove', onForcedMove);
    
    // Also poll position in case forcedMove doesn't fire
    const startPos = bot.entity.position.clone();
    const check = setInterval(() => {
      const dist = bot.entity.position.distanceTo(startPos);
      if (dist > 5) {
        clearInterval(check);
        bot.removeListener('forcedMove', onForcedMove);
        resolve();
      }
    }, 1000);
  });
}

/**
 * Navigate through the server lobby/hub.
 * Steps:
 * 1. Right-click in the air to open a GUI
 * 2. Click the correct slot to join the game world
 * 3. Wait for teleportation
 */
async function navigateLobby(bot) {
  logger.info('Navigating server lobby...');
  
  // Wait a bit before doing anything to not trigger anti-spam/anti-bot (increased to 8s)
  logger.info('Waiting 8 seconds before interacting with lobby...');
  await sleep(8000);
  
  // Step 1: Right-click (use item) to open the lobby GUI
  // In mineflayer, right-clicking in the air = bot.activateItem()
  logger.info('Right-clicking to open lobby menu...');
  bot.activateItem();
  
  // Wait for the GUI to open
  const window = await waitForWindowOpen(bot, 5000);
  if (!window) {
    logger.warn('Lobby GUI did not open. Trying again...');
    await sleep(3000);
    bot.activateItem();
    const window2 = await waitForWindowOpen(bot, 5000);
    if (!window2) {
      throw new Error('Could not open lobby GUI after 2 attempts.');
    }
  }
  
  logger.info(`Lobby GUI opened: "${bot.currentWindow?.title || 'Unknown'}" (${bot.currentWindow?.slots?.length || 0} slots)`);
  
  // Wait a bit before clicking to simulate human reading time (increased to 4s)
  logger.info('Waiting 4 seconds before clicking Farmrun...');
  await sleep(4000);
  
  // Log all slots for debugging
  if (bot.currentWindow) {
    for (let i = 0; i < Math.min(bot.currentWindow.slots.length, 27); i++) {
      const item = bot.currentWindow.slots[i];
      if (item) {
        logger.debug(`  Slot ${i}: ${item.name} x${item.count} "${item.displayName || ''}"`);
      }
    }
  }
  
  // Step 2: Click the Farmrun slot (21, 22, 23) found during the lobby dump
  const farmrunSlots = [22, 21, 23]; // Try middle farmrun paper first
  
  let clicked = false;
  for (const slot of farmrunSlots) {
    if (bot.currentWindow && bot.currentWindow.slots[slot]) {
      const item = bot.currentWindow.slots[slot];
      logger.info(`Clicking Farmrun slot ${slot}: ${item.name}`);
      bot.clickWindow(slot, 0, 0);
      clicked = true;
      break;
    }
  }
  
  if (!clicked) {
    logger.warn('Could not find a clickable item in the center of the lobby menu.');
    logger.warn('Please check the debug logs above to find the correct slot number.');
    // Close the window and try /mine directly anyway
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
  }
  
  // Step 3: Wait for teleportation to the game world (Farmrun)
  logger.info('Waiting for teleportation to Farmrun (waiting for spawn event)...');
  global.isTeleporting = true;
  
  // Wait up to 30 seconds for the queue and teleport to finish
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn('Timeout waiting for Farmrun spawn, continuing anyway...');
      bot.removeListener('spawn', onSpawn);
      global.isTeleporting = false;
      resolve();
    }, 30000);
    
    function onSpawn() {
      clearTimeout(timeout);
      logger.success('Spawn event detected (arrived in Farmrun)!');
      global.isTeleporting = false;
      resolve();
    }
    
    bot.once('spawn', onSpawn);
  });
  
  await sleep(2000); // Give it a bit more time to settle
  
  // Check if position changed significantly
  logger.success(`Now at position: ${bot.entity.position.toString()}`);
  logger.success('Lobby navigation complete!');
}

function waitForWindowOpen(bot, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (bot.currentWindow) {
      resolve(bot.currentWindow);
      return;
    }
    
    const timeout = setTimeout(() => {
      bot.removeListener('windowOpen', onWindow);
      resolve(null);
    }, timeoutMs);
    
    function onWindow(window) {
      clearTimeout(timeout);
      resolve(window);
    }
    
    bot.once('windowOpen', onWindow);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start the bot
main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  logger.error(err.stack);
  process.exit(1);
});
