'use strict';

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const DLL_BASE = 'C:\\ProgramData\\Lenovo\\Vantage\\Addins\\IdeaNotebookAddin';
const CSC      = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

const DEFAULTS = {
  workingLevel:    'Level_2',
  waitingLevel:    'Level_1',
  idleLevel:       'Off',
  blinkEnabled:    true,
  blinkCount:      3,
  blinkOnMs:       250,
  blinkOffMs:      200,
  blinkFinalLevel: 'Off',
};

function findDllDir() {
  if (!fs.existsSync(DLL_BASE)) return null;
  const vers = fs.readdirSync(DLL_BASE, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
  if (!vers.length) return null;
  return path.join(DLL_BASE, vers[vers.length - 1]);
}

function ensureExe(extDir, dllDir, ctx) {
  const exe = path.join(extDir, 'KbdCtrl.exe');
  if (fs.existsSync(exe)) return Promise.resolve(exe);
  ctx.log('Compiling KbdCtrl.exe...');
  return new Promise((resolve) => {
    const child = spawn(CSC, [
      '/out:' + exe,
      '/reference:' + path.join(dllDir, 'KeyboardContract.dll'),
      '/reference:' + path.join(dllDir, 'Newtonsoft.Json.dll'),
      path.join(extDir, 'KbdCtrl.cs')
    ], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) { ctx.log('Compiled OK'); resolve(exe); }
      else { ctx.log('Compile failed: ' + stderr); resolve(null); }
    });
  });
}

function getCfg(ctx) {
  const saved = ctx.getSettings();
  return Object.assign({}, DEFAULTS, saved);
}

function runCmd(exe, dllDir, cmdArgs, ctx) {
  const child = spawn(exe, [dllDir, ...cmdArgs], { windowsHide: true });
  if (ctx) {
    child.stdout.on('data', d => { const s = d.toString().trim(); if (s) ctx.log(s); });
    child.stderr.on('data', d => { const s = d.toString().trim(); if (s) ctx.log('ERR: ' + s); });
  }
}

let exe    = null;
let dllDir = null;
let ctxRef = null;
let cfgRef = null;

function setLevel(level) {
  if (!exe || level === 'Off' && level === level) {
    // 'Off' is valid — allow it
  }
  if (!exe) return;
  runCmd(exe, dllDir, ['set', level], ctxRef);
}

function blinkSequence(cfg) {
  if (!exe || !cfg.blinkEnabled) {
    if (!cfg.blinkEnabled) setLevel(cfg.idleLevel);
    return;
  }
  runCmd(exe, dllDir, [
    'blink',
    String(cfg.blinkCount),
    String(cfg.blinkOnMs),
    String(cfg.blinkOffMs),
    cfg.blinkFinalLevel,
  ], ctxRef);
}

module.exports = {
  async activate(ctx) {
    ctxRef = ctx;
    dllDir = findDllDir();
    if (!dllDir) { ctx.log('Lenovo Vantage DLLs not found.'); return; }
    exe = await ensureExe(__dirname, dllDir, ctx);
    if (!exe) return;
    cfgRef = getCfg(ctx);
    ctx.log('Ready — ' + exe);
  },

  onStateChange(newState, prevState) {
    if (!exe) return;
    const cfg = getCfg(ctxRef);
    if (newState === 'working') {
      setLevel(cfg.workingLevel);
    } else if (newState === 'waiting') {
      setLevel(cfg.waitingLevel);
    } else if (newState === 'idle') {
      if (prevState === 'waiting' && cfg.blinkEnabled) {
        setImmediate(() => blinkSequence(cfg));
      } else {
        setLevel(cfg.idleLevel);
      }
    }
  },

  onSettingsChange(newCfg) {
    cfgRef = Object.assign({}, DEFAULTS, newCfg);
    ctxRef.log('Settings updated');
  },

  deactivate() {
    if (exe && ctxRef) setLevel(DEFAULTS.idleLevel);
    exe = null;
  },
};
