let leafImg;

// socket / shared state
let socket;
let mySocketId = null;
let connectedUsers = 0;
let worldState = { marks: [] };
let infoEl;

// mediapipe
let videoEl;
let hands;
let cameraFeed;
let handDetected = false;
let handPoint = null;
let prevHandPoint = null;
let handEnergy = 0;
let showHandCursor = true;

let lastGestureSwitchTime = 0;
let currentFingerGesture = "explore";
const GESTURE_SWITCH_COOLDOWN = 900;

// layers
let fgCells = [];
let bgCells = [];

let imgLoaded = false;

let imgScale = 1;
let imgOffsetX = 0;
let imgOffsetY = 0;

// source mapping
let sourceCols = 0;
let sourceRows = 0;
let sourceBrightnessGrid = [];
let sourceMaskGrid = [];
let edgeGrid = [];

// poster layout
let posterW = 0;
let posterH = 0;

// interaction
let lastSentTime = 0;

// ui
let modeButtons = [];
let currentMode = "chew";
let presentationMode = false;

// performance / density
const SAMPLE_STEP = 10;
const FG_THRESHOLD = 220;

// symbols
const DEFAULT_SYMBOLS = "TRACE";
const BG_SYMBOLS = ["·", ".", ":", "°", ",", "˙", "·", ".", ":"];
let symbolSource = DEFAULT_SYMBOLS;
let symbolChars = [];

// modes
const MODES = [
  { key: "chew", label: "Chew", icon: "▢", note: "loss / rupture / missing" },
  { key: "suck", label: "Suck", icon: "~", note: "curl / drain / collapse" },
  { key: "fungus", label: "Fungus", icon: "◌", note: "spot / spread / cover" }
];

// --------------------------------- preload / setup ---------------------------------

function preload() {
  leafImg = loadImage(
    "xx.jpg",
    () => {
      imgLoaded = true;
      console.log("image loaded");
    },
    (err) => {
      console.error("failed to load image", err);
    }
  );
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  frameRate(24);
  textFont("monospace");
  textAlign(CENTER, CENTER);

  infoEl = document.getElementById("info");
  videoEl = document.getElementById("video");

  handPoint = createVector(width * 0.5, height * 0.5);
  prevHandPoint = createVector(width * 0.5, height * 0.5);

  setupSymbolSource(DEFAULT_SYMBOLS);
  buildModeButtons();
  setupSocket();

  try {
    setupMediaPipe();
  } catch (err) {
    console.warn("MediaPipe setup skipped:", err);
  }

  if (imgLoaded) {
    buildSystem();
  }
}

function setupSocket() {
  if (typeof io === "undefined") {
    console.warn("socket.io client not loaded");
    if (infoEl) infoEl.textContent = "socket.io client not loaded";
    return;
  }

  socket = io();

  socket.on("connect", () => {
    console.log("connected to server:", socket.id);
    if (infoEl) infoEl.textContent = "connected to server";
  });

  socket.on("welcome", (data) => {
    mySocketId = data.socketId;
    connectedUsers = data.connectedUsers;
    worldState = data.worldState || { marks: [] };
    updateInfo();
  });

  socket.on("users:update", (data) => {
    connectedUsers = data.connectedUsers;
    updateInfo();
  });

  socket.on("world:update", (data) => {
    worldState = data || { marks: [] };
  });

  socket.on("disconnect", () => {
    if (infoEl) infoEl.textContent = "disconnected from server";
  });
}

function updateInfo() {
  if (!infoEl) return;
  infoEl.textContent = `online users: ${connectedUsers}`;
}

function setupMediaPipe() {
  if (!window.Hands || !window.Camera || !videoEl) {
    console.warn("MediaPipe not loaded");
    return;
  }

  hands = new window.Hands({
    locateFile: (file) => `https://unpkg.com/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 0,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
  });

  hands.onResults(onHandResults);

  try {
    cameraFeed = new window.Camera(videoEl, {
      onFrame: async () => {
        if (!hands || !videoEl) return;
        await hands.send({ image: videoEl });
      },
      width: 480,
      height: 360
    });

    cameraFeed.start();
  } catch (err) {
    console.warn("Camera not available in this browser:", err);
  }
}

// --------------------------------- gesture logic ---------------------------------

function isFingerRaised(hand, tipIndex, pipIndex) {
  return hand[tipIndex].y < hand[pipIndex].y;
}

function detectStructuredGesture(hand) {
  const indexUp = isFingerRaised(hand, 8, 6);
  const middleUp = isFingerRaised(hand, 12, 10);
  const ringUp = isFingerRaised(hand, 16, 14);
  const pinkyUp = isFingerRaised(hand, 20, 18);

  // exact gesture patterns
  if (indexUp && !middleUp && !ringUp && !pinkyUp) return "chew";
  if (indexUp && middleUp && !ringUp && !pinkyUp) return "suck";
  if (indexUp && middleUp && ringUp && !pinkyUp) return "fungus";

  // open palm / exploration
  if ((indexUp && middleUp && ringUp && pinkyUp) || (!indexUp && middleUp && ringUp && pinkyUp)) {
    return "explore";
  }

  return "none";
}

function handleStructuredGesture(gestureName) {
  const now = millis();
  if (now - lastGestureSwitchTime < GESTURE_SWITCH_COOLDOWN) return;

  if (gestureName === "chew" && currentMode !== "chew") {
    switchMode("chew");
    lastGestureSwitchTime = now;
  } else if (gestureName === "suck" && currentMode !== "suck") {
    switchMode("suck");
    lastGestureSwitchTime = now;
  } else if (gestureName === "fungus" && currentMode !== "fungus") {
    switchMode("fungus");
    lastGestureSwitchTime = now;
  }
}

function onHandResults(results) {
  if (results && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const hand = results.multiHandLandmarks[0];
    const indexTip = hand[8];
    const middleTip = hand[12];
    const wrist = hand[0];

    handDetected = true;

    prevHandPoint.x = handPoint.x;
    prevHandPoint.y = handPoint.y;

    const targetX = width - indexTip.x * width;
    const targetY = indexTip.y * height;

    handPoint.x = lerp(handPoint.x, targetX, 0.35);
    handPoint.y = lerp(handPoint.y, targetY, 0.35);

    const openness =
      dist(indexTip.x, indexTip.y, middleTip.x, middleTip.y) +
      dist(indexTip.x, indexTip.y, wrist.x, wrist.y);

    handEnergy = lerp(handEnergy, map(openness, 0.08, 0.45, 0.15, 1.0, true), 0.2);

    currentFingerGesture = detectStructuredGesture(hand);
    handleStructuredGesture(currentFingerGesture);

    const moved = dist(handPoint.x, handPoint.y, prevHandPoint.x, prevHandPoint.y);

    // only draw when not exploring
    if (currentFingerGesture !== "explore" && currentFingerGesture !== "none" && moved > 6) {
      sendSharedMark(handPoint.x, handPoint.y, prevHandPoint.x, prevHandPoint.y);
    }
  } else {
    handDetected = false;
    handEnergy = lerp(handEnergy, 0, 0.1);
    currentFingerGesture = "explore";
  }
}

function gestureLabel(name) {
  if (name === "chew") return "index";
  if (name === "suck") return "index + middle";
  if (name === "fungus") return "index + middle + ring";
  if (name === "explore") return "open palm";
  return "none";
}

function setupSymbolSource(str) {
  let cleaned = str.replace(/\s+/g, "");
  if (cleaned.length === 0) cleaned = DEFAULT_SYMBOLS;
  cleaned = cleaned.slice(0, 8);
  symbolSource = cleaned;
  symbolChars = cleaned.split("");
}

function buildModeButtons() {
  modeButtons = [];
  const w = 118;
  const h = 34;
  const gap = 14;
  const totalW = MODES.length * w + (MODES.length - 1) * gap;
  const startX = width * 0.5 - totalW * 0.5;
  const y = height - 62;

  for (let i = 0; i < MODES.length; i++) {
    modeButtons.push({
      x: startX + i * (w + gap),
      y,
      w,
      h,
      mode: MODES[i].key,
      label: MODES[i].label,
      icon: MODES[i].icon,
      note: MODES[i].note
    });
  }
}

function switchMode(newMode) {
  currentMode = newMode;
  if (socket) socket.emit("reset_world");
  updateInfo();
}

// --------------------------------- build system ---------------------------------

function buildSystem() {
  fgCells = [];
  bgCells = [];
  sourceBrightnessGrid = [];
  sourceMaskGrid = [];
  edgeGrid = [];

  posterW = width * 0.92;
  posterH = height * 0.94;

  imgScale = min(posterW / leafImg.width, posterH / leafImg.height);
  imgOffsetX = width * 0.39 - (leafImg.width * imgScale) * 0.5;
  imgOffsetY = height * 0.50 - (leafImg.height * imgScale) * 0.5;

  leafImg.loadPixels();

  sourceCols = floor(leafImg.width / SAMPLE_STEP) + 1;
  sourceRows = floor(leafImg.height / SAMPLE_STEP) + 1;

  for (let gy = 0; gy < sourceRows; gy++) {
    sourceBrightnessGrid[gy] = [];
    sourceMaskGrid[gy] = [];

    for (let gx = 0; gx < sourceCols; gx++) {
      const x = min(gx * SAMPLE_STEP, leafImg.width - 1);
      const y = min(gy * SAMPLE_STEP, leafImg.height - 1);

      const idx = 4 * (x + y * leafImg.width);
      const r = leafImg.pixels[idx];
      const g = leafImg.pixels[idx + 1];
      const b = leafImg.pixels[idx + 2];
      const a = leafImg.pixels[idx + 3];

      const br = a < 10 ? 255 : (r + g + b) / 3;
      const isFg = a >= 10 && br < FG_THRESHOLD;

      sourceBrightnessGrid[gy][gx] = br;
      sourceMaskGrid[gy][gx] = isFg;
    }
  }

  for (let gy = 0; gy < sourceRows; gy++) {
    edgeGrid[gy] = [];
    for (let gx = 0; gx < sourceCols; gx++) {
      edgeGrid[gy][gx] = computeLeafEdgeFactor(gx, gy);
    }
  }

  for (let gy = 0; gy < sourceRows; gy++) {
    for (let gx = 0; gx < sourceCols; gx++) {
      const x = imgOffsetX + gx * SAMPLE_STEP * imgScale;
      const y = imgOffsetY + gy * SAMPLE_STEP * imgScale;
      const br = sourceBrightnessGrid[gy][gx];
      const isFg = sourceMaskGrid[gy][gx];

      if (isFg) {
        fgCells.push(new ForegroundCell(x, y, br, gx, gy, edgeGrid[gy][gx]));
      } else if ((gx + gy) % 2 === 0) {
        bgCells.push(new BackgroundCell(x, y));
      }
    }
  }

  assignForegroundSymbols();
  assignBackgroundSymbols();
}

function computeLeafEdgeFactor(gx, gy) {
  if (!sourceMaskGrid[gy][gx]) return 0;

  let bgCount = 0;
  let total = 0;

  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      if (ox === 0 && oy === 0) continue;

      const nx = gx + ox;
      const ny = gy + oy;

      if (nx < 0 || ny < 0 || nx >= sourceCols || ny >= sourceRows) {
        bgCount++;
        total++;
        continue;
      }

      total++;
      if (!sourceMaskGrid[ny][nx]) bgCount++;
    }
  }

  const raw = total > 0 ? bgCount / total : 0;
  return constrain(map(raw, 0.05, 0.45, 0, 1, true), 0, 1);
}

function assignForegroundSymbols() {
  for (let i = 0; i < fgCells.length; i++) {
    const cell = fgCells[i];
    const density = map(cell.brightness, 0, FG_THRESHOLD, 1, 0, true);
    let idx = floor(density * (symbolChars.length - 1));
    idx = constrain(idx, 0, symbolChars.length - 1);

    const shifted = (idx + (cell.gridX + cell.gridY) % symbolChars.length) % symbolChars.length;
    cell.baseChar = symbolChars[shifted];
    cell.altChar = symbolChars[(shifted + 1) % symbolChars.length];
  }
}

function assignBackgroundSymbols() {
  for (let i = 0; i < bgCells.length; i++) {
    bgCells[i].char = BG_SYMBOLS[i % BG_SYMBOLS.length];
  }
}

// --------------------------------- shared marks ---------------------------------

function evaluateMarks(x, y, edgeFactor) {
  const marks = worldState?.marks || [];

  let chewCore = 0;
  let chewBoundary = 0;
  let chewOuter = 0;

  let suckCore = 0;
  let suckBoundary = 0;
  let suckOuter = 0;
  let suckDirection = 0;

  let fungusCore = 0;
  let fungusBoundary = 0;
  let fungusOuter = 0;

  let stain = 0;
  let hueSeed = 0.2;

  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];

    const mx = imgOffsetX + m.x * (leafImg.width * imgScale);
    const my = imgOffsetY + m.y * (leafImg.height * imgScale);
    const r = m.size || 18;

    const d = dist(x, y, mx, my);
    if (d > r * 1.18) continue;

    let core = 0;
    let boundary = 0;
    let outer = 0;

    if (d <= r * 0.50) {
      core = map(d, 0, r * 0.50, 1, 0.55, true);
    } else if (d <= r * 0.90) {
      boundary = map(d, r * 0.50, r * 0.90, 1, 0, true);
    } else {
      outer = map(d, r * 0.90, r * 1.18, 1, 0, true);
    }

    const mode = m.mode || "chew";
    const dir = m.direction || 0;

    if (mode === "chew") {
      const coreAmt = core * (0.8 + edgeFactor * 1.2);
      const boundaryAmt = boundary * (0.9 + edgeFactor * 1.3);
      const outerAmt = outer * 0.35;

      chewCore = max(chewCore, coreAmt);
      chewBoundary = max(chewBoundary, boundaryAmt);
      chewOuter = max(chewOuter, outerAmt);

      stain = max(stain, max(coreAmt * 0.85, boundaryAmt * 0.95, outerAmt * 0.3));
      hueSeed = 0.2;
    }

    if (mode === "suck") {
      const coreAmt = core;
      const boundaryAmt = boundary;
      const outerAmt = outer * 0.25;

      suckCore = max(suckCore, coreAmt);
      suckBoundary = max(suckBoundary, boundaryAmt);
      suckOuter = max(suckOuter, outerAmt);

      suckDirection = dir;
      stain = max(stain, max(coreAmt * 0.20, boundaryAmt * 0.14, outerAmt * 0.08));
      hueSeed = 0.8;
    }

    if (mode === "fungus") {
      const coreAmt = core;
      const boundaryAmt = boundary;
      const outerAmt = outer * 0.70;

      fungusCore = max(fungusCore, coreAmt);
      fungusBoundary = max(fungusBoundary, boundaryAmt);
      fungusOuter = max(fungusOuter, outerAmt);

      stain = max(stain, max(coreAmt * 0.62, boundaryAmt * 0.52, outerAmt * 0.25));
      hueSeed = 0.7;
    }
  }

  return {
    chewCore, chewBoundary, chewOuter,
    suckCore, suckBoundary, suckOuter, suckDirection,
    fungusCore, fungusBoundary, fungusOuter,
    stain, hueSeed
  };
}

function isOnLeafScreen(px, py) {
  const gx = round((px - imgOffsetX) / (SAMPLE_STEP * imgScale));
  const gy = round((py - imgOffsetY) / (SAMPLE_STEP * imgScale));

  if (gx < 0 || gy < 0 || gx >= sourceCols || gy >= sourceRows) return false;
  return sourceMaskGrid[gy][gx];
}

function sendSharedMark(px, py, prevPx, prevPy) {
  if (!socket || !imgLoaded) return;
  if (!isOnLeafScreen(px, py)) return;

  const now = millis();
  if (now - lastSentTime < 55) return;
  lastSentTime = now;

  const nx = constrain((px - imgOffsetX) / (leafImg.width * imgScale), 0, 1);
  const ny = constrain((py - imgOffsetY) / (leafImg.height * imgScale), 0, 1);

  const direction = atan2(py - prevPy, px - prevPx);

  let size = 11;
  if (currentMode === "chew") size = random(11, 16);
  if (currentMode === "suck") size = random(9, 13);
  if (currentMode === "fungus") size = random(10, 15);

  socket.emit("add_mark", {
    x: nx,
    y: ny,
    mode: currentMode,
    size,
    direction
  });
}

// --------------------------------- cells ---------------------------------

class BackgroundCell {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.char = "·";
  }

  display() {
    fill(146, 152, 156, 92);
    noStroke();
    textSize(11);
    text(this.char, this.x, this.y);
  }
}

class ForegroundCell {
  constructor(x, y, brightness, gridX, gridY, edgeFactor) {
    this.homeX = x;
    this.homeY = y;
    this.brightness = brightness;
    this.gridX = gridX;
    this.gridY = gridY;
    this.edgeFactor = edgeFactor;
    this.phase = random(TWO_PI);

    this.baseChar = ".";
    this.altChar = "*";
  }

  drawTextureBase() {
    const density = map(this.brightness, 0, FG_THRESHOLD, 1, 0, true);
    const alphaVal = 22 + density * 30 + this.edgeFactor * 30;

    noStroke();
    fill(58, 68, 74, alphaVal);
    ellipse(
      this.homeX,
      this.homeY,
      2.0 + density * 1.8,
      1.7 + density * 1.2
    );
  }

  display() {
    this.drawTextureBase();

    const inf = evaluateMarks(this.homeX, this.homeY, this.edgeFactor);

    if (inf.chewCore > 0.34) return;

    const density = map(this.brightness, 0, FG_THRESHOLD, 1, 0, true);

    const innerBase = color(92, 108, 114, 178);
    const edgeBase = color(38, 52, 58, 224);

    let baseCol = lerpColor(innerBase, edgeBase, 0.32 + this.edgeFactor * 0.68);

    let ch = this.baseChar;
    let sizeVal = 11.6 + density * 2.6 + this.edgeFactor * 2.0;

    let jitterX = 0;
    let jitterY = 0;

    if (inf.suckCore > 0 || inf.suckBoundary > 0) {
      const fadedCore = color(225, 229, 231, 210);
      const fadedBoundary = color(188, 196, 200, 185);

      baseCol = lerpColor(baseCol, fadedBoundary, inf.suckBoundary * 1.0);
      baseCol = lerpColor(baseCol, fadedCore, inf.suckCore * 1.3);

      sizeVal *= (1 - inf.suckCore * 0.52 - inf.suckBoundary * 0.20);

      jitterX += cos(inf.suckDirection) * (inf.suckCore * 2.0 + inf.suckBoundary * 0.8);
      jitterY += sin(inf.suckDirection) * (inf.suckCore * 1.2 + inf.suckBoundary * 0.6);

      if (inf.suckCore > 0.18) ch = ".";
    }

    if (inf.fungusCore > 0 || inf.fungusBoundary > 0 || inf.fungusOuter > 0) {
      const fungusCoreCol = color(216, 224, 208, 220);
      const fungusBoundaryCol = color(174, 190, 166, 188);
      const fungusOuterCol = color(200, 210, 194, 120);

      baseCol = lerpColor(baseCol, fungusOuterCol, inf.fungusOuter * 0.65);
      baseCol = lerpColor(baseCol, fungusBoundaryCol, inf.fungusBoundary * 1.0);
      baseCol = lerpColor(baseCol, fungusCoreCol, inf.fungusCore * 1.2);

      sizeVal += inf.fungusBoundary * 1.1 + inf.fungusCore * 0.5;

      jitterX += sin(this.phase) * inf.fungusBoundary * 0.2;
      jitterY += cos(this.phase) * inf.fungusBoundary * 0.2;

      if (inf.fungusCore > 0.20) ch = "·";
    }

    if (inf.chewBoundary > 0 || inf.chewOuter > 0) {
      const woundEdge = color(26, 32, 34, 235);
      const woundOuter = color(110, 82, 66, 120);

      baseCol = lerpColor(baseCol, woundOuter, inf.chewOuter * 0.5);
      baseCol = lerpColor(baseCol, woundEdge, inf.chewBoundary * 1.15);

      sizeVal += inf.chewBoundary * 1.5;
      jitterX += sin(frameCount * 0.018 + this.phase) * inf.chewBoundary * 0.8;
      jitterY += cos(frameCount * 0.017 + this.phase) * inf.chewBoundary * 0.7;
    }

    const stainCol = getAgedColor(inf.hueSeed, 220);
    const finalCol = lerpColor(baseCol, stainCol, inf.stain);

    if (inf.stain > 0.24 && inf.fungusCore < 0.2 && inf.suckCore < 0.2) {
      ch = this.altChar;
    }

    fill(finalCol);
    noStroke();
    textSize(sizeVal);
    text(ch, this.homeX + jitterX, this.homeY + jitterY);

    if (inf.chewBoundary > 0.22) {
      fill(46, 36, 30, 118 * inf.chewBoundary);
      textSize(sizeVal - 1.0);
      text(":", this.homeX - 0.6, this.homeY + 0.3);
    }

    if (inf.fungusCore > 0.18) {
      fill(234, 240, 230, 150 * inf.fungusCore);
      textSize(8.5 + inf.fungusCore * 2.5);
      text("·", this.homeX + 0.8, this.homeY - 0.1);
    }

    if (inf.fungusBoundary > 0.20) {
      fill(182, 194, 176, 100 * inf.fungusBoundary);
      textSize(7.2);
      text(":", this.homeX + 0.35, this.homeY + 0.25);
    }
  }
}

// --------------------------------- helpers ---------------------------------

function getAgedColor(seed, a) {
  if (seed < 0.5) return color(160, 96, 58, a);
  return color(82, 122, 96, a);
}

function drawFungusSurfaceOverlays() {
  const marks = worldState?.marks || [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (m.mode !== "fungus") continue;

    const mx = imgOffsetX + m.x * (leafImg.width * imgScale);
    const my = imgOffsetY + m.y * (leafImg.height * imgScale);
    const r = m.size || 16;

    noStroke();

    fill(224, 230, 218, 18);
    ellipse(mx, my, r * 1.45, r * 1.18);

    fill(190, 202, 182, 14);
    ellipse(mx + 1, my - 1, r * 1.8, r * 1.35);

    fill(232, 236, 228, 10);
    ellipse(mx - 1, my + 1, r * 0.9, r * 0.7);
  }
}

function drawPosterLabel() {
  if (presentationMode) return;

  const modeObj = MODES.find(m => m.key === currentMode);

  push();
  fill(88, 96, 100, 150);
  noStroke();
  textAlign(LEFT, TOP);

  textSize(13);
  text("RESIDUAL GROWTH", width * 0.75, height * 0.08);

  textSize(10);
  text("shared leaf / multiplayer trace surface", width * 0.75, height * 0.08 + 20);

  textSize(10);
  text(`mode: ${modeObj.label} / ${modeObj.note}`, width * 0.75, height * 0.08 + 38);

  textSize(10);
  text(`online users: ${connectedUsers}`, width * 0.75, height * 0.08 + 56);

  textSize(10);
  text(`gesture: ${gestureLabel(currentFingerGesture)}`, width * 0.75, height * 0.08 + 74);
  pop();
}

function drawModeBar() {
  push();
  textAlign(CENTER, CENTER);

  const y = height - 62;
  const w = 118;
  const h = 34;
  const gap = 14;
  const totalW = MODES.length * w + (MODES.length - 1) * gap;
  const startX = width * 0.5 - totalW * 0.5;

  for (let i = 0; i < modeButtons.length; i++) {
    const b = modeButtons[i];
    b.x = startX + i * (w + gap);
    b.y = y;
    b.w = w;
    b.h = h;

    const active = currentMode === b.mode;

    noStroke();
    fill(active ? color(60, 68, 72, 228) : color(255, 255, 255, 170));
    rect(b.x, b.y, b.w, b.h, 8);

    if (!active) {
      stroke(60, 68, 72, 24);
      noFill();
      rect(b.x, b.y, b.w, b.h, 8);
      noStroke();
    }

    fill(active ? 245 : 70);
    textSize(12);
    text(`${b.icon} ${b.label}`, b.x + b.w / 2, b.y + b.h / 2);
  }

  pop();
}

function drawHint() {
  if (presentationMode) return;

  fill(88);
  noStroke();
  textAlign(LEFT, BOTTOM);
  textSize(12);
  text(
    "gesture switch: index = Chew / index + middle = Suck / index + middle + ring = Fungus / open palm = Explore | press R to reset | F fullscreen | H hide UI",
    18,
    height - 16
  );
}

function drawHandCursor() {
  if (!handDetected || !showHandCursor) return;

  push();
  noFill();

  if (currentFingerGesture === "explore") {
    stroke(115, 137, 145, 55);
  } else {
    stroke(176, 120, 70, 70);
  }

  strokeWeight(1);

  const r = 15 + handEnergy * 10;
  circle(handPoint.x, handPoint.y, r * 2);

  stroke(82, 122, 96, 35);
  circle(handPoint.x, handPoint.y, r * 3);

  pop();
}

// --------------------------------- draw ---------------------------------

function draw() {
  background(248, 245, 238);

  if (!imgLoaded) {
    fill(60);
    noStroke();
    textSize(18);
    text("Image failed to load", width * 0.5, height * 0.5);
    return;
  }

  for (let i = 0; i < bgCells.length; i++) {
    bgCells[i].display();
  }

  drawFungusSurfaceOverlays();

  for (let i = 0; i < fgCells.length; i++) {
    fgCells[i].display();
  }

  drawPosterLabel();
  drawModeBar();
  drawHint();
  drawHandCursor();
}

// --------------------------------- input ---------------------------------

function mouseDragged() {
  sendSharedMark(mouseX, mouseY, pmouseX, pmouseY);
}

function mousePressed() {
  for (let i = 0; i < modeButtons.length; i++) {
    const b = modeButtons[i];
    if (
      mouseX >= b.x && mouseX <= b.x + b.w &&
      mouseY >= b.y && mouseY <= b.y + b.h
    ) {
      switchMode(b.mode);
      return;
    }
  }

  sendSharedMark(mouseX, mouseY, pmouseX, pmouseY);
}

function touchStarted() {
  if (touches.length > 0) {
    const tx = touches[0].x;
    const ty = touches[0].y;

    for (let i = 0; i < modeButtons.length; i++) {
      const b = modeButtons[i];
      if (tx >= b.x && tx <= b.x + b.w && ty >= b.y && ty <= b.y + b.h) {
        switchMode(b.mode);
        return false;
      }
    }

    sendSharedMark(tx, ty, tx, ty);
  }
  return false;
}

function touchMoved() {
  if (touches.length > 0) {
    const t = touches[0];
    sendSharedMark(t.x, t.y, t.x, t.y);
  }
  return false;
}

function keyPressed() {
  if (key === "r" || key === "R") {
    if (socket) socket.emit("reset_world");
  }

  if (key === "f" || key === "F") {
    const fs = fullscreen();
    fullscreen(!fs);
  }

  if (key === "h" || key === "H") {
    presentationMode = !presentationMode;
  }

  if (key === "c" || key === "C") {
    showHandCursor = !showHandCursor;
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildModeButtons();
  if (imgLoaded) buildSystem();
}