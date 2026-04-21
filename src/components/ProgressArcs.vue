<script setup>
/**
 * Range graphic for calendar covers — same planetary longitude as correspondences-app lines mode:
 *
 * 1. Two `POST …/astrology/chart` requests (correspondences-app backend): one instant at local noon
 *    on the calendar range **start** date, one at local noon on the **end** date (see
 *    `utcNoonForDateKeyInTimeZone` + panel location / time zone).
 * 2. For each planet, read absolute tropical longitude in 0–360° (same field order as
 *    `absoluteTropicalLongitudeDeg` in `tropicalLongitude.js`, aligned with
 *    `ephemerisChartData.ts` / `astrology.js` chart payloads).
 * 3. Arc = circle segment between start and end longitude (sampled path). Most planets use the
 *    **short** rim arc (`shortestLongitudeDeltaDeg`). The **Moon** can move >180° in a month, so
 *    we pick the long or short sweep that fits a span-based motion cap (otherwise the Moon stroke
 *    would highlight the wrong short complement instead of most of a month of travel).
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

const MOON_RING_INDEX = PLANET_STACK.length - 1;
const R_OUTERMOST = R0 + MOON_RING_INDEX * R_STEP;
/** Radial offset past the Moon ring so zodiac glyphs sit slightly outside the wheel. */
const R_ZODIAC_GLYPHS = R_OUTERMOST + 4.6;

const zodiacPhysisByName = getZodiacKeysFromNames();
const zodiacUnicodeByName = getZodiacUnicodeFallback();

const loadError = ref("");
const startLongitudes = ref(null);
const endLongitudes = ref(null);
/** Calendar span in days (start noon → end noon); used for Moon arc disambiguation. */
const spanDays = ref(1);
const isLoading = ref(false);

const MOON_DEG_PER_DAY_CAP = 16;

/**
 * Signed longitude change for the visible arc. Moon: choose between +forward [0,360) and
 * backward = forward−360 using whichever has |Δ| ≤ span×cap when possible, else prefer **larger**
 * |Δ| among feasible (so a ~27-day span draws ~360° of Moon, not the ~30° short complement).
 * Other bodies: always shortest rim arc.
 */
function longitudeDeltaForArc(planetKey, s0, s1, span) {
  const shortest = shortestLongitudeDeltaDeg(s0, s1);
  if (planetKey !== "moon" || !Number.isFinite(span) || span <= 0) {
    return shortest;
  }

  const forward = ((s1 - s0 + 360) % 360 + 360) % 360;
  const backward = forward - 360;
  const cap = Math.max(span, 1 / 24) * MOON_DEG_PER_DAY_CAP + 14;

  const candidates = [forward, backward].filter(
    (d) => Math.abs(d) > 1e-9 && Math.abs(d) <= cap,
  );
  if (candidates.length === 0) {
    return shortest;
  }
  return candidates.reduce((best, d) =>
    Math.abs(d) > Math.abs(best) ? d : best,
  candidates[0],
  );
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
 */
function describeRingArc(r, startLng, endLng, planetKey) {
  const s0 = normalizeEclipticLongitudeDeg(startLng);
  const s1 = normalizeEclipticLongitudeDeg(endLng);
  if (s0 === null || s1 === null) return "";

  let delta = longitudeDeltaForArc(planetKey, s0, s1, spanDays.value);
  if (Math.abs(delta) < 1e-6) {
    delta = delta >= 0 ? 0.06 : -0.06;
  }

  const segs = Math.max(
    12,
    Math.min(96, Math.ceil(Math.abs(delta) / 1.5)),
  );
  const parts = [];
  for (let i = 0; i <= segs; i += 1) {
    const lng = s0 + (delta * i) / segs;
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
  startLongitudes.value = null;
  endLongitudes.value = null;

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

  isLoading.value = true;
  try {
    const [startMap, endMap] = await Promise.all([
      fetchChartUtc(startUtc, coords),
      fetchChartUtc(endUtc, coords),
    ]);
    startLongitudes.value = startMap;
    endLongitudes.value = endMap;
  } catch (err) {
    loadError.value =
      err instanceof Error ? err.message : "Could not load planet positions.";
  } finally {
    isLoading.value = false;
  }
}

watch(
  () => [
    props.startDate,
    props.endDate,
    props.apiBaseUrl,
    props.latitude,
    props.longitude,
    props.timeZone,
  ],
  () => {
    loadPositions();
  },
  { immediate: true },
);

const guideRings = computed(() =>
  PLANET_STACK.map((row, i) => ({
    key: row.key,
    r: R0 + i * R_STEP,
    stroke: row.stroke,
  })),
);

/** Midpoint of each 30° tropical slice (Aries 0–30 → 15°, …). */
const zodiacMarks = computed(() =>
  TROPICAL_SIGN_ORDER.map((signName, i) => {
    const lngDeg = i * 30 + 15;
    const p = lngToPoint(R_ZODIAC_GLYPHS, lngDeg);
    const phiDeg = (Math.atan2(p.y - CY, p.x - CX) * 180) / Math.PI;
    /** Outward radial is φ; +90° aligns default text so cap/top points outward, base toward center. */
    const rotateDeg = phiDeg + 90;
    return {
      signName,
      char: zodiacPhysisByName[signName] || zodiacUnicodeByName[signName] || "",
      x: p.x,
      y: p.y,
      rotateDeg,
    };
  }),
);

const arcRings = computed(() => {
  const a = startLongitudes.value;
  const b = endLongitudes.value;
  return PLANET_STACK.map((row, i) => {
    const r = R0 + i * R_STEP;
    const d =
      a && b ? describeRingArc(r, a[row.key], b[row.key], row.key) : "";
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
  const a = startLongitudes.value;
  const b = endLongitudes.value;
  if (!a || !b) {
    return "Planet arcs: tropical longitude from calendar range start to end";
  }
  return "Tropical longitude arcs from range start to end (noon, location time zone); 0° Aries at left";
});
</script>

<template>
  <div class="progress-arcs" :class="{ 'progress-arcs--loading': isLoading }">
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
          :opacity="ring.key === 'saturn' ? Math.min(GUIDE_OPACITY + 0.12, 0.45) : GUIDE_OPACITY"
          :transform="GUIDE_ROTATE"
        />
      </g>

      <g class="progress-arcs-arcs" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path
          v-for="ring in arcRings"
          :key="`arc-${ring.key}`"
          :d="ring.d"
          :stroke="ring.stroke"
          :stroke-width="ring.strokeWidth"
        />
      </g>

      <g class="progress-arcs-zodiac" aria-hidden="true">
        <text
          v-for="m in zodiacMarks"
          :key="m.signName"
          class="progress-arcs-zodiac-glyph"
          :x="m.x"
          :y="m.y"
          :transform="`rotate(${m.rotateDeg.toFixed(2)}, ${m.x.toFixed(3)}, ${m.y.toFixed(3)})`"
          text-anchor="middle"
          dominant-baseline="central"
        >
          {{ m.char }}
        </text>
      </g>
    </svg>
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

.progress-arcs-svg {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}

.progress-arcs-zodiac-glyph {
  font-family: Physis, serif;
  font-size: 5.4px;
  fill: #4d5159;
  paint-order: stroke fill;
  stroke: rgba(255, 255, 255, 0.65);
  stroke-width: 0.2px;
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
}
</style>
