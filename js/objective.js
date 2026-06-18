export function getCurrentStep(mission, stepIndex) {
  if (!mission || !Array.isArray(mission.steps)) {
    return null;
  }

  return mission.steps[stepIndex] || null;
}

export function getStepFlag(step, keys, defaultValue = true) {
  if (!step) {
    return defaultValue;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(step, key)) {
      return Boolean(step[key]);
    }
  }

  return defaultValue;
}

function normalizeObjectiveName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getTimeLimitMs(step) {
  const raw = step?.rules?.timeMs ?? step?.timeMs;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function buildLoreText(mission, stepIndex) {
  if (!mission) {
    return "Enter a mission code to begin.";
  }

  const step = getCurrentStep(mission, stepIndex);
  const locationLine = mission.location ? `${mission.location}\n\n` : "";

  if (step) {
    const stepTitle = step.title || `Step ${stepIndex + 1}`;
    const stepText = step.text || step.instruction || "No step text provided.";

    return `${locationLine}${stepTitle}\n\n${stepText}`;
  }

  return `${locationLine}${mission.intro || "No mission intro provided."}`;
}

export function evaluateObjective(step, context = {}) {
  const objective = normalizeObjectiveName(step?.objective);

  if (!step) {
    return {
      status: "not_met",
      objective: "",
      reason: "missing_step",
    };
  }

  if (objective === "ending") {
    return {
      status: "ending",
      objective,
    };
  }

  const radius = Number(step?.target?.radiusMeters ?? 20);
  const distanceMeters = Number(context.distanceMeters);
  const elapsedMsValue = Number(context.elapsedMs);
  const elapsedMs = Number.isFinite(elapsedMsValue) ? elapsedMsValue : null;
  const timeLimitMs = getTimeLimitMs(step);
  const timed = objective.endsWith("_timed");

  if (timed && timeLimitMs !== null && elapsedMs !== null && elapsedMs >= timeLimitMs) {
    return {
      status: "failed",
      objective,
      radiusMeters: radius,
      distanceMeters,
      elapsedMs,
      timeLimitMs,
    };
  }

  switch (objective) {
    case "arrive":
    case "arrive_timed":
      return {
        status: distanceMeters <= radius ? "succeed" : "not_met",
        objective,
        radiusMeters: radius,
        distanceMeters,
        elapsedMs,
        timeLimitMs,
      };

    case "evacuate":
    case "disband":
    case "evacuate_timed":
      return {
        status: distanceMeters >= radius ? "succeed" : "not_met",
        objective,
        radiusMeters: radius,
        distanceMeters,
        elapsedMs,
        timeLimitMs,
      };

    default:
      return {
        status: "not_met",
        objective,
        radiusMeters: radius,
        distanceMeters,
        elapsedMs,
        timeLimitMs,
        reason: "unknown_objective",
      };
  }
}

export function checkObjective(step, distanceMeters) {
  return evaluateObjective(step, { distanceMeters }).status === "succeed";
}

export function advanceStep(state) {
  if (!state?.mission || !Array.isArray(state.mission.steps)) {
    return state;
  }

  const nextIndex = Math.min(
    (state.stepIndex ?? 0) + 1,
    state.mission.steps.length - 1
  );

  return {
    ...state,
    stepIndex: nextIndex,
  };
}