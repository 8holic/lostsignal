import { scanDistance as runDistanceScan } from "./js/distance.js";
import { scanSignal as runSignalScan } from "./js/signal.js";
import {
  getCurrentStep,
  getStepFlag,
  checkLocation as isCorrectLocation,
  getCorrectLore,
} from "./js/mission.js";

const missionCodeInput = document.getElementById("missionCode");
const loadMissionBtn = document.getElementById("loadMissionBtn");

const accessScreenEl = document.getElementById("accessScreen");
const gameScreenEl = document.getElementById("gameScreen");

const accessStatusEl = document.getElementById("accessStatus");
const gameStatusEl = document.getElementById("gameStatus");

const missionTitleEl = document.getElementById("missionTitle");
const missionTextEl = document.getElementById("missionText");

const distanceValueEl = document.getElementById("distanceValue");
const signalValueEl = document.getElementById("signalValue");

const scanDistanceBtn = document.getElementById("scanDistanceBtn");
const scanSignalBtn = document.getElementById("scanSignalBtn");
const checkLocationBtn = document.getElementById("checkLocationBtn");

const STORAGE_KEY = "signalcore_active_mission";

let lastDistanceReading = "-- m";
let lastSignalReading = "---";

let manifestCache = null;
let activeMission = null;
let activeStepIndex = 0;

let distanceScanInProgress = false;
let signalScanInProgress = false;
let locationCheckInProgress = false;

function setStatus(message, type = "normal", target = "game") {
  const el = target === "access" ? accessStatusEl : gameStatusEl;
  if (!el) return;

  el.textContent = message;
  el.style.color = type === "error" ? "var(--danger)" : "var(--muted)";
}

function showAccessScreen() {
  if (accessScreenEl) accessScreenEl.style.display = "";
  if (gameScreenEl) gameScreenEl.style.display = "none";
}

function showGameScreen() {
  if (accessScreenEl) accessScreenEl.style.display = "none";
  if (gameScreenEl) gameScreenEl.style.display = "";
}

function renderIdleHud() {
  if (distanceValueEl) distanceValueEl.textContent = lastDistanceReading;
  if (signalValueEl) signalValueEl.textContent = lastSignalReading;
}

function resetHudReadings() {
  lastDistanceReading = "-- m";
  lastSignalReading = "---";
  renderIdleHud();
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadManifest() {
  if (manifestCache) return manifestCache;

  const res = await fetch("missions/manifest.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Unable to load mission manifest.");
  }

  const manifest = await res.json();
  if (!manifest || !Array.isArray(manifest.missions)) {
    throw new Error("Mission manifest is not in the expected format.");
  }

  manifestCache = manifest;
  return manifestCache;
}

async function loadMissionByCode(code) {
  const manifest = await loadManifest();
  const normalized = normalizeCode(code);
  const hashed = await sha256(normalized);

  const missionEntry = manifest.missions.find((m) => {
    return normalizeCode(m.code) === normalized || m.code === hashed;
  });

  if (!missionEntry) {
    throw new Error("Mission code not recognized.");
  }

  const res = await fetch(`missions/${missionEntry.file}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Mission file could not be loaded.");
  }

  const mission = await res.json();
  if (!mission.code) mission.code = missionEntry.code;
  if (!mission.title) mission.title = missionEntry.title || "UNTITLED MISSION";
  if (!mission.location && missionEntry.location) mission.location = missionEntry.location;

  return mission;
}

function saveActiveMissionState() {
  if (!activeMission) return;

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      mission: activeMission,
      stepIndex: activeStepIndex,
    })
  );
}

function loadSavedMissionState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearSavedMission() {
  localStorage.removeItem(STORAGE_KEY);
}

function getStepAt(index) {
  if (!activeMission || !Array.isArray(activeMission.steps)) return null;
  return activeMission.steps[index] || null;
}

function currentStep() {
  return getStepAt(activeStepIndex);
}

function refreshHudButtons() {
  const step = currentStep();

  const distanceEnabled = getStepFlag(step, ["distanceEnabled"], true);
  const signalEnabled = getStepFlag(step, ["signalEnabled"], true);
  const locationEnabled = getStepFlag(step, ["locationEnabled"], true);

  if (scanDistanceBtn) {
    scanDistanceBtn.disabled = !distanceEnabled || distanceScanInProgress;
    scanDistanceBtn.textContent = distanceScanInProgress ? "SCANNING..." : "SCAN";
  }

  if (scanSignalBtn) {
    scanSignalBtn.disabled = !signalEnabled || signalScanInProgress;
    scanSignalBtn.textContent = signalScanInProgress ? "SCANNING..." : "SCAN SIGNAL";
  }

  if (checkLocationBtn) {
    checkLocationBtn.disabled = !locationEnabled || locationCheckInProgress;
    checkLocationBtn.textContent = locationCheckInProgress ? "CHECKING..." : "CHECK LOCATION";
  }
}

function renderMission() {
  if (!activeMission || !missionTitleEl || !missionTextEl) return;

  const step = currentStep();
  missionTitleEl.textContent = activeMission.title || "UNTITLED MISSION";

  if (step) {
    const stepTitle = step.title || `Step ${activeStepIndex + 1}`;
    const stepText = step.text || step.instruction || "No step text provided.";
    missionTextEl.textContent = `${stepTitle}\n\n${stepText}`;
  } else {
    missionTextEl.textContent = "No step text provided.";
  }

  setStatus(`Mission loaded: ${activeMission.code}`, "normal", "game");
  refreshHudButtons();
}

function bootMission(mission, stepIndex = 0) {
  activeMission = mission;
  activeStepIndex = Number.isInteger(stepIndex) && stepIndex >= 0 ? stepIndex : 0;
  resetHudReadings();
  saveActiveMissionState();
  renderMission();
  showGameScreen();
}

async function handleLoadMission() {
  const code = normalizeCode(missionCodeInput?.value);

  if (!code) {
    setStatus("Enter a mission code first.", "error", "access");
    return;
  }

  setStatus("Checking mission code...", "normal", "access");
  if (loadMissionBtn) loadMissionBtn.disabled = true;

  try {
    const mission = await loadMissionByCode(code);
    bootMission(mission, 0);
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Mission could not be loaded.", "error", "access");
  } finally {
    if (loadMissionBtn) loadMissionBtn.disabled = false;
  }
}

async function scanDistance() {
  const step = currentStep();
  if (!step) return;

  const enabled = getStepFlag(step, ["distanceEnabled"], true);
  if (!enabled || distanceScanInProgress) return;

  distanceScanInProgress = true;
  refreshHudButtons();

  if (distanceValueEl) distanceValueEl.textContent = "SCANNING...";
  setStatus("Distance scan running...", "normal", "game");

  try {
    const result = await runDistanceScan(step);
    lastDistanceReading = `${result.meters} m`;

    if (distanceValueEl) distanceValueEl.textContent = lastDistanceReading;
    setStatus("Distance scan complete.", "normal", "game");
  } catch (err) {
    console.error(err);
    lastDistanceReading = "ERROR";

    if (distanceValueEl) distanceValueEl.textContent = lastDistanceReading;
    setStatus(err?.message || "Distance scan failed.", "error", "game");
  } finally {
    distanceScanInProgress = false;
    refreshHudButtons();
  }
}

async function scanSignal() {
  const step = currentStep();
  if (!step) return;

  const enabled = getStepFlag(step, ["signalEnabled"], true);
  if (!enabled || signalScanInProgress) return;

  signalScanInProgress = true;
  refreshHudButtons();

  if (signalValueEl) signalValueEl.textContent = "SCANNING...";
  setStatus("Signal scan running...", "normal", "game");

  try {
    const result = await runSignalScan(step);
    lastSignalReading = result.signal;

    if (signalValueEl) signalValueEl.textContent = lastSignalReading;
    setStatus("Signal scan complete.", "normal", "game");
  } catch (err) {
    console.error(err);
    lastSignalReading = "ERROR";

    if (signalValueEl) signalValueEl.textContent = lastSignalReading;
    setStatus(err?.message || "Signal scan failed.", "error", "game");
  } finally {
    signalScanInProgress = false;
    refreshHudButtons();
  }
}

function advanceStep() {
  if (!activeMission || !Array.isArray(activeMission.steps)) return false;
  if (activeStepIndex >= activeMission.steps.length - 1) return false;

  activeStepIndex += 1;
  resetHudReadings();
  saveActiveMissionState();
  renderMission();
  return true;
}

async function checkLocation() {
  const step = currentStep();
  if (!step) return;

  const enabled = getStepFlag(step, ["locationEnabled"], true);
  if (!enabled || locationCheckInProgress) return;

  locationCheckInProgress = true;
  refreshHudButtons();

  if (checkLocationBtn) checkLocationBtn.textContent = "CHECKING...";
  setStatus("Checking location...", "normal", "game");

  try {
    const distanceResult = await runDistanceScan(step);
    const isCorrect = isCorrectLocation(step, distanceResult.meters);

    if (isCorrect) {
      if (checkLocationBtn) checkLocationBtn.textContent = "CORRECT LOCATION";
      setStatus("Location confirmed.", "normal", "game");

      const correctLore = getCorrectLore(step);
      if (correctLore && missionTextEl) {
        missionTextEl.textContent = correctLore;
      }

      if (step.advanceOnCorrect) {
        window.setTimeout(() => {
          advanceStep();
        }, 700);
      }
    } else {
      if (checkLocationBtn) checkLocationBtn.textContent = "WRONG LOCATION";
      setStatus("Wrong location.", "error", "game");
    }
  } catch (err) {
    console.error(err);
    if (checkLocationBtn) checkLocationBtn.textContent = "CHECK LOCATION";
    setStatus(err?.message || "Location check failed.", "error", "game");
  } finally {
    window.setTimeout(() => {
      locationCheckInProgress = false;
      refreshHudButtons();
    }, 900);
  }
}

function handleResetToAccess() {
  activeMission = null;
  activeStepIndex = 0;
  distanceScanInProgress = false;
  signalScanInProgress = false;
  locationCheckInProgress = false;

  clearSavedMission();
  resetHudReadings();

  if (missionTitleEl) missionTitleEl.textContent = "NO MISSION LOADED";
  if (missionTextEl) missionTextEl.textContent = "Enter a mission code to begin.";

  refreshHudButtons();
  showAccessScreen();
  setStatus("Awaiting code input.", "normal", "access");

  if (missionCodeInput) missionCodeInput.focus();
}

loadMissionBtn?.addEventListener("click", handleLoadMission);
missionCodeInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleLoadMission();
  }
});

scanDistanceBtn?.addEventListener("click", scanDistance);
scanSignalBtn?.addEventListener("click", scanSignal);
checkLocationBtn?.addEventListener("click", checkLocation);

window.addEventListener("DOMContentLoaded", () => {
  const saved = loadSavedMissionState();

  if (saved && saved.mission) {
    activeMission = saved.mission;
    activeStepIndex = Number.isInteger(saved.stepIndex) ? saved.stepIndex : 0;
    renderMission();
    renderIdleHud();
    refreshHudButtons();
    showGameScreen();
    setStatus(`Resumed mission: ${activeMission.code}`, "normal", "game");
  } else {
    resetHudReadings();
    refreshHudButtons();
    showAccessScreen();
    setStatus("Awaiting code input.", "normal", "access");
  }
});