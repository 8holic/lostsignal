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

export function normalizePromptText(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
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
    const stepText = step.text || step.instruction || "Mission feed unavailable.";

    return `${locationLine}${stepTitle}\n\n${stepText}`;
  }

  return `${locationLine}${mission.intro || "Mission feed unavailable."}`;
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

export function resolvePrompt(step, rawInput) {
  const normalizedInput = normalizePromptText(rawInput);
  if (!normalizedInput) {
    return {
      matched: false,
      response: null,
      normalizedInput,
    };
  }

  const responses = Array.isArray(step?.responses) ? step.responses : [];
  for (const response of responses) {
    const responseInput = normalizePromptText(response?.input ?? response?.text ?? response?.match);
    if (!responseInput) continue;
    if (responseInput !== normalizedInput) continue;

    return {
      matched: true,
      response,
      normalizedInput,
    };
  }

  return {
    matched: false,
    response: null,
    normalizedInput,
  };
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
