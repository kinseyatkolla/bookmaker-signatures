const OPALE_LUNAR_ECLIPSES = "301";
const OPALE_SOLAR_ECLIPSES = "10";

function extractEclipseDateString(eclipse) {
  if (!eclipse || typeof eclipse !== "object") return "";
  const value =
    eclipse.events?.greatest?.date ||
    eclipse.events?.greatest?.Date ||
    eclipse.calendarDate ||
    eclipse.date ||
    eclipse.Date ||
    eclipse.datetime ||
    eclipse.Datetime ||
    eclipse.time ||
    eclipse.dateTime;
  return typeof value === "string" ? value.trim() : "";
}

function toUtcParseableIso(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const hasTimezone = /[Z+-]\d{2}:?\d{2}$/.test(text) || text.endsWith("Z");
  return hasTimezone ? text : `${text}Z`;
}

function parseEclipseInstant(eclipse) {
  const dateValue = extractEclipseDateString(eclipse);
  if (!dateValue) return null;
  const eclipseDateTime = new Date(toUtcParseableIso(dateValue));
  if (Number.isNaN(eclipseDateTime.getTime())) return null;
  return eclipseDateTime;
}

function dateKeyForInstant(instant, timeZone) {
  return instant.toLocaleDateString("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function fetchOpaleEclipseArrays(year) {
  const [lunarRes, solarRes] = await Promise.all([
    fetch(
      `https://opale.imcce.fr/api/v1/phenomena/eclipses/${OPALE_LUNAR_ECLIPSES}/${year}`,
    ),
    fetch(
      `https://opale.imcce.fr/api/v1/phenomena/eclipses/${OPALE_SOLAR_ECLIPSES}/${year}`,
    ),
  ]);

  let lunarEclipses = [];
  let solarEclipses = [];

  if (lunarRes.ok) {
    const data = await lunarRes.json();
    if (Array.isArray(data?.response?.lunareclipse)) {
      lunarEclipses = data.response.lunareclipse;
    }
  }

  if (solarRes.ok) {
    const data = await solarRes.json();
    if (Array.isArray(data?.response?.data)) {
      solarEclipses = data.response.data;
    }
  }

  return { lunarEclipses, solarEclipses };
}

export async function buildEclipseTypeByDateKey(year, timeZone) {
  const { lunarEclipses, solarEclipses } = await fetchOpaleEclipseArrays(year);
  const byKey = {};

  const add = (dateKey, kind) => {
    const prev = byKey[dateKey];
    if (!prev) {
      byKey[dateKey] = kind;
      return;
    }
    if (prev !== kind) {
      byKey[dateKey] = "both";
    }
  };

  lunarEclipses.forEach((eclipse) => {
    const instant = parseEclipseInstant(eclipse);
    if (!instant) return;
    add(dateKeyForInstant(instant, timeZone), "lunar");
  });

  solarEclipses.forEach((eclipse) => {
    const instant = parseEclipseInstant(eclipse);
    if (!instant) return;
    add(dateKeyForInstant(instant, timeZone), "solar");
  });

  return byKey;
}
