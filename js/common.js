export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;

  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export function getCurrentPosition() {
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

export async function getAveragedPosition(
  durationMs = 5000,
  intervalMs = 400
) {
  const samples = [];
  const endTime = Date.now() + durationMs;

  while (Date.now() < endTime) {
    try {
      const position = await getCurrentPosition();
      samples.push(position);
    } catch (err) {
      console.warn("Location sample failed:", err);
    }

    if (Date.now() < endTime) {
      await sleep(intervalMs);
    }
  }

  if (!samples.length) {
    throw new Error("Unable to obtain any GPS readings.");
  }

  let weightedLat = 0;
  let weightedLng = 0;
  let totalWeight = 0;

  for (const sample of samples) {
    const accuracy = Math.max(sample.accuracy || 50, 1);

    // Better accuracy => larger weight
    const weight = 1 / accuracy;

    weightedLat += sample.lat * weight;
    weightedLng += sample.lng * weight;
    totalWeight += weight;
  }

  return {
    lat: weightedLat / totalWeight,
    lng: weightedLng / totalWeight,
    accuracy:
      samples.reduce((best, s) => Math.min(best, s.accuracy), Infinity),
    sampleCount: samples.length,
    samples,
  };
}