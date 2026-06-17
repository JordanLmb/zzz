const mineflayer = require('mineflayer');
const config = require('./config');

/**
 * Standalone movement test script.
 * Connects to the server, waits for spawn, and walks forward for 5 seconds.
 * Includes the tick_end GrimAC workaround for 1.21+ servers.
 * 
 * Usage: node test-move.js
 * 
 * The bot must already be in Farmrun (not in the hub lobby).
 * If it's in the lobby, it will dump the GUI slots and exit.
 */
async function main() {
  console.log('=== MOVEMENT TEST (with tick_end fix) ===');
  
  const bot = mineflayer.createBot({
    host: config.SERVER_HOST,
    port: config.SERVER_PORT,
    username: config.MC_EMAIL,
    auth: 'microsoft',
    version: config.MC_VERSION,
    profilesFolder: config.AUTH_CACHE_DIR,
  });

  bot.on('login', () => {
    console.log(`[+] Connected as ${bot.username}`);
  });

  bot.on('kicked', (reason) => {
    console.log(`[-] Kicked: ${JSON.stringify(reason)}`);
    process.exit(1);
  });

  bot.on('error', (err) => {
    console.log(`[-] Error: ${err.message}`);
  });

  // Accept resource packs automatically (required by Neodium/BungeeCord)
  bot.on('resourcePack', () => {
    try { bot.acceptResourcePack(); } catch (e) {}
  });

  bot.once('spawn', async () => {
    console.log('[+] Spawned! Waiting 3s for world to load...');
    await sleep(3000);
    
    // GrimAC 1.21+ workaround: send tick_end every physics tick
    bot.on('physicTick', () => {
      try {
        bot._client.write('tick_end', {});
      } catch (e) {}
    });
    
    const pos = bot.entity.position;
    console.log(`[+] Position: ${pos.toString()}`);
    console.log(`[+] On ground: ${bot.entity.onGround}`);
    
    // Print entity attributes (speed, etc.)
    console.log('\n--- Entity Attributes ---');
    if (bot.entity.attributes) {
      for (const [key, attr] of Object.entries(bot.entity.attributes)) {
        console.log(`  ${key}: value=${attr.value}`);
      }
    }
    
    // Print potion effects
    console.log('\n--- Potion Effects ---');
    if (bot.entity.effects) {
      for (const [id, effect] of Object.entries(bot.entity.effects)) {
        console.log(`  Effect ${id}: amplifier=${effect.amplifier}, duration=${effect.duration}`);
      }
    }
    
    // Disable speed to match vanilla physics
    console.log('\n[+] Sending /speedoff...');
    bot.chat('/speedoff');
    await sleep(2000);
    
    // Test: walk forward in whatever direction we're currently facing
    console.log('\n[+] TEST: Walking forward for 5 seconds...');
    const startPos = bot.entity.position.clone();
    
    // Face current direction with pitch=0 (look straight ahead)
    await bot.look(bot.entity.yaw, 0, true);
    
    // Walk forward
    bot.setControlState('forward', true);
    
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      const p = bot.entity.position;
      const dist = p.distanceTo(startPos);
      console.log(`  ${(i+1)*0.5}s: Pos=(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) dist=${dist.toFixed(2)}`);
    }
    
    bot.clearControlStates();
    
    const finalDist = bot.entity.position.distanceTo(startPos);
    console.log(`\n[+] RESULT: Moved ${finalDist.toFixed(2)} blocks in 5 seconds`);
    
    if (finalDist > 5) {
      console.log('[+] SUCCESS: Movement is working! (>5 blocks in 5s)');
    } else if (finalDist > 1) {
      console.log('[~] PARTIAL: Bot moved a bit but slowly. Check anti-cheat/speed settings.');
    } else {
      console.log('[-] FAILURE: Bot barely moved. Movement is still broken.');
    }
    
    process.exit(0);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
