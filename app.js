import { scanDistance as runDistanceScan } from "./js/distance.js";
import { scanSignal as runSignalScan } from "./js/signal.js";
import { evaluateObjective, getStepFlag } from "./js/objective.js";

const missionCodeInput = document.getElementById("missionCode");
const loadMissionBtn = document.getElementById("loadMissionBtn");
const resumeMissionBtn = document.getElementById("resumeMissionBtn");

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
let activeStepStartedAt = 0;

let distanceScanInProgress = false;
let signalScanInProgress = false;
let locationCheckInProgress = false;
let activeStepTimerId = null;

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

function setResumeMissionVisible(visible) {
  if (resumeMissionBtn) {
    resumeMissionBtn.style.display = visible ? "" : "none";
  }
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

function normalizeMission(mission) {
  if (!mission || !Array.isArray(mission.steps)) {
    throw new Error("Mission file is not in the expected format.");
  }

  mission.steps = mission.steps.map((step, index) => {
    return {
      ...step,
      step_id: String(step?.step_id || `step_${index + 1}`).trim(),
    };
  });

  return mission;
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

  const mission = normalizeMission(await res.json());

  if (!mission.code) mission.code = missionEntry.code;
  if (!mission.title) mission.title = missionEntry.title || "UNTITLED MISSION";
  if (!mission.location && missionEntry.location) {
    mission.location = missionEntry.location;
  }

  return mission;
}

function saveActiveMissionState() {
  if (!activeMission) return;

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      mission: activeMission,
      stepIndex: activeStepIndex,
      stepId: currentStep()?.step_id || null,
      stepStartedAt: activeStepStartedAt,
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

function getStepIndexById(stepId) {
  if (!activeMission || !Array.isArray(activeMission.steps)) return -1;
  const wanted = String(stepId || "").trim();
  if (!wanted) return -1;

  return activeMission.steps.findIndex((step) => {
    return String(step?.step_id || "").trim() === wanted;
  });
}

function isEndingStep(step) {
  return String(step?.objective || "").trim().toLowerCase() === "ending";
}

function isTimedStep(step) {
  return String(step?.objective || "").trim().toLowerCase().endsWith("_timed");
}

function getStepTimeLimitMs(step) {
  const raw = step?.rules?.timeMs ?? step?.timeMs;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getSuccessTarget(step) {
  const target = step?.transitions?.success;
  return target ? String(target).trim() : null;
}

function getFailureTarget(step) {
  const ruleTarget = step?.rules?.onFailGoTo;
  const transitionTarget = step?.transitions?.fail;
  const target = ruleTarget ?? transitionTarget;
  return target ? String(target).trim() : null;
}

function clearActiveStepTimer() {
  if (activeStepTimerId !== null) {
    clearTimeout(activeStepTimerId);
    activeStepTimerId = null;
  }
}

function startActiveStepTimer() {
  clearActiveStepTimer();

  const step = currentStep();
  if (!step || !isTimedStep(step)) {
    return;
  }

  const timeLimitMs = getStepTimeLimitMs(step);
  if (!timeLimitMs) {
    return;
  }

  const elapsedMs = Math.max(0, Date.now() - (activeStepStartedAt || Date.now()));
  const remainingMs = timeLimitMs - elapsedMs;

  if (remainingMs <= 0) {
    activeStepTimerId = window.setTimeout(() => {
      handleTimedObjectiveExpired();
    }, 0);
    return;
  }

  activeStepTimerId = window.setTimeout(() => {
    handleTimedObjectiveExpired();
  }, remainingMs);
}

function activateCurrentStep({ preserveStartTime = false } = {}) {
  clearActiveStepTimer();

  if (!preserveStartTime || !Number.isFinite(activeStepStartedAt) || activeStepStartedAt <= 0) {
    activeStepStartedAt = Date.now();
  }

  saveActiveMissionState();
  startActiveStepTimer();
}

function refreshHudButtons() {
  const step = currentStep();
  const ending = isEndingStep(step);

  const distanceEnabled = ending ? false : getStepFlag(step, ["distanceEnabled"], true);
  const signalEnabled = ending ? false : getStepFlag(step, ["signalEnabled"], true);
  const locationEnabled = ending ? false : getStepFlag(step, ["locationEnabled"], true);

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

  if (step && isEndingStep(step)) {
    setStatus("Ending reached.", "normal", "game");
  } else {
    setStatus(`Mission loaded: ${activeMission.code}`, "normal", "game");
  }

  refreshHudButtons();
}

function resolveJumpTarget(target) {
  if (!activeMission || !Array.isArray(activeMission.steps)) return -1;
  if (target === null || typeof target === "undefined") return -1;

  if (typeof target === "number" && Number.isInteger(target)) {
    return target;
  }

  const raw = String(target).trim();
  if (!raw) return -1;

  const byId = getStepIndexById(raw);
  if (byId !== -1) return byId;

  const numeric = Number(raw);
  if (Number.isInteger(numeric)) {
    return numeric;
  }

  return -1;
}

function jumpMission(target, reason = "jump") {
  if (!activeMission || !Array.isArray(activeMission.steps)) return false;

  const nextIndex = resolveJumpTarget(target);
  if (!Number.isInteger(nextIndex) || nextIndex < 0) return false;
  if (nextIndex >= activeMission.steps.length) return false;

  activeStepIndex = nextIndex;
  resetHudReadings();
  renderMission();
  activateCurrentStep();

  return true;
}

function advanceStep() {
  if (!activeMission || !Array.isArray(activeMission.steps)) return false;
  if (activeStepIndex >= activeMission.steps.length - 1) return false;

  return jumpMission(activeStepIndex + 1, "advance");
}

function bootMission(mission, stepIndex = 0) {
  activeMission = normalizeMission(mission);
  activeStepIndex = Number.isInteger(stepIndex) && stepIndex >= 0 ? stepIndex : 0;
  activeStepStartedAt = Date.now();
  resetHudReadings();
  renderMission();
  setResumeMissionVisible(false);
  showGameScreen();
  activateCurrentStep();
}

function resumeMission() {
  const saved = loadSavedMissionState();

  if (!saved || !saved.mission) {
    setStatus("No saved mission found.", "error", "access");
    return;
  }

  activeMission = normalizeMission(saved.mission);

  if (saved.stepId) {
    const byId = getStepIndexById(saved.stepId);
    if (byId !== -1) {
      activeStepIndex = byId;
    } else if (Number.isInteger(saved.stepIndex)) {
      activeStepIndex = saved.stepIndex;
    } else {
      activeStepIndex = 0;
    }
  } else if (Number.isInteger(saved.stepIndex)) {
    activeStepIndex = saved.stepIndex;
  } else {
    activeStepIndex = 0;
  }

  if (!Number.isFinite(saved.stepStartedAt) || saved.stepStartedAt <= 0) {
    activeStepStartedAt = Date.now();
  } else {
    activeStepStartedAt = saved.stepStartedAt;
  }

  renderMission();
  renderIdleHud();
  refreshHudButtons();
  setResumeMissionVisible(false);
  showGameScreen();

  activateCurrentStep({ preserveStartTime: true });
  setStatus(`Resumed mission: ${activeMission.code}`, "normal", "game");
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

function handleTimedObjectiveExpired() {
  activeStepTimerId = null;

  const step = currentStep();
  if (!step || !isTimedStep(step)) {
    return;
  }

  const timeLimitMs = getStepTimeLimitMs(step);
  if (!timeLimitMs) {
    return;
  }

  const elapsedMs = Math.max(0, Date.now() - (activeStepStartedAt || Date.now()));
  if (elapsedMs < timeLimitMs) {
    startActiveStepTimer();
    return;
  }

  const failTarget = getFailureTarget(step);
  if (failTarget) {
    jumpMission(failTarget, "timeout");
  } else {
    setStatus("Time ran out.", "error", "game");
  }
}

async function scanDistance() {
  const step = currentStep();
  if (!step) return;

  const stepId = step.step_id;
  const ending = isEndingStep(step);
  const enabled = ending ? false : getStepFlag(step, ["distanceEnabled"], true);
  if (!enabled || distanceScanInProgress) return;

  distanceScanInProgress = true;
  refreshHudButtons();

  if (distanceValueEl) distanceValueEl.textContent = "SCANNING...";
  setStatus("Distance scan running...", "normal", "game");

  try {
    const result = await runDistanceScan(step);

    if (!currentStep() || currentStep()?.step_id !== stepId) {
      return;
    }

    lastDistanceReading = `${result.meters} m`;

    if (distanceValueEl) distanceValueEl.textContent = lastDistanceReading;
    setStatus("Distance scan complete.", "normal", "game");
  } catch (err) {
    console.error(err);

    if (!currentStep() || currentStep()?.step_id !== stepId) {
      return;
    }

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

  const stepId = step.step_id;
  const ending = isEndingStep(step);
  const enabled = ending ? false : getStepFlag(step, ["signalEnabled"], true);
  if (!enabled || signalScanInProgress) return;

  signalScanInProgress = true;
  refreshHudButtons();

  if (signalValueEl) signalValueEl.textContent = "SCANNING...";
  setStatus("Signal scan running...", "normal", "game");

  try {
    const result = await runSignalScan(step);

    if (!currentStep() || currentStep()?.step_id !== stepId) {
      return;
    }

    lastSignalReading = result.signal;

    if (signalValueEl) signalValueEl.textContent = lastSignalReading;
    setStatus("Signal scan complete.", "normal", "game");
  } catch (err) {
    console.error(err);

    if (!currentStep() || currentStep()?.step_id !== stepId) {
      return;
    }

    lastSignalReading = "ERROR";

    if (signalValueEl) signalValueEl.textContent = lastSignalReading;
    setStatus(err?.message || "Signal scan failed.", "error", "game");
  } finally {
    signalScanInProgress = false;
    refreshHudButtons();
  }
}

function getCurrentElapsedMs() {
  if (!activeStepStartedAt || !Number.isFinite(activeStepStartedAt)) {
    return 0;
  }
  return Math.max(0, Date.now() - activeStepStartedAt);
}

async function checkLocation() {
  const step = currentStep();
  if (!step) return;

  const stepId = step.step_id;
  const objective = String(step.objective || "").trim().toLowerCase();

  if (objective === "ending") {
    setStatus("This step is lore only.", "normal", "game");
    return;
  }

  const enabled = getStepFlag(step, ["locationEnabled"], true);
  if (!enabled || locationCheckInProgress) return;

  locationCheckInProgress = true;
  refreshHudButtons();

  if (checkLocationBtn) checkLocationBtn.textContent = "CHECKING...";
  setStatus("Checking location...", "normal", "game");

  try {
    const distanceResult = await runDistanceScan(step);

    if (!currentStep() || currentStep()?.step_id !== stepId) {
      return;
    }

    const result = evaluateObjective(step, {
      distanceMeters: distanceResult.meters,
      elapsedMs: getCurrentElapsedMs(),
    });

    if (result.status === "succeed") {
      if (checkLocationBtn) checkLocationBtn.textContent = "OBJECTIVE PASSED";
      setStatus("Objective confirmed.", "normal", "game");

      const successTarget = getSuccessTarget(step);
      if (successTarget) {
        window.setTimeout(() => {
          jumpMission(successTarget, "success");
        }, 700);
      } else if (activeMission && activeStepIndex < activeMission.steps.length - 1) {
        window.setTimeout(() => {
          advanceStep();
        }, 700);
      }
    } else if (result.status === "failed") {
      if (checkLocationBtn) checkLocationBtn.textContent = "OBJECTIVE FAILED";
      setStatus("Objective failed.", "error", "game");

      const failTarget = getFailureTarget(step);
      if (failTarget) {
        window.setTimeout(() => {
          jumpMission(failTarget, "failure");
        }, 700);
      }
    } else if (result.status === "ending") {
      if (checkLocationBtn) checkLocationBtn.textContent = "ENDING";
      setStatus("Ending reached.", "normal", "game");
    } else {
      if (checkLocationBtn) checkLocationBtn.textContent = "OBJECTIVE NOT MET";
      setStatus("Objective not met.", "normal", "game");
    }
  } catch (err) {
    console.error(err);

    if (!currentStep() || currentStep()?.step_id !== stepId) {
      return;
    }

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
  clearActiveStepTimer();

  activeMission = null;
  activeStepIndex = 0;
  activeStepStartedAt = 0;
  distanceScanInProgress = false;
  signalScanInProgress = false;
  locationCheckInProgress = false;

  clearSavedMission();
  resetHudReadings();
  setResumeMissionVisible(false);

  if (missionTitleEl) missionTitleEl.textContent = "NO MISSION LOADED";
  if (missionTextEl) missionTextEl.textContent = "Enter a mission code to begin.";

  refreshHudButtons();
  showAccessScreen();
  setStatus("Awaiting code input.", "normal", "access");

  if (missionCodeInput) missionCodeInput.focus();
}

loadMissionBtn?.addEventListener("click", handleLoadMission);
resumeMissionBtn?.addEventListener("click", resumeMission);

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

  resetHudReadings();
  refreshHudButtons();
  showAccessScreen();

  if (saved && saved.mission) {
    setResumeMissionVisible(true);
    setStatus(`Saved mission found: ${saved.mission.code}`, "normal", "access");
  } else {
    setResumeMissionVisible(false);
    setStatus("Awaiting code input.", "normal", "access");
  }
});