// Temporal Error
// Xinyue Cao
// 07.01.2026

// Instructions:
// Interact by touching the conductive surface applied to the body. For testing, click and hold the mouse. If using Arduino, click “Connect Arduino” and allow serial access. Sound responds immediately to input, while visual disruption is introduced after a system-controlled temporal delay. The system modulates audiovisual behaviour based on the duration and intensity of contact.

// Optional Blurb:
// This work explores time as a constructed and interruptible experience. Rather than responding continuously, the system introduces moments of delay, misalignment, and interruption between action and response. Through immediate sonic disruption and delayed visual breakdown, time is made perceptible as something calculated, fragile, and negotiated between the body and the computational system.

// Reference code: The Glitch Sketch: https://editor.p5js.org/ffd8/sketches/5aew0QfB4

//  Acknowledgements：p5.js Reference: millis() https://p5js.org/reference/p5/millis/

//  Acknowledgements：p5.js Reference: image() https://p5js.org/reference/p5/image/

//  Acknowledgements：p5.sound Reference: p5.SoundFile https://p5js.org/reference/p5.sound/p5.SoundFile/

// Acknowledgements: Discrete timing logic inspired by The Coding Train https://www.youtube.com/watch?v=E4RyStef-gY

// Acknowledgements: p5.js timing function millis() https://p5js.org/reference/p5/millis/

// Acknowledgements: JavaScript Array (frame buffer data structure) https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array

//  Acknowledgements：Web Serial API – MDN Web Docs  https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API

let cam;
let inputMode = "mouse"; // "mouse" | "arduino" | "both"

// Mouse -> touch
let mouseHoldStartMs = null;

// Temporal State (touch as duration)
let touchNorm = 0;
let touchTarget = 0;
let isTouching = false;
let touchStartMs = 0;
let visualDelayMs = 420;
let visualRampMs = 280;

// Temporal Buffer (past frames)
const MAX_FRAMES = 150;
let frameBuffer = [];

// System timing (quantized ticks)
let tickIntervalMs = 300;
let lastTickMs = 0;
let tickPulse = 0;
let tickDecay = 0.95;
let pending = 0;

// Sound system
let audioFile;
let audioReady = false;
let audioLPF, audioHPF;
let lastJumpFrame = -999;

let baseVol = 0.22;
let maxVol = 0.85;
let baseRate = 1.0;

// Visual parameters
let scanlineCount = 14;
let maxShiftPx = 110;
let rgbShiftMax = 36;
let blockCount = 34;
let flickerMax = 190;

// WEB SERIAL (ARDUINO)
let port = null;
let reader = null;
let decoder = null;
let pipePromise = null;

let serialBuffer = "";
let arduinoRaw = 0; // 0..1023
let arduinoNorm = 0; // 0..1
let arduinoLastSeenMs = 0;
let arduinoConnected = false;

const SERIAL_BAUD = 57600;
const DEBUG_SERIAL = false;
const USE_THRESHOLD_REMAP = true;
const SENSOR_THRESHOLD = 209;

// PRELOAD / SETUP
function preload() {
  audioFile = loadSound(
    "sionssound.mp3",
    () => (audioReady = true),
    () => (audioReady = false)
  );
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  noStroke();
  colorMode(HSB, 360, 100, 100, 255);

  // Camera
  cam = createCapture(VIDEO);
  cam.size(320, 240);
  cam.hide();

  // Audio chain
  userStartAudio();
  audioLPF = new p5.LowPass();
  audioHPF = new p5.HighPass();
  audioLPF.freq(20000);

  if (audioReady) {
    audioFile.disconnect();
    audioFile.connect(audioLPF);
    audioLPF.disconnect();
    audioLPF.connect(audioHPF);
    audioFile.loop();
    audioFile.rate(baseRate);
    audioFile.setVolume(0);
  }

  // UI
  setupSerialUI();

  lastTickMs = millis();
}

function draw() {
  const rawTouch = getRawTouch(); // 0..1

  // Smooth touch
  touchTarget = rawTouch;
  touchNorm = lerp(touchNorm, touchTarget, 0.12);

  // Touch onset / release
  const touchingNow = rawTouch > 0.02;
  if (touchingNow && !isTouching) {
    isTouching = true;
    touchStartMs = millis();
    visualDelayMs = 360 + random(0, 220);
  } else if (!touchingNow && isTouching) {
    isTouching = false;
  }

  // Visual request (delayed + quantized)
  const visualRequest = computeVisualRequest(rawTouch);
  pending += visualRequest * 0.12;
  pending = constrain(pending, 0, 1);

  // System tick
  runSystemTick();
  tickPulse *= tickDecay;

  // Strengths
  const visualStrength = constrain(tickPulse, 0, 1);
  const audioStrength = rawTouch;

  // Mapping
  const delayFrames = floor(map(visualStrength, 0, 1, 2, 52));
  const shift = floor(lerp(10, maxShiftPx, visualStrength));
  const bands = floor(lerp(2, scanlineCount, visualStrength));

  // Frame buffer
  pushFrameFromCam();
  const delayed = getDelayedFrame(delayFrames);

  // Base
  background(0);
  if (delayed) drawCoverImage(delayed, 0, 0, width, height);

  // Glitch layers
  if (delayed && visualStrength > 0.01) {
    applyScanlineGlitch(delayed, bands, shift, visualStrength);
    applyRGBSplit(delayed, visualStrength);
    applyBlockCorruption(delayed, visualStrength);
    applyHueDrift(visualStrength);
    applyPosterizeAndFlicker(visualStrength);
    applyGrain(visualStrength);
  }

  // Audio
  handleAudioFile(audioStrength);

  // Serial status indicator
  drawSerialStatusDot();
}

function mousePressed() {
  userStartAudio();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// INPUT (MOUSE + ARDUINO)
function getRawTouch() {
  const m = mouseInput();
  const a = arduinoInput();

  if (inputMode === "mouse") return m;
  if (inputMode === "arduino") return a;

  // both: stronger wins (mouse can boost)
  return max(m, a);
}

function mouseInput() {
  if (!mouseIsPressed) {
    mouseHoldStartMs = null;
    return 0;
  }
  if (mouseHoldStartMs === null) mouseHoldStartMs = millis();

  const heldMs = millis() - mouseHoldStartMs;
  return constrain(map(heldMs, 0, 1200, 0, 1), 0, 1);
}

function arduinoInput() {
  // If no new data recently, treat as inactive to avoid stale values
  const alive = arduinoConnected && millis() - arduinoLastSeenMs < 700;
  if (!alive) return 0;
  return arduinoNorm;
}

// TEMPORAL LOGIC

function computeVisualRequest(rawTouch) {
  if (!isTouching) return 0;

  const t = millis() - touchStartMs;
  if (t < visualDelayMs) return 0;

  const ramp = constrain((t - visualDelayMs) / visualRampMs, 0, 1);

  // Quantized ramp for "interruptible" time
  const q = 0.1;
  const rampQ = floor(ramp / q) * q;

  return rawTouch * rampQ;
}

function runSystemTick() {
  const now = millis();
  if (now - lastTickMs < tickIntervalMs) return;

  tickPulse = constrain(tickPulse + pending, 0, 1);
  pending *= 0.15;
  lastTickMs = now;
}

// TEMPORAL FRAME BUFFER
function pushFrameFromCam() {
  frameBuffer.push(cam.get());
  if (frameBuffer.length > MAX_FRAMES) frameBuffer.shift();
}

function getDelayedFrame(d) {
  const i = frameBuffer.length - 1 - d;
  if (i >= 0 && i < frameBuffer.length) return frameBuffer[i];
  return null;
}

// VISUALS
function drawCoverImage(img, x, y, w, h) {
  const ia = img.width / img.height;
  const ca = w / h;
  let dw, dh, dx, dy;

  if (ia > ca) {
    dh = h;
    dw = h * ia;
    dx = x - (dw - w) / 2;
    dy = y;
  } else {
    dw = w;
    dh = w / ia;
    dx = x;
    dy = y - (dh - h) / 2;
  }
  image(img, dx, dy, dw, dh);
}

function applyScanlineGlitch(img, bands, maxShift, s) {
  for (let i = 0; i < bands; i++) {
    const sy = floor(random(img.height));
    const sh = floor(random(6, 40));
    const xs = floor(random(-maxShift, maxShift));
    const dy = map(sy, 0, img.height, 0, height);
    const dh = map(sh, 0, img.height, 0, height);
    image(img, xs, dy, width, dh, 0, sy, img.width, sh);
  }
}

function applyRGBSplit(img, s) {
  const d = floor(lerp(0, rgbShiftMax, s));
  if (d < 1) return;

  push();
  blendMode(ADD);
  tint(0, 0, 100, 140);
  image(img, -d, 0, width, height);
  tint(120, 80, 100, 140);
  image(img, d, 0, width, height);
  pop();
  noTint();
}

function applyBlockCorruption(img, s) {
  const n = floor(lerp(0, blockCount, s));
  for (let i = 0; i < n; i++) {
    const sw = random(20, 200);
    const sh = random(10, 120);
    image(
      img,
      random(width),
      random(height),
      sw,
      sh,
      random(img.width),
      random(img.height),
      sw,
      sh
    );
  }
}

function applyHueDrift(s) {
  if (s < 0.1) return;
  push();
  blendMode(OVERLAY);
  fill((frameCount * 2) % 360, 80, 100, s * 80);
  rect(0, 0, width, height);
  pop();
}

function applyPosterizeAndFlicker(s) {
  if (s < 0.2) return;
  fill(0, 0, 100, random(20, flickerMax) * s);
  rect(0, 0, width, height);
}

function applyGrain(s) {
  fill(0, 0, 100, s * 40);
  for (let i = 0; i < 120; i++) {
    rect(random(width), random(height), 2, 2);
  }
}

// AUDIO
function handleAudioFile(s) {
  if (!audioReady) return;

  if (s < 0.02) {
    audioFile.rate(baseRate);
    audioFile.setVolume(baseVol, 0.1);
    audioLPF.freq(20000);
    audioHPF.freq(10);
    return;
  }

  audioFile.setVolume(lerp(baseVol, maxVol, s), 0.05);
  audioFile.rate(lerp(1.0, 0.6, s));
  audioLPF.freq(lerp(16000, 600, s));
  audioHPF.freq(lerp(20, 140, s));

  if (frameCount - lastJumpFrame > lerp(20, 4, s)) {
    lastJumpFrame = frameCount;
    audioFile.jump(random(audioFile.duration()));
  }
}

// UI (SERIAL + INPUT MODE)
function setupSerialUI() {
  const btn = createButton("Connect Arduino");
  btn.position(12, 12);
  btn.mousePressed(connectSerial);

  const bMouse = createButton("mouse");
  bMouse.position(12, 44);
  bMouse.mousePressed(() => (inputMode = "mouse"));

  const bArd = createButton("arduino");
  bArd.position(70, 44);
  bArd.mousePressed(() => (inputMode = "arduino"));

  const bBoth = createButton("both");
  bBoth.position(146, 44);
  bBoth.mousePressed(() => (inputMode = "both"));
}

// WEB SERIAL (CONNECT / READ / PARSE)
async function connectSerial() {
  try {
    // Clean up previous session if any (prevents stuck port / reader lock)
    await stopSerial();

    port = await navigator.serial.requestPort();
    await port.open({ baudRate: SERIAL_BAUD });

    arduinoConnected = true;
    serialBuffer = "";

    decoder = new TextDecoderStream();
    pipePromise = port.readable.pipeTo(decoder.writable).catch((e) => {
      if (DEBUG_SERIAL) console.warn("pipeTo error:", e);
    });

    reader = decoder.readable.getReader();
    if (DEBUG_SERIAL) console.log("Serial connected.");

    readSerialLoop();
  } catch (e) {
    console.error("Serial connection failed:", e);
    arduinoConnected = false;
  }
}

async function stopSerial() {
  // Cancel + release reader
  try {
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      reader = null;
    }
  } catch {}

  // Wait pipe to finish
  try {
    if (pipePromise) {
      await pipePromise.catch(() => {});
      pipePromise = null;
    }
  } catch {}

  // Close port
  try {
    if (port && port.readable) {
      await port.close().catch(() => {});
    }
  } catch {}

  decoder = null;
  port = null;
  arduinoConnected = false;
}

async function readSerialLoop() {
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) handleSerialChunk(value);
    }
  } catch (e) {
    console.error("Serial read error:", e);
    arduinoConnected = false;
  } finally {
    try {
      if (reader) {
        reader.releaseLock();
        reader = null;
      }
    } catch {}
  }
}

function handleSerialChunk(chunk) {
  serialBuffer += chunk;

  let idx;
  while ((idx = serialBuffer.indexOf("\n")) >= 0) {
    const line = serialBuffer.slice(0, idx).trim().replace("\r", "");
    serialBuffer = serialBuffer.slice(idx + 1);

    if (!line) continue;

    const v = parseInt(line, 10);
    if (Number.isNaN(v)) {
      if (DEBUG_SERIAL) console.warn("Bad serial line:", line);
      continue;
    }

    arduinoRaw = constrain(v, 0, 1023);

    if (USE_THRESHOLD_REMAP) {
      // Treat SENSOR_THRESHOLD as the "zero touch" baseline
      arduinoNorm = constrain(
        (arduinoRaw - SENSOR_THRESHOLD) / (1023 - SENSOR_THRESHOLD),
        0,
        1
      );
    } else {
      arduinoNorm = arduinoRaw / 1023;
    }

    arduinoLastSeenMs = millis();

    if (DEBUG_SERIAL && frameCount % 30 === 0) {
      console.log("Arduino raw:", arduinoRaw, "norm:", arduinoNorm.toFixed(3));
    }
  }
}

// Optional debug helper: call in Console
window.debugArduinoStatus = function () {
  const timeSinceLast = millis() - arduinoLastSeenMs;
  const alive = arduinoConnected && timeSinceLast < 700;

  console.log("=== Arduino Debug Info ===");
  console.log("Connected:", arduinoConnected);
  console.log("Alive:", alive);
  console.log("Last data (ms ago):", timeSinceLast.toFixed(0));
  console.log("Raw:", `${arduinoRaw}/1023`);
  console.log("Norm:", arduinoNorm.toFixed(3));
  console.log("Input mode:", inputMode);
  console.log("Port open:", port && port.readable ? "Yes" : "No");
  console.log("Reader active:", reader ? "Yes" : "No");
  console.log("==========================");
};

// Clean up (prevents port stuck after refresh)
window.addEventListener("beforeunload", () => {
  stopSerial();
});

// SERIAL STATUS INDICATOR

function drawSerialStatusDot() {
  const alive = arduinoConnected && millis() - arduinoLastSeenMs < 700;

  push();
  noStroke();
  if (alive) fill(120, 80, 100, 255);
  // green
  else fill(0, 0, 60, 255); // gray
  circle(250, 22, 10);
  pop();
}
