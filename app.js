import { scanDistance as runDistanceScan } from "./js/distance.js";
import { scanSignal as runSignalScan } from "./js/signal.js";
import { calculateDistanceMeters, getAveragedPosition } from "./js/common.js";
import { createComplicationController } from "./js/complications.js";
import {
  evaluateObjective,
  getStepFlag,
  normalizePromptText,
  resolvePrompt,
} from "./js/objective.js";

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
const complicationRowEl = document.getElementById("complicationRow");
const complicationValueEl = document.getElementById("complicationValue");

const scanTargetRow = document.getElementById("scanTargetRow");
const scanTargetSelect = document.getElementById("scanTargetSelect");
const searchPointRow = document.getElementById("searchPointRow");
const searchPointSelect = document.getElementById("searchPointSelect");
const scanDistanceBtn = document.getElementById("scanDistanceBtn");
const scanSignalBtn = document.getElementById("scanSignalBtn");
const checkLocationBtn = document.getElementById("checkLocationBtn");
const promptPanelEl = document.getElementById("promptPanel");
const promptInputEl = document.getElementById("promptInput");
const submitPromptBtn = document.getElementById("submitPromptBtn");

const STORAGE_KEY = "signalcore_active_mission";

let lastDistanceReading = "-- m";
let lastSignalReading = "---";

let manifestCache = null;
let activeMission = null;
let activeStepIndex = 0;
let activeStepStartedAt = 0;
let activeMissionStartedAt = 0;
let activeMissionEndedAt = 0;
let activeTimeModifierMs = 0;
let activeSearchState = {};
let activePromptState = {};

let distanceScanInProgress = false;
let signalScanInProgress = false;
let locationCheckInProgress = false;
let promptSubmitInProgress = false;
let activeStepTimerId = null;
const complications = createComplicationController({
  rowEl: complicationRowEl,
  valueEl: complicationValueEl,
  getMission: () => activeMission,
  getStep: currentStep,
  isEndingStep,
  setStatus,
  applyTimeModifier,
  formatSignedDuration,
  saveState: saveActiveMissionState,
});

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

function getScanTargetMode() {
  return scanTargetSelect?.value === "safeSpot" ? "safeSpot" : "objective";
}

function refreshScanTargetOptions() {
  if (!scanTargetSelect) return;

  const safeSpotOption = Array.from(scanTargetSelect.options).find((option) => {
    return option.value === "safeSpot";
  });

  if (!safeSpotOption) return;

  const hasSafeSpots = complications.getAllSafePoints().length > 0;
  safeSpotOption.disabled = !hasSafeSpots;
  safeSpotOption.hidden = !hasSafeSpots;

  if (scanTargetRow) {
    scanTargetRow.classList.toggle("hidden", !hasSafeSpots);
  }

  if (!hasSafeSpots && scanTargetSelect.value === "safeSpot") {
    scanTargetSelect.value = "objective";
  }
}

function getSearchPoints(step) {
  return Array.isArray(step?.searchPoints) ? step.searchPoints : [];
}

function getSearchPointId(point, index) {
  return String(point?.id ?? point?.label ?? `point_${index + 1}`).trim();
}

function getSearchPointLabel(point, index) {
  return String(point?.label ?? point?.id ?? `POINT ${index + 1}`).trim();
}

function getSearchStepState(step) {
  const stepId = String(step?.step_id || "").trim();
  if (!stepId) return null;

  if (!activeSearchState[stepId] || typeof activeSearchState[stepId] !== "object") {
    activeSearchState[stepId] = {
      claimedIds: [],
    };
  }

  if (!Array.isArray(activeSearchState[stepId].claimedIds)) {
    activeSearchState[stepId].claimedIds = [];
  }

  return activeSearchState[stepId];
}

function getClaimedSearchIds(step) {
  const state = getSearchStepState(step);
  return new Set((state?.claimedIds || []).map((id) => String(id)));
}

function getRequiredSearchClaims(step) {
  const points = getSearchPoints(step);
  const required = Math.floor(getFiniteNumber(step?.requiredClaims ?? step?.required, points.length));

  if (!points.length) return 0;
  return Math.max(1, Math.min(points.length, required));
}

function getClaimedSearchCount(step) {
  const claimedIds = getClaimedSearchIds(step);
  return getSearchPoints(step).filter((point, index) => {
    return claimedIds.has(getSearchPointId(point, index));
  }).length;
}

function isSearchComplete(step) {
  return getClaimedSearchCount(step) >= getRequiredSearchClaims(step);
}

function getUnclaimedSearchPoints(step) {
  const claimedIds = getClaimedSearchIds(step);

  return getSearchPoints(step)
    .map((point, index) => ({
      point,
      index,
      id: getSearchPointId(point, index),
      label: getSearchPointLabel(point, index),
    }))
    .filter((entry) => {
      return entry.id && !claimedIds.has(entry.id);
    });
}

function getSelectedSearchPoint(step = currentStep()) {
  const unclaimed = getUnclaimedSearchPoints(step);
  if (!unclaimed.length) return null;

  const selectedId = String(searchPointSelect?.value || "");
  return unclaimed.find((entry) => entry.id === selectedId) || unclaimed[0];
}

function refreshSearchPointOptions() {
  if (!searchPointRow || !searchPointSelect) return;

  const step = currentStep();
  const visible =
    isSearchStep(step) &&
    getScanTargetMode() === "objective" &&
    !isSearchComplete(step);
  searchPointRow.classList.toggle("hidden", !visible);

  if (!visible) {
    searchPointSelect.innerHTML = "";
    return;
  }

  const currentValue = searchPointSelect.value;
  const unclaimed = getUnclaimedSearchPoints(step);
  searchPointSelect.innerHTML = "";

  for (const entry of unclaimed) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    searchPointSelect.appendChild(option);
  }

  if (unclaimed.some((entry) => entry.id === currentValue)) {
    searchPointSelect.value = currentValue;
  } else if (unclaimed[0]) {
    searchPointSelect.value = unclaimed[0].id;
  }
}

function getObjectiveScanTarget(step) {
  if (isSearchStep(step)) {
    const selected = getSelectedSearchPoint(step);
    if (!selected) {
      throw new Error("No unclaimed search points remain.");
    }

    return {
      target: selected.point,
      label: selected.label,
    };
  }

  if (!step?.target) {
    throw new Error("No target location is defined for this step.");
  }

  return {
    target: step.target,
    label: "objective",
  };
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function getValidTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function getFiniteNumber(value, defaultValue = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : defaultValue;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

function getMissionElapsedMs() {
  if (!getValidTimestamp(activeMissionStartedAt)) {
    return 0;
  }

  const endTime = getValidTimestamp(activeMissionEndedAt) || Date.now();
  return Math.max(0, endTime - activeMissionStartedAt);
}

function getFinalMissionTimeMs() {
  return Math.max(0, getMissionElapsedMs() + activeTimeModifierMs);
}

function formatSignedDuration(ms) {
  const value = getFiniteNumber(ms);
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatDuration(Math.abs(value))}`;
}

function getMissionTimeSummaryText() {
  const elapsedText = `TIME TAKEN: ${formatDuration(getMissionElapsedMs())}`;

  if (activeTimeModifierMs === 0) {
    return elapsedText;
  }

  return [
    elapsedText,
    `TIME ADJUSTMENT: ${formatSignedDuration(activeTimeModifierMs)}`,
    `FINAL TIME: ${formatDuration(getFinalMissionTimeMs())}`,
  ].join("\n");
}

function getMissionStatusTimeText() {
  if (activeTimeModifierMs === 0) {
    return `TIME TAKEN: ${formatDuration(getMissionElapsedMs())}`;
  }

  return `FINAL TIME: ${formatDuration(getFinalMissionTimeMs())}`;
}

function applyTimeModifier(ms) {
  const modifier = getFiniteNumber(ms);
  if (modifier === 0) return 0;

  activeTimeModifierMs += modifier;
  saveActiveMissionState();
  return modifier;
}

function initializeSearchState(savedSearchState = {}) {
  activeSearchState = {};

  for (const step of activeMission?.steps || []) {
    if (!isSearchStep(step)) continue;

    const state = getSearchStepState(step);
    const savedClaimedIds = savedSearchState?.[step.step_id]?.claimedIds;
    state.claimedIds = Array.isArray(savedClaimedIds)
      ? savedClaimedIds.map((id) => String(id))
      : [];
  }

  refreshSearchPointOptions();
}

function getMultiAnswerConfig(step) {
  return step?.multiAnswer && typeof step.multiAnswer === "object"
    ? step.multiAnswer
    : null;
}

function isMultiAnswerPrompt(step) {
  const config = getMultiAnswerConfig(step);
  return Boolean(config && Array.isArray(config.answers) && config.answers.length);
}

function getMultiAnswerId(answer, index) {
  return String(answer?.id ?? answer?.label ?? `answer_${index + 1}`).trim();
}

function getMultiAnswerStepState(step) {
  const stepId = String(step?.step_id || "").trim();
  if (!stepId) return null;

  if (!activePromptState[stepId] || typeof activePromptState[stepId] !== "object") {
    activePromptState[stepId] = {
      matchedIds: [],
      ready: false,
    };
  }

  if (!Array.isArray(activePromptState[stepId].matchedIds)) {
    activePromptState[stepId].matchedIds = [];
  }

  activePromptState[stepId].ready = Boolean(activePromptState[stepId].ready);

  return activePromptState[stepId];
}

function getMatchedMultiAnswerIds(step) {
  const state = getMultiAnswerStepState(step);
  return new Set((state?.matchedIds || []).map((id) => String(id)));
}

function getRequiredMultiAnswerCount(step) {
  const config = getMultiAnswerConfig(step);
  const answers = Array.isArray(config?.answers) ? config.answers : [];
  const required = Math.floor(getFiniteNumber(config?.required ?? config?.requiredMatches, answers.length));

  if (!answers.length) return 0;
  return Math.max(1, Math.min(answers.length, required));
}

function getMatchedMultiAnswerCount(step) {
  const matchedIds = getMatchedMultiAnswerIds(step);
  const answers = getMultiAnswerConfig(step)?.answers || [];

  return answers.filter((answer, index) => {
    return matchedIds.has(getMultiAnswerId(answer, index));
  }).length;
}

function isMultiAnswerComplete(step) {
  return getMatchedMultiAnswerCount(step) >= getRequiredMultiAnswerCount(step);
}

function initializePromptState(savedPromptState = {}) {
  activePromptState = {};

  for (const step of activeMission?.steps || []) {
    if (!isMultiAnswerPrompt(step)) continue;

    const state = getMultiAnswerStepState(step);
    const savedState = savedPromptState?.[step.step_id];
    const validIds = new Set(
      getMultiAnswerConfig(step).answers.map((answer, index) => {
        return getMultiAnswerId(answer, index);
      })
    );

    state.matchedIds = Array.isArray(savedState?.matchedIds)
      ? savedState.matchedIds.map((id) => String(id)).filter((id) => validIds.has(id))
      : [];
    state.ready = Boolean(savedState?.ready);
  }
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

  mission.steps = mission.steps.map((step, index) => ({
    ...step,
    step_id: String(step?.step_id || `step_${index + 1}`).trim(),
  }));

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
      missionStartedAt: activeMissionStartedAt,
      missionEndedAt: activeMissionEndedAt,
      timeModifierMs: activeTimeModifierMs,
      complicationState: complications.getState(),
      searchState: activeSearchState,
      promptState: activePromptState,
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

function markMissionEndedIfNeeded() {
  if (getValidTimestamp(activeMissionEndedAt)) {
    return;
  }

  activeMissionEndedAt = Date.now();
  clearActiveStepTimer();
  complications.stop();
  complications.render();
  saveActiveMissionState();
}

function isTimedStep(step) {
  return String(step?.objective || "").trim().toLowerCase().endsWith("_timed");
}

function isPromptStep(step) {
  return String(step?.objective || "").trim().toLowerCase() === "prompt";
}

function isSearchStep(step) {
  return String(step?.objective || "").trim().toLowerCase() === "search";
}

function hasPrompts(step) {
  return isPromptStep(step) || (Array.isArray(step?.responses) && step.responses.length > 0);
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
  const promptStep = hasPrompts(step);
  const searchStep = isSearchStep(step);

  const distanceEnabled = ending ? false : getStepFlag(step, ["distanceEnabled"], true);
  const signalEnabled = ending ? false : getStepFlag(step, ["signalEnabled"], true);
  const locationEnabled =
    ending || promptStep || (searchStep && getScanTargetMode() === "safeSpot")
      ? false
      : getStepFlag(step, ["locationEnabled"], true);

  if (scanDistanceBtn) {
    scanDistanceBtn.disabled = !distanceEnabled || distanceScanInProgress;
    scanDistanceBtn.textContent = distanceScanInProgress ? "SCANNING..." : "SCAN";
  }

  if (scanSignalBtn) {
    scanSignalBtn.disabled = !signalEnabled || signalScanInProgress;
    scanSignalBtn.textContent = signalScanInProgress ? "SCANNING..." : "SCAN BEARINGS";
  }

  // Hide the entire signal row when signals are disabled (same pattern as complication row)
  const signalRowEl = document.getElementById("signalRow");
  if (signalRowEl) {
    signalRowEl.classList.toggle("hidden", !signalEnabled);
  }

  if (checkLocationBtn) {
    checkLocationBtn.disabled = !locationEnabled || locationCheckInProgress;
    checkLocationBtn.textContent = locationCheckInProgress
      ? "CHECKING..."
      : searchStep
        ? "CLAIM LOCATION"
        : "CHECK LOCATION";
  }

  if (submitPromptBtn) {
    submitPromptBtn.disabled = !promptStep || promptSubmitInProgress;
    submitPromptBtn.textContent = promptSubmitInProgress ? "SUBMITTING..." : "SUBMIT";
  }

  if (promptInputEl) {
    promptInputEl.disabled = !promptStep || promptSubmitInProgress;
  }
}

function refreshPrimaryAction() {
  const step = currentStep();
  const promptStep = hasPrompts(step);

  if (promptPanelEl) {
    promptPanelEl.classList.toggle("hidden", !promptStep);
  }

  if (checkLocationBtn) {
    checkLocationBtn.classList.toggle("hidden", promptStep);
  }

  if (promptStep && promptInputEl && document.activeElement !== promptInputEl) {
    window.setTimeout(() => {
      if (hasPrompts(currentStep())) {
        promptInputEl.focus();
      }
    }, 0);
  }
}

function renderMission() {
  if (!activeMission || !missionTitleEl || !missionTextEl) return;

  const step = currentStep();
  const ending = step && isEndingStep(step);
  missionTitleEl.textContent = activeMission.title || "UNTITLED MISSION";

  if (step) {
    if (ending) {
      markMissionEndedIfNeeded();
    }

    const stepTitle = step.title || `Step ${activeStepIndex + 1}`;
    const stepText = step.text || step.instruction || "Mission feed unavailable.";
    const searchText = isSearchStep(step)
      ? `\n\nCLAIMED: ${getClaimedSearchCount(step)} / ${getRequiredSearchClaims(step)}`
      : "";
    const promptText = isMultiAnswerPrompt(step)
      ? `\n\nVERIFIED: ${getMatchedMultiAnswerCount(step)} / ${getRequiredMultiAnswerCount(step)}`
      : "";
    const timeText = ending ? `\n\n${getMissionTimeSummaryText()}` : "";
    missionTextEl.textContent = `${stepTitle}\n\n${stepText}${searchText}${promptText}${timeText}`;
  } else {
    missionTextEl.textContent = "No active mission step.";
  }

  if (ending) {
    setStatus(`Ending reached. ${getMissionStatusTimeText()}`, "normal", "game");
  } else {
    setStatus(`Mission loaded: ${activeMission.code}`, "normal", "game");
  }

  refreshScanTargetOptions();
  refreshSearchPointOptions();
  refreshHudButtons();
  refreshPrimaryAction();
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
  if (promptInputEl) promptInputEl.value = "";
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
  const now = Date.now();
  activeMission = normalizeMission(mission);
  activeStepIndex = Number.isInteger(stepIndex) && stepIndex >= 0 ? stepIndex : 0;
  activeStepStartedAt = now;
  activeMissionStartedAt = now;
  activeMissionEndedAt = 0;
  activeTimeModifierMs = 0;
  complications.initialize();
  initializeSearchState();
  initializePromptState();
  resetHudReadings();
  if (promptInputEl) promptInputEl.value = "";
  renderMission();
  setResumeMissionVisible(false);
  showGameScreen();
  activateCurrentStep();
  complications.start();
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

  if (!getValidTimestamp(saved.stepStartedAt)) {
    activeStepStartedAt = Date.now();
  } else {
    activeStepStartedAt = saved.stepStartedAt;
  }

  activeMissionStartedAt =
    getValidTimestamp(saved.missionStartedAt) ||
    getValidTimestamp(saved.stepStartedAt) ||
    Date.now();
  activeMissionEndedAt = getValidTimestamp(saved.missionEndedAt) || 0;
  activeTimeModifierMs = getFiniteNumber(saved.timeModifierMs);
  complications.initialize(saved.complicationState);
  initializeSearchState(saved.searchState);
  initializePromptState(saved.promptState);

  renderMission();
  renderIdleHud();
  refreshHudButtons();
  refreshPrimaryAction();
  setResumeMissionVisible(false);
  showGameScreen();

  activateCurrentStep({ preserveStartTime: true });
  if (isEndingStep(currentStep())) {
    setStatus(`Ending reached. ${getMissionStatusTimeText()}`, "normal", "game");
  } else {
    complications.start();
    setStatus(`Resumed mission: ${activeMission.code}`, "normal", "game");
  }
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

function getMultiAnswerInputList(answer) {
  const values = [];

  for (const key of ["input", "text", "match"]) {
    if (typeof answer?.[key] !== "undefined") {
      values.push(answer[key]);
    }
  }

  for (const key of ["inputs", "matches"]) {
    if (Array.isArray(answer?.[key])) {
      values.push(...answer[key]);
    }
  }

  return values
    .map((value) => normalizePromptText(value))
    .filter(Boolean);
}

function findMultiAnswerMatch(step, normalizedInput) {
  const answers = getMultiAnswerConfig(step)?.answers || [];

  for (const [index, answer] of answers.entries()) {
    if (!getMultiAnswerInputList(answer).includes(normalizedInput)) continue;

    return {
      answer,
      id: getMultiAnswerId(answer, index),
      index,
    };
  }

  return null;
}

function getMultiAnswerTarget(step, keys) {
  const config = getMultiAnswerConfig(step);

  for (const key of keys) {
    const value = config?.[key];
    if (typeof value !== "undefined" && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return null;
}

function handleMultiAnswerPrompt(step, rawInput) {
  const config = getMultiAnswerConfig(step);
  const state = getMultiAnswerStepState(step);
  const normalizedInput = normalizePromptText(rawInput);
  const readyInput = normalizePromptText(config?.readyInput ?? "READY");
  const backInput = normalizePromptText(config?.backInput ?? "BACK");
  const requireReady = config?.requireReady !== false;

  if (!config || !state || !normalizedInput) return false;

  if (normalizedInput === readyInput) {
    state.ready = true;
    saveActiveMissionState();
    setStatus(
      config.readyMessage ||
        `Ready. Submit one answer at a time. ${getMatchedMultiAnswerCount(step)} / ${getRequiredMultiAnswerCount(step)} verified.`,
      "normal",
      "game"
    );
    if (promptInputEl) promptInputEl.value = "";
    return true;
  }

  if (normalizedInput === backInput) {
    const backTarget = getMultiAnswerTarget(step, ["back", "backGoto", "cancelGoto"]);
    saveActiveMissionState();
    if (promptInputEl) promptInputEl.value = "";

    if (backTarget) {
      setStatus(config.backMessage || "Returning to previous route.", "normal", "game");
      window.setTimeout(() => {
        jumpMission(backTarget, "multi-answer-back");
      }, 300);
    } else {
      setStatus(config.noBackMessage || "No return route is configured.", "error", "game");
    }

    return true;
  }

  if (requireReady && !state.ready) {
    setStatus(
      config.notReadyMessage || `Type ${config?.readyInput ?? "READY"} to begin answer verification.`,
      "normal",
      "game"
    );
    if (promptInputEl) promptInputEl.focus();
    return true;
  }

  const match = findMultiAnswerMatch(step, normalizedInput);
  if (!match) {
    setStatus(config.noMatchMessage || "No answer matched.", "error", "game");
    if (promptInputEl) promptInputEl.focus();
    return true;
  }

  if (state.matchedIds.includes(match.id)) {
    setStatus(
      match.answer.duplicateMessage ||
        config.duplicateMessage ||
        `Already verified. ${getMatchedMultiAnswerCount(step)} / ${getRequiredMultiAnswerCount(step)} complete.`,
      "normal",
      "game"
    );
    if (promptInputEl) promptInputEl.value = "";
    return true;
  }

  state.matchedIds.push(match.id);
  saveActiveMissionState();
  renderMission();
  if (promptInputEl) promptInputEl.value = "";

  const matched = getMatchedMultiAnswerCount(step);
  const required = getRequiredMultiAnswerCount(step);

  if (matched >= required) {
    const completeTarget =
      getMultiAnswerTarget(step, ["completeGoto", "goto", "next", "stepId"]) ||
      getSuccessTarget(step);
    setStatus(
      config.completeMessage || `Answer verified. ${matched} / ${required} complete.`,
      "normal",
      "game"
    );

    if (completeTarget) {
      window.setTimeout(() => {
        jumpMission(completeTarget, "multi-answer-complete");
      }, 700);
    }

    return true;
  }

  setStatus(
    match.answer.message ||
      match.answer.hint ||
      config.matchMessage ||
      `Answer verified. ${matched} / ${required} complete.`,
    "normal",
    "game"
  );

  return true;
}

async function scanDistance() {
  const step = currentStep();
  if (!step) return;

  const stepId = step.step_id;
  const scanTargetMode = getScanTargetMode();
  const ending = isEndingStep(step);
  const enabled = ending ? false : getStepFlag(step, ["distanceEnabled"], true);
  if (!enabled || distanceScanInProgress) return;

  distanceScanInProgress = true;
  refreshHudButtons();

  if (distanceValueEl) distanceValueEl.textContent = "SCANNING...";
  setStatus(
    scanTargetMode === "safeSpot"
      ? "Safe zone distance scan running..."
      : "Distance scan running...",
    "normal",
    "game"
  );

  try {
    let result;

    if (scanTargetMode === "safeSpot") {
      const current = await getAveragedPosition(5000, 400);
      const nearest = complications.getNearestSafePoint(current);

      if (!nearest) {
        throw new Error("No complication safe zones are defined for this mission.");
      }

      result = {
        meters: nearest.distanceMeters,
        current,
        safePoint: nearest.point,
      };
    } else {
      const scanTarget = getObjectiveScanTarget(step);
      result = await runDistanceScan({ target: scanTarget.target });
    }

    if (!currentStep() || currentStep()?.step_id !== stepId) {
      return;
    }

    lastDistanceReading = `${result.meters} m`;

    if (distanceValueEl) distanceValueEl.textContent = lastDistanceReading;
    setStatus(
      scanTargetMode === "safeSpot"
        ? "Safe zone distance scan complete."
        : "Distance scan complete.",
      "normal",
      "game"
    );
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
  const scanTargetMode = getScanTargetMode();
  const ending = isEndingStep(step);
  const enabled = ending ? false : getStepFlag(step, ["signalEnabled"], true);
  if (!enabled || signalScanInProgress) return;

  signalScanInProgress = true;
  refreshHudButtons();

  if (signalValueEl) signalValueEl.textContent = "SCANNING...";
  setStatus(
    scanTargetMode === "safeSpot"
      ? "Safe zone signal scan running..."
      : "Signal scan running...",
    "normal",
    "game"
  );

  try {
    let target;

    if (scanTargetMode === "safeSpot") {
      const current = await getAveragedPosition(5000, 400);
      const nearest = complications.getNearestSafePoint(current);

      if (!nearest) {
        throw new Error("No complication safe zones are defined for this mission.");
      }

      target = nearest.point;
    } else {
      target = getObjectiveScanTarget(step).target;
    }

    const result = await runSignalScan({ target });

    if (!currentStep() || currentStep()?.step_id !== stepId) {
      return;
    }

    lastSignalReading = result.signal;

    if (signalValueEl) signalValueEl.textContent = lastSignalReading;
    setStatus(
      scanTargetMode === "safeSpot"
        ? "Safe zone signal scan complete."
        : "Signal scan complete.",
      "normal",
      "game"
    );
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

function addSearchClaim(step, searchPoint) {
  const state = getSearchStepState(step);
  if (!state || !searchPoint?.id) return false;

  if (state.claimedIds.includes(searchPoint.id)) {
    return false;
  }

  state.claimedIds.push(searchPoint.id);
  saveActiveMissionState();
  return true;
}

async function checkSearchLocation(step, stepId) {
  if (isSearchComplete(step)) {
    const successTarget = getSuccessTarget(step);
    if (successTarget) {
      jumpMission(successTarget, "success");
    } else {
      advanceStep();
    }
    return;
  }

  const selected = getSelectedSearchPoint(step);
  if (!selected) {
    setStatus("No unclaimed search points remain.", "normal", "game");
    return;
  }

  const current = await getAveragedPosition(5000, 400);

  if (!currentStep() || currentStep()?.step_id !== stepId) {
    return;
  }

  const lat = Number(selected.point?.lat);
  const lng = Number(selected.point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Selected search point is missing coordinates.");
  }

  const radius = Math.max(0, getFiniteNumber(selected.point?.radiusMeters, 20));
  const distanceMeters = calculateDistanceMeters(current.lat, current.lng, lat, lng);
  lastDistanceReading = `${distanceMeters} m`;
  if (distanceValueEl) distanceValueEl.textContent = lastDistanceReading;

  if (distanceMeters > radius) {
    if (checkLocationBtn) checkLocationBtn.textContent = "CLAIM NOT MET";
    setStatus(`${selected.label} not reached.`, "normal", "game");
    return;
  }

  addSearchClaim(step, selected);
  resetHudReadings();
  refreshSearchPointOptions();

  const claimed = getClaimedSearchCount(step);
  const required = getRequiredSearchClaims(step);

  if (isSearchComplete(step)) {
    renderMission();
    if (checkLocationBtn) checkLocationBtn.textContent = "SEARCH COMPLETE";
    setStatus("Search objective complete.", "normal", "game");

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

    return;
  }

  renderMission();
  if (checkLocationBtn) checkLocationBtn.textContent = "POINT CLAIMED";
  setStatus(`${selected.label} claimed. ${claimed}/${required} complete.`, "normal", "game");
}

async function checkLocation() {
  const step = currentStep();
  if (!step) return;

  const stepId = step.step_id;
  const objective = String(step.objective || "").trim().toLowerCase();

  if (objective === "ending") {
    setStatus("This step does not require a location check.", "normal", "game");
    return;
  }

  if (hasPrompts(step)) {
    setStatus("This step uses the prompt response box.", "normal", "game");
    return;
  }

  const enabled = getStepFlag(step, ["locationEnabled"], true);
  if (!enabled || locationCheckInProgress) return;

  locationCheckInProgress = true;
  refreshHudButtons();

  if (checkLocationBtn) checkLocationBtn.textContent = "CHECKING...";
  setStatus(isSearchStep(step) ? "Checking search point..." : "Checking location...", "normal", "game");

  try {
    if (isSearchStep(step)) {
      await checkSearchLocation(step, stepId);
      return;
    }

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

function getPromptAction(response) {
  if (!response || typeof response !== "object") {
    return null;
  }

  const action = response.action && typeof response.action === "object" ? response.action : response;

  return {
    hint: action.hint ?? action.message ?? response.hint ?? response.message ?? null,
    goto: action.goto ?? action.stepId ?? action.stepIndex ?? action.next ?? response.goto ?? response.stepId ?? response.stepIndex ?? response.next ?? null,
    mission: action.mission ?? action.missionCode ?? response.mission ?? response.missionCode ?? null,
    timeModifierMs: action.timeModifierMs ?? response.timeModifierMs ?? 0,
  };
}

function applyPromptResponse(response) {
  const action = getPromptAction(response);
  if (!action) return;

  if (action.hint) {
    setStatus(action.hint, "normal", "game");
  }

  const appliedModifier = applyTimeModifier(action.timeModifierMs);
  if (appliedModifier !== 0 && !action.hint) {
    setStatus(`Time adjustment applied: ${formatSignedDuration(appliedModifier)}`, "normal", "game");
  }

  if (action.mission) {
    window.setTimeout(async () => {
      try {
        const mission = await loadMissionByCode(action.mission);
        bootMission(mission, 0);
      } catch (err) {
        console.error(err);
        setStatus(err?.message || "Mission switch failed.", "error", "game");
      }
    }, 500);
    return;
  }

  if (action.goto !== null && typeof action.goto !== "undefined") {
    window.setTimeout(() => {
      jumpMission(action.goto, "prompt");
    }, 500);
  }
}

async function submitPrompt() {
  const step = currentStep();
  if (!step) return;
  if (!hasPrompts(step) || promptSubmitInProgress) return;

  const rawInput = String(promptInputEl?.value || "");
  if (!rawInput.trim()) {
    setStatus("Enter a response first.", "error", "game");
    if (promptInputEl) promptInputEl.focus();
    return;
  }

  promptSubmitInProgress = true;
  refreshHudButtons();
  setStatus("Checking response...", "normal", "game");

  try {
    if (isMultiAnswerPrompt(step)) {
      handleMultiAnswerPrompt(step, rawInput);
      return;
    }

    const result = resolvePrompt(step, rawInput);

    if (!currentStep() || currentStep()?.step_id !== step.step_id) {
      return;
    }

    if (result.matched) {
      setStatus("Response matched.", "normal", "game");
      applyPromptResponse(result.response);
      if (promptInputEl) promptInputEl.value = "";
    } else {
      setStatus("No response matched.", "error", "game");
      if (promptInputEl) promptInputEl.focus();
    }
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Prompt check failed.", "error", "game");
  } finally {
    promptSubmitInProgress = false;
    refreshHudButtons();
  }
}

function handleResetToAccess() {
  clearActiveStepTimer();
  complications.stop();

  activeMission = null;
  activeStepIndex = 0;
  activeStepStartedAt = 0;
  activeMissionStartedAt = 0;
  activeMissionEndedAt = 0;
  activeTimeModifierMs = 0;
  complications.reset();
  activeSearchState = {};
  activePromptState = {};
  distanceScanInProgress = false;
  signalScanInProgress = false;
  locationCheckInProgress = false;
  promptSubmitInProgress = false;

  clearSavedMission();
  resetHudReadings();
  complications.render();
  refreshScanTargetOptions();
  refreshSearchPointOptions();
  if (promptInputEl) promptInputEl.value = "";
  setResumeMissionVisible(false);

  if (missionTitleEl) missionTitleEl.textContent = "NO MISSION LOADED";
  if (missionTextEl) missionTextEl.textContent = "Enter a mission code to begin.";

  refreshHudButtons();
  refreshPrimaryAction();
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
submitPromptBtn?.addEventListener("click", submitPrompt);

scanTargetSelect?.addEventListener("change", () => {
  resetHudReadings();
  refreshSearchPointOptions();
  refreshHudButtons();
  const label = getScanTargetMode() === "safeSpot" ? "safe zone" : "objective";
  setStatus(`Scanning for ${label}.`, "normal", "game");
});

searchPointSelect?.addEventListener("change", () => {
  resetHudReadings();
  const selectedLabel =
    searchPointSelect.selectedOptions?.[0]?.textContent || searchPointSelect.value;
  setStatus(`Search point selected: ${selectedLabel}`, "normal", "game");
});

promptInputEl?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    submitPrompt();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  const saved = loadSavedMissionState();

  resetHudReadings();
  refreshScanTargetOptions();
  refreshHudButtons();
  refreshPrimaryAction();
  showAccessScreen();

  if (saved && saved.mission) {
    setResumeMissionVisible(true);
    setStatus(`Saved mission found: ${saved.mission.code}`, "normal", "access");
  } else {
    setResumeMissionVisible(false);
    setStatus("Awaiting code input.", "normal", "access");
  }
});
