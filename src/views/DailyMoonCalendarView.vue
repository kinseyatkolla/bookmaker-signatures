<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import html2canvas from "html2canvas";
import { PDFDocument } from "pdf-lib";
import { buildImpositionOutputs } from "../imposition/helpers";
import {
  embedPreparedImage,
  formatInchesLabel,
  getSheetCreepOffsetPoints,
  toPoints,
} from "../imposition/pdfUtils";
import { renderImpositionSide } from "../imposition/pdfRender";
import {
  calibratePreviewScale,
  loadPreviewPhysicalScale,
  savePreviewPhysicalScale,
} from "../imposition/previewCalibration";
import {
  buildDomPreviewContentFrameStyle,
  DEFAULT_DOM_PREVIEW_MARGIN_IN,
} from "../imposition/domPreviewMargins";
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

const props = defineProps({
  pageTitle: {
    type: String,
    default: "Daily Moon Calendar",
  },
  defaultPageWidth: {
    type: Number,
    default: 2,
  },
  defaultPageHeight: {
    type: Number,
    default: 4,
  },
  defaultOutputLayoutCols: {
    type: Number,
    default: 2,
  },
  defaultOutputLayoutRows: {
    type: Number,
    default: 2,
  },
  defaultOutputFoldAxis: {
    type: String,
    default: "horizontal",
  },
  defaultHorizontalGap: {
    type: Number,
    default: 0,
  },
  defaultVerticalGap: {
    type: Number,
    default: 0,
  },
  isMoonCalendarMode: {
    type: Boolean,
    default: true,
  },
});

const today = new Date();
const plusThirty = new Date(today);
plusThirty.setDate(today.getDate() + 30);

const startDate = ref(toDateInputValue(today));
const endDate = ref(toDateInputValue(plusThirty));
const coverTitleOverride = ref("");

const sheetsPerSignature = ref(4);
const numberOfSignatures = ref(1);
const signatureCalcMode = ref("sheets-fixed");
const outputWidth = ref(8.5);
const outputHeight = ref(11);
const pageWidth = ref(props.defaultPageWidth);
const pageHeight = ref(props.defaultPageHeight);
const outputLayoutCols = ref(props.defaultOutputLayoutCols);
const outputLayoutRows = ref(props.defaultOutputLayoutRows);
const outputFoldAxis = ref(props.defaultOutputFoldAxis);
const OUTPUT_LAYOUT_GRID_MAX = 8;
const layoutSelectDragging = ref(false);
const layoutSelectAnchor = ref({ col: 0, row: 0 });
const layoutSelectEnd = ref({ col: 0, row: 0 });
const PLATE_FRONT_ROTATION_DEG = 90;
const PLATE_BACK_ROTATION_DEG = -90;
const cropMarkOffset = ref(0.08);
const cropMarkLength = ref(0.18);
const showCropMarks = ref(true);
const bleedTop = ref(0);
const bleedRight = ref(0.25);
const bleedBottom = ref(0);
const bleedLeft = ref(0.25);
const horizontalGap = ref(props.defaultHorizontalGap);
const verticalGap = ref(props.defaultVerticalGap);
const domPreviewMarginTop = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const domPreviewMarginRight = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const domPreviewMarginBottom = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const domPreviewMarginLeft = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const isGeneratingPdf = ref(false);
const pdfError = ref("");
const combinedPdfUrl = ref("");
const PAGE_DEPTH_INCHES = 0.25 / 25;
const rasterizedPageFiles = ref([]);
const rasterizeProgressCurrent = ref(0);
const rasterizeProgressTotal = ref(0);
const rasterizeProgressActive = ref(false);
const PREVIEW_CALIBRATION_REFERENCE_INCHES = 2;
const previewTrueSizeEnabled = ref(true);
const previewPhysicalScale = ref(loadPreviewPhysicalScale());
const previewMeasuredInches = ref(String(PREVIEW_CALIBRATION_REFERENCE_INCHES));
const astrologyEventsByDate = ref({});
const astrologyTithisByDate = ref({});
const astrologyEclipsesByDate = ref({});
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

const dayCalendarPages = computed(() => {
  const start = parseDateInput(startDate.value);
  const end = parseDateInput(endDate.value);

  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }

  const pages = [];
  const cursor = new Date(start);
  cursor.setHours(12, 0, 0, 0);

  while (cursor.getTime() <= end.getTime()) {
    const current = new Date(cursor);
    pages.push({
      key: toDateInputValue(current),
      dayNumber: current.getDate(),
      dayShortLabel: current
        .toLocaleString("en-US", { weekday: "short" })
        .toUpperCase(),
      dayLongLabel: current
        .toLocaleString("en-US", { weekday: "long" })
        .toUpperCase(),
      fullDateLabel: current.toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      }),
      isoStamp: current.toISOString(),
      events: astrologyEventsByDate.value[toDateInputValue(current)] ?? [],
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return pages;
});

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

const calendarRasterPages = computed(() => {
  const start = parseDateInput(startDate.value);
  const end = parseDateInput(endDate.value);
  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }

  const locationLine = formatCoverLocationName(
    astrologyContext.value.locationName,
  );
  const natalLine = hasNatalTransits.value
    ? formatNatalCoverLine(
        astrologyContext.value.birthDateTime,
        astrologyContext.value.birthLocationName,
      )
    : "";
  const coverTitle =
    String(coverTitleOverride.value || "").trim() ||
    formatTimeframeCoverTitle(start, end);

  return [
    {
      key: "cover-front",
      kind: "cover-front",
      coverTitle,
      locationLine,
      natalLine,
    },
    ...dayCalendarPages.value.map((page) => ({ ...page, kind: "day" })),
    {
      key: "cover-back",
      kind: "cover-back",
      imprintText: "GARLAND CALENDARS",
    },
  ];
});

const requiredPageCount = computed(() => calendarRasterPages.value.length);
const numberOfPages = ref(requiredPageCount.value);
const uploadedPageCount = computed(() => 0);
const effectivePageCount = computed(() =>
  Math.max(
    requiredPageCount.value,
    Math.floor(Number(numberOfPages.value) || 0),
  ),
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

function buildSheetSlot(signatureOffset, relativePageNumber) {
  const absolutePageNumber = signatureOffset + relativePageNumber;
  const required = requiredPageCount.value;
  const hasCovers = required >= 2;
  const backCoverSourceIndex = required - 1;
  const contentPageCount = Math.max(0, required - 1);
  const insertedBlankCount = blankPagesNeeded.value;
  const backCoverTargetPageNumber = contentPageCount + insertedBlankCount + 1;
  let sourceIndex = absolutePageNumber - 1;
  if (hasCovers) {
    if (absolutePageNumber <= contentPageCount) {
      sourceIndex = absolutePageNumber - 1;
    } else if (absolutePageNumber === backCoverTargetPageNumber) {
      sourceIndex = backCoverSourceIndex;
    } else {
      sourceIndex = -1;
    }
  }
  const imageFile =
    sourceIndex >= 0 ? (rasterizedPageFiles.value[sourceIndex] ?? null) : null;
  const hasSourcePage = absolutePageNumber <= effectivePageCount.value;
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

function applyPreviewCalibration() {
  const measured = Number(previewMeasuredInches.value);
  if (!Number.isFinite(measured) || measured <= 0) {
    return;
  }
  previewPhysicalScale.value = calibratePreviewScale({
    currentScale: previewPhysicalScale.value,
    expectedInches: PREVIEW_CALIBRATION_REFERENCE_INCHES,
    measuredInches: measured,
  });
  savePreviewPhysicalScale(previewPhysicalScale.value);
}

function resetPreviewCalibration() {
  previewPhysicalScale.value = 1;
  previewMeasuredInches.value = String(PREVIEW_CALIBRATION_REFERENCE_INCHES);
  savePreviewPhysicalScale(previewPhysicalScale.value);
}

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
    `basic-calendar-output-${pageCount}p.pdf`,
  );
}

async function drawImpositionSide(
  page,
  pdfDocument,
  sideLayout,
  rotationDegreesValue,
) {
  await renderImpositionSide({
    page,
    pdfDocument,
    sideLayout,
    rotationDegreesValue,
    getOutputPageSizeInches,
    getLayoutSlotForGridInches,
    verticalGap: verticalGap.value,
    horizontalGap: horizontalGap.value,
    cropMarkOffset: cropMarkOffset.value,
    cropMarkLength: cropMarkLength.value,
    showCropMarks: showCropMarks.value,
    bleedInches: {
      top: bleedTop.value,
      right: bleedRight.value,
      bottom: bleedBottom.value,
      left: bleedLeft.value,
    },
    pageTrimInches: { width: Number(pageWidth.value), height: Number(pageHeight.value) },
    getSlotOffset: ({ slot, foldHorizontal, pageIndexWithinSheet }) =>
      getSheetCreepOffsetPoints({
        sheetNumber: slot.sheetNumber ?? 1,
        foldHorizontal,
        pageIndexWithinSheet,
        pageDepthInches: PAGE_DEPTH_INCHES,
      }),
    resolveSlotAsset: async ({ slot, rasterRotation, pdfDocument: doc }) => {
      if (!slot.file) {
        return null;
      }
      const image = await embedPreparedImage(doc, slot.file, rasterRotation);
      return image ? { image, fitMode: "contain" } : null;
    },
  });
}

const dateCardRefs = ref({});

function setDateCardRef(dateKey, element) {
  if (element) {
    dateCardRefs.value[dateKey] = element;
    return;
  }
  delete dateCardRefs.value[dateKey];
}

async function waitForRasterFonts() {
  if (
    typeof document === "undefined" ||
    !document.fonts ||
    typeof document.fonts.load !== "function"
  ) {
    return;
  }
  try {
    // Ensure custom symbol/text faces are ready before html2canvas snapshots.
    await Promise.all([
      document.fonts.load('16px "Physis"'),
      document.fonts.load('16px "Saira Condensed"'),
      document.fonts.ready,
    ]);
  } catch {
    // If font loading API fails, continue with best-effort rendering.
  }
}

async function rasterizeCalendarPages() {
  await nextTick();
  await waitForRasterFonts();
  const files = [];
  rasterizeProgressCurrent.value = 0;
  rasterizeProgressTotal.value = calendarRasterPages.value.length;
  rasterizeProgressActive.value = true;
  await nextTick();

  try {
    for (
      let pageIndex = 0;
      pageIndex < calendarRasterPages.value.length;
      pageIndex += 1
    ) {
      const pageData = calendarRasterPages.value[pageIndex];
      const card = dateCardRefs.value[pageData.key];
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

  if (calendarRasterPages.value.length === 0) {
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
    isGeneratingPdf.value = false;
  }
}

function buildCalendarPagesPreviewStyle() {
  const trimW = Math.max(0.1, Number(pageWidth.value) || 2.5);
  const trimH = Math.max(0.1, Number(pageHeight.value) || 3.5);
  const bleedT = Math.max(0, Number(bleedTop.value) || 0);
  const bleedR = Math.max(0, Number(bleedRight.value) || 0);
  const bleedB = Math.max(0, Number(bleedBottom.value) || 0);
  const bleedL = Math.max(0, Number(bleedLeft.value) || 0);
  const totalW = trimW + bleedL + bleedR;
  const totalH = trimH + bleedT + bleedB;
  const pageWidthPx = totalW * 96 * Number(previewPhysicalScale.value || 1);

  let gridTemplateColumns;
  if (previewTrueSizeEnabled.value) {
    gridTemplateColumns = `repeat(auto-fill, minmax(${pageWidthPx}px, ${pageWidthPx}px))`;
  } else if (totalW >= 8) {
    gridTemplateColumns = "minmax(0, 1fr)";
  } else if (totalW >= 4.25) {
    gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  } else {
    gridTemplateColumns = "repeat(auto-fill, minmax(220px, 1fr))";
  }

  return {
    "--calendar-page-aspect-w": String(totalW),
    "--calendar-page-aspect-h": String(totalH),
    "--calendar-page-width-px": `${pageWidthPx}px`,
    "--calendar-preview-scale": String(previewPhysicalScale.value || 1),
    gridTemplateColumns,
  };
}

const calendarPagesPreviewStyle = ref(buildCalendarPagesPreviewStyle());

watch(
  [
    pageWidth,
    pageHeight,
    bleedTop,
    bleedRight,
    bleedBottom,
    bleedLeft,
    previewTrueSizeEnabled,
    previewPhysicalScale,
  ],
  () => {
    calendarPagesPreviewStyle.value = buildCalendarPagesPreviewStyle();
  },
);

const calendarTrimGuideStyle = computed(() => {
  const trimWidth = Math.max(0.01, Number(pageWidth.value) || 0.01);
  const trimHeight = Math.max(0.01, Number(pageHeight.value) || 0.01);
  const bleedT = Math.max(0, Number(bleedTop.value) || 0);
  const bleedR = Math.max(0, Number(bleedRight.value) || 0);
  const bleedB = Math.max(0, Number(bleedBottom.value) || 0);
  const bleedL = Math.max(0, Number(bleedLeft.value) || 0);
  const totalW = trimWidth + bleedL + bleedR;
  const totalH = trimHeight + bleedT + bleedB;
  return {
    "--trim-guide-top": `${(bleedT / totalH) * 100}%`,
    "--trim-guide-right": `${(bleedR / totalW) * 100}%`,
    "--trim-guide-bottom": `${(bleedB / totalH) * 100}%`,
    "--trim-guide-left": `${(bleedL / totalW) * 100}%`,
  };
});

const contentFrameBoxStyle = computed(() =>
  buildDomPreviewContentFrameStyle({
    pageWidth: pageWidth.value,
    pageHeight: pageHeight.value,
    bleedTop: bleedTop.value,
    bleedRight: bleedRight.value,
    bleedBottom: bleedBottom.value,
    bleedLeft: bleedLeft.value,
    marginTop: domPreviewMarginTop.value,
    marginRight: domPreviewMarginRight.value,
    marginBottom: domPreviewMarginBottom.value,
    marginLeft: domPreviewMarginLeft.value,
  }),
);

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
  bleedTop: bleedTop.value,
  bleedRight: bleedRight.value,
  bleedBottom: bleedBottom.value,
  bleedLeft: bleedLeft.value,
  numberOfPages: numberOfPages.value,
  outputFoldAxis: outputFoldAxis.value,
  domPreviewMarginTop: domPreviewMarginTop.value,
  domPreviewMarginRight: domPreviewMarginRight.value,
  domPreviewMarginBottom: domPreviewMarginBottom.value,
  domPreviewMarginLeft: domPreviewMarginLeft.value,
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

const coverMoonGridTithis = Array.from({ length: 30 }, (_, index) => index + 1);

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
      tithiTransitions: [],
    }
  );
}

function formatTithiSummary(tithiNumber, hourCounts) {
  const step = getMoonTithiStep(tithiNumber);
  const hours = Number(hourCounts?.[tithiNumber] ?? 0);
  const label = step?.name || `T${tithiNumber}`;
  return hours > 0 ? `${label} (${hours}h)` : label;
}

function dayHasEclipse(dateKey) {
  return eclipseTypeForDay(dateKey) !== "";
}

function eclipseTypeForDay(dateKey) {
  const mapped = String(astrologyEclipsesByDate.value?.[dateKey] || "");
  if (mapped === "solar" || mapped === "lunar" || mapped === "both") {
    return mapped;
  }
  const events = astrologyEventsByDate.value?.[dateKey] ?? [];
  let hasSolar = false;
  let hasLunar = false;
  events.forEach((event) => {
    const label = String(event?.mainLabel || "").toLowerCase();
    if (label.includes("solar eclipse")) hasSolar = true;
    if (label.includes("lunar eclipse")) hasLunar = true;
  });
  if (hasSolar && hasLunar) return "both";
  if (hasSolar) return "solar";
  if (hasLunar) return "lunar";
  return "";
}

function eclipseIndicatorLabel(dateKey) {
  const eclipseType = eclipseTypeForDay(dateKey);
  if (eclipseType === "both") return "SOLAR + LUNAR ECLIPSE";
  if (eclipseType === "solar") return "SOLAR ECLIPSE";
  if (eclipseType === "lunar") return "LUNAR ECLIPSE";
  return "";
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

function topRightTithiNumbers(dateKey) {
  const hourCounts = dayTithiDetails(dateKey).hourCounts || {};
  const entries = Object.entries(hourCounts).map(([tithi, hours]) => ({
    tithi: Number(tithi),
    hours: Number(hours) || 0,
  }));
  if (!entries.length) {
    return [];
  }
  const maxHours = Math.max(...entries.map((entry) => entry.hours));
  return entries
    .filter((entry) => entry.hours === maxHours)
    .sort((a, b) => a.tithi - b.tithi)
    .map((entry) => entry.tithi);
}

function topRightTithiLabel(dateKey) {
  const tiedTithis = topRightTithiNumbers(dateKey);
  if (!tiedTithis.length) {
    return "";
  }
  return tiedTithis
    .map(
      (tithiNumber) => getMoonTithiStep(tithiNumber)?.name || `T${tithiNumber}`,
    )
    .join(" ");
}

const MOON_DIGNITY_RULES = [
  { type: "domicile", sign: "Cancer" },
  { type: "exaltation", sign: "Taurus" },
  { type: "detriment", sign: "Capricorn" },
];

function moonDignitiesForDay(dateKey) {
  const moonSign = dayTithiDetails(dateKey)?.sunMoon?.moonSign;
  if (!moonSign) {
    return [];
  }
  return MOON_DIGNITY_RULES.filter((rule) => rule.sign === moonSign);
}

function isMoonOnlyAspectOrIngress(event) {
  if (!event) {
    return false;
  }
  const type = String(event.eventType || "").toLowerCase();
  if (type === "lunation") {
    return true;
  }
  if (type !== "aspect" && type !== "ingress") {
    return false;
  }
  const labelIncludesMoon = String(event.mainLabel || "")
    .toLowerCase()
    .includes("moon");
  if (labelIncludesMoon) {
    return true;
  }
  const moonKey = planetKeys.Moon || "";
  const moonUnicode = planetUnicodeFallback.moon || "";
  return (event.glyphRows || []).some(
    (row) => row?.planetKey === moonKey || row?.planetUnicode === moonUnicode,
  );
}

function dayEventsForDisplay(page) {
  const events = page?.events || [];
  if (!props.isMoonCalendarMode) {
    return events;
  }
  const moonEvents = events.filter(isMoonOnlyAspectOrIngress);
  const normalizedMoonEvents = moonEvents.map((event, index) => ({
    ...event,
    sortKey: parseTimeLabelToMinutes(event?.timestamp),
    sortIndex: index,
  }));
  const transitions = (
    dayTithiDetails(page?.key)?.tithiTransitions ?? []
  ).filter((transition) => Number(transition?.hour) !== 0);
  const tithiEvents = transitions.map((transition, index) => {
    const tithiStep = getMoonTithiStep(transition.tithi);
    const sortKey = Number.isFinite(transition.hour)
      ? Number(transition.hour) * 60
      : index * 60;
    return {
      id: `${page.key}-tithi-transition-${index}`,
      eventType: "tithi transition",
      mainLabel: `Tithi shifts to ${tithiStep?.name || `T${transition.tithi}`}`,
      timestamp: formatHourToApproxLabel(transition.hour),
      glyphRows: [],
      aspectPhysisKey: "",
      tithiColorKey: tithiStep?.colorKey || "blue",
      sortKey,
      sortIndex: normalizedMoonEvents.length + index,
    };
  });
  const combined = [...normalizedMoonEvents, ...tithiEvents];
  combined.sort((a, b) => {
    const timeA = Number.isFinite(a?.sortKey)
      ? Number(a.sortKey)
      : parseTimeLabelToMinutes(a?.timestamp);
    const timeB = Number.isFinite(b?.sortKey)
      ? Number(b.sortKey)
      : parseTimeLabelToMinutes(b?.timestamp);
    if (timeA !== timeB) return timeA - timeB;
    if (Number(a?.sortIndex) !== Number(b?.sortIndex)) {
      return Number(a?.sortIndex) - Number(b?.sortIndex);
    }
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
  return combined;
}

function shouldCondenseMoonEventRows(page) {
  if (!props.isMoonCalendarMode) {
    return false;
  }
  const glyphRowEvents = dayEventsForDisplay(page).filter(
    (event) => (event?.glyphRows || []).length > 0,
  );
  return glyphRowEvents.length >= 4;
}

function parseTimeLabelToMinutes(timeLabel) {
  const text = String(timeLabel || "")
    .trim()
    .toUpperCase();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3];
  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour !== 12) hour += 12;
  return hour * 60 + minute;
}

function formatHourToTimeLabel(hour) {
  const normalized = Math.max(0, Math.min(23, Number(hour) || 0));
  const period = normalized >= 12 ? "PM" : "AM";
  const hour12 = normalized % 12 || 12;
  return `${hour12}:00${period}`;
}

function formatHourToApproxLabel(hour) {
  const normalized = Math.max(0, Math.min(23, Number(hour) || 0));
  const period = normalized >= 12 ? "pm" : "am";
  const hour12 = normalized % 12 || 12;
  return `${hour12}${period}`;
}

function moonTithiInlineLabel(dateKey) {
  return (dayTithiDetails(dateKey).tithiNumbers || [])
    .map((tithiNumber) =>
      formatTithiSummary(tithiNumber, dayTithiDetails(dateKey).hourCounts),
    )
    .join("");
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

function onAstrologyEclipsesByDateUpdate(nextEclipsesByDate) {
  astrologyEclipsesByDate.value = nextEclipsesByDate ?? {};
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
    case "bleedTop":
      bleedTop.value = Math.max(0, Number(value) || 0);
      break;
    case "bleedRight":
      bleedRight.value = Math.max(0, Number(value) || 0);
      break;
    case "bleedBottom":
      bleedBottom.value = Math.max(0, Number(value) || 0);
      break;
    case "bleedLeft":
      bleedLeft.value = Math.max(0, Number(value) || 0);
      break;
    case "domPreviewMarginTop":
      domPreviewMarginTop.value = Math.max(0, Number(value) || 0);
      break;
    case "domPreviewMarginRight":
      domPreviewMarginRight.value = Math.max(0, Number(value) || 0);
      break;
    case "domPreviewMarginBottom":
      domPreviewMarginBottom.value = Math.max(0, Number(value) || 0);
      break;
    case "domPreviewMarginLeft":
      domPreviewMarginLeft.value = Math.max(0, Number(value) || 0);
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
        <h1>{{ props.pageTitle }}</h1>
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
        <label class="field" for="basic-calendar-cover-title-override">
          <span>Cover Title Override</span>
          <input
            id="basic-calendar-cover-title-override"
            v-model="coverTitleOverride"
            name="basic-calendar-cover-title-override"
            type="text"
            placeholder="Optional custom cover title"
          />
        </label>
      </div>

      <SignatureImpositionControls
        :form="impositionControlForm"
        :summary="impositionControlSummary"
        :layout="impositionControlLayout"
        :handlers="impositionControlHandlers"
        :show-dom-preview-margins="true"
        @update:field="onImpositionControlFieldUpdate"
      />

      <AstrologyEventsPanel
        :start-date="startDate"
        :end-date="endDate"
        :moon-mode="props.isMoonCalendarMode"
        :include-lunations="true"
        @update:eventsByDate="onAstrologyEventsByDateUpdate"
        @update:context="onAstrologyContextUpdate"
        @update:tithisByDate="onAstrologyTithisByDateUpdate"
        @update:eclipsesByDate="onAstrologyEclipsesByDateUpdate"
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
          Each card matches the page aspect ratio and is rasterized at PDF
          generation.
        </p>
        <div class="calendar-preview-calibration">
          <label class="field checkbox-field">
            <input
              :checked="previewTrueSizeEnabled"
              type="checkbox"
              @change="previewTrueSizeEnabled = $event.target.checked"
            />
            <span>Use calibrated true-size preview</span>
          </label>
          <div class="calendar-preview-calibration-row">
            <span
              class="calendar-calibration-ruler"
              :style="{ width: `${PREVIEW_CALIBRATION_REFERENCE_INCHES * 96 * previewPhysicalScale}px` }"
              aria-hidden="true"
            ></span>
            <span class="calendar-calibration-ruler-label"
              >Measure this line (target {{ PREVIEW_CALIBRATION_REFERENCE_INCHES }}")</span
            >
          </div>
          <div class="calendar-preview-calibration-row">
            <label class="field">
              <span>Measured length (in)</span>
              <input
                v-model="previewMeasuredInches"
                type="number"
                min="0.1"
                step="0.01"
              />
            </label>
            <button type="button" class="secondary-button" @click="applyPreviewCalibration">
              Calibrate
            </button>
            <button type="button" class="secondary-button" @click="resetPreviewCalibration">
              Reset
            </button>
          </div>
        </div>
        <div
          class="calendar-pages-grid"
          :class="{ 'calendar-pages-grid--true-size': previewTrueSizeEnabled }"
          :style="calendarPagesPreviewStyle"
        >
          <article
            v-for="page in calendarRasterPages"
            :key="page.key"
            :ref="(el) => setDateCardRef(page.key, el)"
            :style="calendarTrimGuideStyle"
            :class="[
              'calendar-day-card',
              page.kind === 'day'
                ? 'calendar-page--day'
                : 'calendar-page--cover',
              rasterizeProgressActive ? 'calendar-day-card--rasterizing' : '',
            ]"
          >
            <div class="calendar-trim-guide" aria-hidden="true" />
            <div
              class="calendar-content-frame"
              :style="contentFrameBoxStyle"
            >
            <section
              v-if="page.kind === 'cover-front'"
              :class="[
                'calendar-cover-page',
                'calendar-cover-page--front',
                rasterizeProgressActive
                  ? 'calendar-cover-page--rasterizing'
                  : '',
              ]"
            >
              <p class="calendar-cover-title">{{ page.coverTitle }}</p>
              <div class="calendar-cover-moon-grid" aria-hidden="true">
                <img
                  v-for="tithi in coverMoonGridTithis"
                  :key="`cover-moon-${tithi}`"
                  class="calendar-cover-moon-grid-image"
                  :src="moonIconSrc(tithi)"
                  alt=""
                />
              </div>
              <div class="calendar-cover-footer">
                <p class="calendar-cover-line">{{ page.locationLine }}</p>
                <p v-if="page.natalLine" class="calendar-cover-line">
                  {{ page.natalLine }}
                </p>
              </div>
            </section>
            <section
              v-else-if="page.kind === 'cover-back'"
              :class="[
                'calendar-cover-page',
                'calendar-cover-page--back',
                rasterizeProgressActive
                  ? 'calendar-cover-page--rasterizing'
                  : '',
              ]"
            >
              <div class="calendar-cover-footer">
                <p class="calendar-cover-line">{{ page.imprintText }}</p>
              </div>
            </section>
            <template v-else>
              <template v-if="props.isMoonCalendarMode">
                <header
                  class="day-page-header"
                  :class="{
                    'day-page-header--moon-mode': props.isMoonCalendarMode,
                  }"
                >
                  <p
                    class="header-day"
                    :class="{
                      'header-day--moon-mode': props.isMoonCalendarMode,
                    }"
                  >
                    {{ page.dayNumber }} {{ page.dayLongLabel }}
                  </p>
                  <span
                    v-if="topRightTithiLabel(page.key)"
                    class="tithi-tag tithi-tag--day-corner"
                    :class="[
                      `tithi-tag--${primaryTithiStep(page.key)?.colorKey || 'blue'}`,
                      props.isMoonCalendarMode
                        ? 'tithi-tag--day-corner-moon-mode'
                        : '',
                    ]"
                    :title="`Tithi ${dayTithiDetails(page.key).primaryTithi} (${primaryTithiStep(page.key)?.name})`"
                  >
                    {{ topRightTithiLabel(page.key) }}
                  </span>
                </header>
                <p class="calendar-day-iso">{{ page.fullDateLabel }}</p>
              </template>
              <div
                v-if="
                  props.isMoonCalendarMode &&
                  moonIconSrc(dayTithiDetails(page.key).primaryTithi)
                "
                class="moon-focus-wrap"
                :class="{
                  'moon-focus-wrap--eclipse': dayHasEclipse(page.key),
                }"
              >
                <img
                  class="moon-focus-icon"
                  :src="moonIconSrc(dayTithiDetails(page.key).primaryTithi)"
                  alt=""
                  :title="`Primary tithi ${dayTithiDetails(page.key).primaryTithi}`"
                />
                <p
                  v-if="eclipseIndicatorLabel(page.key)"
                  class="moon-eclipse-indicator"
                >
                  {{ eclipseIndicatorLabel(page.key) }}
                </p>
              </div>
              <header
                v-if="!props.isMoonCalendarMode"
                class="day-page-header"
                :class="{
                  'day-page-header--moon-mode': props.isMoonCalendarMode,
                }"
              >
                <p
                  class="header-day"
                  :class="{
                    'header-day--moon-mode': props.isMoonCalendarMode,
                  }"
                >
                  {{ page.dayNumber }} {{ page.dayLongLabel }}
                </p>
                <span
                  v-if="topRightTithiLabel(page.key)"
                  class="tithi-tag tithi-tag--day-corner"
                  :class="[
                    `tithi-tag--${primaryTithiStep(page.key)?.colorKey || 'blue'}`,
                    props.isMoonCalendarMode
                      ? 'tithi-tag--day-corner-moon-mode'
                      : '',
                  ]"
                  :title="`Tithi ${dayTithiDetails(page.key).primaryTithi} (${primaryTithiStep(page.key)?.name})`"
                >
                  {{ topRightTithiLabel(page.key) }}
                </span>
              </header>
              <p v-if="!props.isMoonCalendarMode" class="calendar-day-iso">
                {{ page.fullDateLabel }}
              </p>
              <p
                v-if="
                  !props.isMoonCalendarMode && eclipseIndicatorLabel(page.key)
                "
                class="page-eclipse-indicator page-eclipse-indicator--header"
              >
                {{ eclipseIndicatorLabel(page.key) }}
              </p>
              <div
                v-if="
                  !props.isMoonCalendarMode &&
                  dayTithiDetails(page.key).tithiNumbers.length
                "
                class="calendar-day-tithis"
              >
                <span class="calendar-day-tithi-text">
                  <template v-if="props.isMoonCalendarMode">
                    {{ moonTithiInlineLabel(page.key) }}
                  </template>
                  <template
                    v-else
                    v-for="(tithiNumber, tithiIndex) in dayTithiDetails(
                      page.key,
                    ).tithiNumbers"
                    :key="`${page.key}-tithi-label-${tithiNumber}`"
                  >
                    <span
                      class="calendar-day-tithi-token"
                      :class="`calendar-day-tithi-token--${
                        getMoonTithiStep(tithiNumber)?.colorKey || 'blue'
                      }`"
                    >
                      {{
                        formatTithiSummary(
                          tithiNumber,
                          dayTithiDetails(page.key).hourCounts,
                        )
                      }}
                    </span>
                    <span
                      v-if="
                        tithiIndex <
                        dayTithiDetails(page.key).tithiNumbers.length - 1
                      "
                      class="calendar-day-tithi-separator"
                    ></span>
                  </template>
                </span>
              </div>
              <ul
                class="event-list event-list--day"
                :class="{
                  'event-list--moon-mode': props.isMoonCalendarMode,
                }"
              >
                <li
                  v-if="
                    props.isMoonCalendarMode && dayFooterSunMoonGlyphs(page.key)
                  "
                  class="event-block event-block--moon-inline-glyphs"
                >
                  <div class="moon-inline-glyphs-wrap">
                    <div class="moon-dignity-wrap">
                      <p
                        v-for="(dignity, dignityIndex) in moonDignitiesForDay(
                          page.key,
                        )"
                        :key="`${page.key}-moon-dignity-${dignity.type}-${dignityIndex}`"
                        class="moon-dignity-line"
                        :class="`moon-dignity-line--${dignity.type}`"
                      >
                        Moon in {{ dignity.type }} ({{ dignity.sign }})
                      </p>
                    </div>
                    <span
                      class="moon-dignity-inline-glyph"
                      :class="
                        dayFooterSunMoonGlyphs(page.key).moon.elementClass
                      "
                    >
                      <span class="glyph-char">{{
                        dayFooterSunMoonGlyphs(page.key).moon.planetKey ||
                        dayFooterSunMoonGlyphs(page.key).moon.planetUnicode
                      }}</span>
                      <span class="glyph-char">{{
                        dayFooterSunMoonGlyphs(page.key).moon.zodiacKey ||
                        dayFooterSunMoonGlyphs(page.key).moon.zodiacUnicode
                      }}</span>
                    </span>
                  </div>
                </li>
                <li
                  v-for="event in dayEventsForDisplay(page)"
                  :key="event.id"
                  :class="[
                    'event-block',
                    props.isMoonCalendarMode &&
                    (event.eventType === 'aspect' ||
                      event.eventType === 'ingress')
                      ? 'event-block--moon-aspect-ingress'
                      : '',
                  ]"
                >
                  <div
                    v-if="
                      event.glyphRows.length === 2 &&
                      !shouldCondenseMoonEventRows(page)
                    "
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
                      <span
                        v-if="!props.isMoonCalendarMode"
                        class="glyph-char"
                        >{{
                          event.glyphRows[0].zodiacKey ||
                          event.glyphRows[0].zodiacUnicode
                        }}</span
                      >
                      <span class="glyph-row-degree"
                        >{{ event.glyphRows[0].degree
                        }}{{
                          !props.isMoonCalendarMode
                            ? ` ${event.glyphRows[0].signName}`
                            : ""
                        }}</span
                      >
                      <span
                        v-if="props.isMoonCalendarMode"
                        class="glyph-char"
                        >{{
                          event.glyphRows[0].zodiacKey ||
                          event.glyphRows[0].zodiacUnicode
                        }}</span
                      >
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
                      <span
                        v-if="!props.isMoonCalendarMode"
                        class="glyph-char"
                        >{{
                          event.glyphRows[1].zodiacKey ||
                          event.glyphRows[1].zodiacUnicode
                        }}</span
                      >
                      <span class="glyph-row-degree"
                        >{{ event.glyphRows[1].degree
                        }}{{
                          !props.isMoonCalendarMode
                            ? ` ${event.glyphRows[1].signName}`
                            : ""
                        }}</span
                      >
                      <span
                        v-if="props.isMoonCalendarMode"
                        class="glyph-char"
                        >{{
                          event.glyphRows[1].zodiacKey ||
                          event.glyphRows[1].zodiacUnicode
                        }}</span
                      >
                    </div>
                  </div>
                  <div
                    v-else-if="
                      event.glyphRows.length &&
                      !shouldCondenseMoonEventRows(page)
                    "
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
                      <span
                        v-if="!props.isMoonCalendarMode"
                        class="glyph-char"
                        >{{ row.zodiacKey || row.zodiacUnicode }}</span
                      >
                      <span class="glyph-row-degree"
                        >{{ row.degree
                        }}{{
                          !props.isMoonCalendarMode ? ` ${row.signName}` : ""
                        }}</span
                      >
                      <span
                        v-if="props.isMoonCalendarMode"
                        class="glyph-char"
                        >{{ row.zodiacKey || row.zodiacUnicode }}</span
                      >
                    </div>
                  </div>
                  <div class="event-title-row">
                    <p
                      class="event-title"
                      :class="[
                        event.eventType === 'natal transit'
                          ? 'event-title--natal'
                          : '',
                        event.eventType === 'tithi transition'
                          ? 'event-title--tithi-transition'
                          : '',
                        event.eventType === 'tithi transition'
                          ? `event-title--tithi-${event.tithiColorKey || 'blue'}`
                          : '',
                        event.eventType === 'aspect' ||
                        event.eventType === 'ingress' ||
                        event.eventType === 'lunation'
                          ? 'event-title--aspect'
                          : '',
                      ]"
                    >
                      {{ event.mainLabel }}
                    </p>
                    <p
                      v-if="event.timestamp"
                      class="event-time"
                      :class="[
                        props.isMoonCalendarMode &&
                        event.eventType !== 'tithi transition'
                          ? 'event-time--moon-mode'
                          : '',
                        event.eventType === 'tithi transition'
                          ? 'event-time--tithi-transition'
                          : '',
                        event.eventType === 'tithi transition'
                          ? `event-time--tithi-${event.tithiColorKey || 'blue'}`
                          : '',
                      ]"
                    >
                      {{ event.timestamp }}
                    </p>
                  </div>
                </li>
              </ul>
              <footer class="page-day-footer">
                <div
                  v-if="
                    dayFooterSunMoonGlyphs(page.key) &&
                    !props.isMoonCalendarMode
                  "
                  class="page-day-footer-glyphs"
                  aria-label="Sun and Moon at local noon"
                  :class="{
                    'page-day-footer-glyphs--moon-mode':
                      props.isMoonCalendarMode,
                  }"
                >
                  <span
                    v-if="!props.isMoonCalendarMode"
                    class="page-day-footer-pair"
                    :class="dayFooterSunMoonGlyphs(page.key).sun.elementClass"
                  >
                    <span class="glyph-char">{{
                      dayFooterSunMoonGlyphs(page.key).sun.planetKey ||
                      dayFooterSunMoonGlyphs(page.key).sun.planetUnicode
                    }}</span>
                    <span class="glyph-char">{{
                      dayFooterSunMoonGlyphs(page.key).sun.zodiacKey ||
                      dayFooterSunMoonGlyphs(page.key).sun.zodiacUnicode
                    }}</span>
                  </span>
                </div>
                <span
                  v-if="dayTithiDetails(page.key).primaryTithi"
                  class="page-moon-wrap page-moon-wrap--footer"
                  v-show="!props.isMoonCalendarMode"
                  :class="{
                    'page-moon-wrap--eclipse': dayHasEclipse(page.key),
                  }"
                >
                  <img
                    v-if="moonIconSrc(dayTithiDetails(page.key).primaryTithi)"
                    class="page-moon-icon page-moon-icon--footer"
                    width="40"
                    height="40"
                    :src="moonIconSrc(dayTithiDetails(page.key).primaryTithi)"
                    alt=""
                    :title="`Primary tithi ${dayTithiDetails(page.key).primaryTithi}`"
                  />
                </span>
              </footer>
            </template>
            </div>
          </article>
        </div>
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

.calendar-preview-calibration {
  display: grid;
  gap: 0.5rem;
  margin: 0.6rem 0 0.85rem;
}

.calendar-preview-calibration-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.calendar-calibration-ruler {
  display: inline-block;
  width: calc(2in * var(--calendar-preview-scale, 1));
  max-width: 100%;
  border-top: 3px solid #111827;
}

.calendar-calibration-ruler-label {
  font-size: 0.8rem;
  color: #374151;
}

.calendar-pages-grid {
  --calendar-preview-scale: 1;
  display: grid;
  gap: 0.75rem;
}

.calendar-pages-grid--true-size {
  justify-content: start;
  overflow-x: auto;
}

.calendar-day-card {
  position: relative;
  width: 100%;
  min-width: 0;
  border: 1px solid #d4d7df;
  border-radius: 10px;
  background: #ffffff;
  padding: 0;
  aspect-ratio: var(--calendar-page-aspect-w) / var(--calendar-page-aspect-h);
  height: auto;
  min-height: 0;
  overflow: visible;
  box-sizing: border-box;
  font-family: Inter, "Avenir Next", Avenir, "Segoe UI", Roboto, sans-serif;
}

.calendar-trim-guide {
  position: absolute;
  top: var(--trim-guide-top, 0%);
  right: var(--trim-guide-right, 0%);
  bottom: var(--trim-guide-bottom, 0%);
  left: var(--trim-guide-left, 0%);
  border: 1.5px dashed #ff4f87;
  border-radius: 0;
  pointer-events: none;
  z-index: 50;
  box-sizing: border-box;
}

.calendar-day-card--rasterizing .calendar-trim-guide,
.weekly-raster-sheet--rasterizing .calendar-trim-guide {
  display: none;
}

.calendar-day-card--rasterizing {
  border: 0 !important;
  outline: none;
  box-shadow: none;
  border-radius: 0;
  overflow: hidden;
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
  position: absolute;
  left: 50%;
  bottom: 1.25rem;
  transform: translateX(-50%);
  max-width: 92%;
  font-size: clamp(0.72rem, 2vw, 0.9rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.1;
  white-space: nowrap;
  text-align: center;
}

.calendar-cover-moon-grid {
  position: absolute;
  top: 0.55rem;
  bottom: 2.35rem;
  left: 50%;
  width: calc(100% - 1rem);
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: repeat(6, 1fr);
  gap: 0.08rem;
  place-items: center;
  transform: translateX(-50%);
}

.calendar-cover-moon-grid-image {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  display: block;
}

.calendar-cover-footer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0.45rem;
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

.day-page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
  width: 100%;
  margin-bottom: 0.35rem;
}

.day-page-header--moon-mode {
  margin-top: 0.2rem;
  margin-bottom: 0.2rem;
}

.header-day {
  margin: 0;
  font-size: clamp(1.05rem, 2.8vw, 1.45rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.1;
}

.header-day--moon-mode {
  padding-top: 0.12rem;
  font-size: clamp(0.78rem, 2vw, 0.95rem);
  line-height: 1.2;
  letter-spacing: 0.06em;
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

.tithi-tag--day-corner-moon-mode {
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

.calendar-day-tithis {
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15rem;
}

.calendar-day-tithi-text {
  font-size: 0.62rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.calendar-day-tithi-token--blue {
  color: #005eff;
}

.calendar-day-tithi-token--green {
  color: #118b36;
}

.calendar-day-tithi-token--red {
  color: #d40000;
}

.calendar-day-tithi-separator {
  margin: 0 0.15rem;
  color: #7f8798;
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

.event-list--moon-mode {
  flex: 0 0 auto;
  margin-top: auto;
  padding-bottom: 0.35rem;
}

.moon-focus-wrap {
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  margin-bottom: 0.2rem;
}

.moon-focus-wrap--eclipse .moon-focus-icon {
  border: 3px solid #ff6b6b;
  border-radius: 50%;
  box-sizing: border-box;
}

.moon-eclipse-indicator {
  margin: 1rem 0 0;
  padding: 0.08rem 0.36rem;
  border: 1px solid #ffb3b3;
  border-radius: 999px;
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.2;
  color: #c62828;
  background: #fff2f2;
  text-transform: uppercase;
}

.moon-focus-icon {
  width: 62%;
  max-width: 62%;
  height: auto;
  object-fit: contain;
  display: block;
}

.moon-dignity-wrap {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin: 0;
}

.moon-dignity-line {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.2;
  text-align: left;
}

.moon-dignity-inline-glyph {
  display: inline-flex;
  align-items: baseline;
  gap: 0.02rem;
  flex-shrink: 0;
}

.moon-dignity-inline-glyph .glyph-char {
  font-size: 1.9rem;
  line-height: 1;
}

.event-block--moon-inline-glyphs {
  min-height: auto;
  max-height: none;
  border-bottom: none;
}

.moon-inline-glyphs-wrap {
  width: 100%;
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  align-items: center;
  margin: 0 0 0.02rem;
}

.moon-dignity-line--domicile {
  color: #4ecdc4;
}

.moon-dignity-line--exaltation {
  color: #51cf66;
}

.moon-dignity-line--detriment {
  color: #ff8c42;
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

.event-list--moon-mode .event-block--moon-inline-glyphs {
  min-height: auto;
  max-height: none;
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

.event-block--moon-aspect-ingress {
  padding-top: 0.12rem;
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

.event-title--aspect {
  font-size: 0.62rem;
  line-height: 1.2;
}

.event-title--tithi-transition {
  font-size: 0.62rem;
  line-height: 1.2;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-top: 0.22rem;
}

.event-title--tithi-blue {
  color: #005eff;
}

.event-title--tithi-green {
  color: #118b36;
}

.event-title--tithi-red {
  color: #d40000;
}

.event-time {
  margin: 0;
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 400;
  color: #8a8a8a;
  letter-spacing: 0.02em;
}

.event-time--moon-mode {
  font-size: 0.62rem;
}

.event-time--tithi-transition {
  font-size: 0.62rem;
  line-height: 1.2;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-top: 0.22rem;
}

.event-time--tithi-blue {
  color: #005eff;
}

.event-time--tithi-green {
  color: #118b36;
}

.event-time--tithi-red {
  color: #d40000;
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

.page-day-footer-glyphs--moon-mode {
  justify-content: flex-end;
  width: 100%;
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

.page-eclipse-indicator {
  margin: 0;
  padding: 0.08rem 0.36rem;
  border: 1px solid #ffb3b3;
  border-radius: 999px;
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.2;
  color: #c62828;
  background: #fff2f2;
  text-transform: uppercase;
}

.page-eclipse-indicator--header {
  margin: 0 0 0.3rem;
  width: fit-content;
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
