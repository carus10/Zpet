'use strict';

let ctx = null;

function activate(context) {
  ctx = context;
  ctx.log('Example Notifier activated!');
}

function deactivate() {
  if (ctx) ctx.log('Example Notifier deactivated.');
  ctx = null;
}

function onStateChange(newState, prevState) {
  if (!ctx) return;
  const settings = ctx.getSettings();
  if (settings.logLevel === 'silent') return;

  const prefix = settings.showTimestamp ? `[${new Date().toLocaleTimeString()}] ` : '';
  ctx.log(`${prefix}State changed: ${prevState} -> ${newState}`);
}

function onSettingsChange(newSettings) {
  if (!ctx) return;
  ctx.log('Settings updated: ' + JSON.stringify(newSettings));
}

module.exports = { activate, deactivate, onStateChange, onSettingsChange };
