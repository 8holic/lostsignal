function getCurrentPosition() {
  if (!navigator.geolocation) {
    throw new Error("Geolocation is not supported on this device.");
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        reject(new Error(err?.message || "Unable to get location."));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });
}

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

async function getDeviceHeading() {
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
      let heading = null;

      if (Number.isFinite(event.webkitCompassHeading)) {
        heading = event.webkitCompassHeading;
      } else if (Number.isFinite(event.alpha)) {
        heading = 360 - event.alpha;
      }

      heading = normalizeHeading(heading);

      if (heading === null) return;

      finishResolve(heading);
    };

    const timeoutId = window.setTimeout(() => {
      finishReject(new Error("Unable to read compass heading."));
    }, 4000);

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

export function calculateSignalStrength(angleDifferenceDegrees) {
  const diff = Math.min(Math.abs(angleDifferenceDegrees), 180);

  if (diff <= 15) return "█████";
  if (diff <= 35) return "████░";
  if (diff <= 60) return "███░░";
  if (diff <= 100) return "██░░░";
  if (diff <= 140) return "█░░░░";
  return "░░░░░";
}

export async function scanSignal(step) {
  if (!step?.target) {
    throw new Error("No target location is defined for this step.");
  }

  const current = await getCurrentPosition();
  const heading = await getDeviceHeading();

  const bearing = calculateBearing(
    current.lat,
    current.lng,
    step.target.lat,
    step.target.lng
  );

  let diff = Math.abs(bearing - heading);
  diff = Math.min(diff, 360 - diff);

  return {
    bearing,
    heading,
    signal: calculateSignalStrength(diff),
    current,
  };
}