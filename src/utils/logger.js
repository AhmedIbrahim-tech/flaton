const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function write(stream, symbol, message, color) {
  const useColor = Boolean(stream.isTTY);
  const prefix = useColor ? `${color}${symbol}${RESET}` : symbol;
  stream.write(`${prefix} ${message}\n`);
}

export const logger = {
  success(message) {
    write(process.stdout, '✓', message, GREEN);
  },
  error(message) {
    write(process.stderr, '✗', message, RED);
  },
  warn(message) {
    write(process.stdout, '⚠', message, YELLOW);
  },
  info(message) {
    write(process.stdout, 'i', message, CYAN);
  },
  step(message) {
    write(process.stdout, '•', message, DIM);
  },
};
