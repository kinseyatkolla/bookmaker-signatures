<script setup>
import { computed, reactive, ref, watch } from "vue";
import {
  getAspectPhysisKey,
  getPlanetKeysFromNames,
  getPlanetUnicodeFallback,
  getZodiacKeysFromNames,
  getZodiacUnicodeFallback,
} from "../astrology/physisSymbolMap";
import { buildMoonTithisForDateRange } from "../astrology/moonTithi";
import { buildEclipseTypeByDateKey } from "../astrology/eclipseOpale";

const DEFAULT_BIRTH_TIME_ZONE = "America/Chicago";
const DEFAULT_BIRTH_LOCAL = {
  year: 1984,
  month: 2,
  day: 18,
  hour: 13,
  minute: 54,
  second: 0,
};
const DEFAULT_BIRTH_PLACE = {
  query: "Kansas City, MO",
  name: "Kansas City, Missouri, United States",
  latitude: "39.0997",
  longitude: "-94.5786",
};

const pad2 = (value) => String(value).padStart(2, "0");

const props = defineProps({
  startDate: {
    type: String,
    default: "",
  },
  endDate: {
    type: String,
    default: "",
  },
  moonMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "update:eventsByDate",
  "update:context",
  "update:tithisByDate",
  "update:eclipsesByDate",
]);

const apiBaseUrl = ref("http://localhost:3000/api");
const isLoading = ref(false);
const isLoadingBirthChart = ref(false);
const searchingCurrentLocation = ref(false);
const searchingBirthLocation = ref(false);
const errorMessage = ref("");
const didAttemptLoad = ref(false);
const rawEvents = ref([]);
const tithisByDate = ref({});
const eclipsesByDate = ref({});
const didFetchBirthChart = ref(false);
const natalChartPreview = ref(null);
const natalChartPreviewError = ref("");
const locationTimeZone = ref(
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
);

const form = reactive({
  currentLocationQuery: "Manitou Springs, CO",
  currentLocationName: "Manitou Springs, El Paso County, Colorado, United States",
  currentLatitude: "38.8597",
  currentLongitude: "-104.9172",
  birthDateTime: "",
  birthLocationQuery: DEFAULT_BIRTH_PLACE.query,
  birthLocationName: DEFAULT_BIRTH_PLACE.name,
  birthLatitude: DEFAULT_BIRTH_PLACE.latitude,
  birthLongitude: DEFAULT_BIRTH_PLACE.longitude,
});

locationTimeZone.value = "America/Denver";

const planetKeys = getPlanetKeysFromNames();
const zodiacKeys = getZodiacKeysFromNames();
const planetUnicodeFallback = getPlanetUnicodeFallback();
const zodiacUnicodeFallback = getZodiacUnicodeFallback();

const zodiacElementBySign = {
  Aries: "fire",
  Leo: "fire",
  Sagittarius: "fire",
  Taurus: "earth",
  Virgo: "earth",
  Capricorn: "earth",
  Gemini: "air",
  Libra: "air",
  Aquarius: "air",
  Cancer: "water",
  Scorpio: "water",
  Pisces: "water",
};

const NATAL_CHART_PREVIEW_KEYS = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];

function parseDateInput(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

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

function formatDateTimeLocalFromParts(year, month, day, hour, minute) {
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`;
}

const defaultBirthDateTimeLocal = (() => {
  const utcBirth = convertZonedLocalToUtc(
    DEFAULT_BIRTH_LOCAL.year,
    DEFAULT_BIRTH_LOCAL.month,
    DEFAULT_BIRTH_LOCAL.day,
    DEFAULT_BIRTH_LOCAL.hour,
    DEFAULT_BIRTH_LOCAL.minute,
    DEFAULT_BIRTH_LOCAL.second,
    DEFAULT_BIRTH_TIME_ZONE,
  );
  return formatDateTimeLocalFromParts(
    utcBirth.getFullYear(),
    utcBirth.getMonth() + 1,
    utcBirth.getDate(),
    utcBirth.getHours(),
    utcBirth.getMinutes(),
  );
})();

form.birthDateTime = defaultBirthDateTimeLocal;

const yearsToFetch = computed(() => {
  const start = parseDateInput(props.startDate);
  const end = parseDateInput(props.endDate);
  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  const years = [];
  for (let year = startYear; year <= endYear; year += 1) {
    years.push(year);
  }
  return years;
});

function titleCaseWord(word) {
  if (!word) return "";
  const lower = String(word).toLowerCase();
  if (lower === "rx") return "Rx";
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCaseLabel(value) {
  return String(value || "")
    .split(/\s+/g)
    .filter(Boolean)
    .map(titleCaseWord)
    .join(" ");
}

function formatAspectNameForDisplay(aspectName) {
  const s = String(aspectName || "");
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatPlanetLabel(planet) {
  if (!planet) return "";
  if (String(planet).toLowerCase() === "northnode") return "N. Node";
  return titleCaseWord(planet);
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

function formatRoundedWholeDegreeWithinSign(degreeFormatted) {
  const decimal = parseDegreeWithinSign(degreeFormatted);
  if (!Number.isFinite(decimal)) {
    return `${String(degreeFormatted || "").split("°")[0] || "0"}°`;
  }
  const rounded = Math.min(29, Math.max(0, Math.round(decimal)));
  return `${rounded}°`;
}

function getSharedAspectDegree(planet1DegreeFormatted, planet2DegreeFormatted) {
  const p1 = parseDegreeWithinSign(planet1DegreeFormatted);
  const p2 = parseDegreeWithinSign(planet2DegreeFormatted);
  const sharedRounded = Math.round((p1 + p2) / 2);
  const normalized = Math.min(29, Math.max(0, sharedRounded));
  return `${normalized}°`;
}

function formatEventTimestamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: locationTimeZone.value || "UTC",
  });
  return time.replace(" AM", "AM").replace(" PM", "PM");
}

function planetGlyphKey(planetName) {
  const label = formatPlanetLabel(planetName);
  return planetKeys[label] || planetKeys[titleCaseWord(planetName)] || "";
}

function zodiacGlyphKey(signName) {
  return zodiacKeys[signName] || "";
}

function signElementClass(signName) {
  const element = zodiacElementBySign[signName];
  if (!element) return "";
  return `sign-${element}`;
}

function buildGlyphRow({ planetName, position }) {
  if (!position?.zodiacSignName) return null;
  const planetKey = planetGlyphKey(planetName);
  const zodiacKey = zodiacGlyphKey(position.zodiacSignName);
  const degree = formatRoundedWholeDegreeWithinSign(position.degreeFormatted);
  return {
    planetKey,
    zodiacKey,
    degree,
    signName: position.zodiacSignName,
    elementClass: signElementClass(position.zodiacSignName),
    planetUnicode:
      planetUnicodeFallback[String(planetName || "").toLowerCase()] ||
      planetUnicodeFallback[
        String(planetName || "")
          .toLowerCase()
          .replaceAll(".", "")
      ] ||
      "",
    zodiacUnicode: zodiacUnicodeFallback[position.zodiacSignName] || "",
  };
}

function ensureUtcIsoString(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (text.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(text)) return text;
  return `${text}Z`;
}

function toDateKey(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-CA", {
    timeZone: locationTimeZone.value || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function normalizeEvent(event, fallbackId) {
  const whenRaw =
    event.utcDateTime ??
    event.localDateTime ??
    event.eventDate ??
    event.date ??
    event.startAt ??
    event.startsAt ??
    event.datetime ??
    event.timestamp;
  const when = typeof whenRaw === "string" ? ensureUtcIsoString(whenRaw) : whenRaw;
  const dateKey = toDateKey(when);
  if (!dateKey) return null;
  const sortTime = new Date(when).getTime();
  if (Number.isNaN(sortTime)) return null;

  const rawType = (event.type ?? event.eventType ?? event.category ?? "event")
    .toString()
    .toLowerCase();
  const eventType =
    rawType === "aspect" && event.isNatalTransit ? "natal transit" : rawType;
  const timestamp = formatEventTimestamp(when);

  const buildAspectMainLabel = () => {
    const moonMode = props.moonMode === true;
    const isMoonTransitAspect =
      moonMode &&
      eventType === "aspect" &&
      !event.isNatalTransit &&
      (String(event.planet1 || "").toLowerCase() === "moon" ||
        String(event.planet2 || "").toLowerCase() === "moon");
    const p1Raw = isMoonTransitAspect ? "moon" : event.planet1;
    const p2Raw = isMoonTransitAspect
      ? String(event.planet1 || "").toLowerCase() === "moon"
        ? event.planet2
        : event.planet1
      : event.planet2;
    const p1 = formatPlanetLabel(p1Raw);
    const aspect = formatAspectNameForDisplay(event.aspectName);
    if (event.isNatalTransit) {
      const p2 = formatPlanetLabel(p2Raw);
      return `${p1} ${aspect} Natal ${p2}`.trim();
    }
    const p2 = formatPlanetLabel(p2Raw);
    return `${p1} ${aspect} ${p2}`.trim();
  };

  const buildIngressMainLabel = () => {
    const planet = formatPlanetLabel(event.planet);
    const toSign = titleCaseLabel(event.toSign);
    const isSolsticeOrEquinox =
      String(event.planet || "").toLowerCase() === "sun" &&
      ["Aries", "Cancer", "Libra", "Capricorn"].includes(String(event.toSign));
    const prefix = (() => {
      if (!isSolsticeOrEquinox) return "";
      if (String(event.toSign) === "Aries" || String(event.toSign) === "Libra") {
        return "Equinox - ";
      }
      if (
        String(event.toSign) === "Cancer" ||
        String(event.toSign) === "Capricorn"
      ) {
        return "Solstice - ";
      }
      return "";
    })();
    return `${prefix}${planet} Enters ${toSign}`.trim();
  };

  const buildStationMainLabel = () => {
    const planet = formatPlanetLabel(event.planet);
    const station =
      event.stationType === "retrograde"
        ? "Stations Retrograde"
        : event.stationType === "direct"
          ? "Stations Direct"
          : `Stations ${titleCaseLabel(event.stationType)}`;
    return `${planet} ${station}`.trim();
  };

  const mainLabel = (() => {
    if (eventType === "aspect" || eventType === "natal transit") {
      return buildAspectMainLabel();
    }
    if (eventType === "ingress") return buildIngressMainLabel();
    if (eventType === "station") return buildStationMainLabel();
    return titleCaseLabel(
      event.title ??
        event.label ??
        event.description ??
        event.name ??
        event.event ??
        "Event",
    );
  })();

  const glyphRows = [];
  if (eventType === "ingress") {
    const row = buildGlyphRow({
      planetName: event.planet,
      position: {
        degree: event.degree,
        degreeFormatted: event.degreeFormatted,
        zodiacSignName: event.toSign,
      },
    });
    if (row) glyphRows.push(row);
  }
  if (eventType === "station") {
    const row = buildGlyphRow({
      planetName: event.planet,
      position: {
        degree: event.degree,
        degreeFormatted: event.degreeFormatted,
        zodiacSignName: event.zodiacSignName,
      },
    });
    if (row) glyphRows.push(row);
  }
  if (eventType === "aspect" || eventType === "natal transit") {
    const moonMode = props.moonMode === true;
    const moonFirstForTransitAspect =
      moonMode &&
      eventType === "aspect" &&
      !event.isNatalTransit &&
      (String(event.planet1 || "").toLowerCase() === "moon" ||
        String(event.planet2 || "").toLowerCase() === "moon");
    const baseP1 = event.planet1Position;
    const baseP2 = event.planet2Position;
    const p1 = moonFirstForTransitAspect
      ? String(event.planet1 || "").toLowerCase() === "moon"
        ? baseP1
        : baseP2
      : baseP1;
    const p2 = moonFirstForTransitAspect
      ? String(event.planet1 || "").toLowerCase() === "moon"
        ? baseP2
        : baseP1
      : baseP2;
    const p1Name = moonFirstForTransitAspect
      ? "moon"
      : event.planet1;
    const p2Name = moonFirstForTransitAspect
      ? String(event.planet1 || "").toLowerCase() === "moon"
        ? event.planet2
        : event.planet1
      : event.planet2;
    const aspectName = String(event.aspectName || "").toLowerCase();
    if (aspectName === "conjunct") {
      const sharedDegree = getSharedAspectDegree(
        p1?.degreeFormatted,
        p2?.degreeFormatted,
      );
      const signName = p1?.zodiacSignName || p2?.zodiacSignName;
      if (signName) {
        const planetKey = planetGlyphKey(p1Name);
        const zodiacKey = zodiacGlyphKey(signName);
        glyphRows.push({
          planetKey,
          zodiacKey,
          degree: sharedDegree,
          signName,
          elementClass: signElementClass(signName),
          planetUnicode:
            planetUnicodeFallback[String(p1Name || "").toLowerCase()] || "",
          zodiacUnicode: zodiacUnicodeFallback[signName] || "",
        });
      }
    } else {
      const row1 = buildGlyphRow({ planetName: p1Name, position: p1 });
      const row2 = buildGlyphRow({ planetName: p2Name, position: p2 });
      if (row1) glyphRows.push(row1);
      if (row2) glyphRows.push(row2);
    }
  }

  let aspectPhysisKey = "";
  if ((eventType === "aspect" || eventType === "natal transit") && glyphRows.length === 2) {
    aspectPhysisKey = getAspectPhysisKey(event.aspectName);
  }

  return {
    id: event.id ?? `${dateKey}-${fallbackId}`,
    dateKey,
    sortTime,
    eventType,
    mainLabel,
    timestamp,
    glyphRows,
    aspectPhysisKey,
  };
}

const groupedEvents = computed(() => {
  const grouped = new Map();
  rawEvents.value.forEach((event, index) => {
    const normalized = normalizeEvent(event, index);
    if (!normalized) return;
    if (!grouped.has(normalized.dateKey)) {
      grouped.set(normalized.dateKey, []);
    }
    grouped.get(normalized.dateKey).push(normalized);
  });
  grouped.forEach((events) => {
    events.sort((a, b) => a.sortTime - b.sortTime);
  });
  return grouped;
});

const groupedEventsObject = computed(() => {
  const object = {};
  groupedEvents.value.forEach((events, dateKey) => {
    object[dateKey] = events;
  });
  return object;
});

const natalChartPreviewRows = computed(() => {
  const data = natalChartPreview.value;
  if (!data?.planets) return [];

  const rows = [];
  for (const key of NATAL_CHART_PREVIEW_KEYS) {
    const planet = data.planets[key];
    if (!planet) continue;
    const sign = planet.zodiacSignName;
    rows.push({
      id: key,
      label: formatPlanetLabel(key),
      position: `${planet.degreeFormatted || ""} ${sign || ""}`.trim(),
      elementClass: signElementClass(sign),
    });
  }

  const houses = data.houses;
  if (houses?.ascendantSign) {
    rows.push({
      id: "asc",
      label: "Ascendant",
      position: `${houses.ascendantDegree || ""} ${houses.ascendantSign}`.trim(),
      elementClass: signElementClass(houses.ascendantSign),
    });
  }
  if (houses?.mcSign) {
    rows.push({
      id: "mc",
      label: "Midheaven",
      position: `${houses.mcDegree || ""} ${houses.mcSign}`.trim(),
      elementClass: signElementClass(houses.mcSign),
    });
  }

  return rows;
});

const astrologyContext = computed(() => ({
  locationName: form.currentLocationName || "",
  latitude: form.currentLatitude || "",
  longitude: form.currentLongitude || "",
  timeZone: locationTimeZone.value || "UTC",
  apiBaseUrl: apiBaseUrl.value || "",
  startDate: props.startDate || "",
  endDate: props.endDate || "",
  birthDateTime: form.birthDateTime || "",
  birthLocationName: form.birthLocationName || "",
}));

watch(
  groupedEventsObject,
  (nextValue) => {
    emit("update:eventsByDate", nextValue);
  },
  { immediate: true },
);

watch(
  tithisByDate,
  (nextValue) => {
    emit("update:tithisByDate", nextValue ?? {});
  },
  { immediate: true },
);

watch(
  eclipsesByDate,
  (nextValue) => {
    emit("update:eclipsesByDate", nextValue ?? {});
  },
  { immediate: true },
);

watch(
  astrologyContext,
  (nextValue) => {
    emit("update:context", nextValue);
  },
  { immediate: true },
);

function parseCoordinates(latitudeValue, longitudeValue) {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function buildNatalChartPayload() {
  if (!form.birthDateTime) return null;

  const birthDate = new Date(form.birthDateTime);
  if (Number.isNaN(birthDate.getTime())) {
    throw new Error("Birth Date/Time is invalid.");
  }

  const birthCoords = parseCoordinates(form.birthLatitude, form.birthLongitude);
  if (!birthCoords) {
    throw new Error(
      "Birth location coordinates are required when Birth Date/Time is provided.",
    );
  }

  const utcBirth = convertZonedLocalToUtc(
    birthDate.getFullYear(),
    birthDate.getMonth() + 1,
    birthDate.getDate(),
    birthDate.getHours(),
    birthDate.getMinutes(),
    birthDate.getSeconds(),
    DEFAULT_BIRTH_TIME_ZONE,
  );

  return {
    year: utcBirth.getUTCFullYear(),
    month: utcBirth.getUTCMonth() + 1,
    day: utcBirth.getUTCDate(),
    hour: utcBirth.getUTCHours(),
    minute: utcBirth.getUTCMinutes(),
    second: utcBirth.getUTCSeconds(),
    latitude: birthCoords.latitude,
    longitude: birthCoords.longitude,
  };
}

const hasValidNatalData = computed(() => {
  if (!form.birthDateTime) return false;
  const birthDate = new Date(form.birthDateTime);
  if (Number.isNaN(birthDate.getTime())) return false;
  return !!parseCoordinates(form.birthLatitude, form.birthLongitude);
});

const natalTransitEventCount = computed(() =>
  rawEvents.value.filter((event) => event?.type === "aspect" && event?.isNatalTransit)
    .length,
);

watch(hasValidNatalData, (isValid) => {
  if (!isValid) return;
});

watch(
  () => [
    form.birthDateTime,
    form.birthLatitude,
    form.birthLongitude,
    form.birthLocationName,
  ],
  () => {
    didFetchBirthChart.value = false;
    natalChartPreview.value = null;
    natalChartPreviewError.value = "";
  },
);

function buildRequestBody(year, options = { includeNatalChart: false }) {
  const currentCoords = parseCoordinates(form.currentLatitude, form.currentLongitude);
  if (!currentCoords) {
    throw new Error(
      "Current location coordinates are required. Use Find Current Location first.",
    );
  }
  const payload = {
    year: Number(year),
    latitude: currentCoords.latitude,
    longitude: currentCoords.longitude,
    sampleInterval: 6,
    moonMode: props.moonMode === true,
  };
  if (!options.includeNatalChart) return payload;
  const natalChart = buildNatalChartPayload();
  if (natalChart) {
    payload.natalChart = natalChart;
  }
  return payload;
}

async function getBirthChartPreview() {
  errorMessage.value = "";
  natalChartPreviewError.value = "";
  natalChartPreview.value = null;
  didFetchBirthChart.value = false;

  let natalChart;
  try {
    natalChart = buildNatalChartPayload();
    if (!natalChart) {
      throw new Error("Birth Date/Time and Birth Location are required.");
    }
  } catch (error) {
    natalChartPreviewError.value =
      error instanceof Error ? error.message : "Birth chart input is invalid.";
    return;
  }

  isLoadingBirthChart.value = true;
  try {
    const response = await fetch(`${apiBaseUrl.value}/astrology/chart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        year: natalChart.year,
        month: natalChart.month,
        day: natalChart.day,
        hour: natalChart.hour,
        minute: natalChart.minute,
        second: natalChart.second ?? 0,
        latitude: natalChart.latitude,
        longitude: natalChart.longitude,
      }),
    });

    if (!response.ok) {
      throw new Error(`Birth chart preview failed (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    if (payload?.success === false) {
      throw new Error(String(payload.error || "Birth chart preview failed."));
    }

    natalChartPreview.value = payload?.data ?? null;
    didFetchBirthChart.value = true;
  } catch (error) {
    natalChartPreviewError.value =
      error instanceof Error ? error.message : "Could not fetch birth chart preview.";
  } finally {
    isLoadingBirthChart.value = false;
  }
}

async function findLocation(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Enter a city, state, country to search.");
  }
  const endpoint = new URL("https://nominatim.openstreetmap.org/search");
  endpoint.searchParams.set("q", trimmed);
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("limit", "1");
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Location search failed with status ${response.status}`);
  }
  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("No matching location found. Try a more specific query.");
  }
  const best = results[0];
  return {
    name: best.display_name ?? trimmed,
    latitude: String(best.lat ?? ""),
    longitude: String(best.lon ?? ""),
  };
}

async function findCurrentLocation() {
  errorMessage.value = "";
  searchingCurrentLocation.value = true;
  try {
    const result = await findLocation(form.currentLocationQuery);
    form.currentLocationName = result.name;
    form.currentLatitude = result.latitude;
    form.currentLongitude = result.longitude;
    try {
      const timezoneResponse = await fetch(
        `https://timeapi.io/api/TimeZone/coordinate?latitude=${result.latitude}&longitude=${result.longitude}`,
      );
      if (timezoneResponse.ok) {
        const timezonePayload = await timezoneResponse.json();
        if (timezonePayload?.timeZone) {
          locationTimeZone.value = timezonePayload.timeZone;
        }
      }
    } catch {
      // Keep browser timezone when lookup fails.
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Could not find current location.";
  } finally {
    searchingCurrentLocation.value = false;
  }
}

async function findBirthLocation() {
  errorMessage.value = "";
  searchingBirthLocation.value = true;
  try {
    const result = await findLocation(form.birthLocationQuery);
    form.birthLocationName = result.name;
    form.birthLatitude = result.latitude;
    form.birthLongitude = result.longitude;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Could not find birth location.";
  } finally {
    searchingBirthLocation.value = false;
  }
}

async function loadAstrologyEvents() {
  errorMessage.value = "";
  didAttemptLoad.value = true;

  if (yearsToFetch.value.length === 0) {
    rawEvents.value = [];
    tithisByDate.value = {};
    eclipsesByDate.value = {};
    return;
  }

  if (!parseCoordinates(form.currentLatitude, form.currentLongitude)) {
    errorMessage.value =
      "Current location is required. Use Find Current Location first.";
    return;
  }

  isLoading.value = true;
  try {
    const includeNatalTransits =
      props.moonMode === true
        ? false
        : hasValidNatalData.value && didFetchBirthChart.value && !!natalChartPreview.value;
    const yearPayloads = await Promise.all(
      yearsToFetch.value.map(async (year) => {
        const mundaneResponse = await fetch(
          `${apiBaseUrl.value}/astrology/year-ephemeris`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              buildRequestBody(year, { includeNatalChart: false }),
            ),
          },
        );

        if (!mundaneResponse.ok) {
          throw new Error(`Request failed with status ${mundaneResponse.status}`);
        }

        const mundanePayload = await mundaneResponse.json();
        const mundaneEvents =
          mundanePayload?.data?.events ?? mundanePayload?.events ?? [];
        const mundaneList = Array.isArray(mundaneEvents)
          ? mundaneEvents.filter(
              (event) => !(event?.type === "aspect" && event?.isNatalTransit),
            )
          : [];

        let natalTransitEvents = [];
        if (includeNatalTransits) {
          const natalResponse = await fetch(
            `${apiBaseUrl.value}/astrology/year-ephemeris`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(
                buildRequestBody(year, { includeNatalChart: true }),
              ),
            },
          );
          if (!natalResponse.ok) {
            throw new Error(
              `Natal transit request failed with status ${natalResponse.status}`,
            );
          }
          const natalPayload = await natalResponse.json();
          const natalEvents = natalPayload?.data?.events ?? natalPayload?.events ?? [];
          natalTransitEvents = Array.isArray(natalEvents)
            ? natalEvents.filter(
                (event) => event?.type === "aspect" && event?.isNatalTransit,
              )
            : [];
        }

        return [...mundaneList, ...natalTransitEvents];
      }),
    );
    rawEvents.value = yearPayloads.flat();
    const eclipseMaps = await Promise.all(
      yearsToFetch.value.map((year) =>
        buildEclipseTypeByDateKey(year, locationTimeZone.value || "UTC").catch(
          () => ({}),
        ),
      ),
    );
    eclipsesByDate.value = eclipseMaps.reduce(
      (acc, map) => Object.assign(acc, map || {}),
      {},
    );

    const currentCoords = parseCoordinates(
      form.currentLatitude,
      form.currentLongitude,
    );
    if (currentCoords && props.startDate && props.endDate) {
      tithisByDate.value = await buildMoonTithisForDateRange(
        apiBaseUrl.value,
        currentCoords,
        locationTimeZone.value || "UTC",
        props.startDate,
        props.endDate,
        { hourStep: 1, batchSize: 8 },
      );
    } else {
      tithisByDate.value = {};
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to fetch astrology events.";
    rawEvents.value = [];
    tithisByDate.value = {};
    eclipsesByDate.value = {};
  } finally {
    isLoading.value = false;
  }
}

watch(
  () => [props.startDate, props.endDate],
  () => {
    if (didAttemptLoad.value) {
      loadAstrologyEvents();
    }
  },
);

watch(
  () => didFetchBirthChart.value,
  () => {
    if (didAttemptLoad.value) {
      loadAstrologyEvents();
    }
  },
);
</script>

<template>
  <section class="astrology-panel">
    <h2>Astrology Events</h2>
    <p class="astrology-panel-subtitle">
      Load astrology events for this date range using yearly backend requests.
    </p>
    <div class="astrology-two-col">
      <div class="astrology-left">
        <div class="grid astrology-controls-grid">
          <label class="field" for="astrology-current-location-query">
            <span>Current Location Search</span>
            <input
              id="astrology-current-location-query"
              v-model="form.currentLocationQuery"
              name="astrology-current-location-query"
              type="text"
              placeholder="Los Angeles, CA"
              autocomplete="street-address"
            />
          </label>
          <label class="field" for="astrology-birth-datetime">
            <span>Birth Date/Time</span>
            <input
              id="astrology-birth-datetime"
              v-model="form.birthDateTime"
              name="astrology-birth-datetime"
              type="datetime-local"
              autocomplete="bday"
            />
          </label>
          <label class="field" for="astrology-birth-location-query">
            <span>Birth Location Search</span>
            <input
              id="astrology-birth-location-query"
              v-model="form.birthLocationQuery"
              name="astrology-birth-location-query"
              type="text"
              placeholder="Kansas City, MO"
              autocomplete="street-address"
            />
          </label>
        </div>

        <div class="astrology-actions">
          <button
            class="small-button"
            type="button"
            :disabled="searchingCurrentLocation"
            @click="findCurrentLocation"
          >
            {{ searchingCurrentLocation ? "Searching..." : "Find Current Location" }}
          </button>
          <button
            class="small-button"
            type="button"
            :disabled="searchingBirthLocation"
            @click="findBirthLocation"
          >
            {{ searchingBirthLocation ? "Searching Birth..." : "Find Birth Location" }}
          </button>
          <button
            class="small-button"
            type="button"
            :disabled="isLoadingBirthChart || !hasValidNatalData"
            @click="getBirthChartPreview"
          >
            {{ isLoadingBirthChart ? "Fetching Chart..." : "Get Birth Chart" }}
          </button>
        </div>

        <p v-if="!didFetchBirthChart" class="note">
          Fetch and preview the birth chart before loading astrology events if you
          want natal transits included automatically.
        </p>

        <p v-if="form.currentLocationName" class="note">
          {{ form.currentLocationName }} ({{
            Number(form.currentLatitude).toFixed(4)
          }}, {{ Number(form.currentLongitude).toFixed(4) }}) ·
          {{ locationTimeZone }}
        </p>
        <p v-if="form.birthLocationName" class="note">
          Natal: {{ form.birthLocationName }} ({{
            Number(form.birthLatitude).toFixed(4)
          }}, {{ Number(form.birthLongitude).toFixed(4) }}) ·
          {{ form.birthDateTime || "No birth date/time" }}
        </p>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <p v-else-if="didAttemptLoad" class="note">
          Loaded {{ rawEvents.length }} events from
          {{ yearsToFetch.length === 1 ? yearsToFetch[0] : yearsToFetch.join(", ") }}.
          <template v-if="didFetchBirthChart && hasValidNatalData">
            Natal transits: {{ natalTransitEventCount }}.
          </template>
        </p>
      </div>

      <div class="astrology-right">
        <p v-if="natalChartPreviewError" class="error-text">{{ natalChartPreviewError }}</p>
        <div v-if="natalChartPreviewRows.length" class="natal-preview">
          <h3>Natal Chart Preview</h3>
          <ul class="natal-preview-list">
            <li
              v-for="row in natalChartPreviewRows"
              :key="row.id"
              class="natal-preview-row"
              :class="row.elementClass"
            >
              <span class="natal-preview-label">{{ row.label }}</span>
              <span>{{ row.position }}</span>
            </li>
          </ul>
        </div>
        <div v-else class="natal-preview natal-preview--placeholder">
          <h3>Natal Chart Preview</h3>
          <p class="note">Use Get Birth Chart to load planet, Ascendant, and Midheaven placements.</p>
        </div>
      </div>
    </div>
    <div class="astrology-load-row">
      <button
        class="primary-button astrology-load-button"
        type="button"
        :disabled="isLoading"
        @click="loadAstrologyEvents"
      >
        {{ isLoading ? "Loading..." : "Load Astrology Events" }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.astrology-panel {
  margin-bottom: 1rem;
  border: 1px solid #e2e2e5;
  border-radius: 10px;
  background: #fbfbfd;
  padding: 0.85rem;
}

.astrology-panel h2 {
  margin: 0;
  font-size: 1.1rem;
}

.astrology-panel-subtitle {
  margin: 0.35rem 0 0.75rem;
  color: #4f4f56;
  font-size: 0.9rem;
}

.astrology-controls-grid {
  margin-bottom: 0.75rem;
}

.astrology-two-col {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr);
  gap: 1rem;
  align-items: start;
}

.astrology-left,
.astrology-right {
  min-width: 0;
}

.astrology-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.astrology-load-row {
  margin-top: 0.8rem;
}

.astrology-load-button {
  width: 100%;
  justify-content: center;
}

.natal-preview {
  margin-top: 0;
  border: 1px solid #e2e2e5;
  border-radius: 8px;
  background: #ffffff;
  padding: 0.55rem 0.65rem;
}

.natal-preview--placeholder {
  min-height: 100%;
}

.natal-preview h3 {
  margin: 0;
  font-size: 0.9rem;
}

.natal-preview-list {
  list-style: none;
  margin: 0.45rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.2rem;
}

.natal-preview-row {
  display: flex;
  justify-content: space-between;
  gap: 0.65rem;
  font-size: 0.8rem;
}

.natal-preview-label {
  font-weight: 700;
}

@media (max-width: 920px) {
  .astrology-two-col {
    grid-template-columns: 1fr;
  }
}
</style>
