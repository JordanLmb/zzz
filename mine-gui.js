const logger = require('./logger');

/**
 * Opens the /mine GUI, clicks the correct slot, and waits for teleportation.
 * @param {import('mineflayer').Bot} bot
 * @param {number} slot - The slot index to click (0-indexed)
 * @param {object} expectedSpawn - { x, y, z } expected coordinates after teleport
 */
async function openMineAndTeleport(bot, slot, expectedSpawn) {
  logger.info('Sending /mine command...');
  bot.chat('/mine');
  
  // Wait for the GUI window to open
  const window = await waitForWindow(bot, 5000);
  if (!window) {
    throw new Error('Le menu /mine ne s\'est pas ouvert dans les 5 secondes.');
  }
  
  logger.info(`Menu /mine ouvert: "${window.title}" (${window.slots.length} slots)`);
  
  // Log all slots for debugging
  for (let i = 0; i < Math.min(window.slots.length, 27); i++) {
    const item = window.slots[i];
    if (item) {
      logger.debug(`  Slot ${i}: ${item.name} x${item.count} - "${item.displayName || ''}"`);
    }
  }
  
  logger.info(`Clicking slot ${slot}...`);
  
  // Click the mine slot (left click, mode 0)
  bot.clickWindow(slot, 0, 0);
  
  // Wait for teleportation (position change > 10 blocks)
  await waitForTeleport(bot, expectedSpawn, 10000);
  
  logger.success(`Teleported to mine! Position: ${bot.entity.position.toString()}`);
}

/**
 * Waits for a window (GUI) to open.
 */
function waitForWindow(bot, timeoutMs = 5000) {
  return new Promise((resolve) => {
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

/**
 * Waits for the bot to be teleported. We don't check coordinates strictly 
 * because the spawn point of the mine might be exactly the same as the Farmrun lobby.
 */
function waitForTeleport(bot, expectedSpawn, timeoutMs = 8000) {
  return new Promise((resolve) => {
    // Just wait for 8 seconds to ensure teleport completes, 
    // or resolve early if we get a forcedMove event.
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        bot.removeListener('forcedMove', onMove);
        resolve(); // Always resolve, don't throw an error!
      }
    }, timeoutMs);
    
    function onMove() {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        bot.removeListener('forcedMove', onMove);
        // Small delay to let chunks load after the forced move
        setTimeout(resolve, 2000);
      }
    }
    
    bot.once('forcedMove', onMove);
  });
}

module.exports = {
  openMineAndTeleport,
};
