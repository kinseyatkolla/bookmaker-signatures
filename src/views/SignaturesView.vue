<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { PDFDocument, rgb } from "pdf-lib";

const uploadedFiles = ref([]);
const numberOfPages = ref(16);
const sheetsPerSignature = ref(4);
const numberOfSignatures = ref(1);
const signatureCalcMode = ref("sheets-fixed");
const outputWidth = ref(8.5);
const outputHeight = ref(11);
const pageWidth = ref(2.5);
const pageHeight = ref(3.5);
/** User-defined output grid: this many sheets per output page (cols × rows). */
const outputLayoutCols = ref(2);
const outputLayoutRows = ref(2);
/**
 * Fold line inside each output grid cell (spine on the flat sheet).
 * "vertical" = vertical fold (pages left/right); grid math uses unrotated page size.
 * "horizontal" = horizontal fold (pages stacked); grid math uses rotated page size
 * from Sheet Orientation for that side.
 */
const outputFoldAxis = ref("horizontal");

const OUTPUT_LAYOUT_GRID_MAX = 8;
const layoutSelectDragging = ref(false);
const layoutSelectAnchor = ref({ col: 0, row: 0 });
const layoutSelectEnd = ref({ col: 0, row: 0 });
/** Fixed plate rotation for slot sizing and PDF imposition (baked into layout math). */
const PLATE_FRONT_ROTATION_DEG = 90;
const PLATE_BACK_ROTATION_DEG = -90;

/** Added to plate rotation when rasterizing page art for PDF (slot sizing still uses plate angles). */
function impositionRasterRotationDegrees(plateRotationDegrees) {
  const base = Number(plateRotationDegrees) + 180;
  return ((base % 360) + 360) % 360;
}
const cropMarkOffset = ref(0.08);
const cropMarkLength = ref(0.18);
const showCropMarks = ref(true);
/** Space between sheet rows on the output (adds to total layout height). */
const horizontalGap = ref(0.08);
/** Space between sheet columns on the output (adds to total layout width). */
const verticalGap = ref(0.08);
const isGeneratingPdf = ref(false);
const pdfError = ref("");
const combinedPdfUrl = ref("");

const pagesPerSheet = 4;
const pagesPerSignature = computed(
  () => Math.max(1, sheetsPerSignature.value) * pagesPerSheet,
);
const uploadedPageCount = computed(() => uploadedFiles.value.length);
const effectivePageCount = computed(() =>
  uploadedPageCount.value > 0
    ? uploadedPageCount.value
    : Math.max(0, Math.floor(Number(numberOfPages.value) || 0)),
);
const usingManualPageCount = computed(() => uploadedPageCount.value === 0);
const sortedUploadedFiles = computed(() =>
  uploadedFiles.value.slice().sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  ),
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

const formattedFilePreview = computed(() =>
  sortedUploadedFiles.value.slice(0, 6).map((file) => file.name),
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
  const imageFile = sortedUploadedFiles.value[absolutePageNumber - 1] ?? null;
  const hasSourcePage = absolutePageNumber <= effectivePageCount.value;
  return {
    relativePageNumber,
    absolutePageNumber,
    fileName:
      imageFile?.name ??
      (hasSourcePage ? `Page ${absolutePageNumber}` : "Blank"),
    file: imageFile,
    hasSourcePage,
  };
}

/**
 * Zigzag nesting: sheet index 0 is outer (high|low), last index innermost.
 * Front pair high|low. Back pair order depends on fold axis: vertical fold places
 * page halves left|right, so verso reads (low+1)|(high-1); horizontal fold stacks
 * halves, so verso keeps (high-1) above (low+1) in slot order for duplex.
 */
function buildSignatureSheets(signatureIndex) {
  const signatureSheetCount = normalizePositiveInteger(
    sheetsPerSignature.value,
    1,
  );
  const signaturePageCount = signatureSheetCount * pagesPerSheet;
  const signatureOffset = signatureIndex * signaturePageCount;
  const foldVertical = outputFoldAxis.value === "vertical";

  return Array.from({ length: signatureSheetCount }, (_, sheetIndex) => {
    const lowPage = sheetIndex * 2 + 1;
    const highPage = signaturePageCount - sheetIndex * 2;
    const versoFirst = foldVertical ? lowPage + 1 : highPage - 1;
    const versoSecond = foldVertical ? highPage - 1 : lowPage + 1;

    return {
      sheetNumber: sheetIndex + 1,
      front: [
        buildSheetSlot(signatureOffset, highPage),
        buildSheetSlot(signatureOffset, lowPage),
      ],
      back: [
        buildSheetSlot(signatureOffset, versoFirst),
        buildSheetSlot(signatureOffset, versoSecond),
      ],
    };
  });
}

/**
 * Maps physical sheets (sequential after zigzag build) onto output grid cells.
 * Front: each row right-to-left. Back: left-to-right, rows top-to-bottom.
 * Row-major sheetIndex is row * cols + col (matches placeSheetsOnOutputSheet).
 */
function layoutSheetsOnOutputGrid(physicalSheets, side, pattern) {
  const sheetCols = Math.max(1, Math.floor(Number(pattern?.sheetCols) || 1));
  const sheetRows = Math.max(1, Math.floor(Number(pattern?.sheetRows) || 1));
  const gridSlots = sheetCols * sheetRows;
  const n = physicalSheets.length;

  const visitOrder = [];
  if (side === "front") {
    for (let row = 0; row < sheetRows; row += 1) {
      for (let col = sheetCols - 1; col >= 0; col -= 1) {
        visitOrder.push(row * sheetCols + col);
      }
    }
  } else {
    for (let row = 0; row < sheetRows; row += 1) {
      for (let col = 0; col < sheetCols; col += 1) {
        visitOrder.push(row * sheetCols + col);
      }
    }
  }

  const out = Array.from({ length: gridSlots }, () => null);
  for (let i = 0; i < n && i < visitOrder.length; i += 1) {
    out[visitOrder[i]] = physicalSheets[i];
  }
  return out;
}

function placeSheetsOnOutputSheet(sheets, side, pattern) {
  const sheetCols = Math.max(1, Math.floor(Number(pattern?.sheetCols) || 1));
  const sheetRows = Math.max(1, Math.floor(Number(pattern?.sheetRows) || 1));
  const targetSheetCount = sheetCols * sheetRows;
  const placedSlots = [];

  for (let sheetIndex = 0; sheetIndex < targetSheetCount; sheetIndex += 1) {
    const sheet = sheets[sheetIndex];
    if (!sheet) {
      continue;
    }

    const sheetRow = Math.floor(sheetIndex / sheetCols);
    const sheetCol = sheetIndex % sheetCols;
    const slotPair = side === "front" ? sheet.front : sheet.back;

    for (let pageIndex = 0; pageIndex < slotPair.length; pageIndex += 1) {
      const slot = slotPair[pageIndex];
      placedSlots.push({
        ...slot,
        gridRow: sheetRow,
        sheetCol,
        pageIndexWithinSheet: pageIndex,
      });
    }
  }

  return {
    slots: placedSlots,
    rowCount: sheetRows,
    sheetCols,
    foldAxis: outputFoldAxis.value,
  };
}

const impositionOutputs = computed(() => {
  if (!templateMatchesCurrentInputs.value) {
    return [];
  }

  const pattern = getOutputLayoutPattern();
  const normalizedSheetsPerOutput = pattern.sheetCols * pattern.sheetRows;
  const allPhysicalSheets = [];

  for (
    let signatureIndex = 0;
    signatureIndex < numberOfSignatures.value;
    signatureIndex += 1
  ) {
    allPhysicalSheets.push(...buildSignatureSheets(signatureIndex));
  }

  const outputCount = Math.ceil(
    allPhysicalSheets.length / normalizedSheetsPerOutput,
  );
  const outputs = [];

  for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
    const start = outputIndex * normalizedSheetsPerOutput;
    const end = start + normalizedSheetsPerOutput;
    const outputSheets = allPhysicalSheets.slice(start, end);
    const frontSheets = layoutSheetsOnOutputGrid(outputSheets, "front", pattern);
    const backSheets = layoutSheetsOnOutputGrid(outputSheets, "back", pattern);
    outputs.push({
      plateNumber: outputIndex + 1,
      front: placeSheetsOnOutputSheet(frontSheets, "front", pattern),
      back: placeSheetsOnOutputSheet(backSheets, "back", pattern),
    });
  }

  return outputs;
});

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

const sheetPatternPreview = computed(() => {
  const pattern = getOutputLayoutPattern();
  const count = pattern.sheetCols * pattern.sheetRows;

  const foldLabel =
    outputFoldAxis.value === "horizontal"
      ? "horizontal fold (stacked)"
      : "vertical fold (left and right)";

  return `${pattern.sheetCols} column${
    pattern.sheetCols === 1 ? "" : "s"
  } × ${pattern.sheetRows} row${pattern.sheetRows === 1 ? "" : "s"} (${count} sheet${
    count === 1 ? "" : "s"
  } per output — ${foldLabel})`;
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
        label: `${formatInchesLabel(sheetLayoutWidth)}" x ${formatInchesLabel(
          sheetLayoutHeight,
        )}"`,
      };
    },
  );

  return {
    outputWidth: output.width,
    outputHeight: output.height,
    requiredWidth,
    requiredHeight,
    sheets,
    gapAtFold,
    gapBetweenCols,
    gapBetweenRows,
    slotWidth: slot.width,
    slotHeight: slot.height,
    sheetLayoutWidth,
    sheetLayoutHeight,
    fits: requiredWidth <= output.width && requiredHeight <= output.height,
    pattern,
    foldHorizontal,
  };
});

function onFolderUpload(event) {
  const files = Array.from(event.target.files ?? []);
  const allowedTypes = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/tiff",
    "image/bmp",
  ];

  uploadedFiles.value = files.filter((file) => {
    if (file.type) {
      return allowedTypes.includes(file.type);
    }

    return /\.(png|jpe?g|webp|gif|tiff?|bmp)$/i.test(file.name);
  });
}

function onFileUpload(event) {
  onFolderUpload(event);
}

function onNumberOfPagesInput(event) {
  numberOfPages.value = Math.max(
    0,
    Math.floor(Number(event.target.value) || 0),
  );
}

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

function toPoints(inches) {
  return inches * 72;
}

function getOutputPageSizeInches() {
  return {
    // Keep literal physical sheet dimensions; page/content orientation is handled by slot rotation.
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

/** Page footprint (in) for output grid math only (see fold + rotation rules). */
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
  triggerDownload(combinedPdfUrl.value, `bookmaker-output-${pageCount}p.pdf`);
}

async function embedFileImage(pdfDocument, file) {
  const bytes = await file.arrayBuffer();
  const lower = file.name.toLowerCase();

  if (file.type === "image/png" || lower.endsWith(".png")) {
    return pdfDocument.embedPng(bytes);
  }

  if (
    file.type === "image/jpeg" ||
    file.type === "image/jpg" ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg")
  ) {
    return pdfDocument.embedJpg(bytes);
  }

  return null;
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
  const lower = file.name.toLowerCase();
  const normalized = ((Number(rotationDegreesValue) % 360) + 360) % 360;
  const isPng = file.type === "image/png" || lower.endsWith(".png");
  const isJpg =
    file.type === "image/jpeg" ||
    file.type === "image/jpg" ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg");

  if (!isPng && !isJpg) {
    return null;
  }

  if (normalized === 0 && isPng) {
    return embedFileImage(pdfDocument, file);
  }

  if (normalized === 0 && isJpg) {
    return embedFileImage(pdfDocument, file);
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

async function createPagePlaceholderPngBytes(slot, rotationDegreesValue) {
  const ratio = Math.max(
    0.2,
    Number(pageHeight.value) / Math.max(0.2, Number(pageWidth.value)),
  );
  const baseWidth = 700;
  const baseHeight = Math.round(baseWidth * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = baseWidth;
  canvas.height = baseHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas context unavailable for placeholder.");
  }

  context.fillStyle = "#fcfcfd";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#b8b8c2";
  context.lineWidth = 4;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

  const title = `Page ${slot.absolutePageNumber}`;
  const sizeText = `${formatInchesLabel(pageWidth.value)}" x ${formatInchesLabel(pageHeight.value)}"`;

  context.fillStyle = "#31313a";
  context.font = "700 74px Helvetica, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(title, canvas.width / 2, canvas.height / 2 - 24);

  context.fillStyle = "#5b5b63";
  context.font = "400 36px Helvetica, Arial, sans-serif";
  context.fillText(sizeText, canvas.width / 2, canvas.height / 2 + 34);

  const normalized = ((Number(rotationDegreesValue) % 360) + 360) % 360;
  if (normalized === 0) {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error("Failed to convert placeholder image."));
          return;
        }
        resolve(result);
      }, "image/png");
    });
    return blob.arrayBuffer();
  }

  const swap = normalized === 90 || normalized === 270;
  const rotatedCanvas = document.createElement("canvas");
  rotatedCanvas.width = swap ? canvas.height : canvas.width;
  rotatedCanvas.height = swap ? canvas.width : canvas.height;
  const rotatedContext = rotatedCanvas.getContext("2d");

  if (!rotatedContext) {
    throw new Error("Canvas context unavailable for rotated placeholder.");
  }

  rotatedContext.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
  rotatedContext.rotate((normalized * Math.PI) / 180);
  rotatedContext.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

  const rotatedBlob = await new Promise((resolve, reject) => {
    rotatedCanvas.toBlob((result) => {
      if (!result) {
        reject(new Error("Failed to convert rotated placeholder image."));
        return;
      }
      resolve(result);
    }, "image/png");
  });

  return rotatedBlob.arrayBuffer();
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

    const rasterRotation = foldHorizontal
      ? impositionRasterRotationDegrees(rotationDegreesValue)
      : 0;

    if (!slot.file && slot.hasSourcePage) {
      const placeholderBytes = await createPagePlaceholderPngBytes(
        slot,
        rasterRotation,
      );
      const placeholderImage = await pdfDocument.embedPng(placeholderBytes);
      page.drawImage(placeholderImage, {
        x,
        y,
        width: slotWidthPoints,
        height: slotHeightPoints,
      });
      continue;
    }

    if (!slot.file) {
      continue;
    }

    const embeddedImage = await embedPreparedImage(
      pdfDocument,
      slot.file,
      rasterRotation,
    );

    if (!embeddedImage && slot.hasSourcePage) {
      const placeholderBytes = await createPagePlaceholderPngBytes(
        slot,
        rasterRotation,
      );
      const placeholderImage = await pdfDocument.embedPng(placeholderBytes);
      page.drawImage(placeholderImage, {
        x,
        y,
        width: slotWidthPoints,
        height: slotHeightPoints,
      });
      continue;
    }

    if (!embeddedImage) {
      continue;
    }

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

async function generatePdfOutput() {
  if (!templateMatchesCurrentInputs.value) {
    pdfError.value =
      "Please use positive whole numbers for sheets per signature and for the output layout.";
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
      "Could not generate PDF output. Try PNG/JPG images and check inputs.";
  } finally {
    isGeneratingPdf.value = false;
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <h1>Signature Imposition</h1>
      <p class="subtitle">
        Upload sequential page images, set layout variables, and prepare
        signature imposition for printing.
      </p>

      <div class="grid">
        <div class="field field-full">
          <span>Signature Calculation Mode</span>
          <div class="mode-toggle">
            <label>
              <input
                v-model="signatureCalcMode"
                type="radio"
                value="sheets-fixed"
              />
              Lock Sheets Per Signature (auto-calculate Number of Signatures)
            </label>
            <label>
              <input
                v-model="signatureCalcMode"
                type="radio"
                value="signatures-fixed"
              />
              Lock Number of Signatures (auto-calculate Sheets Per Signature)
            </label>
          </div>
        </div>

        <div class="field field-full size-groups">
          <section class="size-group">
            <h3>Page</h3>
            <label class="field">
              <span>Width (inches)</span>
              <input
                v-model.number="pageWidth"
                type="number"
                min="0.1"
                step="0.1"
              />
            </label>
            <label class="field">
              <span>Height (inches)</span>
              <input
                v-model.number="pageHeight"
                type="number"
                min="0.1"
                step="0.1"
              />
            </label>
          </section>

          <section class="size-group">
            <h3>Signatures</h3>
            <label class="field">
              <span>Sheets Per Signature</span>
              <input
                :value="sheetsPerSignature"
                type="number"
                min="1"
                step="1"
                :disabled="signatureCalcMode === 'signatures-fixed'"
                @input="onSheetsPerSignatureInput"
              />
              <small v-if="signatureCalcMode === 'signatures-fixed'"
                >Auto-calculated from uploaded pages and fixed
                signatures.</small
              >
            </label>
            <label class="field">
              <span>Number of Signatures</span>
              <input
                :value="numberOfSignatures"
                type="number"
                min="1"
                step="1"
                :disabled="signatureCalcMode === 'sheets-fixed'"
                @input="onNumberOfSignaturesInput"
              />
              <small v-if="signatureCalcMode === 'sheets-fixed'"
                >Auto-calculated from uploaded pages and fixed sheets per
                signature.</small
              >
            </label>
          </section>

          <section class="size-group">
            <h3>Output</h3>
            <label class="field">
              <span>Width (inches)</span>
              <input
                v-model.number="outputWidth"
                type="number"
                min="0.1"
                step="0.1"
              />
            </label>
            <label class="field">
              <span>Height (inches)</span>
              <input
                v-model.number="outputHeight"
                type="number"
                min="0.1"
                step="0.1"
              />
            </label>
          </section>
        </div>

        <div class="field field-full size-groups">
          <section class="size-group size-group--gaps">
            <h3>Gaps</h3>
            <label class="field">
              <span>Vertical gap (in)</span>
              <input
                v-model.number="verticalGap"
                type="number"
                min="0"
                step="0.01"
              />
            </label>
            <label class="field">
              <span>Horizontal gap (in)</span>
              <input
                v-model.number="horizontalGap"
                type="number"
                min="0"
                step="0.01"
              />
            </label>
          </section>
          <section class="size-group size-group--gaps">
            <h3>Crop marks</h3>
            <label class="field checkbox-field" for="show-crop-marks">
              <input
                id="show-crop-marks"
                v-model="showCropMarks"
                type="checkbox"
              />
              <span>Show crop marks</span>
            </label>
            <label class="field">
              <span>Crop Mark Offset (in)</span>
              <input
                v-model.number="cropMarkOffset"
                type="number"
                min="0.01"
                step="0.01"
                :disabled="!showCropMarks"
              />
            </label>
            <label class="field">
              <span>Crop Mark Length (in)</span>
              <input
                v-model.number="cropMarkLength"
                type="number"
                min="0.01"
                step="0.01"
                :disabled="!showCropMarks"
              />
            </label>
          </section>
          <section class="size-group size-group--summary">
            <label class="field">
              <span>Number of Pages (used when no images are uploaded)</span>
              <input
                :value="numberOfPages"
                type="number"
                min="0"
                step="1"
                :disabled="uploadedPageCount > 0"
                @input="onNumberOfPagesInput"
              />
              <small v-if="uploadedPageCount > 0">
                Disabled while images are uploaded (using
                {{ uploadedPageCount }} uploaded page{{
                  uploadedPageCount === 1 ? "" : "s"
                }}
                instead).
              </small>
              <small v-else>
                Generating placeholders for {{ effectivePageCount }} page{{
                  effectivePageCount === 1 ? "" : "s"
                }}.
              </small>
            </label>
            <h3>Imposition summary</h3>
            <div class="stats stats--summary">
              <p>
                <strong>Sheets per output:</strong>
                {{ sheetsPerOutputCount }} ({{ outputLayoutCols }} ×
                {{ outputLayoutRows }})
              </p>
              <p>
                <strong>Pages per signature:</strong> {{ pagesPerSignature }}
              </p>
              <p>
                <strong>Total page capacity:</strong> {{ totalCapacityPages }}
              </p>
              <p>
                <strong>Input page source:</strong>
                {{
                  usingManualPageCount
                    ? `Manual (${effectivePageCount} pages)`
                    : `Uploaded images (${effectivePageCount} pages)`
                }}
              </p>
              <p><strong>Blank pages needed:</strong> {{ blankPagesNeeded }}</p>
            </div>
          </section>
        </div>
      </div>

      <hr />

      <!-- <div class="imposition">
        
      </div> -->

      <div class="pdf-output">
        <div class="pdf-output-top-row">
          <div class="pdf-output-controls-column">
            <div class="field">
              <span>Fold between page halves (each grid cell)</span>
              <div class="mode-toggle mode-toggle-inline">
                <label>
                  <input
                    v-model="outputFoldAxis"
                    type="radio"
                    value="vertical"
                  />
                  Vertical fold (pages left and right)
                </label>
                <label>
                  <input
                    v-model="outputFoldAxis"
                    type="radio"
                    value="horizontal"
                  />
                  Horizontal fold (pages stacked)
                </label>
              </div>
              <small
                >Each grid cell is one physical sheet. Gaps and crop marks are
                in the row under Page / Signatures / Output.</small
              >
            </div>
            <div class="field output-layout-field">
              <span>Sheets on output (drag cells)</span>
              <p class="output-layout-summary">
                {{ outputLayoutCols }}×{{ outputLayoutRows }} ({{
                  sheetsPerOutputCount
                }}
                sheet{{ sheetsPerOutputCount === 1 ? "" : "s" }})
              </p>
              <div
                class="output-layout-grid"
                role="grid"
                :aria-label="`Select output layout, currently ${outputLayoutCols} by ${outputLayoutRows}`"
              >
                <div
                  v-for="row in OUTPUT_LAYOUT_GRID_MAX"
                  :key="`layout-row-${row}`"
                  class="output-layout-row"
                >
                  <button
                    v-for="col in OUTPUT_LAYOUT_GRID_MAX"
                    :key="`layout-cell-${row}-${col}`"
                    type="button"
                    class="output-layout-cell"
                    :class="{
                      'output-layout-cell--preview': layoutCellInDragPreview(
                        col - 1,
                        row - 1,
                      ),
                      'output-layout-cell--active': layoutCellCommitted(
                        col - 1,
                        row - 1,
                      ),
                    }"
                    :aria-pressed="
                      layoutCellCommitted(col - 1, row - 1) ? 'true' : 'false'
                    "
                    @pointerdown="
                      onOutputLayoutPointerDown(col - 1, row - 1, $event)
                    "
                    @pointerenter="onOutputLayoutPointerEnter(col - 1, row - 1)"
                  />
                </div>
              </div>
              <small
                >Click or drag to select a rectangle. Each cell is one sheet
                (two pages touch at the fold). Spacing between cells uses the
                gaps in the row under Page / Signatures / Output.</small
              >
            </div>
          </div>
          <div class="pdf-output-preview-column">
            <h2>Actual-Size PDF Output</h2>
            <div class="layout-preview">
              <svg
                class="layout-preview-svg"
                :viewBox="`0 0 ${layoutPreview.outputWidth} ${layoutPreview.outputHeight}`"
                role="img"
                aria-label="Layout preview for sheets on output sheet"
              >
                <rect
                  x="0"
                  y="0"
                  :width="layoutPreview.outputWidth"
                  :height="layoutPreview.outputHeight"
                  class="preview-output-boundary"
                />
                <g
                  v-for="(sheet, index) in layoutPreview.sheets"
                  :key="`sheet-preview-${index}`"
                >
                  <rect
                    :x="sheet.pageA.x"
                    :y="sheet.pageA.y"
                    :width="sheet.pageA.width"
                    :height="sheet.pageA.height"
                    class="preview-sheet"
                  />
                  <rect
                    :x="sheet.pageB.x"
                    :y="sheet.pageB.y"
                    :width="sheet.pageB.width"
                    :height="sheet.pageB.height"
                    class="preview-sheet"
                  />
                </g>
              </svg>
              <p class="note">
                Output: {{ formatInchesLabel(layoutPreview.outputWidth) }}" x
                {{ formatInchesLabel(layoutPreview.outputHeight) }}" | Required:
                {{ formatInchesLabel(layoutPreview.requiredWidth) }}" x
                {{ formatInchesLabel(layoutPreview.requiredHeight) }}"
              </p>
              <p class="note">
                Sheet footprint:
                {{ formatInchesLabel(layoutPreview.sheetLayoutWidth) }}" x
                {{ formatInchesLabel(layoutPreview.sheetLayoutHeight) }}". Fold:
                {{
                  layoutPreview.foldHorizontal
                    ? "horizontal (stacked)"
                    : "vertical (left and right)"
                }}
                . Between columns:
                {{ formatInchesLabel(layoutPreview.gapBetweenCols) }}"; between
                rows: {{ formatInchesLabel(layoutPreview.gapBetweenRows) }}".
              </p>
            </div>
          </div>
        </div>
        <p v-if="!layoutFit.fits" class="warning">
          This combination overflows the output page at actual size, which
          causes clipped scaling/crop marks. Reduce page size, sheet footprint,
          or gap values.
        </p>

        <div class="grid" style="margin-top: 1rem">
          <label class="field">
            <span>Page Images Folder</span>
            <input
              type="file"
              webkitdirectory
              directory
              multiple
              accept="image/*"
              @change="onFolderUpload"
            />
            <small
              >Select a folder that contains your sequential page images.</small
            >
          </label>

          <label class="field">
            <span>Or Select Image Files Directly</span>
            <input
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,image/*"
              @change="onFileUpload"
            />
            <small
              >Use this if your numbered PNGs are in a list and not a folder
              upload.</small
            >
            <small
              >{{ uploadedPageCount }} image page{{
                uploadedPageCount === 1 ? "" : "s"
              }}
              detected</small
            >
            <small v-if="formattedFilePreview.length > 0">
              Preview: {{ formattedFilePreview.join(", ")
              }}{{ uploadedPageCount > 6 ? "..." : "" }}
            </small>
          </label>
        </div>

        <div class="actions">
          <button
            type="button"
            class="primary-button"
            :disabled="isGeneratingPdf"
            @click="generatePdfOutput"
          >
            {{ isGeneratingPdf ? "Generating..." : "Generate PDF Output" }}
          </button>
          <small v-if="pdfError" class="error-text">{{ pdfError }}</small>
        </div>

        <div v-if="combinedPdfUrl" class="download-group">
          <button
            type="button"
            class="small-button"
            @click="downloadCombinedPdf"
          >
            Download PDF ({{ combinedPdfPageCount }} page{{
              combinedPdfPageCount === 1 ? "" : "s"
            }})
          </button>
        </div>

        <div v-if="combinedPdfUrl" class="pdf-preview-single">
          <section class="pdf-pane pdf-pane-wide">
            <h4>Combined PDF preview</h4>
            <iframe :src="combinedPdfUrl" title="Combined PDF Preview"></iframe>
          </section>
        </div>
      </div>
    </section>
  </main>
</template>
