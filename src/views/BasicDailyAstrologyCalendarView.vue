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
const pageWidth = ref(2.5);
const pageHeight = ref(3.5);
const outputLayoutCols = ref(2);
const outputLayoutRows = ref(2);
const outputFoldAxis = ref("horizontal");
const OUTPUT_LAYOUT_GRID_MAX = 8;
const layoutSelectDragging = ref(false);
const layoutSelectAnchor = ref({ col: 0, row: 0 });
const layoutSelectEnd = ref({ col: 0, row: 0 });
const PLATE_FRONT_ROTATION_DEG = 90;
const PLATE_BACK_ROTATION_DEG = -90;
const cropMarkOffset = ref(0.08);
const cropMarkLength = ref(0.18);
const showCropMarks = ref(true);
const horizontalGap = ref(0.08);
const verticalGap = ref(0.08);
const isGeneratingPdf = ref(false);
const pdfError = ref("");
const combinedPdfUrl = ref("");
const rasterizedPageFiles = ref([]);
const rasterizeProgressCurrent = ref(0);
const rasterizeProgressTotal = ref(0);
const rasterizeProgressActive = ref(false);
const astrologyEventsByDate = ref({});
const astrologyTithisByDate = ref({});
const astrologyContext = ref({
  locationName: "",
  latitude: "",
  longitude: "",
  timeZone: "UTC",
  startDate: "",
  endDate: "",
});

const pagesPerSheet = 4;
const pagesPerSignature = computed(
  () => Math.max(1, sheetsPerSignature.value) * pagesPerSheet,
);

const calendarPages = computed(() => {
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
    `basic-calendar-output-${pageCount}p.pdf`,
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

  try {
    for (
      let pageIndex = 0;
      pageIndex < calendarPages.value.length;
      pageIndex += 1
    ) {
      const pageData = calendarPages.value[pageIndex];
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

  if (calendarPages.value.length === 0) {
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

const pagesSectionStyle = computed(() => ({
  "--calendar-page-aspect-w": String(
    Math.max(0.1, Number(pageWidth.value) || 2.5),
  ),
  "--calendar-page-aspect-h": String(
    Math.max(0.1, Number(pageHeight.value) || 3.5),
  ),
}));

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

function formatTithiSummary(tithiNumber, hourCounts) {
  const step = getMoonTithiStep(tithiNumber);
  const hours = Number(hourCounts?.[tithiNumber] ?? 0);
  const label = step?.name || `T${tithiNumber}`;
  return hours > 0 ? `${label} (${hours}h)` : label;
}

function dayHasEclipse(dateKey) {
  const events = astrologyEventsByDate.value?.[dateKey] ?? [];
  return events.some((event) => {
    const label = String(event?.mainLabel || "").toLowerCase();
    return label.includes("solar eclipse") || label.includes("lunar eclipse");
  });
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
        <h1>Basic Daily Astrology Calendar</h1>
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
          Each card matches the page aspect ratio and is rasterized at PDF
          generation.
        </p>
        <div class="calendar-pages-grid" :style="pagesSectionStyle">
          <article
            v-for="page in calendarPages"
            :key="page.key"
            :ref="(el) => setDateCardRef(page.key, el)"
            class="calendar-day-card"
          >
            <header class="calendar-day-header">
              <p class="calendar-day-title">
                {{ page.dayNumber }} {{ page.dayLongLabel }}
              </p>
            </header>
            <p class="calendar-day-iso">{{ page.fullDateLabel }}</p>
            <div
              v-if="dayTithiDetails(page.key).tithiNumbers.length"
              class="calendar-day-tithis"
            >
              <span
                v-if="dayTithiDetails(page.key).primaryTithi"
                class="calendar-day-tithi-primary"
                :class="{
                  'calendar-day-tithi-primary--eclipse': dayHasEclipse(
                    page.key,
                  ),
                }"
                :title="`Primary tithi: ${dayTithiDetails(page.key).primaryTithi}`"
              >
                <img
                  v-if="moonIconSrc(dayTithiDetails(page.key).primaryTithi)"
                  :src="moonIconSrc(dayTithiDetails(page.key).primaryTithi)"
                  class="calendar-day-tithi-icon"
                  alt=""
                  width="16"
                  height="16"
                />
              </span>
              <span class="calendar-day-tithi-text">
                <template
                  v-for="(tithiNumber, tithiIndex) in dayTithiDetails(page.key)
                    .tithiNumbers"
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
                    >•</span
                  >
                </template>
              </span>
            </div>
            <ul class="event-list event-list--day">
              <li
                v-for="event in page.events"
                :key="event.id"
                class="event-block"
              >
                <div
                  v-if="event.glyphRows.length === 2"
                  class="event-glyphs event-glyphs--day-lead event-glyphs--aspect-inline"
                >
                  <div
                    class="glyph-row"
                    :class="event.glyphRows[0].elementClass"
                  >
                    <span class="glyph-char">{{
                      event.glyphRows[0].planetUnicode ||
                      event.glyphRows[0].planetKey
                    }}</span>
                    <span class="glyph-char">{{
                      event.glyphRows[0].zodiacUnicode ||
                      event.glyphRows[0].zodiacKey
                    }}</span>
                    <span class="glyph-row-degree"
                      >{{ event.glyphRows[0].degree }}
                      {{ event.glyphRows[0].signName }}</span
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
                      event.glyphRows[1].planetUnicode ||
                      event.glyphRows[1].planetKey
                    }}</span>
                    <span class="glyph-char">{{
                      event.glyphRows[1].zodiacUnicode ||
                      event.glyphRows[1].zodiacKey
                    }}</span>
                    <span class="glyph-row-degree"
                      >{{ event.glyphRows[1].degree }}
                      {{ event.glyphRows[1].signName }}</span
                    >
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
                      row.planetUnicode || row.planetKey
                    }}</span>
                    <span class="glyph-char">{{
                      row.zodiacUnicode || row.zodiacKey
                    }}</span>
                    <span class="glyph-row-degree"
                      >{{ row.degree }} {{ row.signName }}</span
                    >
                  </div>
                </div>
                <div class="event-title-row">
                  <p
                    class="event-title"
                    :class="{
                      'event-title--natal': event.eventType === 'natal transit',
                    }"
                  >
                    {{ event.mainLabel }}
                  </p>
                  <p v-if="event.timestamp" class="event-time">
                    {{ event.timestamp }}
                  </p>
                </div>
              </li>
            </ul>
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

.calendar-pages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
}

.calendar-day-card {
  position: relative;
  border: 1px solid #d4d7df;
  border-radius: 10px;
  background: #ffffff;
  padding: 0.85rem;
  aspect-ratio: var(--calendar-page-aspect-w) / var(--calendar-page-aspect-h);
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  overflow: hidden;
}

.calendar-day-header {
  display: flex;
  align-items: baseline;
  justify-content: flex-start;
  gap: 0.35rem;
}

.calendar-day-title {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.35;
  color: #1d222f;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.calendar-day-iso {
  margin: 0.55rem 0 0;
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
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.35rem;
}

.calendar-day-tithi-primary {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.08rem;
  background: #ffffff;
  flex-shrink: 0;
}

.calendar-day-tithi-primary--eclipse {
  border: 2px solid #ff6b6b;
}

.calendar-day-tithi-icon {
  width: 14px;
  height: 14px;
  border-radius: 50%;
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
  margin-top: 0.2rem;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.event-block {
  display: flex;
  flex-direction: column;
  gap: 0;
  font-size: 0.74rem;
  line-height: 1.2;
  min-height: 1.8lh;
  max-height: 2.8lh;
  overflow: hidden;
  border-bottom: 1px solid #e6e6e6;
}

.event-block:last-of-type {
  border-bottom: none;
}

.event-glyphs--day-lead {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  align-items: baseline;
}

.event-glyphs--aspect-inline {
  flex-wrap: nowrap;
  gap: 0.2rem 0.35rem;
}

.glyph-aspect-char {
  font-size: 0.8rem;
  color: #111111;
  line-height: 1;
  flex-shrink: 0;
}

.glyph-row {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
  white-space: nowrap;
}

.glyph-char {
  font-size: 0.82rem;
  line-height: 1;
}

.glyph-row-degree {
  font-weight: 500;
}

.event-title-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.45rem;
}

.event-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 0.74rem;
  font-weight: 500;
  color: #000000;
  line-height: 1.2;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.event-title--natal {
  font-weight: 650;
}

.event-time {
  margin: 0;
  flex-shrink: 0;
  font-size: 0.62rem;
  color: #8a8a8a;
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
