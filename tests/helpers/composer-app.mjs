import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\/\/ ─── Init ───[\s\S]*?(?=\/\/ Community previews)/, '');
const shared = await readFile(new URL('../../score-model.js', import.meta.url), 'utf8');

export function app() {
  const elements = new Map(), oscillators = [], gains = [], events = [], frames = new Map(), canvasCalls = [];
  let nextFrame = 0;
  const canvas = new Proxy({}, { get: (o, key) => key in o ? o[key] : (...args) => canvasCalls.push([key, ...args]), set: (o, k, v) => (o[k] = v, true) });
  const el = id => {
    if (!elements.has(id)) {
      const classes = new Set(), listeners = new Map(), attributes = new Map();
      const element = {
        value: '', innerHTML: '', textContent: '', style: {}, rectWidth: 1100,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); } },
        focus() { this.focused = true; },
        scrollIntoView(options) { this.scrolledIntoView = options; },
        setAttribute(name, value) { attributes.set(name, value); }, getAttribute: name => attributes.get(name),
        setPointerCapture(pointerId) { this.capturedPointer = pointerId; }, releasePointerCapture() { this.capturedPointer = null; },
        addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
        dispatch(type, props = {}) { const event = { target: this, currentTarget: this, preventDefault() {}, ...props }; return Promise.all((listeners.get(type) || []).map(fn => fn(event))); },
        getContext: () => canvas,
        getBoundingClientRect() { return { left: 0, top: 0, width: this.rectWidth, height: 180 }; },
        parentElement: { getBoundingClientRect: () => ({ width: 1100, height: 200 }) }
      };
      elements.set(id, element);
    }
    return elements.get(id);
  };
  const parameter = () => ({ value: 0, events: [], setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }, linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); }, exponentialRampToValueAtTime(value, time) { this.events.push(['exponential', value, time]); } });
  class AudioContext {
    state = 'running'; currentTime = 0; destination = {};
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { const gain = { gain: parameter(), connect() {}, disconnect() { this.disconnected = true; } }; gains.push(gain); return gain; }
    createDynamicsCompressor() { return { threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter(), connect() {}, disconnect() { this.disconnected = true; } }; }
    createOscillator() { const o = { type: 'sine', frequency: parameter(), detune: parameter(), stopCalls: [], connect() {}, disconnect() {}, addEventListener() {}, start(t) { this.startAt = t; }, stop(t) { this.stopAt = t; this.stopCalls.push(t); } }; oscillators.push(o); return o; }
  }
  const context = {
    Blob, TextEncoder, Event, console, AudioContext, performance: { now: () => 0 }, navigator: { clipboard: { writeText() {} } },
    setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener() {}, removeEventListener() {}, dispatchEvent(e) { events.push(e.type); },
    URL: { createObjectURL(blob) { context.wav = blob; return 'blob:test'; }, revokeObjectURL() {} },
    document: { getElementById: el, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [], createElement: () => ({ click() {} }) }
  };
  context.window = context;
  vm.createContext(context); vm.runInContext(shared, context); vm.runInContext(inline, context);
  const run = code => vm.runInContext(code, context);
  return {
    context, el, oscillators, gains, frames, canvasCalls, run,
    getNotes: () => JSON.parse(run('JSON.stringify(notes)')),
    event: (id, type, props) => el(id).dispatch(type, props),
    frame(time) { run('audioCtx').currentTime = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); }
  };
}
