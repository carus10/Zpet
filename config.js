'use strict';

const path = require('path');
const os = require('os');

const WINDOW_WIDTH = 200;
const WINDOW_HEIGHT = 200;

const STATE_PRIORITY = {
  waiting: 5,
  working: 3,
  idle: 1,
};

const ANTIGRAVITY = {
  convDir: path.join(os.homedir(), '.gemini', 'antigravity-ide', 'conversations'),
  cliBrainDir: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain'),
};

const WATCH_MODE = 'BOTH'; // 'IDE', 'CLI', 'BOTH'

const ASSETS_DIR = path.join(__dirname, 'assets');

module.exports = {
  WINDOW_WIDTH, WINDOW_HEIGHT,
  STATE_PRIORITY,
  ANTIGRAVITY,
  ASSETS_DIR,
  WATCH_MODE,
};
