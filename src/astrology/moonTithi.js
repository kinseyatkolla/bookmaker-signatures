const getTimeZoneOffsetMs = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type) =>
    Number(parts.find((piece) => piece.type === type)?.value || 0);
  const asUtc = Date.UTC(
    getPart("year"),
    getPart("month") - 1,
    getPart("day"),
    getPart("hour"),
    getPart("minute"),
    getPart("second"),
  );
  return asUtc - date.getTime();
};

const convertZonedLocalToUtc = (
  year,
  month,
  day,
  hour,
  minute,
  second,
  timeZone,
) => {
  const localAsIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = localAsIfUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = getTimeZoneOffsetMs(new Date(guess), timeZone);
    guess = localAsIfUtc - offset;
  }
  return new Date(guess);
};

export function calculateTithi(moonLongitude, sunLongitude) {
  let longitudeDifference = moonLongitude - sunLongitude;
  longitudeDifference = ((longitudeDifference % 360) + 360) % 360;
  const tithi = longitudeDifference / 12;
  let finalTithi = Math.floor(tithi) + 1;
  if (finalTithi > 30) finalTithi -= 30;
  if (finalTithi <= 0) finalTithi += 30;
  return finalTithi;
}

const toDateKeyInTimeZone = (date, timeZone) =>
  date.toLocaleDateString("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

async function fetchChart(apiBaseUrl, utcDate, coords) {
  const response = await fetch(`${apiBaseUrl}/astrology/chart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
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

  if (!response.ok) {
    throw new Error(`chart ${response.status}`);
  }

  const payload = await response.json();
  const moon = payload?.data?.planets?.moon;
  const sun = payload?.data?.planets?.sun;
  if (
    !moon ||
    !sun ||
    typeof moon.longitude !== "number" ||
    Number.isNaN(moon.longitude) ||
    typeof sun.longitude !== "number" ||
    Number.isNaN(sun.longitude)
  ) {
    throw new Error("chart missing moon/sun position");
  }

  return {
    tithi: calculateTithi(moon.longitude, sun.longitude),
    sunSign: sun.zodiacSignName || "",
    moonSign: moon.zodiacSignName || "",
  };
}

const enumerateDateKeysInRange = (startDateKey, endDateKey) => {
  const result = [];
  const start = new Date(`${startDateKey}T12:00:00`);
  const end = new Date(`${endDateKey}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return result;
  if (start.getTime() > end.getTime()) return result;
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    result.push(toDateKeyInTimeZone(cursor, "UTC"));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
};

export async function buildMoonTithisForDateRange(
  apiBaseUrl,
  coords,
  timeZone,
  startDateKey,
  endDateKey,
  options = { hourStep: 1, batchSize: 8 },
) {
  const hourStep = Math.max(1, Number(options.hourStep) || 1);
  const batchSize = Math.max(1, Number(options.batchSize) || 8);
  const keys = enumerateDateKeysInRange(startDateKey, endDateKey);
  const samples = [];

  for (const dateKey of keys) {
    const [year, month, day] = dateKey.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      continue;
    }
    for (let hour = 0; hour < 24; hour += hourStep) {
      const utc = convertZonedLocalToUtc(
        year,
        month,
        day,
        hour,
        0,
        0,
        timeZone || "UTC",
      );
      samples.push({ dateKey, utc, hour });
    }
  }

  const dayTithiMap = {};
  const dayTithiHourCounts = {};
  const daySunMoonByDateKey = {};
  const dayTithiTransitions = {};
  keys.forEach((dateKey) => {
    dayTithiMap[dateKey] = [];
    dayTithiHourCounts[dateKey] = {};
    daySunMoonByDateKey[dateKey] = null;
    dayTithiTransitions[dateKey] = [];
  });

  for (let start = 0; start < samples.length; start += batchSize) {
    const batch = samples.slice(start, start + batchSize);
      const fetched = await Promise.all(
      batch.map(async (sample) => {
        try {
          const result = await fetchChart(apiBaseUrl, sample.utc, coords);
          return { ...sample, ...result };
        } catch {
          return { ...sample, tithi: null, sunSign: "", moonSign: "" };
        }
      }),
    );

    fetched.forEach((item) => {
      if (typeof item.tithi !== "number") return;
      const existing = dayTithiMap[item.dateKey] ?? [];
      const previousTithi = existing[existing.length - 1];
      if (previousTithi !== item.tithi) {
        existing.push(item.tithi);
        dayTithiTransitions[item.dateKey].push({
          tithi: item.tithi,
          hour: item.hour,
          localTimeLabel: `${String(item.hour).padStart(2, "0")}:00`,
        });
      }
      dayTithiMap[item.dateKey] = existing;
      dayTithiHourCounts[item.dateKey][item.tithi] =
        (dayTithiHourCounts[item.dateKey][item.tithi] ?? 0) + hourStep;
      if (item.hour === 12 && item.sunSign && item.moonSign) {
        daySunMoonByDateKey[item.dateKey] = {
          sunSign: item.sunSign,
          moonSign: item.moonSign,
        };
      }
    });
  }

  const dayTithiDetailsMap = {};
  keys.forEach((dateKey) => {
    const sequence = dayTithiMap[dateKey] ?? [];
    const hourCounts = dayTithiHourCounts[dateKey] ?? {};
    const primaryTithi = Object.entries(hourCounts)
      .sort((a, b) => {
        const countDiff = Number(b[1]) - Number(a[1]);
        if (countDiff !== 0) return countDiff;
        return Number(a[0]) - Number(b[0]);
      })
      .map(([tithi]) => Number(tithi))[0] ?? null;

    dayTithiDetailsMap[dateKey] = {
      primaryTithi,
      tithiNumbers: sequence,
      hourCounts,
      sunMoon: daySunMoonByDateKey[dateKey],
      tithiTransitions: dayTithiTransitions[dateKey] ?? [],
    };
  });

  return dayTithiDetailsMap;
}
