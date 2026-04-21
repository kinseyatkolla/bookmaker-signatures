/**
 * Tropical absolute longitude (0° = Aries 0°, 30° = Taurus 0°, …, 174° = 24° Virgo).
 *
 * Matches correspondences-app:
 * - Lines mode uses `sample.planets[name].longitude` (0–360) from year ephemeris; see
 *   `correspondences-app/frontend/src/utils/ephemerisChartData.ts` → `processEphemerisData`.
 * - Chart + ephemeris planets are built the same way in
 *   `correspondences-app/backend/routes/astrology.js` (Swiss Ephemeris `longitude`, then
 *   `zodiacSign = floor(longitude/30)`, `degree = longitude % 30`).
 *
 * Resolution order here mirrors that: `longitude` → `zodiacSign` + `degree` → sign name + `degreeFormatted`.
 */

export const TROPICAL_SIGN_ORDER = [
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
];

export function normalizeEclipticLongitudeDeg(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  let x = value % 360;
  if (x < 0) x += 360;
  if (x >= 360) x = 359.9999;
  return x;
}

function parseDegreeWithinSign(degreeFormatted) {
  const degMatch = String(degreeFormatted || "").match(/^(\d+)°/);
  const minMatch = String(degreeFormatted || "").match(/(\d+)'/);
  const secMatch = String(degreeFormatted || "").match(/(\d+)"/);
  const degrees = degMatch ? parseFloat(degMatch[1]) : 0;
  const minutes = minMatch ? parseFloat(minMatch[1]) : 0;
  const seconds = secMatch ? parseFloat(secMatch[1]) : 0;
  return degrees + minutes / 60 + seconds / 3600;
}

/**
 * @param {object} planet - chart / ephemeris planet object from correspondences-app
 * @returns {number|null} absolute longitude 0..<360
 */
export function absoluteTropicalLongitudeDeg(planet) {
  if (!planet || typeof planet !== "object") return null;

  if (typeof planet.longitude === "number" && Number.isFinite(planet.longitude)) {
    return normalizeEclipticLongitudeDeg(planet.longitude);
  }

  const zs = planet.zodiacSign;
  const deg = planet.degree;
  if (
    typeof zs === "number" &&
    Number.isFinite(zs) &&
    zs >= 0 &&
    zs <= 11 &&
    typeof deg === "number" &&
    Number.isFinite(deg)
  ) {
    return normalizeEclipticLongitudeDeg(zs * 30 + deg);
  }

  const signRaw = planet.zodiacSignName;
  const signIndex = TROPICAL_SIGN_ORDER.findIndex(
    (s) => s.toLowerCase() === String(signRaw || "").toLowerCase(),
  );
  if (signIndex < 0) return null;

  const within = parseDegreeWithinSign(planet.degreeFormatted);
  if (!Number.isFinite(within)) return null;

  return normalizeEclipticLongitudeDeg(signIndex * 30 + within);
}

/** Signed smallest arc from start to end on the circle (degrees), in (-180, 180]. */
export function shortestLongitudeDeltaDeg(startDeg, endDeg) {
  const s = normalizeEclipticLongitudeDeg(startDeg);
  const e = normalizeEclipticLongitudeDeg(endDeg);
  if (s === null || e === null) return 0;
  let d = e - s;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
