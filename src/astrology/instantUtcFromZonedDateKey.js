/**
 * Interprets `dateKey` (YYYY-MM-DD) as local calendar noon (12:00:00) in `timeZone`
 * and returns the corresponding UTC instant.
 */
function getTimeZoneOffsetMs(date, timeZone) {
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
}

function convertZonedLocalToUtc(
  year,
  month,
  day,
  hour,
  minute,
  second,
  timeZone,
) {
  const localAsIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = localAsIfUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = getTimeZoneOffsetMs(new Date(guess), timeZone);
    guess = localAsIfUtc - offset;
  }
  return new Date(guess);
}

export function utcNoonForDateKeyInTimeZone(dateKey, timeZone) {
  const tz = String(timeZone || "UTC").trim() || "UTC";
  const [y, m, d] = String(dateKey || "").split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  return convertZonedLocalToUtc(y, m, d, 12, 0, 0, tz);
}
