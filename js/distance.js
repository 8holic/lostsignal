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

export async function scanDistance(step) {
  if (!step?.target) {
    throw new Error("No target location is defined for this step.");
  }

  const current = await getCurrentPosition();

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