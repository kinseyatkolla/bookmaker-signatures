/**
 * Lunation times from IMCCE OPALE (moon phases + eclipse pairing) and Moon
 * position at each instant via the correspondences-app chart API.
 * Mirrors correspondences-app/frontend/src/utils/lunationsUtils.ts
 */

function ensureTrailingZ(iso) {
  const t = String(iso || "").trim();
  if (!t) return "";
  if (t.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(t)) return t;
  return `${t}Z`;
}

function parseEclipseInstant(eclipse) {
  const dateValue =
    eclipse?.events?.greatest?.date ||
    eclipse?.events?.greatest?.Date ||
    eclipse?.calendarDate ||
    eclipse?.date ||
    eclipse?.Date ||
    eclipse?.datetime ||
    eclipse?.Datetime ||
    eclipse?.time ||
    eclipse?.dateTime;
  if (!dateValue || typeof dateValue !== "string") return null;
  let eclipseDate = dateValue.trim();
  const hasTimezone =
    /[Z+-]\d{2}:?\d{2}$/.test(eclipseDate) || eclipseDate.endsWith("Z");
  if (!hasTimezone) eclipseDate = `${eclipseDate}Z`;
  const dt = new Date(eclipseDate);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function fetchOpaleMoonPhasesMonth(year, month) {
  const response = await fetch(
    `https://opale.imcce.fr/api/v1/phenomena/moonphases?year=${year}&month=${month}`,
  );
  if (!response.ok) {
    throw new Error(`OPALE moonphases ${response.status}`);
  }
  return response.json();
}

async function fetchOpaleEclipsesYear(year, eclipseType) {
  const eclipseCode = eclipseType === "lunar" ? "301" : "10";
  const response = await fetch(
    `https://opale.imcce.fr/api/v1/phenomena/eclipses/${eclipseCode}/${year}`,
  );
  if (!response.ok) {
    throw new Error(`OPALE eclipses ${response.status}`);
  }
  const data = await response.json();
  if (eclipseType === "lunar") {
    if (Array.isArray(data?.response?.lunareclipse)) {
      return data.response.lunareclipse;
    }
    return [];
  }
  if (Array.isArray(data?.response?.data)) {
    return data.response.data;
  }
  return [];
}

async function fetchMoonPositionAtUtc(apiBaseUrl, utcDate, coords) {
  const base = String(apiBaseUrl || "").replace(/\/$/, "");
  const response = await fetch(`${base}/astrology/chart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      year: utcDate.getUTCFullYear(),
      month: utcDate.getUTCMonth() + 1,
      day: utcDate.getUTCDate(),
      hour: utcDate.getUTCHours(),
      minute: utcDate.getUTCMinutes(),
      second: utcDate.getUTCSeconds(),
      latitude: coords.latitude,
      longitude: coords.longitude,
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const moon = payload?.data?.planets?.moon;
  if (!moon || moon.error) return null;
  return {
    degree: moon.degree,
    degreeFormatted: moon.degreeFormatted,
    zodiacSignName: moon.zodiacSignName,
  };
}

function phaseNameFromOpale(moonPhase) {
  return String(moonPhase || "")
    .replace(/([A-Z])/g, " $1")
    .trim();
}

/**
 * @param {number} year
 * @param {{ latitude: number, longitude: number }} coords
 * @param {string} apiBaseUrl
 * @returns {Promise<Array<{
 *   type: 'lunation',
 *   id: string,
 *   title: string,
 *   utcDateTime: string,
 *   moonPosition?: { degree: number, degreeFormatted: string, zodiacSignName: string },
 *   isEclipse: boolean,
 *   eclipseType?: 'lunar'|'solar'
 * }>>}
 */
export async function fetchLunationsForYear(year, coords, apiBaseUrl) {
  const allPhases = [];
  for (let month = 1; month <= 12; month += 1) {
    try {
      const monthData = await fetchOpaleMoonPhasesMonth(year, month);
      if (monthData?.response?.data) {
        for (const phase of monthData.response.data) {
          allPhases.push({
            moonPhase: phase.moonPhase,
            date: phase.date,
          });
        }
      }
    } catch {
      // continue other months
    }
  }

  if (allPhases.length === 0) {
    return [];
  }

  let lunarEclipses = [];
  let solarEclipses = [];
  try {
    lunarEclipses = await fetchOpaleEclipsesYear(year, "lunar");
  } catch {
    /* ignore */
  }
  try {
    solarEclipses = await fetchOpaleEclipsesYear(year, "solar");
  } catch {
    /* ignore */
  }

  const eclipseMap = new Map();
  for (const eclipse of lunarEclipses) {
    const dt = parseEclipseInstant(eclipse);
    if (dt) eclipseMap.set(dt.getTime(), { type: "lunar", date: dt });
  }
  for (const eclipse of solarEclipses) {
    const dt = parseEclipseInstant(eclipse);
    if (dt) eclipseMap.set(dt.getTime(), { type: "solar", date: dt });
  }

  const phasesWithTimes = allPhases.map((phase) => {
    const utcString = ensureTrailingZ(phase.date);
    const utcDateTime = new Date(utcString);
    return {
      ...phase,
      utcDateTime: Number.isNaN(utcDateTime.getTime()) ? null : utcDateTime,
    };
  });

  const withMoon = await Promise.all(
    phasesWithTimes.map(async (phase) => {
      if (!phase.utcDateTime) return { ...phase, moonPosition: undefined };
      const moonPosition = await fetchMoonPositionAtUtc(
        apiBaseUrl,
        phase.utcDateTime,
        coords,
      );
      return { ...phase, moonPosition: moonPosition || undefined };
    }),
  );

  const out = withMoon
    .filter((p) => p.utcDateTime)
    .map((phase, index) => {
      const phaseName = phaseNameFromOpale(phase.moonPhase);
      const lunationTime = phase.utcDateTime.getTime();
      const isNewMoon = phaseName === "New Moon";
      const isFullMoon = phaseName === "Full Moon";

      let eclipseInfo;
      let closest = Infinity;
      for (const [eclipseTime, info] of eclipseMap.entries()) {
        const typeMatches =
          (info.type === "solar" && isNewMoon) ||
          (info.type === "lunar" && isFullMoon);
        if (!typeMatches) continue;
        const timeDiff = Math.abs(lunationTime - eclipseTime);
        if (timeDiff < 24 * 60 * 60 * 1000 && timeDiff < closest) {
          eclipseInfo = info;
          closest = timeDiff;
        }
      }
      const isEclipse = eclipseInfo !== undefined;

      return {
        type: "lunation",
        id: `lunation-${year}-${index}-${phase.date}`,
        title: phaseName,
        utcDateTime: phase.utcDateTime.toISOString(),
        moonPosition: phase.moonPosition,
        isEclipse: isEclipse || false,
        eclipseType: isEclipse ? eclipseInfo.type : undefined,
      };
    });

  out.sort(
    (a, b) =>
      new Date(a.utcDateTime).getTime() - new Date(b.utcDateTime).getTime(),
  );
  return out;
}

function toDateKeyInTimeZone(isoOrDate, timeZone) {
  const d =
    typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * @param {Array} lunations
 * @param {string} startDateStr YYYY-MM-DD
 * @param {string} endDateStr YYYY-MM-DD
 * @param {string} timeZone IANA
 */
export function filterLunationsToDateRange(
  lunations,
  startDateStr,
  endDateStr,
  timeZone,
) {
  if (!startDateStr || !endDateStr || !Array.isArray(lunations)) {
    return lunations || [];
  }
  return lunations.filter((L) => {
    const key = toDateKeyInTimeZone(L.utcDateTime, timeZone);
    return key >= startDateStr && key <= endDateStr;
  });
}
