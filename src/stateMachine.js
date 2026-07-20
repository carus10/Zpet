// Cok-kaynakli state machine.
// Her kaynak kendi state'ini tutar.
// Etkin state = en yuksek oncelikli kaynagin state'i.
'use strict';

const { STATE_PRIORITY } = require('../config');

/**
 * @typedef {Object} StateChangeEvent
 * @property {string} source - The source of the state change (e.g. 'antigravity', 'system')
 * @property {string} state - The new state (e.g. 'idle', 'working', 'waiting', 'error')
 */

/**
 * Creates a state machine for managing pet states from multiple sources.
 * @param {(state: string, prevState: string) => void} [onChange] Callback triggered when the effective state changes.
 * @returns {{
 *   setState: (event: StateChangeEvent) => void,
 *   removeSource: (name: string) => void,
 *   getEffectiveState: () => string
 * }}
 */
function createStateMachine(onChange) {
  const sources = new Map();
  let effectiveState = 'idle';

  function ensureSource(name) {
    if (!sources.has(name)) {
      sources.set(name, { current: 'idle' });
    }
    return sources.get(name);
  }

  function recompute() {
    let best = 'idle';
    let bestPri = 0;
    for (const s of sources.values()) {
      const pri = STATE_PRIORITY[s.current] || 0;
      if (pri > bestPri) {
        bestPri = pri;
        best = s.current;
      }
    }
    if (best !== effectiveState) {
      const prev = effectiveState;
      effectiveState = best;
      if (onChange) onChange(effectiveState, prev);
    }
  }

  function setState({ source, state }) {
    const s = ensureSource(source);
    s.current = state;
    recompute();
  }

  function removeSource(name) {
    sources.delete(name);
    recompute();
  }

  function getEffectiveState() {
    return effectiveState;
  }

  return { setState, removeSource, getEffectiveState };
}

module.exports = { createStateMachine };
