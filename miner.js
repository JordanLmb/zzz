const { Vec3 } = require('vec3');
const logger = require('./logger');

/**
 * Core mining engine.
 * Mines the entire mine rectangle layer by layer (top to bottom) in a serpentine pattern.
 * 
 * Strategy:
 * - The bot stands ON the blocks of the current layer (feet at layer_y + 1)
 * - It mines blocks at layer_y level in front of it to create a walkway
 * - It walks forward through the cleared space
 * - At the end of each row, it shifts one block sideways and reverses
 * - After completing a layer, it mines the block under its feet to drop down
 * 
 * The enchant effects (23-block line, 3x3) are handled server-side.
 * The bot simply checks if a block is air before trying to mine it (skip if already broken).
 */
class Miner {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    this.bounds = config.MINE_BOUNDS;
    this.blocksMined = 0;
    this.startTime = Date.now();
    this.currentLayer = this.bounds.topY;
    this.running = false;
    this.teleported = false;

    // Note: The tick_end workaround is handled centrally in index.js to prevent Bungee errors.

    // Listen for sudden teleportation (mine reset)
    this.bot.on('forcedMove', () => {
      if (this.running) {
        // Only count it as a reset if we are teleported high up (e.g., Y=51)
        if (this.bot.entity.position.y > 40) {
          logger.warn(`Forced move to Y=${this.bot.entity.position.y.toFixed(1)} detected! Mine reset.`);
          this.teleported = true;
        }
      }
    });
  }

  /**
   * Main mining loop. Mines the entire mine from top to bottom.
   * Returns when the mine is fully mined or a reset is detected.
   * @returns {'reset'|'complete'} reason for stopping
   */
  async mineAll() {
    this.running = true;
    this.teleported = false;
    this.blocksMined = 0;
    this.startTime = Date.now();

    logger.info(`Starting mining from Y=${this.bounds.topY} down to Y=${this.bounds.bottomY}`);
    logger.info(`Mine dimensions: X=${this.bounds.minX}→${this.bounds.maxX} (${this.bounds.maxX - this.bounds.minX + 1} blocks), Z=${this.bounds.minZ}→${this.bounds.maxZ} (${this.bounds.maxZ - this.bounds.minZ + 1} blocks)`);

    // Equip pickaxe before doing anything else
    await this.equipPickaxe();

    // First, navigate to the starting corner of the mine
    await this.navigateToStart();

    // Mine layer by layer from top to bottom
    for (let y = this.bounds.topY; y >= this.bounds.bottomY; y--) {
      if (this.teleported) {
        logger.warn('Mine reset detected. Stopping current mining pass.');
        this.running = false;
        return 'reset';
      }

      this.currentLayer = y;
      logger.info(`Mining layer Y=${y} (${this.bounds.topY - y + 1}/${this.bounds.topY - this.bounds.bottomY + 1})`);

      await this.mineLayer(y);

      // Drop down to next layer (mine the block under our feet)
      if (y > this.bounds.bottomY) {
        await this.dropDown(y);
      }

      // Stats every 5 layers
      if ((this.bounds.topY - y + 1) % 5 === 0) {
        this.logStats();
      }
    }

    this.running = false;
    logger.success(`Mine fully cleared! Total blocks mined: ${this.blocksMined}`);
    this.logStats();
    return 'complete';
  }

  /**
   * Navigate to the starting corner of the mine.
   * The bot needs to be at the surface level, above the mine.
   */
  async navigateToStart() {
    const startX = this.bounds.maxX;
    const startZ = this.bounds.minZ;
    const startY = this.bounds.topY;

    logger.info(`Navigating to starting corner (${startX}, ${startY + 1}, ${startZ})...`);

    // Simple movement: walk towards the target position
    await this.walkTo(startX, startY + 1, startZ);

    logger.success('Arrived at starting corner.');
  }

  /**
   * Find the 'Pioche ultime' or any pickaxe in inventory and equip it.
   */
  async equipPickaxe() {
    const items = this.bot.inventory.items();

    // Find item named 'Pioche ultime' or any pickaxe
    let targetPickaxe = items.find(item => {
      try {
        const itemStr = JSON.stringify(item);
        return itemStr.includes('Pioche ultime');
      } catch (e) {
        return false;
      }
    }) || items.find(item => item.name.includes('pickaxe'));

    if (targetPickaxe) {
      try {
        await this.bot.equip(targetPickaxe, 'hand');
        logger.success(`Equipped pickaxe: ${targetPickaxe.customName || targetPickaxe.name}`);
      } catch (err) {
        logger.error(`Failed to equip pickaxe: ${err.message}`);
      }
    } else {
      logger.warn('No pickaxe found in inventory! Mining with empty hand...');
      // Log inventory to help debug
      logger.debug(`Inventory: ${items.map(i => i.name).join(', ')}`);
    }
  }

  /**
   * Mine a single layer at the given Y coordinate.
   * Uses a serpentine (zigzag) pattern across the X axis, row by row along Z.
   * 
   * The bot walks ON the blocks at Y level, mining blocks at Y level in front.
   * Wait... actually the bot walks ON blocks at Y-1, mining blocks at Y level.
   * But from the surface, the bot walks ON Y blocks and mines Y blocks in front at the same level.
   * 
   * Let me clarify the geometry:
   * - Bot feet are at approximately Y+1 (standing on block at Y)
   * - Bot mines block at Y level in front of it
   * - After mining, the bot can walk forward (block at Y is gone, block at Y-1 supports)
   * 
   * Actually for the FIRST layer (topY), the bot stands on the top surface.
   * It mines the block UNDER its feet to enter the mine, then walks on the layer below.
   * 
   * Simplified approach: just navigate to each block position and dig it if it's not air.
   */
  async mineLayer(y) {
    let xDirection = -1; // Start going from maxX towards minX

    for (let z = this.bounds.minZ; z <= this.bounds.maxZ; z++) {
      if (this.teleported) return;

      const startX = xDirection === -1 ? this.bounds.maxX : this.bounds.minX;
      const endX = xDirection === -1 ? this.bounds.minX : this.bounds.maxX;

      // Mine along this row
      for (let x = startX; xDirection === -1 ? x >= endX : x <= endX; x += xDirection) {
        if (this.teleported) return;

        // Move towards this position first!
        await this.moveToAdjacent(x, y, z);

        const blockPos = new Vec3(x, y, z);
        const block = this.bot.blockAt(blockPos);

        if (block && block.name !== 'air' && block.name !== 'bedrock' && block.name !== 'cave_air') {
          try {
            // Look at the block
            await this.bot.lookAt(blockPos.offset(0.5, 0.5, 0.5));

            // Dig it
            await this.safeDig(block);

            // Small delay to avoid overwhelming the server
            if (this.config.DIG_DELAY_MS > 0) {
              await this.sleep(this.config.DIG_DELAY_MS);
            }
          } catch (err) {
            // Block might have been broken by enchant effect, skip it
            if (!err.message.includes('is not diggable')) {
              logger.debug(`Dig error at (${x}, ${y}, ${z}): ${err.message}`);
            }
          }
        }
      }

      // Reverse direction for next row (serpentine)
      xDirection *= -1;
    }
  }

  /**
   * Move to be adjacent to the target block position for mining.
   * The bot should be within mining reach (~4.5 blocks).
   */
  async moveToAdjacent(x, y, z) {
    const botPos = this.bot.entity.position;
    const dx = (x + 0.5) - botPos.x;
    const dz = (z + 0.5) - botPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Only move if we're too far away (3 blocks ensures mining reach)
    if (dist > 3) {
      await this.walkTo(x, botPos.y, z);
    }
  }

  /**
   * Drop down one layer by mining the block directly under the bot's feet.
   */
  async dropDown(currentY) {
    const pos = this.bot.entity.position;
    const blockBelow = this.bot.blockAt(new Vec3(Math.floor(pos.x), currentY, Math.floor(pos.z)));

    if (blockBelow && blockBelow.name !== 'air') {
      await this.bot.lookAt(new Vec3(Math.floor(pos.x) + 0.5, currentY + 0.5, Math.floor(pos.z) + 0.5));
      try {
        await this.safeDig(blockBelow);
      } catch (err) {
        // Already air, we can just fall
      }
    }

    // Wait for the bot to fall
    await this.sleep(300);

    // Wait until the bot is on the ground
    let attempts = 0;
    while (!this.bot.entity.onGround && attempts < 20) {
      await this.sleep(100);
      attempts++;
    }
  }

  /**
   * Safely dig a block with a timeout to prevent hanging on custom enchants.
   * Modifies block hardness so mineflayer thinks it's an instamine and sends the finish packet immediately.
   */
  async safeDig(block) {
    if (!block || block.name === 'air' || block.name === 'cave_air' || block.name === 'bedrock') return;

    try {
      // Force instamine by overriding hardness
      const originalHardness = block.hardness;
      block.hardness = 0;

      let isDone = false;
      const digPromise = this.bot.dig(block, 'ignore')
        .then(() => { isDone = true; })
        .catch(() => { isDone = true; });

      await Promise.race([
        digPromise,
        this.sleep(500) // Fast timeout fallback
      ]);

      if (!isDone) {
        try { this.bot.stopDigging(); } catch (e) { }
      }

      // Restore hardness
      block.hardness = originalHardness;
      this.blocksMined++;
    } catch (err) {
      // Ignore
    }
  }

  /**
   * Walk to a target position using vanilla control states.
   * 
   * Key design decisions:
   * - We set entity.yaw directly for IMMEDIATE physics effect (prismarine-physics
   *   reads entity.yaw on every tick to calculate the "forward" direction vector)
   * - We also call bot.look() to send a rotation packet to the SERVER so it
   *   knows where we're looking (GrimAC checks this)
   * - We use bot.waitForTicks(1) instead of sleep(50) to synchronize our loop
   * Opus's custom implementation to bypass GrimAC restrictions on pathfinder.
   */
  async walkTo(x, y, z) {
    const target = new Vec3(x + 0.5, this.bot.entity.position.y, z + 0.5);
    
    const pos0 = this.bot.entity.position;
    const initDx = target.x - pos0.x;
    const initDz = target.z - pos0.z;
    const initDist = Math.sqrt(initDx * initDx + initDz * initDz);
    
    // Don't bother if already there
    if (initDist < 1.0) return;
    
    logger.info(`Walking to X=${x}, Z=${z} (distance: ${initDist.toFixed(1)})...`);
    
    let lastDist = initDist;
    let stuckTicks = 0;
    const MAX_STUCK_TICKS = 100; // Give up after 5 seconds of being stuck
    
    // Set initial look direction BEFORE starting to move
    // Correct Minecraft yaw formula: Math.atan2(-dx, dz)
    const initYaw = Math.atan2(-initDx, initDz);
    this.bot.entity.yaw = initYaw;       
    this.bot.entity.pitch = 0;            
    await this.bot.look(initYaw, 0, true);
    
    // Start walking
    this.bot.setControlState('forward', true);
    
    while (true) {
      if (this.teleported || !this.running) {
        this.stopMoving();
        return;
      }

      const pos = this.bot.entity.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Arrived?
      if (dist < 1.0) {
        this.stopMoving();
        return;
      }

      // Update look direction every tick:
      const yaw = Math.atan2(-dx, dz);
      if (Math.abs(this.bot.entity.yaw - yaw) > 0.1) {
        this.bot.entity.yaw = yaw;
        this.bot.look(yaw, 0, true).catch(() => {});
      }
      
      // Stuck detection (2D distance)
      if (Math.abs(lastDist - dist) < 0.02) {
        stuckTicks++;
      } else {
        stuckTicks = 0;
      }
      lastDist = dist;

      // Auto-jump if stuck (probably hitting a wall or block edge)
      if (stuckTicks > 4) {
        this.bot.setControlState('jump', true);
      } else {
        this.bot.setControlState('jump', false);
      }

      // Log stuck status periodically
      if (stuckTicks > 0 && stuckTicks % 20 === 0) {
        logger.warn(`Stuck for ${stuckTicks} ticks. Dist=${dist.toFixed(2)}, Pos=${pos.toString()}`);
      }

      // Safety valve: give up if stuck too long
      if (stuckTicks >= MAX_STUCK_TICKS) {
        logger.warn(`Gave up walking after ${MAX_STUCK_TICKS} stuck ticks. Dist remaining: ${dist.toFixed(1)}`);
        this.stopMoving();
        return;
      }

      // Wait for the next physics tick (synchronized with the engine)
      await this.bot.waitForTicks(1);
    }
  }

  stopMoving() {
    this.bot.clearControlStates();
  }

  /**
   * Log mining statistics.
   */
  logStats() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const rate = this.blocksMined / (elapsed / 60);
    const pos = this.bot.entity.position;
    logger.stat(`Blocks mined: ${this.blocksMined} | Rate: ${rate.toFixed(0)} blocks/min | Layer: Y=${this.currentLayer} | Position: (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}) | Elapsed: ${(elapsed / 60).toFixed(1)} min`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Miner;
