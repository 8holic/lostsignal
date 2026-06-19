import { getAveragedPosition } from "./common.js";

function normalizeHeading(value) {
  if (!Number.isFinite(value)) return null;
  return ((value % 360) + 360) % 360;
}

async function requestCompassPermissionIfNeeded() {
  if (
    typeof window !== "undefined" &&
    "DeviceOrientationEvent" in window &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    const permission = await DeviceOrientationEvent.requestPermission();

    if (permission !== "granted") {
      throw new Error("Compass permission was denied.");
    }
  }
}

function headingFromEvent(event) {
  let heading = null;

  if (Number.isFinite(event.webkitCompassHeading)) {
    heading = event.webkitCompassHeading;
  } else if (Number.isFinite(event.alpha)) {
    heading = 360 - event.alpha;
  }

  return normalizeHeading(heading);
}

function averageCircularHeadings(headings) {
  if (!headings.length) return null;

  let x = 0;
  let y = 0;

  for (const heading of headings) {
    const rad = (heading * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }

  const avgRad = Math.atan2(y, x);

  return normalizeHeading((avgRad * 180) / Math.PI);
}

async function getAveragedDeviceHeading(durationMs = 2500) {
  if (typeof window === "undefined") {
    throw new Error("Compass heading is not available here.");
  }

  await requestCompassPermissionIfNeeded();

  if (
    !("DeviceOrientationEvent" in window) &&
    !("ondeviceorientation" in window)
  ) {
    throw new Error("Compass heading is not supported on this device.");
  }

  return new Promise((resolve, reject) => {
    const headings = [];
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("deviceorientation", onOrientation, true);
      window.removeEventListener(
        "deviceorientationabsolute",
        onOrientation,
        true
      );
      clearTimeout(timeoutId);
    };

    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onOrientation = (event) => {
      const heading = headingFromEvent(event);
      if (heading === null) return;
      headings.push(heading);
    };

    const timeoutId = window.setTimeout(() => {
      const averagedHeading = averageCircularHeadings(headings);

      if (averagedHeading === null) {
        finishReject(new Error("Unable to read compass heading."));
        return;
      }

      finishResolve(averagedHeading);
    }, durationMs);

    window.addEventListener("deviceorientation", onOrientation, true);
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
  });
}

export function calculateBearing(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const λ1 = toRad(lng1);
  const λ2 = toRad(lng2);

  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function signedAngleDifference(bearing, heading) {
  return ((bearing - heading + 540) % 360) - 180;
}

export function calculateSignalStrength(bearing, heading) {
  const diff = Math.abs(signedAngleDifference(bearing, heading));

  // Absolute difference → number of filled bars
  let filled;
  if (diff <= 20) {
    filled = 5;               // 0–20°  → 5 bars
  } else if (diff <= 40) {
    filled = 4;               // 20–40° → 4 bars
  } else if (diff <= 60) {
    filled = 3;               // 40–60° → 3 bars
  } else if (diff <= 80) {
    filled = 2;               // 60–80° → 2 bars
  } else if (diff <= 100) {
    filled = 1;               // 80–100°→ 1 bar
  } else {
    filled = 0;               // >100°  → 0 bars
  }

  return "█".repeat(filled) + "░".repeat(5 - filled);
}

export async function scanSignal(step) {
  if (!step?.target) {
    throw new Error("No target location is defined for this step.");
  }

  const [current, heading] = await Promise.all([
    getAveragedPosition(5000, 400),
    getAveragedDeviceHeading(2500),
  ]);

  const bearing = calculateBearing(
    current.lat,
    current.lng,
    step.target.lat,
    step.target.lng
  );

  return {
    bearing,
    heading,
    signal: calculateSignalStrength(bearing, heading),
  };
}