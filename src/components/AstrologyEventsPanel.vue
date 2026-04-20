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

const props = defineProps({
  startDate: {
    type: String,
    default: "",
  },
  endDate: {
    type: String,
    default: "",
  },
});

const emit = defineEmits([
  "update:eventsByDate",
  "update:context",
  "update:tithisByDate",
]);

const apiBaseUrl = ref("http://localhost:3000/api");
const isLoading = ref(false);
const searchingCurrentLocation = ref(false);
const errorMessage = ref("");
const didAttemptLoad = ref(false);
const rawEvents = ref([]);
const tithisByDate = ref({});
const locationTimeZone = ref(
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
);

const form = reactive({
  currentLocationQuery: "Manitou Springs, CO",
  currentLocationName: "Manitou Springs, El Paso County, Colorado, United States",
  currentLatitude: "38.8597",
  currentLongitude: "-104.9172",
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

function parseDateInput(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

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
    const p1 = formatPlanetLabel(event.planet1);
    const p2Raw = event.planet2;
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
    const p1 = event.planet1Position;
    const p2 = event.planet2Position;
    const aspectName = String(event.aspectName || "").toLowerCase();
    if (aspectName === "conjunct") {
      const sharedDegree = getSharedAspectDegree(
        p1?.degreeFormatted,
        p2?.degreeFormatted,
      );
      const signName = p1?.zodiacSignName || p2?.zodiacSignName;
      if (signName) {
        const planetKey = planetGlyphKey(event.planet1);
        const zodiacKey = zodiacGlyphKey(signName);
        glyphRows.push({
          planetKey,
          zodiacKey,
          degree: sharedDegree,
          signName,
          elementClass: signElementClass(signName),
          planetUnicode:
            planetUnicodeFallback[String(event.planet1 || "").toLowerCase()] || "",
          zodiacUnicode: zodiacUnicodeFallback[signName] || "",
        });
      }
    } else {
      const row1 = buildGlyphRow({ planetName: event.planet1, position: p1 });
      const row2 = buildGlyphRow({ planetName: event.planet2, position: p2 });
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

const astrologyContext = computed(() => ({
  locationName: form.currentLocationName || "",
  latitude: form.currentLatitude || "",
  longitude: form.currentLongitude || "",
  timeZone: locationTimeZone.value || "UTC",
  startDate: props.startDate || "",
  endDate: props.endDate || "",
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

function buildRequestBody(year) {
  const currentCoords = parseCoordinates(form.currentLatitude, form.currentLongitude);
  if (!currentCoords) {
    throw new Error(
      "Current location coordinates are required. Use Find Current Location first.",
    );
  }
  return {
    year: Number(year),
    latitude: currentCoords.latitude,
    longitude: currentCoords.longitude,
    sampleInterval: 6,
  };
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

async function loadAstrologyEvents() {
  errorMessage.value = "";
  didAttemptLoad.value = true;

  if (yearsToFetch.value.length === 0) {
    rawEvents.value = [];
    tithisByDate.value = {};
    return;
  }

  if (!parseCoordinates(form.currentLatitude, form.currentLongitude)) {
    errorMessage.value =
      "Current location is required. Use Find Current Location first.";
    return;
  }

  isLoading.value = true;
  try {
    const responses = await Promise.all(
      yearsToFetch.value.map((year) =>
        fetch(`${apiBaseUrl.value}/astrology/year-ephemeris`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildRequestBody(year)),
        }),
      ),
    );

    const invalidResponse = responses.find((response) => !response.ok);
    if (invalidResponse) {
      throw new Error(`Request failed with status ${invalidResponse.status}`);
    }

    const payloads = await Promise.all(responses.map((response) => response.json()));
    const merged = payloads.flatMap((payload) => {
      const events = payload?.data?.events ?? payload?.events ?? [];
      return Array.isArray(events) ? events : [];
    });
    rawEvents.value = merged;

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
</script>

<template>
  <section class="astrology-panel">
    <h2>Astrology Events</h2>
    <p class="astrology-panel-subtitle">
      Load astrology events for this date range using yearly backend requests.
    </p>
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
        class="primary-button"
        type="button"
        :disabled="isLoading"
        @click="loadAstrologyEvents"
      >
        {{ isLoading ? "Loading..." : "Load Astrology Events" }}
      </button>
    </div>

    <p v-if="form.currentLocationName" class="note">
      {{ form.currentLocationName }} ({{
        Number(form.currentLatitude).toFixed(4)
      }}, {{ Number(form.currentLongitude).toFixed(4) }}) ·
      {{ locationTimeZone }}
    </p>
    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
    <p v-else-if="didAttemptLoad" class="note">
      Loaded {{ rawEvents.length }} events from
      {{ yearsToFetch.length === 1 ? yearsToFetch[0] : yearsToFetch.join(", ") }}.
    </p>
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

.astrology-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
