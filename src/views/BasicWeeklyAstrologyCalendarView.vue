<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import html2canvas from "html2canvas";
import { PDFDocument, rgb } from "pdf-lib";
import { buildImpositionOutputs } from "../imposition/helpers";
import SignatureImpositionControls from "../components/SignatureImpositionControls.vue";
import PdfOutputActions from "../components/PdfOutputActions.vue";
import AstrologyEventsPanel from "../components/AstrologyEventsPanel.vue";
import { getMoonTithiStep } from "../astrology/moonTithiDisplay";
import {
  getPlanetKeysFromNames,
  getPlanetUnicodeFallback,
  getZodiacKeysFromNames,
  getZodiacUnicodeFallback,
} from "../astrology/physisSymbolMap";

const today = new Date();
const plusThirty = new Date(today);
plusThirty.setDate(today.getDate() + 30);

const startDate = ref(toDateInputValue(today));
const endDate = ref(toDateInputValue(plusThirty));

const sheetsPerSignature = ref(4);
const numberOfSignatures = ref(1);
const signatureCalcMode = ref("sheets-fixed");
const outputWidth = ref(8.5);
const outputHeight = ref(11);
/** Defaults for weekly spread: page size, 1×2 output grid, vertical fold, no gaps or crop marks. */
const pageWidth = ref(4.25);
const pageHeight = ref(5.5);
const outputLayoutCols = ref(1);
const outputLayoutRows = ref(2);
const outputFoldAxis = ref("vertical");
const OUTPUT_LAYOUT_GRID_MAX = 8;
const layoutSelectDragging = ref(false);
const layoutSelectAnchor = ref({ col: 0, row: 0 });
const layoutSelectEnd = ref({ col: 0, row: 0 });
const PLATE_FRONT_ROTATION_DEG = 90;
const PLATE_BACK_ROTATION_DEG = -90;
const cropMarkOffset = ref(0.08);
const cropMarkLength = ref(0.18);
const showCropMarks = ref(false);
const horizontalGap = ref(0);
const verticalGap = ref(0);
const isGeneratingPdf = ref(false);
const pdfError = ref("");
const combinedPdfUrl = ref("");
const rasterizedPageFiles = ref([]);
const reusableBlankGridFile = ref(null);
const rasterizeProgressCurrent = ref(0);
const rasterizeProgressTotal = ref(0);
const rasterizeProgressActive = ref(false);
/** Real DOM blank grid pages inserted only while generating a PDF; cleared in `finally`. */
const weeklyPdfPaddingSheets = ref([]);
const astrologyEventsByDate = ref({});
const astrologyTithisByDate = ref({});
const astrologyContext = ref({
  locationName: "",
  latitude: "",
  longitude: "",
  timeZone: "UTC",
  birthDateTime: "",
  birthLocationName: "",
  startDate: "",
  endDate: "",
});

const planetKeys = getPlanetKeysFromNames();
const zodiacKeys = getZodiacKeysFromNames();
const planetUnicodeFallback = getPlanetUnicodeFallback();
const zodiacUnicodeFallback = getZodiacUnicodeFallback();

const pagesPerSheet = 4;
const pagesPerSignature = computed(
  () => Math.max(1, sheetsPerSignature.value) * pagesPerSheet,
);

/** Monday 00:00 local of the ISO week containing `date` (noon-safe). */
function startOfIsoWeekMonday(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeekSunday(monday) {
  const d = new Date(monday);
  d.setDate(monday.getDate() + 6);
  d.setHours(12, 0, 0, 0);
  return d;
}

function formatBannerMonthYear(monday, sunday) {
  const m0 = monday.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const y0 = monday.getFullYear();
  const m1 = sunday.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const y1 = sunday.getFullYear();
  if (monday.getMonth() === sunday.getMonth() && y0 === y1) {
    return `${m0} ${y0}`;
  }
  return `${m0} ${y0} -\n${m1} ${y1}`;
}

function getISOWeekYear(date) {
  const d = new Date(date.valueOf());
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  return d.getFullYear();
}

function getISOWeek(date) {
  const d = new Date(date.valueOf());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    )
  );
}

function isoWeeksInYear(year) {
  const dec31 = new Date(year, 11, 31);
  return getISOWeek(dec31) === 53 ? 53 : 52;
}

function buildDayPageData(current) {
  const key = toDateInputValue(current);
  return {
    key,
    dayNumber: current.getDate(),
    dayShortLabel: current
      .toLocaleString("en-US", { weekday: "short" })
      .toUpperCase(),
    dayLongLabel: current
      .toLocaleString("en-US", { weekday: "long" })
      .toUpperCase(),
    isoStamp: current.toISOString(),
    events: astrologyEventsByDate.value[key] ?? [],
  };
}

function monthShortUpper(date) {
  return date.toLocaleString("en-US", { month: "short" }).toUpperCase();
}

function formatCoverDate(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  return `${dd} ${monthShortUpper(date)} ${date.getFullYear()}`;
}

function isWholeMonthRange(start, end) {
  if (start.getDate() !== 1) return false;
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  return end.getDate() === lastDay;
}

function formatTimeframeCoverTitle(start, end) {
  if (
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === 0 &&
    start.getDate() === 1 &&
    end.getMonth() === 11 &&
    end.getDate() === 31
  ) {
    return String(start.getFullYear());
  }

  if (isWholeMonthRange(start, end)) {
    const startMonth = `${monthShortUpper(start)} ${start.getFullYear()}`;
    const endMonth = `${monthShortUpper(end)} ${end.getFullYear()}`;
    return startMonth === endMonth ? startMonth : `${startMonth} - ${endMonth}`;
  }

  return `${formatCoverDate(start)} - ${formatCoverDate(end)}`;
}

function formatCoverLocationName(rawName) {
  const parts = String(rawName || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[0]}, ${parts[parts.length - 2]}`;
  }
  return parts[0] || "Location not set";
}

function formatNatalCoverLine(dateTimeRaw, locationRaw) {
  const parsed = new Date(dateTimeRaw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const when = parsed
    .toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(" AM", "am")
    .replace(" PM", "pm");
  return `Natal Transits for ${when}, ${formatCoverLocationName(locationRaw)}`;
}

const hasNatalTransits = computed(() =>
  Object.values(astrologyEventsByDate.value || {}).some((events) =>
    (events || []).some((event) => event?.eventType === "natal transit"),
  ),
);

/**
 * Each raster page = one 2×2 grid: left sheet (banner + Mon–Wed half) or right (Thu–Sun).
 * Order matches calendar-wizard weekly spread.
 */
const weeklyRasterSheets = computed(() => {
  const rangeStart = parseDateInput(startDate.value);
  const rangeEnd = parseDateInput(endDate.value);
  if (!rangeStart || !rangeEnd || rangeStart.getTime() > rangeEnd.getTime()) {
    return [];
  }

  const firstMonday = startOfIsoWeekMonday(rangeStart);
  const lastSunday = new Date(rangeEnd);
  lastSunday.setHours(12, 0, 0, 0);
  const dowEnd = lastSunday.getDay();
  if (dowEnd !== 0) {
    lastSunday.setDate(lastSunday.getDate() + (7 - dowEnd));
  }

  const sheets = [];
  for (
    let w = new Date(firstMonday);
    w.getTime() <= lastSunday.getTime();
    w.setDate(w.getDate() + 7)
  ) {
    const weekMon = new Date(w);
    weekMon.setHours(12, 0, 0, 0);
    const weekDays = [];
    for (let i = 0; i < 7; i += 1) {
      const dt = new Date(weekMon);
      dt.setDate(weekMon.getDate() + i);
      dt.setHours(12, 0, 0, 0);
      if (dt.getTime() < rangeStart.getTime() || dt.getTime() > rangeEnd.getTime()) {
        weekDays.push(null);
      } else {
        weekDays.push(buildDayPageData(dt));
      }
    }

    const weekSun = endOfWeekSunday(weekMon);
    const bannerText = formatBannerMonthYear(weekMon, weekSun);
    const isoY = getISOWeekYear(weekMon);
    const isoW = getISOWeek(weekMon);
    const weekFraction = `${isoW}/${isoWeeksInYear(isoY)}`;
    const monKey = toDateInputValue(weekMon);

    sheets.push({
      key: `${monKey}-L`,
      side: "left",
      bannerText,
      weekFraction,
      isTotallyBlank: false,
      placements: [
        { area: "banner", kind: "banner" },
        { area: "tue", kind: "day", day: weekDays[1] },
        { area: "mon", kind: "day", day: weekDays[0] },
        { area: "wed", kind: "day", day: weekDays[2] },
      ],
    });
    sheets.push({
      key: `${monKey}-R`,
      side: "right",
      bannerText,
      weekFraction,
      isTotallyBlank: weekDays.slice(3).every((day) => !day),
      placements: [
        { area: "thu", kind: "day", day: weekDays[3] },
        { area: "fri", kind: "day", day: weekDays[4] },
        { area: "sat", kind: "day", day: weekDays[5] },
        { area: "sun", kind: "day", day: weekDays[6] },
      ],
    });
  }

  return sheets;
});

const calendarRasterSheets = computed(() => {
  const start = parseDateInput(startDate.value);
  const end = parseDateInput(endDate.value);
  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }

  const locationLine = `Current location: ${formatCoverLocationName(
    astrologyContext.value.locationName,
  )}`;
  const natalLine = hasNatalTransits.value
    ? formatNatalCoverLine(
        astrologyContext.value.birthDateTime,
        astrologyContext.value.birthLocationName,
      )
    : "";

  return [
    {
      key: "cover-front",
      kind: "cover-front",
      coverTitle: formatTimeframeCoverTitle(start, end),
      locationLine,
      natalLine,
    },
    ...weeklyRasterSheets.value.map((sheet) => ({ ...sheet, kind: "week-sheet" })),
    {
      key: "cover-back",
      kind: "cover-back",
      imprintText: "GARLAND CALENDARS",
    },
  ];
});

const weeklyRasterPagesForView = computed(() => {
  const base = calendarRasterSheets.value;
  const extra = weeklyPdfPaddingSheets.value;
  if (!extra.length || base.length < 2) {
    return base;
  }
  return [...base.slice(0, -1), ...extra, base[base.length - 1]];
});

const requiredPageCount = computed(() => calendarRasterSheets.value.length);
const numberOfPages = ref(requiredPageCount.value);
const uploadedPageCount = computed(() => 0);
const effectivePageCount = computed(() =>
  Math.max(requiredPageCount.value, Math.floor(Number(numberOfPages.value) || 0)),
);
const usingManualPageCount = computed(() => true);

watch(
  requiredPageCount,
  (nextRequired) => {
    if ((Number(numberOfPages.value) || 0) < nextRequired) {
      numberOfPages.value = nextRequired;
    }
  },
  { immediate: true },
);

watch(
  [
    effectivePageCount,
    sheetsPerSignature,
    numberOfSignatures,
    signatureCalcMode,
  ],
  () => {
    if (signatureCalcMode.value === "sheets-fixed") {
      const fixedSheets = Math.max(
        1,
        Math.floor(Number(sheetsPerSignature.value) || 1),
      );
      if (sheetsPerSignature.value !== fixedSheets) {
        sheetsPerSignature.value = fixedSheets;
      }

      const pagesPerComputedSignature = fixedSheets * pagesPerSheet;
      const nextSignatures =
        effectivePageCount.value === 0
          ? 1
          : Math.max(
              1,
              Math.ceil(effectivePageCount.value / pagesPerComputedSignature),
            );

      if (numberOfSignatures.value !== nextSignatures) {
        numberOfSignatures.value = nextSignatures;
      }

      return;
    }

    const fixedSignatures = Math.max(
      1,
      Math.floor(Number(numberOfSignatures.value) || 1),
    );
    if (numberOfSignatures.value !== fixedSignatures) {
      numberOfSignatures.value = fixedSignatures;
    }

    const targetPagesPerSignature =
      effectivePageCount.value === 0
        ? pagesPerSheet
        : Math.ceil(effectivePageCount.value / fixedSignatures);
    const nextSheetsPerSignature = Math.max(
      1,
      Math.ceil(targetPagesPerSignature / pagesPerSheet),
    );

    if (sheetsPerSignature.value !== nextSheetsPerSignature) {
      sheetsPerSignature.value = nextSheetsPerSignature;
    }
  },
  { immediate: true },
);

const totalCapacityPages = computed(
  () => numberOfSignatures.value * pagesPerSignature.value,
);
const blankPagesNeeded = computed(() =>
  Math.max(0, totalCapacityPages.value - effectivePageCount.value),
);
const sheetsPerOutputCount = computed(
  () =>
    normalizePositiveInteger(outputLayoutCols.value, 1) *
    normalizePositiveInteger(outputLayoutRows.value, 1),
);
const templateMatchesCurrentInputs = computed(
  () =>
    Number.isInteger(Number(sheetsPerSignature.value)) &&
    Number(sheetsPerSignature.value) >= 1 &&
    Number.isInteger(Number(outputLayoutCols.value)) &&
    Number(outputLayoutCols.value) >= 1 &&
    Number.isInteger(Number(outputLayoutRows.value)) &&
    Number(outputLayoutRows.value) >= 1,
);

function normalizePositiveInteger(value, fallback = 1) {
  const normalized = Math.floor(Number(value) || fallback);
  return Math.max(1, normalized);
}

function getOutputLayoutPattern() {
  return {
    sheetCols: normalizePositiveInteger(outputLayoutCols.value, 1),
    sheetRows: normalizePositiveInteger(outputLayoutRows.value, 1),
  };
}

function layoutSelectionBounds() {
  const c0 = layoutSelectAnchor.value.col;
  const r0 = layoutSelectAnchor.value.row;
  const c1 = layoutSelectEnd.value.col;
  const r1 = layoutSelectEnd.value.row;
  return {
    minCol: Math.min(c0, c1),
    maxCol: Math.max(c0, c1),
    minRow: Math.min(r0, r1),
    maxRow: Math.max(r0, r1),
  };
}

function layoutCellInDragPreview(col, row) {
  if (!layoutSelectDragging.value) {
    return false;
  }
  const { minCol, maxCol, minRow, maxRow } = layoutSelectionBounds();
  return col >= minCol && col <= maxCol && row >= minRow && row <= maxRow;
}

function layoutCellCommitted(col, row) {
  if (layoutSelectDragging.value) {
    return false;
  }
  return (
    col < normalizePositiveInteger(outputLayoutCols.value, 1) &&
    row < normalizePositiveInteger(outputLayoutRows.value, 1)
  );
}

function onOutputLayoutPointerDown(col, row, event) {
  event.preventDefault();
  layoutSelectDragging.value = true;
  layoutSelectAnchor.value = { col, row };
  layoutSelectEnd.value = { col, row };
}

function onOutputLayoutPointerEnter(col, row) {
  if (!layoutSelectDragging.value) {
    return;
  }
  layoutSelectEnd.value = { col, row };
}

function commitOutputLayoutSelection() {
  if (!layoutSelectDragging.value) {
    return;
  }
  const { minCol, maxCol, minRow, maxRow } = layoutSelectionBounds();
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  outputLayoutCols.value = cols;
  outputLayoutRows.value = rows;
  layoutSelectDragging.value = false;
}

function onOutputLayoutPointerUpGlobal() {
  commitOutputLayoutSelection();
}

onMounted(() => {
  window.addEventListener("pointerup", onOutputLayoutPointerUpGlobal);
  window.addEventListener("pointercancel", onOutputLayoutPointerUpGlobal);
});

onUnmounted(() => {
  window.removeEventListener("pointerup", onOutputLayoutPointerUpGlobal);
  window.removeEventListener("pointercancel", onOutputLayoutPointerUpGlobal);
});

const repeatedBlankGridSourceIndex = computed(() =>
  calendarRasterSheets.value.findIndex(
    (page) => page.kind === "week-sheet" && page.isTotallyBlank,
  ),
);

function buildSheetSlot(signatureOffset, relativePageNumber) {
  const absolutePageNumber = signatureOffset + relativePageNumber;
  const required = requiredPageCount.value;
  const hasCovers = required >= 2;
  const backCoverSourceIndex = required - 1;
  const files = rasterizedPageFiles.value;
  const paddingActive = weeklyPdfPaddingSheets.value.length > 0;

  let sourceIndex = absolutePageNumber - 1;
  if (paddingActive && files.length > 0) {
    const abs = absolutePageNumber;
    const effective = effectivePageCount.value;
    const l = files.length;
    if (abs <= required - 1) {
      sourceIndex = abs - 1;
    } else if (abs === effective) {
      sourceIndex = l - 1;
    } else if (abs >= required && abs < effective) {
      sourceIndex = repeatedBlankGridSourceIndex.value;
    } else if (abs > effective) {
      const tailIndex = abs - effective - 1;
      sourceIndex = required - 1 + tailIndex;
    }
  } else if (hasCovers && absolutePageNumber === effectivePageCount.value) {
    sourceIndex = backCoverSourceIndex;
  } else if (hasCovers && absolutePageNumber >= required) {
    sourceIndex = repeatedBlankGridSourceIndex.value;
  }
  const imageFile = (() => {
    if (sourceIndex >= 0) {
      return files[sourceIndex] ?? null;
    }
    if (hasCovers && absolutePageNumber >= required) {
      return reusableBlankGridFile.value;
    }
    return null;
  })();
  const hasSourcePage = absolutePageNumber <= effectivePageCount.value && !!imageFile;
  return {
    relativePageNumber,
    absolutePageNumber,
    fileName:
      imageFile?.name ??
      (hasSourcePage ? `Calendar Page ${absolutePageNumber}` : "Blank"),
    file: imageFile,
    hasSourcePage,
  };
}

const impositionOutputs = computed(() =>
  buildImpositionOutputs({
    templateMatchesCurrentInputs: templateMatchesCurrentInputs.value,
    outputLayoutPattern: getOutputLayoutPattern(),
    numberOfSignatures: numberOfSignatures.value,
    sheetsPerSignature: sheetsPerSignature.value,
    foldAxis: outputFoldAxis.value,
    buildSheetSlot,
  }),
);

function getRequiredLayoutForOutput() {
  const pattern = getOutputLayoutPattern();
  const gapBetweenCols = Math.max(0, Number(verticalGap.value));
  const gapBetweenRows = Math.max(0, Number(horizontalGap.value));
  const frontSlot = getLayoutSlotForGridInches(PLATE_FRONT_ROTATION_DEG);
  const backSlot = getLayoutSlotForGridInches(PLATE_BACK_ROTATION_DEG);
  const slot = {
    width: Math.max(frontSlot.width, backSlot.width),
    height: Math.max(frontSlot.height, backSlot.height),
  };
  const stacked = outputFoldAxis.value === "horizontal";

  if (stacked) {
    const sheetW = slot.width;
    const sheetH = slot.height * 2;
    return {
      requiredWidth:
        sheetW * pattern.sheetCols +
        gapBetweenCols * Math.max(0, pattern.sheetCols - 1),
      requiredHeight:
        sheetH * pattern.sheetRows +
        gapBetweenRows * Math.max(0, pattern.sheetRows - 1),
    };
  }

  const sheetW = slot.width * 2;
  const sheetH = slot.height;
  return {
    requiredWidth:
      sheetW * pattern.sheetCols +
      gapBetweenCols * Math.max(0, pattern.sheetCols - 1),
    requiredHeight:
      sheetH * pattern.sheetRows +
      gapBetweenRows * Math.max(0, pattern.sheetRows - 1),
  };
}

const layoutFit = computed(() => {
  const output = getOutputPageSizeInches();
  const { requiredWidth, requiredHeight } = getRequiredLayoutForOutput();

  return {
    outputWidth: output.width,
    outputHeight: output.height,
    requiredWidth,
    requiredHeight,
    fits: requiredWidth <= output.width && requiredHeight <= output.height,
  };
});

const layoutPreview = computed(() => {
  const pattern = getOutputLayoutPattern();
  const normalizedSheetsPerOutput = pattern.sheetCols * pattern.sheetRows;
  const frontSlot = getLayoutSlotForGridInches(PLATE_FRONT_ROTATION_DEG);
  const backSlot = getLayoutSlotForGridInches(PLATE_BACK_ROTATION_DEG);
  const slot = {
    width: Math.max(frontSlot.width, backSlot.width),
    height: Math.max(frontSlot.height, backSlot.height),
  };
  const gapAtFold = 0;
  const gapBetweenCols = Math.max(0, Number(verticalGap.value));
  const gapBetweenRows = Math.max(0, Number(horizontalGap.value));
  const output = getOutputPageSizeInches();
  const foldHorizontal = outputFoldAxis.value === "horizontal";
  const sheetLayoutWidth = foldHorizontal
    ? slot.width
    : slot.width * 2 + gapAtFold;
  const sheetLayoutHeight = foldHorizontal
    ? slot.height * 2 + gapAtFold
    : slot.height;
  const requiredWidth =
    sheetLayoutWidth * pattern.sheetCols +
    gapBetweenCols * Math.max(0, pattern.sheetCols - 1);
  const requiredHeight =
    sheetLayoutHeight * pattern.sheetRows +
    gapBetweenRows * Math.max(0, pattern.sheetRows - 1);
  const offsetX = (output.width - requiredWidth) / 2;
  const offsetY = (output.height - requiredHeight) / 2;

  const sheets = Array.from(
    { length: normalizedSheetsPerOutput },
    (_, index) => {
      const sheetCol = index % pattern.sheetCols;
      const sheetRow = Math.floor(index / pattern.sheetCols);
      const x = offsetX + sheetCol * (sheetLayoutWidth + gapBetweenCols);
      const y = offsetY + sheetRow * (sheetLayoutHeight + gapBetweenRows);
      const pageA = { x, y, width: slot.width, height: slot.height };
      const pageB = foldHorizontal
        ? {
            x,
            y: y + slot.height + gapAtFold,
            width: slot.width,
            height: slot.height,
          }
        : {
            x: x + slot.width + gapAtFold,
            y,
            width: slot.width,
            height: slot.height,
          };
      return {
        x,
        y,
        width: sheetLayoutWidth,
        height: sheetLayoutHeight,
        pageA,
        pageB,
      };
    },
  );

  return {
    outputWidth: output.width,
    outputHeight: output.height,
    requiredWidth,
    requiredHeight,
    sheets,
    gapBetweenCols,
    gapBetweenRows,
    sheetLayoutWidth,
    sheetLayoutHeight,
    fits: requiredWidth <= output.width && requiredHeight <= output.height,
    foldHorizontal,
  };
});

function onSheetsPerSignatureInput(event) {
  sheetsPerSignature.value = Math.max(
    1,
    Math.floor(Number(event.target.value) || 1),
  );
}

function onNumberOfSignaturesInput(event) {
  numberOfSignatures.value = Math.max(
    1,
    Math.floor(Number(event.target.value) || 1),
  );
}

function onNumberOfPagesInput(event) {
  const next = Math.max(
    requiredPageCount.value,
    Math.floor(Number(event?.target?.value) || requiredPageCount.value),
  );
  numberOfPages.value = next;
}

function toPoints(inches) {
  return inches * 72;
}

function getOutputPageSizeInches() {
  return {
    width: Number(outputWidth.value),
    height: Number(outputHeight.value),
  };
}

function getRotatedSlotSizeInches(rotationDegrees) {
  const normalized = ((rotationDegrees % 360) + 360) % 360;
  const swapsWidthHeight = normalized === 90 || normalized === 270;

  if (swapsWidthHeight) {
    return { width: pageHeight.value, height: pageWidth.value };
  }

  return { width: pageWidth.value, height: pageHeight.value };
}

function getLayoutSlotForGridInches(rotationDegreesValue) {
  if (outputFoldAxis.value === "vertical") {
    return getRotatedSlotSizeInches(0);
  }
  return getRotatedSlotSizeInches(rotationDegreesValue);
}

function revokeCombinedPdfUrl() {
  if (combinedPdfUrl.value) {
    URL.revokeObjectURL(combinedPdfUrl.value);
    combinedPdfUrl.value = "";
  }
}

const combinedPdfPageCount = computed(() => impositionOutputs.value.length * 2);
const rasterizeProgressPercent = computed(() => {
  if (rasterizeProgressTotal.value <= 0) {
    return 0;
  }
  return Math.round(
    (rasterizeProgressCurrent.value / rasterizeProgressTotal.value) * 100,
  );
});
const pdfOutputState = computed(() => ({
  isGeneratingPdf: isGeneratingPdf.value,
  pdfError: pdfError.value,
  combinedPdfUrl: combinedPdfUrl.value,
  combinedPdfPageCount: combinedPdfPageCount.value,
  rasterizeProgressCurrent: rasterizeProgressCurrent.value,
  rasterizeProgressTotal: rasterizeProgressTotal.value,
  rasterizeProgressActive: rasterizeProgressActive.value,
  rasterizeProgressPercent: rasterizeProgressPercent.value,
}));
const pdfOutputHandlers = {
  generatePdfOutput,
  downloadCombinedPdf,
};

function triggerDownload(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
}

function downloadCombinedPdf() {
  if (!combinedPdfUrl.value) {
    return;
  }

  const pageCount = impositionOutputs.value.length * 2;
  triggerDownload(
    combinedPdfUrl.value,
    `basic-weekly-astrology-output-${pageCount}p.pdf`,
  );
}

function impositionRasterRotationDegrees(plateRotationDegrees) {
  // DOM-rasterized cards need an additional 180deg correction before entering
  // the existing imposition placement flow.
  const base = Number(plateRotationDegrees) + 180;
  return ((base % 360) + 360) % 360;
}

async function rotateImageFileToPngBytes(file, rotationDegreesValue) {
  const normalized = ((Number(rotationDegreesValue) % 360) + 360) % 360;

  if (normalized === 0) {
    return file.arrayBuffer();
  }

  const imageUrl = URL.createObjectURL(file);

  try {
    const imageElement = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load source image."));
      img.src = imageUrl;
    });

    const sourceWidth = imageElement.width;
    const sourceHeight = imageElement.height;
    const swapsDimensions = normalized === 90 || normalized === 270;
    const canvas = document.createElement("canvas");
    canvas.width = swapsDimensions ? sourceHeight : sourceWidth;
    canvas.height = swapsDimensions ? sourceWidth : sourceHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas context unavailable.");
    }

    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((normalized * Math.PI) / 180);
    context.drawImage(imageElement, -sourceWidth / 2, -sourceHeight / 2);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error("Failed to convert rotated image."));
          return;
        }

        resolve(result);
      }, "image/png");
    });

    return blob.arrayBuffer();
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function embedPreparedImage(pdfDocument, file, rotationDegreesValue) {
  const normalized = ((Number(rotationDegreesValue) % 360) + 360) % 360;

  if (normalized === 0) {
    return pdfDocument.embedPng(await file.arrayBuffer());
  }

  const rotatedBytes = await rotateImageFileToPngBytes(file, normalized);
  return pdfDocument.embedPng(rotatedBytes);
}

function drawCropMarks(
  page,
  x,
  y,
  width,
  height,
  markOffsetPoints,
  markLengthPoints,
  edges,
) {
  const yTop = y + height;
  const yBottom = y;
  const xLeft = x;
  const xRight = x + width;
  const lineColor = rgb(0.1, 0.1, 0.1);
  const thickness = 0.6;

  if (edges.top) {
    page.drawLine({
      start: { x: xLeft, y: yTop + markOffsetPoints },
      end: { x: xLeft, y: yTop + markOffsetPoints + markLengthPoints },
      thickness,
      color: lineColor,
    });
    page.drawLine({
      start: { x: xRight, y: yTop + markOffsetPoints },
      end: { x: xRight, y: yTop + markOffsetPoints + markLengthPoints },
      thickness,
      color: lineColor,
    });
  }

  if (edges.bottom) {
    page.drawLine({
      start: { x: xLeft, y: yBottom - markOffsetPoints },
      end: { x: xLeft, y: yBottom - markOffsetPoints - markLengthPoints },
      thickness,
      color: lineColor,
    });
    page.drawLine({
      start: { x: xRight, y: yBottom - markOffsetPoints },
      end: { x: xRight, y: yBottom - markOffsetPoints - markLengthPoints },
      thickness,
      color: lineColor,
    });
  }

  if (edges.left) {
    page.drawLine({
      start: { x: xLeft - markOffsetPoints, y: yTop },
      end: { x: xLeft - markOffsetPoints - markLengthPoints, y: yTop },
      thickness,
      color: lineColor,
    });
    page.drawLine({
      start: { x: xLeft - markOffsetPoints, y: yBottom },
      end: { x: xLeft - markOffsetPoints - markLengthPoints, y: yBottom },
      thickness,
      color: lineColor,
    });
  }

  if (edges.right) {
    page.drawLine({
      start: { x: xRight + markOffsetPoints, y: yTop },
      end: { x: xRight + markOffsetPoints + markLengthPoints, y: yTop },
      thickness,
      color: lineColor,
    });
    page.drawLine({
      start: { x: xRight + markOffsetPoints, y: yBottom },
      end: { x: xRight + markOffsetPoints + markLengthPoints, y: yBottom },
      thickness,
      color: lineColor,
    });
  }
}

function formatInchesLabel(value) {
  const rounded = Number(value);
  if (!Number.isFinite(rounded)) {
    return "0";
  }

  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, "");
}

async function drawImpositionSide(
  page,
  pdfDocument,
  sideLayout,
  rotationDegreesValue,
) {
  const slots = sideLayout?.slots ?? [];
  const rowCount = Math.max(1, Number(sideLayout?.rowCount) || 1);
  const sheetCols = Math.max(1, Number(sideLayout?.sheetCols) || 1);
  const foldHorizontal = sideLayout?.foldAxis === "horizontal";
  const outputSize = getOutputPageSizeInches();
  const outputWidthPoints = toPoints(outputSize.width);
  const outputHeightPoints = toPoints(outputSize.height);
  const slotSize = getLayoutSlotForGridInches(rotationDegreesValue);
  const slotWidthPoints = toPoints(slotSize.width);
  const slotHeightPoints = toPoints(slotSize.height);
  const gapAtFoldPoints = 0;
  const gapBetweenColsPoints = toPoints(Math.max(0, Number(verticalGap.value)));
  const gapBetweenRowsPoints = toPoints(
    Math.max(0, Number(horizontalGap.value)),
  );

  const sheetBlockWidthPoints = foldHorizontal
    ? slotWidthPoints
    : slotWidthPoints * 2 + gapAtFoldPoints;
  const sheetBlockHeightPoints = foldHorizontal
    ? slotHeightPoints * 2 + gapAtFoldPoints
    : slotHeightPoints;

  const totalGridWidthPoints =
    sheetBlockWidthPoints * sheetCols +
    gapBetweenColsPoints * Math.max(0, sheetCols - 1);
  const totalGridHeightPoints =
    sheetBlockHeightPoints * rowCount +
    gapBetweenRowsPoints * Math.max(0, rowCount - 1);
  const startX = (outputWidthPoints - totalGridWidthPoints) / 2;
  const startY = (outputHeightPoints - totalGridHeightPoints) / 2;
  const markOffsetPoints = toPoints(cropMarkOffset.value);
  const markLengthPoints = toPoints(cropMarkLength.value);

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    const row = slot.gridRow;
    const sheetCol = slot.sheetCol;
    const pageIndexWithinSheet = slot.pageIndexWithinSheet;
    const rowFromBottom = rowCount - 1 - row;
    const cellBaseX =
      startX + sheetCol * (sheetBlockWidthPoints + gapBetweenColsPoints);
    const cellBaseY =
      startY + rowFromBottom * (sheetBlockHeightPoints + gapBetweenRowsPoints);

    let x;
    let y;
    if (foldHorizontal) {
      x = cellBaseX;
      y =
        cellBaseY + pageIndexWithinSheet * (slotHeightPoints + gapAtFoldPoints);
    } else {
      x =
        cellBaseX + pageIndexWithinSheet * (slotWidthPoints + gapAtFoldPoints);
      y = cellBaseY;
    }

    const cropTop = foldHorizontal
      ? row === 0 && pageIndexWithinSheet === 1
      : row === 0;
    const cropBottom = foldHorizontal
      ? row === rowCount - 1 && pageIndexWithinSheet === 0
      : row === rowCount - 1;
    const cropLeft = foldHorizontal
      ? sheetCol === 0
      : sheetCol === 0 && pageIndexWithinSheet === 0;
    const cropRight = foldHorizontal
      ? sheetCol === sheetCols - 1
      : sheetCol === sheetCols - 1 && pageIndexWithinSheet === 1;

    if (showCropMarks.value) {
      drawCropMarks(
        page,
        x,
        y,
        slotWidthPoints,
        slotHeightPoints,
        markOffsetPoints,
        markLengthPoints,
        {
          top: cropTop,
          bottom: cropBottom,
          left: cropLeft,
          right: cropRight,
        },
      );
    }

    if (!slot.file) {
      continue;
    }

    const rasterRotation = foldHorizontal
      ? impositionRasterRotationDegrees(rotationDegreesValue)
      : 0;
    const embeddedImage = await embedPreparedImage(
      pdfDocument,
      slot.file,
      rasterRotation,
    );
    const imageWidth = embeddedImage.width;
    const imageHeight = embeddedImage.height;
    const scale = Math.min(
      slotWidthPoints / imageWidth,
      slotHeightPoints / imageHeight,
    );
    const drawnWidth = imageWidth * scale;
    const drawnHeight = imageHeight * scale;
    const centeredX = x + (slotWidthPoints - drawnWidth) / 2;
    const centeredY = y + (slotHeightPoints - drawnHeight) / 2;

    page.drawImage(embeddedImage, {
      x: centeredX,
      y: centeredY,
      width: drawnWidth,
      height: drawnHeight,
    });
  }
}

const rasterSheetRefs = ref({});
const blankGridPrototypeRef = ref(null);

function setRasterSheetRef(sheetKey, element) {
  if (element) {
    rasterSheetRefs.value[sheetKey] = element;
    return;
  }
  delete rasterSheetRefs.value[sheetKey];
}

function setBlankGridPrototypeRef(element) {
  blankGridPrototypeRef.value = element || null;
}

async function rasterizeCalendarPages() {
  await nextTick();
  const files = [];
  reusableBlankGridFile.value = null;
  rasterizeProgressCurrent.value = 0;
  const sheets = weeklyRasterPagesForView.value;
  rasterizeProgressTotal.value = sheets.length;
  rasterizeProgressActive.value = true;

  try {
    for (let pageIndex = 0; pageIndex < sheets.length; pageIndex += 1) {
      const pageData = sheets[pageIndex];
      const card = rasterSheetRefs.value[pageData.key];
      if (!card) {
        throw new Error("Calendar page card is not ready for rasterization.");
      }

      const canvas = await html2canvas(card, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
          if (!result) {
            reject(new Error("Could not convert calendar page to image."));
            return;
          }
          resolve(result);
        }, "image/png");
      });
      files.push(
        new File(
          [blob],
          `calendar-page-${String(pageIndex + 1).padStart(4, "0")}.png`,
          {
            type: "image/png",
          },
        ),
      );
      rasterizeProgressCurrent.value = pageIndex + 1;
    }

    if (blankGridPrototypeRef.value) {
      const blankCanvas = await html2canvas(blankGridPrototypeRef.value, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const blankBlob = await new Promise((resolve, reject) => {
        blankCanvas.toBlob((result) => {
          if (!result) {
            reject(new Error("Could not convert blank grid page to image."));
            return;
          }
          resolve(result);
        }, "image/png");
      });
      reusableBlankGridFile.value = new File([blankBlob], "calendar-blank-grid.png", {
        type: "image/png",
      });
    }
  } finally {
    rasterizeProgressActive.value = false;
  }

  rasterizedPageFiles.value = files;
}

async function generatePdfOutput() {
  if (!templateMatchesCurrentInputs.value) {
    pdfError.value =
      "Please use positive whole numbers for sheets per signature and for the output layout.";
    return;
  }

  if (calendarRasterSheets.value.length === 0) {
    pdfError.value = "Choose a valid date range to create calendar pages.";
    return;
  }

  if (!layoutFit.value.fits) {
    pdfError.value =
      "Current size/orientation cannot fit the true-size layout. Try portrait orientation for 8.5 x 11 with 2.5 x 3.5 pages.";
    return;
  }

  isGeneratingPdf.value = true;
  pdfError.value = "";
  revokeCombinedPdfUrl();

  const paddingCount = blankPagesNeeded.value;
  if (paddingCount > 0) {
    weeklyPdfPaddingSheets.value = Array.from({ length: paddingCount }, (_, i) => ({
      key: `pdf-padding-blank-${i}`,
      kind: "padding-blank-grid",
    }));
    await nextTick();
  }

  try {
    await rasterizeCalendarPages();

    const outputSize = getOutputPageSizeInches();
    const pageSize = [toPoints(outputSize.width), toPoints(outputSize.height)];
    const pdf = await PDFDocument.create();

    for (const output of impositionOutputs.value) {
      const firstOutputSheetPage = pdf.addPage(pageSize);
      const secondOutputSheetPage = pdf.addPage(pageSize);
      await drawImpositionSide(
        firstOutputSheetPage,
        pdf,
        output.back,
        PLATE_BACK_ROTATION_DEG,
      );
      await drawImpositionSide(
        secondOutputSheetPage,
        pdf,
        output.front,
        PLATE_FRONT_ROTATION_DEG,
      );
    }

    const bytes = await pdf.save();
    combinedPdfUrl.value = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
  } catch (error) {
    pdfError.value =
      error instanceof Error
        ? error.message
        : "Could not generate PDF output from calendar pages.";
  } finally {
    weeklyPdfPaddingSheets.value = [];
    isGeneratingPdf.value = false;
  }
}

function buildCalendarPagesPreviewStyle() {
  const w = Math.max(0.1, Number(pageWidth.value) || 2.5);
  const h = Math.max(0.1, Number(pageHeight.value) || 3.5);
  let gridTemplateColumns;
  if (w >= 8) {
    gridTemplateColumns = "minmax(0, 1fr)";
  } else if (w >= 4.25) {
    gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  } else {
    gridTemplateColumns = "repeat(auto-fill, minmax(220px, 1fr))";
  }
  return {
    "--calendar-page-aspect-w": String(w),
    "--calendar-page-aspect-h": String(h),
    gridTemplateColumns,
  };
}

/** Inline grid + aspect vars; kept in a ref and synced via watch so DOM tracks page size inputs. */
const calendarPagesPreviewStyle = ref(buildCalendarPagesPreviewStyle());

watch([pageWidth, pageHeight], () => {
  calendarPagesPreviewStyle.value = buildCalendarPagesPreviewStyle();
});

const astrologyTimeframeLabel = computed(() => {
  const start = parseDateInput(startDate.value);
  const end = parseDateInput(endDate.value);
  if (!start || !end) {
    return "Invalid date range";
  }
  const startLabel = start.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const endLabel = end.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel} - ${endLabel}`;
});

const astrologyLocationLabel = computed(() => {
  const name = astrologyContext.value.locationName;
  if (!name) {
    return "Location not set";
  }
  const latitude = Number(astrologyContext.value.latitude);
  const longitude = Number(astrologyContext.value.longitude);
  const hasCoordinates =
    Number.isFinite(latitude) && Number.isFinite(longitude);
  const coordinateText = hasCoordinates
    ? ` (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`
    : "";
  const tz = astrologyContext.value.timeZone || "UTC";
  return `${name}${coordinateText} · ${tz}`;
});

const impositionControlForm = computed(() => ({
  signatureCalcMode: signatureCalcMode.value,
  pageWidth: pageWidth.value,
  pageHeight: pageHeight.value,
  sheetsPerSignature: sheetsPerSignature.value,
  numberOfSignatures: numberOfSignatures.value,
  outputWidth: outputWidth.value,
  outputHeight: outputHeight.value,
  verticalGap: verticalGap.value,
  horizontalGap: horizontalGap.value,
  showCropMarks: showCropMarks.value,
  cropMarkOffset: cropMarkOffset.value,
  cropMarkLength: cropMarkLength.value,
  numberOfPages: numberOfPages.value,
  outputFoldAxis: outputFoldAxis.value,
}));

const impositionControlSummary = computed(() => ({
  uploadedPageCount: uploadedPageCount.value,
  effectivePageCount: effectivePageCount.value,
  usingManualPageCount: usingManualPageCount.value,
  sheetsPerOutputCount: sheetsPerOutputCount.value,
  outputLayoutCols: outputLayoutCols.value,
  outputLayoutRows: outputLayoutRows.value,
  pagesPerSignature: pagesPerSignature.value,
  totalCapacityPages: totalCapacityPages.value,
  blankPagesNeeded: blankPagesNeeded.value,
}));

const impositionControlLayout = computed(() => ({
  outputLayoutGridMax: OUTPUT_LAYOUT_GRID_MAX,
  layoutCellInDragPreview,
  layoutCellCommitted,
  layoutPreview: layoutPreview.value,
  layoutFit: layoutFit.value,
  formatInchesLabel,
}));

const impositionControlHandlers = {
  onNumberOfPagesInput,
  onSheetsPerSignatureInput,
  onNumberOfSignaturesInput,
  onOutputLayoutPointerDown,
  onOutputLayoutPointerEnter,
};

const moonPhasePngUrlByTithi = (() => {
  const pngModules = import.meta.glob("../assets/moons/*.png", {
    eager: true,
    query: "?url",
    import: "default",
  });
  const byNumber = {};
  for (const [path, url] of Object.entries(pngModules)) {
    const match = path.match(/(\d+)\.png$/i);
    if (match) {
      byNumber[Number(match[1])] = url;
    }
  }
  return byNumber;
})();

function moonIconSrc(tithiNumber) {
  if (typeof tithiNumber !== "number" || tithiNumber < 1 || tithiNumber > 30) {
    return "";
  }
  return moonPhasePngUrlByTithi[tithiNumber] ?? "";
}

function dayTithiDetails(dateKey) {
  return (
    astrologyTithisByDate.value?.[dateKey] ?? {
      primaryTithi: null,
      tithiNumbers: [],
      hourCounts: {},
    }
  );
}

function dayHasEclipse(dateKey) {
  const events = astrologyEventsByDate.value?.[dateKey] ?? [];
  return events.some((event) => {
    const label = String(event?.mainLabel || "").toLowerCase();
    return label.includes("solar eclipse") || label.includes("lunar eclipse");
  });
}

function signElementClass(signName) {
  const map = {
    Aries: "sign-fire",
    Leo: "sign-fire",
    Sagittarius: "sign-fire",
    Taurus: "sign-earth",
    Virgo: "sign-earth",
    Capricorn: "sign-earth",
    Gemini: "sign-air",
    Libra: "sign-air",
    Aquarius: "sign-air",
    Cancer: "sign-water",
    Scorpio: "sign-water",
    Pisces: "sign-water",
  };
  return map[signName] || "";
}

function dayFooterSunMoonGlyphs(dateKey) {
  const entry = dayTithiDetails(dateKey).sunMoon;
  if (!entry?.sunSign || !entry?.moonSign) {
    return null;
  }

  return {
    sun: {
      planetKey: planetKeys.Sun || "",
      zodiacKey: zodiacKeys[entry.sunSign] || "",
      planetUnicode: planetUnicodeFallback.sun || "",
      zodiacUnicode: zodiacUnicodeFallback[entry.sunSign] || "",
      elementClass: signElementClass(entry.sunSign),
    },
    moon: {
      planetKey: planetKeys.Moon || "",
      zodiacKey: zodiacKeys[entry.moonSign] || "",
      planetUnicode: planetUnicodeFallback.moon || "",
      zodiacUnicode: zodiacUnicodeFallback[entry.moonSign] || "",
      elementClass: signElementClass(entry.moonSign),
    },
  };
}

function primaryTithiStep(dateKey) {
  const primary = dayTithiDetails(dateKey).primaryTithi;
  if (typeof primary !== "number") return null;
  return getMoonTithiStep(primary);
}

function onAstrologyEventsByDateUpdate(nextEventsByDate) {
  astrologyEventsByDate.value = nextEventsByDate ?? {};
}

function onAstrologyContextUpdate(nextContext) {
  astrologyContext.value = nextContext ?? astrologyContext.value;
}

function onAstrologyTithisByDateUpdate(nextTithisByDate) {
  astrologyTithisByDate.value = nextTithisByDate ?? {};
}

function onImpositionControlFieldUpdate({ key, value }) {
  switch (key) {
    case "signatureCalcMode":
      signatureCalcMode.value = value;
      break;
    case "pageWidth":
      pageWidth.value = value;
      break;
    case "pageHeight":
      pageHeight.value = value;
      break;
    case "outputWidth":
      outputWidth.value = value;
      break;
    case "outputHeight":
      outputHeight.value = value;
      break;
    case "verticalGap":
      verticalGap.value = value;
      break;
    case "horizontalGap":
      horizontalGap.value = value;
      break;
    case "showCropMarks":
      showCropMarks.value = value;
      break;
    case "cropMarkOffset":
      cropMarkOffset.value = value;
      break;
    case "cropMarkLength":
      cropMarkLength.value = value;
      break;
    case "outputFoldAxis":
      outputFoldAxis.value = value;
      break;
    default:
      break;
  }
}

function parseDateInput(value) {
  if (!value) {
    return null;
  }
  const [year, month, day] = String(value).split("-").map(Number);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
</script>

<template>
  <main class="page">
    <section class="card">
      <div class="calendar-header">
        <h1>Basic Weekly Astrology Calendar</h1>
        <RouterLink class="small-button" to="/calendars"
          >Back to Calendars</RouterLink
        >
      </div>
      <p class="subtitle">
        Build one DOM card per day in a date range, rasterize those cards, and
        run them through the existing imposition engine.
      </p>

      <div class="grid date-range-grid">
        <label class="field" for="basic-calendar-start-date">
          <span>Start Date</span>
          <input
            id="basic-calendar-start-date"
            v-model="startDate"
            name="basic-calendar-start-date"
            type="date"
          />
        </label>
        <label class="field" for="basic-calendar-end-date">
          <span>End Date</span>
          <input
            id="basic-calendar-end-date"
            v-model="endDate"
            name="basic-calendar-end-date"
            type="date"
          />
        </label>
      </div>

      <SignatureImpositionControls
        :form="impositionControlForm"
        :summary="impositionControlSummary"
        :layout="impositionControlLayout"
        :handlers="impositionControlHandlers"
        @update:field="onImpositionControlFieldUpdate"
      />

      <AstrologyEventsPanel
        :start-date="startDate"
        :end-date="endDate"
        @update:eventsByDate="onAstrologyEventsByDateUpdate"
        @update:context="onAstrologyContextUpdate"
        @update:tithisByDate="onAstrologyTithisByDateUpdate"
      />

      <PdfOutputActions :state="pdfOutputState" :handlers="pdfOutputHandlers" />

      <section class="calendar-pages-section">
        <h2>Calendar DOM Pages</h2>
        <p class="calendar-pages-context">
          <strong>Current location:</strong> {{ astrologyLocationLabel }}
          <span class="calendar-pages-context-separator">|</span>
          <strong>Timeframe:</strong> {{ astrologyTimeframeLabel }}
        </p>
        <p class="note">
          Each raster page is one side of the weekly spread (banner + Mon–Wed or
          Thu–Sun) at the page aspect ratio for PDF generation.
        </p>
        <div class="calendar-pages-grid" :style="calendarPagesPreviewStyle">
          <article
            v-for="sheet in weeklyRasterPagesForView"
            :key="sheet.key"
            :ref="(el) => setRasterSheetRef(sheet.key, el)"
            :class="[
              'weekly-raster-sheet',
              sheet.kind === 'week-sheet' || sheet.kind === 'padding-blank-grid'
                ? ''
                : 'calendar-page--cover',
              rasterizeProgressActive ? 'weekly-raster-sheet--rasterizing' : '',
            ]"
          >
            <section
              v-if="sheet.kind === 'cover-front'"
              :class="[
                'calendar-cover-page',
                'calendar-cover-page--front',
                rasterizeProgressActive ? 'calendar-cover-page--rasterizing' : '',
              ]"
            >
              <p class="calendar-cover-title">{{ sheet.coverTitle }}</p>
              <div class="calendar-cover-footer">
                <p class="calendar-cover-line">{{ sheet.locationLine }}</p>
                <p v-if="sheet.natalLine" class="calendar-cover-line">
                  {{ sheet.natalLine }}
                </p>
              </div>
            </section>
            <section
              v-else-if="sheet.kind === 'cover-back'"
              :class="[
                'calendar-cover-page',
                'calendar-cover-page--back',
                rasterizeProgressActive ? 'calendar-cover-page--rasterizing' : '',
              ]"
            >
              <div class="calendar-cover-footer">
                <p class="calendar-cover-line">{{ sheet.imprintText }}</p>
              </div>
            </section>
            <div
              v-else-if="sheet.kind === 'padding-blank-grid'"
              class="weekly-grid"
            >
              <div class="weekly-blank-page" aria-hidden="true" />
            </div>
            <div v-else class="weekly-grid" :class="`weekly-grid--${sheet.side}`">
              <div
                v-if="sheet.isTotallyBlank"
                class="weekly-blank-page"
                aria-hidden="true"
              />
              <div
                v-else
                v-for="cell in sheet.placements"
                :key="`${sheet.key}-${cell.area}`"
                :class="[
                  'weekly-cell',
                  `weekly-cell--${cell.area}`,
                  cell.kind === 'day' && !cell.day ? 'weekly-cell--empty' : '',
                ]"
              >
                <template v-if="cell.kind === 'banner'">
                  <div class="week-banner-inner">
                    <p class="week-banner-month">{{ sheet.bannerText }}</p>
                    <p class="week-banner-weeknum">{{ sheet.weekFraction }}</p>
                  </div>
                </template>
                <div
                  v-else-if="cell.kind === 'day' && !cell.day"
                  class="weekly-day-placeholder"
                  aria-hidden="true"
                />
                <div
                  v-else-if="cell.day"
                  class="weekly-day-inner calendar-page--day"
                >
                  <header class="day-page-header">
                    <p class="header-day">
                      {{ cell.day.dayNumber }} {{ cell.day.dayLongLabel }}
                    </p>
                    <span
                      v-if="primaryTithiStep(cell.day.key)"
                      class="tithi-tag tithi-tag--day-corner"
                      :class="`tithi-tag--${primaryTithiStep(cell.day.key)?.colorKey}`"
                      :title="`Tithi ${dayTithiDetails(cell.day.key).primaryTithi} (${primaryTithiStep(cell.day.key)?.name})`"
                    >
                      {{ primaryTithiStep(cell.day.key)?.name }}
                    </span>
                  </header>
                  <ul class="event-list event-list--day">
                    <li
                      v-for="event in cell.day.events"
                      :key="event.id"
                      class="event-block"
                    >
                      <div class="weekly-event-symbols-row">
                        <div
                          v-if="event.glyphRows.length === 2"
                          class="event-glyphs event-glyphs--day-lead event-glyphs--aspect-inline"
                        >
                          <div
                            class="glyph-row"
                            :class="event.glyphRows[0].elementClass"
                          >
                            <span class="glyph-char">{{
                              event.glyphRows[0].planetKey ||
                              event.glyphRows[0].planetUnicode
                            }}</span>
                            <span class="glyph-row-degree">{{
                              event.glyphRows[0].degree
                            }}</span>
                            <span class="glyph-char">{{
                              event.glyphRows[0].zodiacKey ||
                              event.glyphRows[0].zodiacUnicode
                            }}</span>
                          </div>
                          <span
                            v-if="event.aspectPhysisKey"
                            class="glyph-aspect-char"
                            aria-hidden="true"
                            >{{ event.aspectPhysisKey }}</span
                          >
                          <div
                            class="glyph-row"
                            :class="event.glyphRows[1].elementClass"
                          >
                            <span class="glyph-char">{{
                              event.glyphRows[1].planetKey ||
                              event.glyphRows[1].planetUnicode
                            }}</span>
                            <span class="glyph-row-degree">{{
                              event.glyphRows[1].degree
                            }}</span>
                            <span class="glyph-char">{{
                              event.glyphRows[1].zodiacKey ||
                              event.glyphRows[1].zodiacUnicode
                            }}</span>
                          </div>
                        </div>
                        <div
                          v-else-if="event.glyphRows.length"
                          class="event-glyphs event-glyphs--day-lead"
                        >
                          <div
                            v-for="(row, rowIndex) in event.glyphRows"
                            :key="`${event.id}-glyph-${rowIndex}`"
                            class="glyph-row"
                            :class="row.elementClass"
                          >
                            <span class="glyph-char">{{
                              row.planetKey || row.planetUnicode
                            }}</span>
                            <span class="glyph-row-degree">{{
                              row.degree
                            }}</span>
                            <span class="glyph-char">{{
                              row.zodiacKey || row.zodiacUnicode
                            }}</span>
                          </div>
                        </div>
                        <p v-if="event.timestamp" class="event-time">
                          {{ event.timestamp }}
                        </p>
                      </div>
                      <div class="event-title-row weekly-event-title-row">
                        <p
                          class="event-title"
                          :class="{
                            'event-title--natal':
                              event.eventType === 'natal transit',
                          }"
                        >
                          {{ event.mainLabel }}
                        </p>
                      </div>
                    </li>
                  </ul>
                  <footer class="page-day-footer">
                    <div
                      v-if="dayFooterSunMoonGlyphs(cell.day.key)"
                      class="page-day-footer-glyphs"
                      aria-label="Sun and Moon at local noon"
                    >
                      <span
                        class="page-day-footer-pair"
                        :class="
                          dayFooterSunMoonGlyphs(cell.day.key).sun.elementClass
                        "
                      >
                        <span class="glyph-char">{{
                          dayFooterSunMoonGlyphs(cell.day.key).sun.planetKey ||
                          dayFooterSunMoonGlyphs(cell.day.key).sun.planetUnicode
                        }}</span>
                        <span class="glyph-char">{{
                          dayFooterSunMoonGlyphs(cell.day.key).sun.zodiacKey ||
                          dayFooterSunMoonGlyphs(cell.day.key).sun.zodiacUnicode
                        }}</span>
                      </span>
                      <span
                        class="page-day-footer-pair"
                        :class="
                          dayFooterSunMoonGlyphs(cell.day.key).moon.elementClass
                        "
                      >
                        <span class="glyph-char">{{
                          dayFooterSunMoonGlyphs(cell.day.key).moon.planetKey ||
                          dayFooterSunMoonGlyphs(cell.day.key).moon.planetUnicode
                        }}</span>
                        <span class="glyph-char">{{
                          dayFooterSunMoonGlyphs(cell.day.key).moon.zodiacKey ||
                          dayFooterSunMoonGlyphs(cell.day.key).moon.zodiacUnicode
                        }}</span>
                      </span>
                    </div>
                    <span
                      v-if="dayTithiDetails(cell.day.key).primaryTithi"
                      class="page-moon-wrap page-moon-wrap--footer"
                      :class="{
                        'page-moon-wrap--eclipse': dayHasEclipse(cell.day.key),
                      }"
                    >
                      <img
                        v-if="
                          moonIconSrc(dayTithiDetails(cell.day.key).primaryTithi)
                        "
                        class="page-moon-icon page-moon-icon--footer"
                        width="14"
                        height="14"
                        :src="
                          moonIconSrc(dayTithiDetails(cell.day.key).primaryTithi)
                        "
                        alt=""
                        :title="`Primary tithi ${dayTithiDetails(cell.day.key).primaryTithi}`"
                      />
                    </span>
                  </footer>
                </div>
              </div>
            </div>
          </article>
        </div>
        <article
          :ref="setBlankGridPrototypeRef"
          class="weekly-raster-sheet weekly-raster-sheet--prototype"
          aria-hidden="true"
        >
          <div class="weekly-grid">
            <div class="weekly-blank-page" />
          </div>
        </article>
      </section>
    </section>
  </main>
</template>

<style scoped>
.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.date-range-grid {
  margin-bottom: 1rem;
}

.calendar-pages-section {
  margin-top: 1rem;
  margin-bottom: 1rem;
}

.calendar-pages-context {
  margin: 0.4rem 0 0.4rem;
  font-size: 0.88rem;
  color: #3f4451;
}

.calendar-pages-context-separator {
  margin: 0 0.45rem;
  color: #8a909e;
}

.calendar-pages-grid {
  display: grid;
  gap: 0.75rem;
}

.weekly-raster-sheet {
  position: relative;
  width: 100%;
  min-width: 0;
  border: 1px solid #d4d7df;
  border-radius: 10px;
  background: #ffffff;
  padding: 0.25in;
  aspect-ratio: var(--calendar-page-aspect-w) / var(--calendar-page-aspect-h);
  height: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: visible;
  box-sizing: border-box;
  font-family: Inter, "Avenir Next", Avenir, "Segoe UI", Roboto, sans-serif;
}

.weekly-raster-sheet--rasterizing {
  border: 0 !important;
  outline: none;
  box-shadow: none;
  /* html2canvas can leave a hairline at rounded corners when the inner block
     does not fill the flex column; clip and square corners for capture only. */
  border-radius: 0;
  overflow: hidden;
}

.calendar-page--cover {
  padding: 0.75rem;
}

.calendar-cover-page {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.calendar-cover-page--rasterizing {
  border: 0;
  outline: none;
  box-shadow: none;
  background-color: #ffffff;
}

.calendar-cover-title {
  margin: 0;
  font-size: clamp(1.25rem, 3.6vw, 2.1rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.2;
}

.calendar-cover-footer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
}

.calendar-cover-line {
  margin: 0;
  font-size: 0.6rem;
  line-height: 1.2;
  color: #5b5f69;
  text-align: center;
}

.weekly-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  gap: 0;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.weekly-blank-page {
  grid-column: 1 / -1;
  grid-row: 1 / -1;
  min-width: 0;
  min-height: 0;
  background-color: #ffffff;
  background-image:
    linear-gradient(to right, #f2f1e8 1px, transparent 1px),
    linear-gradient(to bottom, #f2f1e8 1px, transparent 1px);
  background-size: 0.125in 0.125in;
}

.weekly-raster-sheet--prototype {
  position: fixed;
  left: -200vw;
  top: -200vh;
  opacity: 0;
  pointer-events: none;
  z-index: -1;
}

.weekly-grid--left {
  grid-template-areas:
    "banner tue"
    "mon wed";
}

.weekly-grid--right {
  grid-template-areas:
    "thu sat"
    "fri sun";
}

.weekly-cell {
  position: relative;
  min-height: 0;
  min-width: 0;
  border-radius: 0;
  border: 0;
  background: #fafbfc;
  overflow: hidden;
}

.weekly-cell--banner {
  grid-area: banner;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  text-align: left;
  padding: 0.35rem 0.5rem;
  background-color: #ffffff;
  background-image:
    linear-gradient(to right, #f2f1e8 1px, transparent 1px),
    linear-gradient(to bottom, #f2f1e8 1px, transparent 1px);
  background-size: 0.125in 0.125in;
}

.weekly-cell--mon {
  grid-area: mon;
}

.weekly-cell--tue {
  grid-area: tue;
}

.weekly-cell--wed {
  grid-area: wed;
}

.weekly-cell--thu {
  grid-area: thu;
}

.weekly-cell--fri {
  grid-area: fri;
}

.weekly-cell--sat {
  grid-area: sat;
}

.weekly-cell--sun {
  grid-area: sun;
}

.weekly-cell--empty {
  background-color: #ffffff;
  background-image:
    linear-gradient(to right, #f2f1e8 1px, transparent 1px),
    linear-gradient(to bottom, #f2f1e8 1px, transparent 1px);
  background-size: 0.125in 0.125in;
}

.weekly-cell--empty .weekly-day-placeholder {
  height: 100%;
  min-height: 0;
  background-image:
    linear-gradient(to right, #f2f1e8 1px, transparent 1px),
    linear-gradient(to bottom, #f2f1e8 1px, transparent 1px);
  background-size: 0.125in 0.125in;
}

/* Draw only the center cross, not the outer page edges. */
.weekly-cell--banner,
.weekly-cell--thu {
  border-right: 1px solid #000000;
  border-bottom: 1px solid #000000;
}

.weekly-cell--tue,
.weekly-cell--sat {
  border-bottom: 1px solid #000000;
}

.weekly-cell--mon,
.weekly-cell--fri {
  border-right: 1px solid #000000;
}

/* Blank filler cells should not draw black cross borders. */
.weekly-cell--empty {
  border-right: 0;
  border-bottom: 0;
}

.week-banner-inner {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 0.2rem;
  width: 100%;
  height: 100%;
}

.week-banner-month {
  margin: 0;
  font-family: var(--font-saira);
  font-size: clamp(0.72rem, 2.2vw, 1rem);
  font-weight: 800;
  letter-spacing: 0.08em;
  line-height: 1.15;
  color: #1a1d24;
  white-space: pre-line;
}

.week-banner-weeknum {
  margin: 0;
  font-size: clamp(0.62rem, 1.8vw, 0.82rem);
  font-weight: 600;
  letter-spacing: 0.12em;
  color: #5c6475;
}

.weekly-day-placeholder {
  height: 100%;
  min-height: 2.5rem;
}

.weekly-day-inner {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.35rem 0.4rem 0.4rem;
  box-sizing: border-box;
  background: #ffffff;
  overflow: hidden;
}

.weekly-day-inner .day-page-header {
  margin-bottom: 0.2rem;
}

.weekly-day-inner .header-day {
  font-size: clamp(0.62rem, 1.4vw, 0.78rem);
}

.weekly-day-inner .tithi-tag--day-corner {
  font-size: clamp(0.62rem, 1.4vw, 0.78rem);
  padding-top: 0;
}

.weekly-day-inner .event-list--day {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: calc(1.1rem + 14px);
}

.weekly-day-inner .event-block {
  font-size: 0.72rem;
  min-height: 0;
  max-height: none;
}

.weekly-day-inner .glyph-row {
  font-size: 0.72rem;
}

.weekly-day-inner .glyph-char {
  font-size: 0.85rem;
}

.weekly-day-inner .event-title {
  font-size: 0.72rem;
}

.weekly-day-inner .page-day-footer {
  right: 0.35rem;
  bottom: 0.3rem;
  gap: 0.45rem;
}

.weekly-day-inner .page-day-footer .glyph-char {
  font-size: 1.05rem;
}

.weekly-day-inner .event-block > .weekly-event-symbols-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: baseline;
  justify-content: flex-start;
  gap: 0.35rem;
  width: 100%;
  min-width: 0;
  flex: 0 0 auto;
  min-height: 1lh;
  max-height: 2lh;
  overflow: hidden;
}

.weekly-day-inner .weekly-event-symbols-row .event-glyphs {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  width: auto;
  max-width: 100%;
}

.weekly-day-inner .weekly-event-symbols-row .event-glyphs--aspect-inline {
  width: auto;
  max-width: 100%;
}

.weekly-day-inner .weekly-event-symbols-row .event-time {
  flex-shrink: 0;
  margin: 0 0 0 auto;
  align-self: baseline;
  line-height: 1.2;
}

.weekly-day-inner .event-block > .weekly-event-title-row {
  display: block;
  width: 100%;
  flex: 0 0 auto;
  max-height: none;
  overflow: visible;
}

.weekly-day-inner .weekly-event-title-row .event-title {
  flex: none;
  width: 100%;
  max-width: 100%;
  display: block;
  -webkit-line-clamp: unset;
  line-clamp: unset;
  -webkit-box-orient: initial;
  overflow: visible;
}

.weekly-day-inner .page-moon-wrap.page-moon-wrap--footer {
  width: 22px;
  height: 22px;
}

.weekly-day-inner .page-moon-icon.page-moon-icon--footer {
  width: 20px;
  height: 20px;
}

.weekly-day-inner .page-moon-wrap--eclipse {
  border-width: 1.5px;
}

.day-page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
  width: 100%;
  margin-bottom: 0.35rem;
}

.header-day {
  margin: 0;
  font-size: clamp(1.05rem, 2.8vw, 1.45rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.1;
}

.tithi-tag {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  user-select: none;
  min-width: 1.35rem;
  text-align: center;
}

.tithi-tag--day-corner {
  font-size: clamp(0.78rem, 2vw, 0.95rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.2;
  padding-top: 0.12rem;
}

.tithi-tag--blue {
  color: #005eff;
}

.tithi-tag--green {
  color: #118b36;
}

.tithi-tag--red {
  color: #d40000;
}

.calendar-day-iso {
  margin: 0 0 0.35rem;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
  font-size: 0.72rem;
  line-height: 1.25;
  color: #535a69;
  overflow-wrap: anywhere;
}

.event-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.event-list--day {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1 0 auto;
  overflow: visible;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  align-content: flex-start;
  gap: 0;
  padding-bottom: calc(3rem + 40px + 0.35rem);
}

.event-block {
  display: flex;
  flex-direction: column;
  gap: 0;
  flex: none;
  font-size: 0.98rem;
  line-height: 1.22;
  height: auto;
  min-height: 2lh;
  max-height: 3lh;
  box-sizing: border-box;
  overflow: hidden;
  border-bottom: 1px solid #e6e6e6;
  padding: 0;
}

.event-block:last-of-type {
  border-bottom: none;
}

.event-block:has(> .event-title-row:only-child) {
  height: auto;
  min-height: 1lh;
  max-height: 2lh;
}

.event-block > .event-glyphs--day-lead {
  flex: 0 0 1lh;
  height: 1lh;
  min-height: 1lh;
  max-height: 1lh;
  overflow: hidden;
  flex-wrap: nowrap;
  align-items: center;
  padding: 0;
}

.event-block > .event-title-row {
  flex: 0 0 auto;
  height: auto;
  min-height: 1lh;
  max-height: 2lh;
  overflow: hidden;
  align-items: flex-start;
  padding: 0;
}

.event-glyphs--day-lead {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.35rem 1.35rem;
  align-items: baseline;
  justify-content: flex-start;
}

.event-glyphs--aspect-inline {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 0.35rem 0.5rem;
  align-items: baseline;
  justify-content: flex-start;
  width: 100%;
}

.event-glyphs--aspect-inline .glyph-row {
  flex: 0 1 auto;
  min-width: 0;
}

.glyph-aspect-char {
  font-family: Physis, serif;
  font-size: 1.05rem;
  font-weight: 600;
  color: #111111;
  line-height: 1;
  flex-shrink: 0;
  padding: 0 0.1rem;
}

.glyph-row {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  white-space: nowrap;
  font-size: 0.98rem;
  font-weight: 600;
}

.glyph-char {
  font-size: 1.15rem;
  font-family: Physis, serif;
  line-height: 1;
}

.glyph-row-degree {
  font-weight: 700;
}

.calendar-page--day .glyph-row-degree {
  font-weight: 500;
}

.event-title-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  width: 100%;
}

.event-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 0.98rem;
  font-weight: 500;
  color: #000000;
  line-height: 1.22;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.event-title--natal {
  font-weight: 650;
}

.event-time {
  margin: 0;
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 400;
  color: #8a8a8a;
  letter-spacing: 0.02em;
}

.page-day-footer {
  position: absolute;
  right: 0.85rem;
  bottom: 0.85rem;
  left: auto;
  margin-top: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 1.7rem;
  padding-top: 0;
  z-index: 1;
}

.page-day-footer-glyphs {
  display: inline-flex;
  align-items: baseline;
  gap: 0.7rem;
}

.page-day-footer-pair {
  display: inline-flex;
  align-items: baseline;
  gap: 0.12rem;
  font-weight: 600;
}

.page-day-footer .glyph-char {
  font-family: Physis, serif;
  font-size: 1.9rem;
  line-height: 1;
}

.page-moon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  box-sizing: border-box;
}

.page-moon-wrap--eclipse {
  border: 3px solid #ff6b6b;
  background-color: transparent;
}

.page-moon-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  object-fit: contain;
  border-radius: 50%;
  display: block;
}

.page-moon-wrap.page-moon-wrap--footer {
  width: 44px;
  height: 44px;
}

.page-moon-icon.page-moon-icon--footer {
  width: 40px;
  height: 40px;
}

.sign-fire {
  color: #d40000;
}

.sign-water {
  color: #005eff;
}

.sign-earth {
  color: #118b36;
}

.sign-air {
  color: #6e31d8;
}
</style>
