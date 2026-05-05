<script setup>
import { computed, ref, watch } from "vue";
import { utcNoonForDateKeyInTimeZone } from "../astrology/instantUtcFromZonedDateKey.js";
import {
  absoluteTropicalLongitudeDeg,
  TROPICAL_SIGN_ORDER,
} from "../astrology/tropicalLongitude.js";
import {
  getZodiacKeysFromNames,
  getZodiacUnicodeFallback,
} from "../astrology/physisSymbolMap";

const props = defineProps({
  startDate: { type: String, default: "" },
  endDate: { type: String, default: "" },
  apiBaseUrl: { type: String, default: "http://localhost:3000/api" },
  latitude: { type: [String, Number], default: "" },
  longitude: { type: [String, Number], default: "" },
  timeZone: { type: String, default: "UTC" },
  size: { type: String, default: "" },
  /** vertical = tall chart; horizontal = rotate into landscape layout */
  orientation: { type: String, default: "vertical" },
  /** Used when orientation === "horizontal"; defaults counter-clockwise. */
  rotationDirection: { type: String, default: "ccw" },
  /** When true and `natalChart` has positions, draw fixed natal longitudes (no day dots). */
  natalLines: { type: Boolean, default: false },
  /** Birth chart payload (`planets`, optional `houses` for Ascendant line). */
  natalChart: { type: Object, default: null },
});
const isHorizontal = computed(() => props.orientation === "horizontal");
const isClockwise = computed(() => props.rotationDirection === "cw");

const PLANETS = [
  { key: "sun", color: "#e6c229" },
  { key: "moon", color: "#8f959d" },
  { key: "mercury", color: "#2d8f4e" },
  { key: "venus", color: "#e89bb8" },
  { key: "mars", color: "#c12f2f" },
  { key: "jupiter", color: "#e89b2a" },
  { key: "saturn", color: "#1a1a1a" },
  { key: "uranus", color: "#5eb8e8" },
  { key: "neptune", color: "#5b3bbf" },
  { key: "pluto", color: "#7a4a2a" },
];

const ELEMENT_COLORS = {
  fire: "#d40000",
  water: "#005eff",
  earth: "#118b36",
  air: "#6e31d8",
};

const INNER_CHART_W = 360;
/** Horizontal padding for day labels (pre-rotation left/right); wider avoids clipped text when rotated. */
const LABEL_GUTTER_X = 30;
const CHART_X0 = LABEL_GUTTER_X;
const VIEW_WIDTH = LABEL_GUTTER_X + INNER_CHART_W + LABEL_GUTTER_X;
/** Header strip height (SVG units); sized so DOM zodiac glyphs can read larger without dwarfing the row. */
const TOP_BAR_HEIGHT = 15;
/** First day row starts flush below the zodiac strip (no extra spacer band). */
const CHART_TOP = TOP_BAR_HEIGHT;
const CHART_BOTTOM = 252;
const VIEW_HEIGHT = CHART_BOTTOM + 2;
const MAX_DAYS = 370;
/** Column tint opacity for each day row cell. */
const DAY_ROW_BG_OPACITY = 0.25;
/** White gutter between day rows to show clear row boundaries. */
const DAY_ROW_GAP = 0.6;

/** Alternating fills for left/right date labels (easier row tracking). */
const DAY_LABEL_FILL_EVEN = "#c4c4c4";
const DAY_LABEL_FILL_ODD = "#6a6a6a";

/** Single-letter weekdays except Thu=R; Sat/Sa Sun/Su to avoid S ambiguity. */
const WEEKDAY_ABBR = ["Su", "M", "T", "W", "R", "F", "Sa"];

const zodiacPhysisByName = getZodiacKeysFromNames();
const zodiacUnicodeByName = getZodiacUnicodeFallback();

const loadError = ref("");
const isLoading = ref(false);
const dayKeys = ref([]);
const planetSeries = ref({});

function parseDateKey(value) {
  const [y, m, d] = String(value || "")
    .split("-")
    .map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDateKeysInRange(startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end) return [];
  const [rangeStart, rangeEnd] =
    start.getTime() <= end.getTime() ? [start, end] : [end, start];
  const out = [];
  const cursor = new Date(rangeStart.getTime());
  while (cursor.getTime() <= rangeEnd.getTime()) {
    out.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if (out.length > MAX_DAYS) break;
  }
  return out;
}

function parseCoords() {
  const lat = Number(props.latitude);
  const lon = Number(props.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latitude: lat, longitude: lon };
}

function resolvedApiBase() {
  const raw = String(props.apiBaseUrl || "").trim();
  return (raw || "http://localhost:3000/api").replace(/\/$/, "");
}

async function fetchChartUtc(utcDate, coords) {
  const response = await fetch(`${resolvedApiBase()}/astrology/chart`, {
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

  if (!response.ok) {
    throw new Error(`Chart request failed (HTTP ${response.status}).`);
  }
  const payload = await response.json();
  if (payload?.success === false) {
    throw new Error(String(payload.error || "Chart request failed."));
  }
  const planets = payload?.data?.planets;
  if (!planets || typeof planets !== "object") {
    throw new Error("Chart response missing planets.");
  }

  const out = {};
  for (const row of PLANETS) {
    const lng = absoluteTropicalLongitudeDeg(planets[row.key]);
    out[row.key] = Number.isFinite(lng) ? lng : null;
  }
  return out;
}

async function loadLines() {
  loadError.value = "";
  dayKeys.value = [];
  planetSeries.value = {};

  if (!props.startDate || !props.endDate) return;
  const coords = parseCoords();
  if (!coords) return;

  const keys = buildDateKeysInRange(props.startDate, props.endDate);
  if (!keys.length) return;
  dayKeys.value = keys;

  const instants = keys.map((dateKey) =>
    utcNoonForDateKeyInTimeZone(dateKey, props.timeZone),
  );
  if (instants.some((d) => !d)) {
    loadError.value = "Invalid date range.";
    return;
  }

  isLoading.value = true;
  try {
    const maps = await Promise.all(
      instants.map((utc) => fetchChartUtc(utc, coords)),
    );
    const nextSeries = {};
    for (const row of PLANETS) {
      nextSeries[row.key] = maps.map((sample) => sample[row.key]);
    }
    planetSeries.value = nextSeries;
  } catch (err) {
    loadError.value =
      err instanceof Error ? err.message : "Could not load line chart.";
    planetSeries.value = {};
  } finally {
    isLoading.value = false;
  }
}

const chartInputsKey = computed(
  () =>
    `${props.startDate}|${props.endDate}|${props.timeZone}|${String(props.latitude)}|${String(props.longitude)}|${props.apiBaseUrl}`,
);

watch(
  chartInputsKey,
  () => {
    loadLines();
  },
  { immediate: true },
);

function degreeToX(degree) {
  const normalized = ((Number(degree) % 360) + 360) % 360;
  return CHART_X0 + (normalized / 360) * INNER_CHART_W;
}

function shortRowLabelFromDateKey(dateKey) {
  const [y, m, d] = String(dateKey || "").split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return "";
  }
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  const letter = WEEKDAY_ABBR[dow] ?? "?";
  return `${letter} ${m}/${d}`;
}

function dayIndexToY(index, totalDays) {
  if (totalDays <= 1) return CHART_TOP;
  const progress = index / (totalDays - 1);
  return CHART_TOP + progress * (CHART_BOTTOM - CHART_TOP);
}

function buildPlanetPath(points) {
  let d = "";
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point == null) continue;
    if (!d) {
      d = `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      continue;
    }
    const prev = points[i - 1];
    if (!prev || Math.abs(point.lng - prev.lng) > 180) {
      d += ` M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      continue;
    }
    d += ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }
  return d;
}

function signElement(signName) {
  const map = {
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
  return map[signName] || "air";
}

const zodiacBar = computed(() =>
  TROPICAL_SIGN_ORDER.map((signName, index) => {
    const x = CHART_X0 + index * 30;
    const width = 30;
    const cx = x + width / 2;
    return {
      signName,
      x,
      width,
      color: ELEMENT_COLORS[signElement(signName)],
      /** Physis key char or Unicode fallback; rendered in HTML overlay (PDF-safe), not SVG text elements. */
      glyph:
        zodiacPhysisByName[signName] || zodiacUnicodeByName[signName] || "",
      overlayLeftPct: (cx / VIEW_WIDTH) * 100,
      /** Anchor glyphs toward the bottom of the header so less dead air above the day grid. */
      overlayTopPct:
        ((TOP_BAR_HEIGHT - 1.6) / VIEW_HEIGHT) * 100,
    };
  }),
);

/** 12 background cells per day row; colors follow zodiac header columns. */
const dayRowCells = computed(() => {
  const n = dayKeys.value.length;
  if (!n) {
    return [];
  }

  const cells = [];
  for (let i = 0; i < n; i += 1) {
    const yMid = dayIndexToY(i, n);
    const yTop = i === 0 ? CHART_TOP : (dayIndexToY(i - 1, n) + yMid) / 2;
    const yBottom =
      i === n - 1 ? CHART_BOTTOM : (yMid + dayIndexToY(i + 1, n)) / 2;
    const rowHeight = Math.max(0, yBottom - yTop - DAY_ROW_GAP);
    const rowY = yTop + DAY_ROW_GAP / 2;

    for (const column of zodiacBar.value) {
      cells.push({
        key: `${dayKeys.value[i]}-${column.signName}`,
        x: column.x,
        y: rowY,
        width: column.width,
        height: rowHeight,
        fill: column.color,
        opacity: DAY_ROW_BG_OPACITY,
      });
    }
  }
  return cells;
});

const dayRowLabels = computed(() => {
  const n = dayKeys.value.length;
  if (!n) return [];

  return dayKeys.value.map((dateKey, i) => {
    const yMid = dayIndexToY(i, n);
    const yTop = i === 0 ? CHART_TOP : (dayIndexToY(i - 1, n) + yMid) / 2;
    const yBottom =
      i === n - 1 ? CHART_BOTTOM : (yMid + dayIndexToY(i + 1, n)) / 2;
    const rowHeight = Math.max(0, yBottom - yTop - DAY_ROW_GAP);
    const rowY = yTop + DAY_ROW_GAP / 2;
    const cy = rowY + rowHeight / 2;

    return {
      key: dateKey,
      text: shortRowLabelFromDateKey(dateKey),
      cy,
      fill: i % 2 === 0 ? DAY_LABEL_FILL_EVEN : DAY_LABEL_FILL_ODD,
    };
  });
});

const planetRows = computed(() =>
  PLANETS.map((planet) => {
    const series = planetSeries.value?.[planet.key] || [];
    const points = series.map((lng, index) => {
      if (!Number.isFinite(lng)) return null;
      return {
        lng: Number(lng),
        x: degreeToX(Number(lng)),
        y: dayIndexToY(index, dayKeys.value.length),
      };
    });
    return {
      ...planet,
      points: points.filter(Boolean),
      path: buildPlanetPath(points),
    };
  }),
);

/** Fixed λ appears as a vertical span in chart coordinates (x = longitude, y = calendar days). */
const natalGuideLines = computed(() => {
  if (!props.natalLines || !props.natalChart || !dayKeys.value.length) {
    return [];
  }
  const out = [];
  for (const p of PLANETS) {
    const planet = props.natalChart.planets?.[p.key];
    const lng = absoluteTropicalLongitudeDeg(planet);
    if (lng == null) continue;
    out.push({
      key: `natal-${p.key}`,
      x: degreeToX(lng),
      stroke: p.color,
    });
  }
  const houses = props.natalChart.houses;
  if (houses?.ascendantSign) {
    const lng = absoluteTropicalLongitudeDeg({
      zodiacSignName: houses.ascendantSign,
      degreeFormatted: houses.ascendantDegree,
    });
    if (lng != null) {
      out.push({
        key: "natal-asc",
        x: degreeToX(lng),
        stroke: "#ffffff",
      });
    }
  }
  return out;
});

const svgTitle = computed(
  () =>
    "Planet positions by day over selected timeframe, on a 0-360 tropical zodiac axis",
);
</script>

<template>
  <div
    class="progress-lines"
    :class="{
      'progress-lines--loading': isLoading,
      'progress-lines--cover': size === 'cover',
    }"
  >
    <div
      class="progress-lines-canvas"
      :class="{
        'progress-lines-canvas--rotate-ccw': isHorizontal && !isClockwise,
        'progress-lines-canvas--rotate-cw': isHorizontal && isClockwise,
      }"
    >
      <div class="progress-lines-figure">
        <svg
          class="progress-lines-svg"
          :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
          preserveAspectRatio="xMidYMid meet"
          overflow="visible"
          role="img"
          :aria-label="svgTitle"
        >
          <title>{{ svgTitle }}</title>

          <g class="progress-lines-zodiac-bar">
            <rect
              v-for="z in zodiacBar"
              :key="`bar-${z.signName}`"
              :x="z.x"
              y="0"
              :width="z.width"
              :height="TOP_BAR_HEIGHT"
              fill="#ffffff"
            />
          </g>

        <g class="progress-lines-day-rows" aria-hidden="true">
          <rect
            v-for="cell in dayRowCells"
            :key="`day-row-${cell.key}`"
            :x="cell.x"
            :y="cell.y"
            :width="cell.width"
            :height="cell.height"
            :fill="cell.fill"
            :opacity="cell.opacity"
          />
        </g>

        <g class="progress-lines-day-labels" aria-hidden="true">
          <text
            v-for="lbl in dayRowLabels"
            :key="`day-lbl-L-${lbl.key}`"
            :x="CHART_X0 - 2"
            :y="lbl.cy"
            text-anchor="end"
            dominant-baseline="middle"
            class="progress-lines-day-label"
            :fill="lbl.fill"
          >
            {{ lbl.text }}
          </text>
          <text
            v-for="lbl in dayRowLabels"
            :key="`day-lbl-R-${lbl.key}`"
            :x="CHART_X0 + INNER_CHART_W + 2"
            :y="lbl.cy"
            text-anchor="start"
            dominant-baseline="middle"
            class="progress-lines-day-label"
            :fill="lbl.fill"
          >
            {{ lbl.text }}
          </text>
        </g>

        <g class="progress-lines-natal-lines" aria-hidden="true">
          <line
            v-for="line in natalGuideLines"
            :key="line.key"
            :x1="line.x"
            :x2="line.x"
            :y1="CHART_TOP"
            :y2="CHART_BOTTOM"
            :stroke="line.stroke"
            stroke-width="0.65"
            stroke-linecap="round"
            opacity="0.88"
            pointer-events="none"
          />
        </g>

        <g class="progress-lines-series">
          <path
            v-for="row in planetRows"
            :key="`path-${row.key}`"
            :d="row.path"
            fill="none"
            :stroke="row.color"
            stroke-width="0.9"
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity="0.75"
          />
          <template v-for="row in planetRows" :key="`dots-${row.key}`">
            <circle
              v-for="(point, idx) in row.points"
              :key="`dot-${row.key}-${idx}`"
              :cx="point.x"
              :cy="point.y"
              r="1.6"
              :fill="row.color"
              opacity="0.95"
            />
          </template>
        </g>
        </svg>
        <!-- DOM glyphs (same approach as ProgressArcs): SVG text lacks Physis in PDF rasterization. -->
        <div class="progress-lines-zodiac-overlay" aria-hidden="true">
          <span
            v-for="z in zodiacBar"
            :key="`z-overlay-${z.signName}`"
            class="progress-lines-zodiac-glyph"
            :style="{
              left: `${z.overlayLeftPct}%`,
              top: `${z.overlayTopPct}%`,
              color: z.color,
            }"
          >
            {{ z.glyph }}
          </span>
        </div>
      </div>
    </div>
    <p v-if="loadError" class="progress-lines-error">{{ loadError }}</p>
  </div>
</template>

<style scoped>
.progress-lines {
  position: relative;
  container-type: size;
  width: min(82vw, 20rem);
  max-width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  overflow: hidden;
}

.progress-lines--cover {
  width: 100%;
  max-width: 100%;
  overflow: visible;
}

.progress-lines--loading {
  opacity: 0.6;
}

.progress-lines-canvas {
  position: absolute;
  inset: 0;
}

.progress-lines-canvas--rotate-ccw,
.progress-lines-canvas--rotate-cw {
  inset: auto;
  left: 50%;
  top: 50%;
  width: 100cqb;
  height: 100cqi;
  transform: translate(-50%, -50%);
  transform-origin: center center;
}

.progress-lines-canvas--rotate-ccw {
  transform: translate(-50%, -50%) rotate(-90deg);
}

.progress-lines-canvas--rotate-cw {
  transform: translate(-50%, -50%) rotate(90deg);
}

.progress-lines-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.progress-lines-figure {
  position: relative;
  width: 100%;
  height: 100%;
}

.progress-lines-zodiac-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-size: clamp(12px, 6cqmin, 19px);
}

.progress-lines-zodiac-glyph {
  position: absolute;
  transform: translate(-50%, -52%);
  font-family: Physis, serif;
  font-size: 1em;
  line-height: 0.92;
  text-shadow:
    0 0 0.25px rgba(255, 255, 255, 0.65),
    0 0 0.25px rgba(255, 255, 255, 0.65);
}

.progress-lines-day-label {
  font-family:
    system-ui,
    -apple-system,
    Segoe UI,
    Roboto,
    sans-serif;
  font-size: 6px;
  font-weight: 600;
}

.progress-lines-error {
  margin: 0.25rem 0 0;
  font-size: 0.55rem;
  line-height: 1.2;
  color: #a94442;
  text-align: center;
}
</style>
