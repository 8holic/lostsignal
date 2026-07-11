import { getAveragedPosition, calculateDistanceMeters } from "./common.js";

export async function scanDistance(step) {
  if (!step?.target) {
    throw new Error("No target location is defined for this step.");
  }

  const current = await getAveragedPosition(5000, 400);

  const meters = calculateDistanceMeters(
    current.lat,
    current.lng,
    step.target.lat,
    step.target.lng
  );

  return {
    meters,
    current,
  };
}