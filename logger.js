// Simple colored logger (no external dependencies)

function timestamp() {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

module.exports = {
  info:    (msg) => console.log(`[${timestamp()}] [INFO] ${msg}`),
  success: (msg) => console.log(`[${timestamp()}] [SUCCESS] ${msg}`),
  warn:    (msg) => console.log(`[${timestamp()}] [WARN] ${msg}`),
  error:   (msg) => console.log(`[${timestamp()}] [ERROR] ${msg}`),
  debug:   (msg) => console.log(`[${timestamp()}] [DEBUG] ${msg}`),
  stat:    (msg) => console.log(`[${timestamp()}] [STAT] ${msg}`),
};
