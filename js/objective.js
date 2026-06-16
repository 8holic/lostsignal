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

export function buildLoreText(mission, stepIndex) {
  if (!mission) {
    return "Enter a mission code to begin.";
  }

  const step = getCurrentStep(mission, stepIndex);
  const locationLine = mission.location
    ? `${mission.location}\n\n`
    : "";

  if (step) {
    const stepTitle = step.title || `Step ${stepIndex + 1}`;
    const stepText =
      step.text ||
      step.instruction ||
      "No step text provided.";

    return `${locationLine}${stepTitle}\n\n${stepText}`;
  }

  return `${locationLine}${mission.intro || "No mission intro provided."}`;
}

export function checkObjective(step, distanceMeters) {
  if (!step?.target) {
    return false;
  }

  const radius = Number(step.target.radiusMeters ?? 20);
  const objective = String(
    step.objective || "arrive"
  ).toLowerCase();

  switch (objective) {
    case "arrive":
      return distanceMeters <= radius;

    case "disband":
      return distanceMeters >= radius;

    default:
      return false;
  }
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