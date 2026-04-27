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
import { generateCutCropSheetPdf } from "../imposition/cutCropSheetPdf";
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
import ProgressArcs from "../components/ProgressArcs.vue";

const now = new Date();
const defaultStartMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const startMonth = ref(defaultStartMonth);

const astrologyContext = ref({
  locationName: "",
  latitude: "",
  longitude: "",
  timeZone: "UTC",
  apiBaseUrl: "http://localhost:3000/api",
  birthDateTime: "",
  birthLocationName: "",
  startDate: "",
  endDate: "",
  natalChart: null,
});

const sheetsPerSignature = ref(4);
const numberOfSignatures = ref(1);
const signatureCalcMode = ref("signatures-fixed");
const outputWidth = ref(8.5);
const outputHeight = ref(11);
const pageWidth = ref(4.25);
const pageHeight = ref(2.75);
const outputLayoutCols = ref(1);
const outputLayoutRows = ref(4);
const outputFoldAxis = ref("vertical");
const OUTPUT_LAYOUT_GRID_MAX = 8;
const layoutSelectDragging = ref(false);
const layoutSelectAnchor = ref({ col: 0, row: 0 });
const layoutSelectEnd = ref({ col: 0, row: 0 });
const PLATE_FRONT_ROTATION_DEG = 90;
const PLATE_BACK_ROTATION_DEG = -90;
const cropMarkOffset = ref(0.08);
const cropMarkLength = ref(0.18);
const showCropMarks = ref(true);
const bleedTop = ref(0.25);
const bleedRight = ref(0.25);
const bleedBottom = ref(0.25);
const bleedLeft = ref(0.25);
const horizontalGap = ref(0);
const verticalGap = ref(0);
const domPreviewMarginTop = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const domPreviewMarginRight = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const domPreviewMarginBottom = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const domPreviewMarginLeft = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const isGeneratingPdf = ref(false);
const pdfError = ref("");
const combinedPdfUrl = ref("");
const pageDepthInches = ref(0.25 / 25);
const enableCreepNudge = ref(true);
const rasterizedPageFiles = ref([]);
const rasterizeProgressCurrent = ref(0);
const rasterizeProgressTotal = ref(0);
const rasterizeProgressActive = ref(false);
const PREVIEW_CALIBRATION_REFERENCE_INCHES = 2;
const previewTrueSizeEnabled = ref(true);
const previewPhysicalScale = ref(loadPreviewPhysicalScale());
const previewMeasuredInches = ref(String(PREVIEW_CALIBRATION_REFERENCE_INCHES));

const pagesPerSheet = 4;
const pagesPerSignature = computed(
  () => Math.max(1, sheetsPerSignature.value) * pagesPerSheet,
);

function parseMonthInput(value) {
  if (!value) {
    return null;
  }
  const [year, month] = String(value).split("-").map(Number);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }
  return { year, month0: month - 1 };
}

const fiveYearMonthPages = computed(() => {
  const parsed = parseMonthInput(startMonth.value);
  if (!parsed) {
    return [];
  }
  const { year, month0 } = parsed;
  const pages = [];
  for (let i = 0; i < 60; i += 1) {
    const first = new Date(year, month0 + i, 1, 12, 0, 0, 0);
    const y = first.getFullYear();
    const m = first.getMonth();
    const last = new Date(y, m + 1, 0, 12, 0, 0, 0);
    const key = `${y}-${String(m + 1).padStart(2, "0")}`;
    pages.push({
      key,
      monthLabel: first.toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      }),
      progressStart: toDateInputValue(new Date(y, m, 1, 12, 0, 0, 0)),
      progressEnd: toDateInputValue(last),
    });
  }
  return pages;
});

const fiveYearRangeForPanel = computed(() => {
  const pages = fiveYearMonthPages.value;
  if (pages.length < 60) {
    return { start: "", end: "" };
  }
  return {
    start: pages[0].progressStart,
    end: pages[59].progressEnd,
  };
});

const calendarPages = computed(() =>
  fiveYearMonthPages.value.flatMap((monthPage, index) => {
    const monthEntry = {
      ...monthPage,
      rasterKey: `${monthPage.key}-month`,
      kind: "month",
    };
    if (index === 0) {
      return [monthEntry];
    }
    return [
      {
        key: `${monthPage.key}-blank`,
        rasterKey: `${monthPage.key}-blank`,
        kind: "blank",
      },
      monthEntry,
    ];
  }),
);

const uploadedPageCount = computed(() => calendarPages.value.length);
const effectivePageCount = computed(() => calendarPages.value.length);
const numberOfPages = computed(() => calendarPages.value.length);
const usingManualPageCount = computed(() => false);

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
  const imageFile = rasterizedPageFiles.value[absolutePageNumber - 1] ?? null;
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

function onNumberOfPagesInput() {}

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
    `five-year-flip-output-${pageCount}p.pdf`,
  );
}

async function onGenerateCutCropSheet() {
  await generateCutCropSheetPdf({
    layoutPreview: layoutPreview.value,
    outputWidthInches: Number(outputWidth.value),
    outputHeightInches: Number(outputHeight.value),
    showCropMarks: Boolean(showCropMarks.value),
    cropMarkOffsetInches: Number(cropMarkOffset.value),
    cropMarkLengthInches: Number(cropMarkLength.value),
    fileName: "basic-calendar-cut-crop-sheet.pdf",
  });
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
    pageTrimInches: {
      width: Number(pageWidth.value),
      height: Number(pageHeight.value),
    },
    getSlotOffset: ({ slot, foldHorizontal, pageIndexWithinSheet }) =>
      enableCreepNudge.value
        ? getSheetCreepOffsetPoints({
            sheetNumber: slot.sheetNumber ?? 1,
            foldHorizontal,
            pageIndexWithinSheet,
            pageDepthInches: pageDepthInches.value,
          })
        : { dx: 0, dy: 0 },
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

async function rasterizeCalendarPages() {
  await nextTick();
  const files = [];
  rasterizeProgressCurrent.value = 0;
  rasterizeProgressTotal.value = calendarPages.value.length;
  rasterizeProgressActive.value = true;
  await nextTick();

  try {
    for (
      let pageIndex = 0;
      pageIndex < calendarPages.value.length;
      pageIndex += 1
    ) {
      const pageData = calendarPages.value[pageIndex];
      const card = dateCardRefs.value[pageData.rasterKey];
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

  if (calendarPages.value.length === 0) {
    pdfError.value = "Choose a valid start month to create 60 monthly pages.";
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
  const { start, end } = fiveYearRangeForPanel.value;
  if (!start || !end) {
    return "Set a valid start month";
  }
  return `${start} through ${end}`;
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
  pageDepthInches: pageDepthInches.value,
  enableCreepNudge: enableCreepNudge.value,
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
  onGenerateCutCropSheet,
};

function onAstrologyContextUpdate(nextContext) {
  astrologyContext.value = nextContext ?? astrologyContext.value;
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
    case "pageDepthInches":
      pageDepthInches.value = Math.max(0, Number(value) || 0);
      break;
    case "enableCreepNudge":
      enableCreepNudge.value = Boolean(value);
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
        <h1>Five Year Flip</h1>
        <RouterLink class="small-button" to="/calendars"
          >Back to Calendars</RouterLink
        >
      </div>
      <p class="subtitle">
        One DOM page per month for five years from the chosen start month, with
        the same progress arc wheel as Ash's Daily Planner covers. Rasterize and
        run through the imposition engine.
      </p>

      <div class="grid date-range-grid">
        <label class="field" for="five-year-flip-start-month">
          <span>Start month</span>
          <input
            id="five-year-flip-start-month"
            v-model="startMonth"
            name="five-year-flip-start-month"
            type="month"
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
        :start-date="fiveYearRangeForPanel.start"
        :end-date="fiveYearRangeForPanel.end"
        :moon-mode="false"
        :merge-all-planet-and-moon-ephemeris="false"
        :include-lunations="false"
        @update:context="onAstrologyContextUpdate"
      />

      <PdfOutputActions :state="pdfOutputState" :handlers="pdfOutputHandlers" />

      <section class="calendar-pages-section">
        <h2>Calendar DOM Pages</h2>
        <p class="calendar-pages-context">
          <strong>Current location:</strong> {{ astrologyLocationLabel }}
          <span class="calendar-pages-context-separator">|</span>
          <strong>Span:</strong> {{ astrologyTimeframeLabel }}
        </p>
        <p class="note">
          120 pages total: one blank page before each monthly progress page.
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
              :style="{
                width: `${PREVIEW_CALIBRATION_REFERENCE_INCHES * 96 * previewPhysicalScale}px`,
              }"
              aria-hidden="true"
            ></span>
            <span class="calendar-calibration-ruler-label"
              >Measure this line (target
              {{ PREVIEW_CALIBRATION_REFERENCE_INCHES }}")</span
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
            <button
              type="button"
              class="secondary-button"
              @click="applyPreviewCalibration"
            >
              Calibrate
            </button>
            <button
              type="button"
              class="secondary-button"
              @click="resetPreviewCalibration"
            >
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
            v-for="page in calendarPages"
            :key="page.rasterKey"
            :ref="(el) => setDateCardRef(page.rasterKey, el)"
            :style="calendarTrimGuideStyle"
            :class="[
              'calendar-day-card',
              rasterizeProgressActive ? 'calendar-day-card--rasterizing' : '',
            ]"
          >
            <div class="calendar-trim-guide" aria-hidden="true" />
            <div class="calendar-content-frame" :style="contentFrameBoxStyle">
              <div
                v-if="page.kind === 'blank'"
                class="five-year-flip-blank-page"
              />
              <div v-else class="five-year-flip-inner">
                <h2 class="five-year-flip-title">{{ page.monthLabel }}</h2>
                <div
                  class="five-year-flip-arc"
                  :aria-label="`Progress arcs for ${page.monthLabel}`"
                >
                  <ProgressArcs
                    size="cover"
                    :start-date="page.progressStart"
                    :end-date="page.progressEnd"
                    :api-base-url="astrologyContext.apiBaseUrl"
                    :latitude="astrologyContext.latitude"
                    :longitude="astrologyContext.longitude"
                    :time-zone="astrologyContext.timeZone"
                  />
                </div>
              </div>
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

.calendar-pages-context {
  font-size: 0.88rem;
  line-height: 1.4;
  color: #374151;
  margin: 0.35rem 0 0.5rem;
}

.calendar-pages-context-separator {
  margin: 0 0.4rem;
  color: #9ca3af;
}

.five-year-flip-inner {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 0.02rem;
}

.five-year-flip-blank-page {
  width: 100%;
  height: 100%;
}

.five-year-flip-title {
  margin: 0;
  position: absolute;
  left: 0.06in;
  top: 0.06in;
  width: 1.25in;
  font-size: clamp(0.58rem, 1.5vw, 0.72rem);
  font-weight: 700;
  letter-spacing: 0.03em;
  line-height: 1;
  text-align: right;
  text-transform: uppercase;
  color: #1f2f55;
  white-space: nowrap;
  transform: rotate(-90deg) translateX(-100%);
  transform-origin: top left;
  z-index: 1;
}

.five-year-flip-arc {
  container-type: size;
  flex: 0 1 auto;
  min-height: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.five-year-flip-arc :deep(.progress-arcs) {
  width: min(100cqi, 100cqb) !important;
  max-width: 100% !important;
  max-height: 100% !important;
  min-height: 0;
  height: auto !important;
  box-sizing: border-box;
  aspect-ratio: 1;
  flex-shrink: 0;
}

.calendar-pages-section {
  margin-top: 1rem;
  margin-bottom: 1rem;
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
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  overflow: hidden;
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
  border-radius: 0;
  outline: none;
  box-shadow: none;
  overflow: hidden;
}
</style>
