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

function normalizePosition(pos) {
  const lat = pos?.coords?.latitude;
  const lng = pos?.coords?.longitude;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    accuracy: Number.isFinite(pos.coords.accuracy)
      ? pos.coords.accuracy
      : Infinity,
    timestamp: Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now(),
  };
}

function getGeolocationOptions(timeoutMs) {
  return {
    enableHighAccuracy: true,
    timeout: timeoutMs,
    maximumAge: 0,
  };
}

export function getCurrentPosition(timeoutMs = 15000) {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("Geolocation is not supported on this device.");
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const position = normalizePosition(pos);

        if (!position) {
          reject(new Error("Unable to read a valid GPS position."));
          return;
        }

        resolve(position);
      },
      (err) => {
        reject(new Error(err?.message || "Unable to get location."));
      },
      getGeolocationOptions(timeoutMs)
    );
  });
}

function collectWatchedPositions(durationMs, options = {}) {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("Geolocation is not supported on this device.");
  }

  const minSamples = options.minSamples ?? 3;
  const minDurationMs = options.minDurationMs ?? 1500;
  const desiredAccuracyMeters = options.desiredAccuracyMeters ?? 20;
  const timeoutMs = Math.max(durationMs + 5000, 15000);

  return new Promise((resolve, reject) => {
    const samples = [];
    let lastError = null;
    let watchId = null;
    let settled = false;
    const startedAt = Date.now();

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);

      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }

      if (samples.length) {
        resolve(samples);
      } else {
        reject(lastError || new Error("Unable to obtain any GPS readings."));
      }
    };

    const timeoutId = setTimeout(finish, durationMs);

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const position = normalizePosition(pos);
          if (!position) return;

          samples.push(position);

          if (
            samples.length >= minSamples &&
            Date.now() - startedAt >= minDurationMs &&
            position.accuracy <= desiredAccuracyMeters
          ) {
            finish();
          }
        },
        (err) => {
          lastError = new Error(err?.message || "Unable to get location.");

          if (err?.code === err?.PERMISSION_DENIED && !samples.length) {
            finish();
          }
        },
        getGeolocationOptions(timeoutMs)
      );
    } catch (err) {
      clearTimeout(timeoutId);
      reject(err);
    }
  });
}

async function collectPolledPositions(durationMs, intervalMs) {
  const samples = [];
  const endTime = Date.now() + durationMs;

  while (Date.now() < endTime) {
    try {
      const position = await getCurrentPosition(Math.max(durationMs, 10000));
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

  return samples;
}

function chooseBestPositionCluster(samples, maxUsableAccuracyMeters) {
  const accurateSamples = samples.filter((sample) => {
    return sample.accuracy <= maxUsableAccuracyMeters;
  });

  const candidates = accurateSamples.length ? accurateSamples : samples;
  const anchor = candidates.reduce((best, sample) => {
    return sample.accuracy < best.accuracy ? sample : best;
  }, candidates[0]);

  const cluster = candidates.filter((sample) => {
    const distanceFromAnchor = calculateDistanceMeters(
      sample.lat,
      sample.lng,
      anchor.lat,
      anchor.lng
    );
    const toleratedDrift = Math.max(anchor.accuracy, sample.accuracy, 25) * 2;

    return distanceFromAnchor <= toleratedDrift;
  });

  return cluster.length ? cluster : candidates;
}

function averagePositionSamples(samples) {
  let weightedLat = 0;
  let weightedLng = 0;
  let totalWeight = 0;

  for (const sample of samples) {
    const accuracy = Number.isFinite(sample.accuracy)
      ? Math.max(sample.accuracy, 1)
      : 50;

    // Accuracy is a radius, so square it to reduce the pull of loose fixes.
    const weight = 1 / accuracy ** 2;

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

export async function getAveragedPosition(
  durationMs = 5000,
  intervalMs = 400,
  options = {}
) {
  const maxUsableAccuracyMeters = options.maxUsableAccuracyMeters ?? 100;
  let samples;

  try {
    samples = await collectWatchedPositions(durationMs, options);
  } catch (err) {
    console.warn("Location watch failed, falling back to polling:", err);
    samples = await collectPolledPositions(durationMs, intervalMs);
  }

  const cluster = chooseBestPositionCluster(samples, maxUsableAccuracyMeters);

  return averagePositionSamples(cluster);
}
