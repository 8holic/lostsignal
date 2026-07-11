import { calculateDistanceMeters, getAveragedPosition } from "./common.js";

const COMPLICATION_TICK_MS = 1000;
const COMPLICATION_SAFE_RADIUS_MULTIPLIER = 1.4;
const COMPLICATION_BAR_COUNT = 5;
const COMPLICATION_FINAL_WARNING_PROGRESS = 0.95;
const SUPPORTED_COMPLICATIONS = new Set(["safe_zone_penalty"]);

function getFiniteNumber(value, defaultValue = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : defaultValue;
}

function getValidTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function normalizeTextKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getComplicationKind(config) {
  return normalizeTextKey(config?.complication);
}

function getComplicationName(config) {
  return String(config?.complicationName || "").trim();
}

function getComplicationStateKey(config, index) {
  const kind = getComplicationKind(config) || "complication";
  const name = normalizeTextKey(getComplicationName(config)) || `entry_${index + 1}`;
  return `${kind}:${name}:${index + 1}`;
}

function getComplicationConfig(entry) {
  return entry?.config || entry;
}

function getComplicationIntervalMs(entry) {
  const interval = getFiniteNumber(getComplicationConfig(entry)?.intervalMs);
  return interval > 0 ? interval : null;
}

function getComplicationSafePoints(entry) {
  const config = getComplicationConfig(entry);
  if (Array.isArray(config?.safeZones)) return config.safeZones;
  return [];
}

function formatComplicationBars(bars) {
  const filled = Math.max(0, Math.min(COMPLICATION_BAR_COUNT, Number(bars) || 0));
  return `${"#".repeat(filled)}${"-".repeat(COMPLICATION_BAR_COUNT - filled)}`;
}

export function createComplicationController({
  rowEl,
  valueEl,
  getMission,
  getStep,
  isEndingStep,
  setStatus,
  applyTimeModifier,
  formatSignedDuration,
  saveState,
}) {
  let complicationState = {};
  let tickTimerId = null;

  function getComplications() {
    const mission = getMission();
    const configured = Array.isArray(mission?.complications) ? mission.complications : [];

    const entries = configured.map((config, index) => ({
      config,
      index,
      kind: getComplicationKind(config),
      name: getComplicationName(config),
      stateKey: getComplicationStateKey(config, index),
    }));

    const missingKind = entries.find((entry) => !entry.kind);
    if (missingKind) {
      throw new Error(`Complication ${missingKind.index + 1} is missing a complication key.`);
    }

    const missingName = entries.find((entry) => !entry.name);
    if (missingName) {
      throw new Error(`Complication ${missingName.index + 1} is missing complicationName.`);
    }

    const unsupported = entries.find((entry) => !SUPPORTED_COMPLICATIONS.has(entry.kind));
    if (unsupported) {
      throw new Error(`Unsupported complication: ${unsupported.kind}`);
    }

    return entries;
  }

  function getAllSafePoints() {
    return getComplications().flatMap((complication) => {
      return getComplicationSafePoints(complication).map((point, index) => ({
        ...point,
        complication: complication.kind,
        complicationName: complication.name || null,
        safePointIndex: index,
      }));
    });
  }

  function getNearestSafePoint(position) {
    let nearest = null;

    for (const point of getAllSafePoints()) {
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }

      const distanceMeters = calculateDistanceMeters(
        position.lat,
        position.lng,
        lat,
        lng
      );

      if (!nearest || distanceMeters < nearest.distanceMeters) {
        nearest = {
          point,
          distanceMeters,
        };
      }
    }

    return nearest;
  }

  function getComplicationState(complication) {
    if (!complication?.stateKey) return null;

    if (
      !complicationState[complication.stateKey] ||
      typeof complicationState[complication.stateKey] !== "object"
    ) {
      complicationState[complication.stateKey] = {};
    }

    return complicationState[complication.stateKey];
  }

  function scheduleNext(complication, fromTime = Date.now()) {
    const state = getComplicationState(complication);
    const intervalMs = getComplicationIntervalMs(complication);
    if (!state || !intervalMs) return;

    state.nextFireAt = fromTime + intervalMs;
    state.currentBars = 0;
    state.checkInProgress = false;
  }

  function getBars(complication, now = Date.now()) {
    const state = getComplicationState(complication);
    const intervalMs = getComplicationIntervalMs(complication);
    if (!state || !intervalMs || !getValidTimestamp(state.nextFireAt)) {
      return 0;
    }

    const remainingMs = state.nextFireAt - now;
    if (remainingMs <= 0) return COMPLICATION_BAR_COUNT;

    const elapsedMs = Math.max(0, intervalMs - remainingMs);
    const progress = elapsedMs / intervalMs;

    if (progress >= COMPLICATION_FINAL_WARNING_PROGRESS) {
      return COMPLICATION_BAR_COUNT;
    }

    return Math.max(
      0,
      Math.min(
        COMPLICATION_BAR_COUNT - 1,
        Math.floor((progress / COMPLICATION_FINAL_WARNING_PROGRESS) * COMPLICATION_BAR_COUNT)
      )
    );
  }

  function render() {
    if (!valueEl) return;

    const activeComplications = getComplications();
    const visible = activeComplications.length > 0 && !isEndingStep(getStep());
    rowEl?.classList.toggle("hidden", !visible);

    if (!visible) {
      valueEl.textContent = formatComplicationBars(0);
      return;
    }

    const checking = activeComplications.some((complication) => {
      return Boolean(getComplicationState(complication)?.checkInProgress);
    });

    if (checking) {
      valueEl.textContent = "RESOLVING";
      return;
    }

    const now = Date.now();
    const bars = activeComplications.reduce((maxBars, complication) => {
      return Math.max(maxBars, getBars(complication, now));
    }, 0);

    valueEl.textContent = formatComplicationBars(bars);
  }

  function initialize(savedComplicationState = {}) {
    complicationState = {};
    const now = Date.now();

    for (const complication of getComplications()) {
      const state = getComplicationState(complication);
      const savedState = savedComplicationState?.[complication.stateKey];
      const savedNextFireAt = getValidTimestamp(savedState?.nextFireAt);

      state.nextFireAt = savedNextFireAt || now + getComplicationIntervalMs(complication);
      state.currentBars = getFiniteNumber(savedState?.currentBars);
      state.checkInProgress = false;
    }

    render();
  }

  function isPositionInSafePoint(position, complication) {
    return getComplicationSafePoints(complication).some((point) => {
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return false;
      }

      const radius = getFiniteNumber(point?.radiusMeters ?? complication.config?.radiusMeters, 20);
      const generousRadius = Math.max(0, radius * COMPLICATION_SAFE_RADIUS_MULTIPLIER);
      const distance = calculateDistanceMeters(position.lat, position.lng, lat, lng);

      return distance <= generousRadius;
    });
  }

  async function resolve(complication) {
    const state = getComplicationState(complication);
    if (!state || state.checkInProgress) return;

    state.checkInProgress = true;
    render();
    const name = complication.name || "Complication";
    const config = complication.config || {};
    setStatus(config?.onCheck?.message || `${name} check running.`, "normal", "game");

    try {
      const position = await getAveragedPosition(5000, 400);

      if (!getMission() || isEndingStep(getStep())) {
        return;
      }

      if (isPositionInSafePoint(position, complication)) {
        setStatus(config?.onSuccess?.message || `${name} safe zone confirmed.`, "normal", "game");
      } else {
        const failAction = config?.onFail || {};
        const appliedModifier = applyTimeModifier(failAction.timeModifierMs);
        const modifierText = appliedModifier ? ` ${formatSignedDuration(appliedModifier)}` : "";
        setStatus(
          failAction.message || `${name} triggered.${modifierText}`,
          "error",
          "game"
        );
      }
    } catch (err) {
      console.error(err);
      setStatus(err?.message || "Complication check failed.", "error", "game");
    } finally {
      if (getMission() && !isEndingStep(getStep())) {
        scheduleNext(complication);
        saveState();
        render();
      }
    }
  }

  function tick() {
    if (!getMission() || isEndingStep(getStep())) {
      stop();
      render();
      return;
    }

    const now = Date.now();

    for (const complication of getComplications()) {
      const state = getComplicationState(complication);
      const intervalMs = getComplicationIntervalMs(complication);
      if (!state || !intervalMs) continue;

      if (!getValidTimestamp(state.nextFireAt)) {
        scheduleNext(complication, now);
        saveState();
      }

      state.currentBars = getBars(complication, now);

      if (now >= state.nextFireAt && !state.checkInProgress) {
        resolve(complication);
      }
    }

    render();
  }

  function start() {
    stop();

    if (!getComplications().length || isEndingStep(getStep())) {
      render();
      return;
    }

    tickTimerId = window.setInterval(tick, COMPLICATION_TICK_MS);
    tick();
  }

  function stop() {
    if (tickTimerId !== null) {
      clearInterval(tickTimerId);
      tickTimerId = null;
    }
  }

  function reset() {
    stop();
    complicationState = {};
    render();
  }

  return {
    getAllSafePoints,
    getNearestSafePoint,
    getState: () => complicationState,
    initialize,
    render,
    reset,
    start,
    stop,
  };
}
