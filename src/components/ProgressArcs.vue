<script setup>
/**
 * Range graphic for calendar covers — same planetary longitude as correspondences-app lines mode:
 *
 * 1. Several `POST …/astrology/chart` requests (correspondences-app backend): local noon on evenly
 *    spaced dates from range **start** through **end** (see `utcNoonForDateKeyInTimeZone` + panel
 *    location / time zone; sample count capped).
 * 2. For each planet, read absolute tropical longitude in 0–360° (same field order as
 *    `absoluteTropicalLongitudeDeg` in `tropicalLongitude.js`, aligned with
 *    `ephemerisChartData.ts` / `astrology.js` chart payloads).
 * 3. Arcs: we fetch **several** noon charts along the range. Most planets: sum **short** steps
 *    between samples. **Moon:** sum **prograde** rim steps (shortest arc is wrong when a step
 *    exceeds ~180°). Long spans: Moon sweep is **capped** at ~one turn so the stroke does not
 *    loop the rim many times. If net motion is ~≥360° but start≈end on the rim, we draw one clean
 *    **360°** ring. Two samples only: Moon uses `longitudeDeltaForArc` (also capped).
 *
 * Layout: 0° Aries at left (9 o’clock); rim is **flipped vertically** (reflection across the
 * horizontal midline through the center) so Cancer sits toward the bottom and Capricorn toward
 * the top; λ still increases along the rim in the usual tropical order. Zodiac glyphs use Physis
 * on the outer rim, rotated so **top** of each symbol points **radially outward** and **bottom**
 * toward the hub. The viewBox is padded so glyphs are not clipped.
 */
import { computed, ref, watch } from "vue";
import { utcNoonForDateKeyInTimeZone } from "../astrology/instantUtcFromZonedDateKey.js";
import {
  getZodiacKeysFromNames,
  getZodiacUnicodeFallback,
} from "../astrology/physisSymbolMap";
import {
  absoluteTropicalLongitudeDeg,
  normalizeEclipticLongitudeDeg,
  shortestLongitudeDeltaDeg,
  TROPICAL_SIGN_ORDER,
} from "../astrology/tropicalLongitude.js";

const props = defineProps({
  startDate: { type: String, default: "" },
  endDate: { type: String, default: "" },
  apiBaseUrl: { type: String, default: "http://localhost:3000/api" },
  latitude: { type: [String, Number], default: "" },
  longitude: { type: [String, Number], default: "" },
  timeZone: { type: String, default: "UTC" },
  /** `"cover"` = larger footprint for weekly calendar front cover. */
  size: { type: String, default: "" },
});

/** Innermost → outermost; shared stroke weight for all planet arcs. */
const PLANET_STACK = [
  { key: "pluto", stroke: "#7a4a2a", arcStroke: 2 },
  { key: "neptune", stroke: "#5b3bbf", arcStroke: 2 },
  { key: "uranus", stroke: "#5eb8e8", arcStroke: 2 },
  { key: "saturn", stroke: "#1a1a1a", arcStroke: 2 },
  { key: "jupiter", stroke: "#e89b2a", arcStroke: 2 },
  { key: "mars", stroke: "#c12f2f", arcStroke: 2 },
  { key: "venus", stroke: "#e89bb8", arcStroke: 2 },
  { key: "mercury", stroke: "#2d8f4e", arcStroke: 2 },
  { key: "sun", stroke: "#e6c229", arcStroke: 2 },
  { key: "moon", stroke: "#8f959d", arcStroke: 2 },
];

const VIEW = 100;
const CX = VIEW / 2;
const CY = VIEW / 2;
/** Extra space around 0…100 drawing so outer zodiac glyphs (radial rotation) are not clipped. */
const VIEWBOX_PAD = 10;
const VIEWBOX_STR = `${-VIEWBOX_PAD} ${-VIEWBOX_PAD} ${VIEW + 2 * VIEWBOX_PAD} ${VIEW + 2 * VIEWBOX_PAD}`;
const R0 = 9;
const R_STEP = 4.2;
const GUIDE_STROKE = 0.32;
const GUIDE_OPACITY = 0.24;
/** Rotate guide circles so path origin sits at 9 o’clock, matching longitude 0 on the left. */
const GUIDE_ROTATE = `rotate(180 ${CX} ${CY})`;

const HIDE_MOON_RING_AFTER_DAYS = 28;

const zodiacPhysisByName = getZodiacKeysFromNames();
const zodiacUnicodeByName = getZodiacUnicodeFallback();

const loadError = ref("");
/** Chronological noon chart rows (each: planetKey → λ°). Built from several samples along the range. */
const chartSamples = ref([]);
/** Calendar span in days (start noon → end noon); used for two-point Moon heuristic. */
const spanDays = ref(1);
const isLoading = ref(false);

const showMoonRing = computed(
  () => spanDays.value <= HIDE_MOON_RING_AFTER_DAYS,
);
const visiblePlanetStack = computed(() =>
  showMoonRing.value
    ? PLANET_STACK
    : PLANET_STACK.filter((row) => row.key !== "moon"),
);
const outermostRingRadius = computed(
  () => R0 + (visiblePlanetStack.value.length - 1) * R_STEP,
);
/** Radial offset past the outer ring so zodiac glyphs sit slightly outside the wheel. */
const zodiacGlyphRadius = computed(() => outermostRingRadius.value + 4.6);

const MOON_DEG_PER_DAY_CAP = 16;
const MAX_CHART_SAMPLES = 12;
/** Target spacing for extra samples (~every 2.5d) so the Moon rarely jumps >180° between steps. */
const SAMPLE_SPACING_DAYS = 2.5;
const FULL_LAP_CLOSURE_TOL_DEG = 14;
/**
 * Moon never retrogrades; long spans + coarse samples can move >180° between points — shortest-arc
 * steps then point the wrong way and `describeRingArc` retraces the rim many times. Cap sweep.
 */
const MOON_MAX_DISPLAY_SWEEP_DEG = 360.5;

/**
 * Positive 0…360° rim step from start to end in the prograde (zodiac-increasing) sense.
 * Use for the Moon between chart samples when spacing is < ~27d so motion does not lap twice.
 */
function progradeRimDeltaDeg(startDeg, endDeg) {
  const s = normalizeEclipticLongitudeDeg(startDeg);
  const e = normalizeEclipticLongitudeDeg(endDeg);
  if (s === null || e === null) return 0;
  return (((e - s + 360) % 360) + 360) % 360;
}

function cumulativeMoonProgradeSeries(longitudes) {
  let total = 0;
  for (let i = 0; i < longitudes.length - 1; i += 1) {
    total += progradeRimDeltaDeg(longitudes[i], longitudes[i + 1]);
  }
  return total;
}

/**
 * UTC instants (noon in location zone) from range start through end, inclusive, for chart sampling.
 */
function buildSampleUtcInstants(startUtc, endUtc) {
  const ms0 = startUtc.getTime();
  const ms1 = endUtc.getTime();
  const spanMs = ms1 - ms0;
  if (spanMs <= 0) {
    return [startUtc, endUtc];
  }
  const spanDays = spanMs / 86400000;
  const n = Math.min(
    MAX_CHART_SAMPLES,
    Math.max(2, Math.ceil(spanDays / SAMPLE_SPACING_DAYS) + 1),
  );
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(new Date(ms0 + (spanMs * i) / (n - 1)));
  }
  return out;
}

function cumulativeLongitudeDeltaSeries(longitudes) {
  let total = 0;
  for (let i = 0; i < longitudes.length - 1; i += 1) {
    total += shortestLongitudeDeltaDeg(longitudes[i], longitudes[i + 1]);
  }
  return total;
}

/**
 * Signed Δλ for the drawn arc. Multi-sample: sum of shortest steps (handles laps). If that sum
 * completes ~≥360° but first/last longitudes almost match, use one **360°** stroke (clean ring).
 * Two samples only: Moon uses `longitudeDeltaForArc`, others use shortest.
 */
function displayArcDeltaForPlanet(planetKey, longitudes, span) {
  const n = longitudes?.length ?? 0;
  if (n < 2) return 0;
  if (n === 2) {
    return longitudeDeltaForArc(planetKey, longitudes[0], longitudes[1], span);
  }

  if (planetKey === "moon") {
    const moonCum = cumulativeMoonProgradeSeries(longitudes);
    return Math.min(moonCum, MOON_MAX_DISPLAY_SWEEP_DEG);
  }

  const cum = cumulativeLongitudeDeltaSeries(longitudes);
  const closure = Math.abs(
    shortestLongitudeDeltaDeg(longitudes[0], longitudes[n - 1]),
  );

  if (
    Math.abs(cum) >= 360 - FULL_LAP_CLOSURE_TOL_DEG &&
    closure < FULL_LAP_CLOSURE_TOL_DEG
  ) {
    return Math.sign(cum || 1) * 360;
  }

  return cum;
}

/**
 * Signed longitude change for the visible arc (two samples only). Moon: forward/backward cap.
 * Other bodies: shortest rim arc.
 */
function longitudeDeltaForArc(planetKey, s0, s1, span) {
  const shortest = shortestLongitudeDeltaDeg(s0, s1);
  if (planetKey !== "moon" || !Number.isFinite(span) || span <= 0) {
    return shortest;
  }

  const forward = (((s1 - s0 + 360) % 360) + 360) % 360;
  const backward = forward - 360;
  const cap = Math.max(span, 1 / 24) * MOON_DEG_PER_DAY_CAP + 14;

  const candidates = [forward, backward].filter(
    (d) => Math.abs(d) > 1e-9 && Math.abs(d) <= cap,
  );
  let chosen;
  if (candidates.length === 0) {
    chosen = shortest;
  } else {
    chosen = candidates.reduce(
      (best, d) => (Math.abs(d) > Math.abs(best) ? d : best),
      candidates[0],
    );
  }
  const sign = chosen >= 0 ? 1 : -1;
  return sign * Math.min(Math.abs(chosen), MOON_MAX_DISPLAY_SWEEP_DEG);
}

function parseCoords() {
  const lat = Number(props.latitude);
  const lon = Number(props.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latitude: lat, longitude: lon };
}

/**
 * Tropical longitude λ (0–360°): λ = 0 at left (9 o’clock). Vertical flip vs raw ecliptic map:
 * `y = CY + r·sin(L)` mirrors across the horizontal axis through the center (Cancer / Capricorn
 * hemispheres swapped as requested). λ increases **clockwise** on the clock face from 9 o’clock.
 */
function lngToPoint(r, lngDeg) {
  const n = normalizeEclipticLongitudeDeg(lngDeg);
  if (n === null) return { x: CX, y: CY };
  const L = (n * Math.PI) / 180;
  return {
    x: CX - r * Math.cos(L),
    y: CY + r * Math.sin(L),
  };
}

/**
 * Polyline along the circle in longitude space (matches `lngToPoint` exactly).
 * @param delta signed degrees from startLng along the rim
 */
function describeRingArc(r, startLng, delta) {
  const s0 = normalizeEclipticLongitudeDeg(startLng);
  if (s0 === null) return "";

  let useDelta = delta;
  if (Math.abs(useDelta) < 1e-6) {
    useDelta = useDelta >= 0 ? 0.06 : -0.06;
  }

  const segs = Math.max(12, Math.min(96, Math.ceil(Math.abs(useDelta) / 1.5)));
  const parts = [];
  for (let i = 0; i <= segs; i += 1) {
    const lng = s0 + (useDelta * i) / segs;
    const p = lngToPoint(r, lng);
    parts.push(
      i === 0
        ? `M ${p.x.toFixed(3)} ${p.y.toFixed(3)}`
        : `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`,
    );
  }
  return parts.join(" ");
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
  for (const { key } of PLANET_STACK) {
    const p = planets[key];
    const lng = absoluteTropicalLongitudeDeg(p);
    if (lng === null) {
      throw new Error(`Could not read tropical longitude for ${key}.`);
    }
    out[key] = lng;
  }
  return out;
}

async function loadPositions() {
  loadError.value = "";
  chartSamples.value = [];

  const coords = parseCoords();
  if (!props.startDate || !props.endDate || !coords) {
    return;
  }

  const startUtc = utcNoonForDateKeyInTimeZone(props.startDate, props.timeZone);
  const endUtc = utcNoonForDateKeyInTimeZone(props.endDate, props.timeZone);
  if (!startUtc || !endUtc || startUtc.getTime() > endUtc.getTime()) {
    loadError.value = "Invalid date range.";
    return;
  }

  spanDays.value = Math.max(
    (endUtc.getTime() - startUtc.getTime()) / 86400000,
    1 / 24,
  );

  const instants = buildSampleUtcInstants(startUtc, endUtc);

  isLoading.value = true;
  try {
    const maps = await Promise.all(
      instants.map((utc) => fetchChartUtc(utc, coords)),
    );
    chartSamples.value = maps;
  } catch (err) {
    loadError.value =
      err instanceof Error ? err.message : "Could not load planet positions.";
    chartSamples.value = [];
  } finally {
    isLoading.value = false;
  }
}

/** Any change to calendar range or chart inputs re-fetches start/end noon positions. */
const chartInputsKey = computed(
  () =>
    `${props.startDate}|${props.endDate}|${props.timeZone}|${String(props.latitude)}|${String(props.longitude)}|${props.apiBaseUrl}`,
);

watch(
  chartInputsKey,
  () => {
    loadPositions();
  },
  { immediate: true },
);

const guideRings = computed(() =>
  visiblePlanetStack.value.map((row, i) => ({
    key: row.key,
    r: R0 + i * R_STEP,
    stroke: row.stroke,
  })),
);

/** Midpoint of each 30° tropical slice (Aries 0–30 → 15°, …). */
const zodiacMarks = computed(() =>
  TROPICAL_SIGN_ORDER.map((signName, i) => {
    const lngDeg = i * 30 + 15;
    const p = lngToPoint(zodiacGlyphRadius.value, lngDeg);
    const phiDeg = (Math.atan2(p.y - CY, p.x - CX) * 180) / Math.PI;
    /** Outward radial is φ; +90° aligns default text so cap/top points outward, base toward center. */
    const rotateDeg = phiDeg + 90;
    return {
      signName,
      char: zodiacPhysisByName[signName] || zodiacUnicodeByName[signName] || "",
      x: p.x,
      y: p.y,
      leftPercent: ((p.x + VIEWBOX_PAD) / (VIEW + 2 * VIEWBOX_PAD)) * 100,
      topPercent: ((p.y + VIEWBOX_PAD) / (VIEW + 2 * VIEWBOX_PAD)) * 100,
      rotateDeg,
    };
  }),
);

function longitudesForPlanet(samples, planetKey) {
  return samples.map((m) => m[planetKey]).filter((x) => Number.isFinite(x));
}

const arcRings = computed(() => {
  const samples = chartSamples.value;
  if (!samples?.length) {
    return visiblePlanetStack.value.map((row, i) => ({
      key: row.key,
      r: R0 + i * R_STEP,
      stroke: row.stroke,
      strokeWidth: row.arcStroke,
      d: "",
    }));
  }

  return visiblePlanetStack.value.map((row, i) => {
    const r = R0 + i * R_STEP;
    const series = longitudesForPlanet(samples, row.key);
    const delta = displayArcDeltaForPlanet(row.key, series, spanDays.value);
    const startLng = series[0];
    const d =
      typeof startLng === "number" && Number.isFinite(startLng)
        ? describeRingArc(r, startLng, delta)
        : "";
    return {
      key: row.key,
      r,
      stroke: row.stroke,
      strokeWidth: row.arcStroke,
      d,
    };
  });
});

const svgTitle = computed(() => {
  const samples = chartSamples.value;
  if (!samples?.length) {
    return "Planet arcs: tropical longitude from calendar range start to end";
  }
  return "Tropical longitude arcs from range start to end (noon, location time zone); 0° Aries at left";
});
</script>

<template>
  <div
    class="progress-arcs"
    :class="{
      'progress-arcs--loading': isLoading,
      'progress-arcs--cover': size === 'cover',
    }"
  >
    <div class="progress-arcs-figure">
      <svg
        class="progress-arcs-svg"
        :viewBox="VIEWBOX_STR"
        overflow="visible"
        role="img"
        :aria-label="svgTitle"
      >
        <title>{{ svgTitle }}</title>

        <g
          class="progress-arcs-guides"
          fill="none"
          :stroke-width="GUIDE_STROKE"
          pointer-events="none"
        >
          <circle
            v-for="ring in guideRings"
            :key="`guide-${ring.key}`"
            :cx="CX"
            :cy="CY"
            :r="ring.r"
            :stroke="ring.stroke"
            :opacity="
              ring.key === 'saturn'
                ? Math.min(GUIDE_OPACITY + 0.12, 0.45)
                : GUIDE_OPACITY
            "
            :transform="GUIDE_ROTATE"
          />
        </g>

        <g
          class="progress-arcs-arcs"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            v-for="ring in arcRings"
            :key="`arc-${ring.key}`"
            :d="ring.d"
            :stroke="ring.stroke"
            :stroke-width="ring.strokeWidth"
          />
        </g>
      </svg>
      <div class="progress-arcs-zodiac" aria-hidden="true">
        <span
          v-for="m in zodiacMarks"
          :key="m.signName"
          class="progress-arcs-zodiac-glyph"
          :style="{
            left: `${m.leftPercent}%`,
            top: `${m.topPercent}%`,
            transform: `translate(-50%, -50%) rotate(${m.rotateDeg.toFixed(2)}deg)`,
          }"
        >
          {{ m.char }}
        </span>
      </div>
    </div>
    <p v-if="loadError" class="progress-arcs-error">{{ loadError }}</p>
  </div>
</template>

<style scoped>
.progress-arcs {
  width: min(42vw, 11rem);
  max-width: 100%;
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

.progress-arcs--loading {
  opacity: 0.55;
}

.progress-arcs--cover {
  width: min(82vw, 19.5rem);
}

.progress-arcs-svg {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}

.progress-arcs-figure {
  position: relative;
  width: 100%;
  height: 100%;
}

.progress-arcs-zodiac {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-size: clamp(12px, 1.8vw, 20px);
}

.progress-arcs-zodiac-glyph {
  position: absolute;
  display: inline-block;
  font-family: Physis, serif;
  font-size: 1em;
  line-height: 1;
  color: #4d5159;
  text-shadow:
    0 0 0.35px rgba(255, 255, 255, 0.75),
    0 0 0.35px rgba(255, 255, 255, 0.75);
}

.progress-arcs-error {
  margin: 0.25rem 0 0;
  font-size: 0.55rem;
  line-height: 1.2;
  color: #a94442;
  text-align: center;
  max-width: 12rem;
}

@media (min-width: 900px) {
  .progress-arcs {
    width: min(36vw, 12.5rem);
  }

  .progress-arcs--cover {
    width: min(62vw, 22rem);
  }
}
</style>
