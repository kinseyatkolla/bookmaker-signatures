<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { PDFDocument } from "pdf-lib";
import { buildImpositionOutputs } from "../imposition/helpers";
import {
  embedPreparedImage,
  formatInchesLabel,
  getSheetCreepOffsetPoints,
  impositionRasterRotationDegrees,
  toPoints,
} from "../imposition/pdfUtils";
import { renderImpositionSide } from "../imposition/pdfRender";
import SignatureImpositionControls from "../components/SignatureImpositionControls.vue";
import PdfOutputActions from "../components/PdfOutputActions.vue";

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

const cropMarkOffset = ref(0.08);
const cropMarkLength = ref(0.18);
const showCropMarks = ref(true);
const bleedTop = ref(0);
const bleedRight = ref(0);
const bleedBottom = ref(0);
const bleedLeft = ref(0);
/** Space between sheet rows on the output (adds to total layout height). */
const horizontalGap = ref(0.08);
/** Space between sheet columns on the output (adds to total layout width). */
const verticalGap = ref(0.08);
const isGeneratingPdf = ref(false);
const pdfError = ref("");
const combinedPdfUrl = ref("");

const pagesPerSheet = 4;
/** Paper stack thickness per sheet layer (in) for folded-signature creep. */
const PAGE_DEPTH_INCHES = 0.25 / 25;
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

const impositionOutputs = computed(() => {
  return buildImpositionOutputs({
    templateMatchesCurrentInputs: templateMatchesCurrentInputs.value,
    outputLayoutPattern: getOutputLayoutPattern(),
    numberOfSignatures: numberOfSignatures.value,
    sheetsPerSignature: sheetsPerSignature.value,
    foldAxis: outputFoldAxis.value,
    buildSheetSlot,
  });
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
const pdfOutputState = computed(() => ({
  isGeneratingPdf: isGeneratingPdf.value,
  pdfError: pdfError.value,
  combinedPdfUrl: combinedPdfUrl.value,
  combinedPdfPageCount: combinedPdfPageCount.value,
}));
const pdfOutputHandlers = {
  generatePdfOutput,
  downloadCombinedPdf,
};

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
    case "outputFoldAxis":
      outputFoldAxis.value = value;
      break;
    default:
      break;
  }
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
  triggerDownload(combinedPdfUrl.value, `bookmaker-output-${pageCount}p.pdf`);
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

  context.fillStyle = "#b8b8c2";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#6e6e78";
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
      if (!slot.file && slot.hasSourcePage) {
        const placeholderBytes = await createPagePlaceholderPngBytes(
          slot,
          rasterRotation,
        );
        const placeholderImage = await doc.embedPng(placeholderBytes);
        return { image: placeholderImage, fitMode: "fill-slot" };
      }
      if (!slot.file) {
        return null;
      }
      const embeddedImage = await embedPreparedImage(doc, slot.file, rasterRotation);
      if (!embeddedImage && slot.hasSourcePage) {
        const placeholderBytes = await createPagePlaceholderPngBytes(
          slot,
          rasterRotation,
        );
        const placeholderImage = await doc.embedPng(placeholderBytes);
        return { image: placeholderImage, fitMode: "fill-slot" };
      }
      if (!embeddedImage) {
        return null;
      }
      return { image: embeddedImage, fitMode: "contain" };
    },
  });
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

      <SignatureImpositionControls
        :form="impositionControlForm"
        :summary="impositionControlSummary"
        :layout="impositionControlLayout"
        :handlers="impositionControlHandlers"
        @update:field="onImpositionControlFieldUpdate"
      />

      <div class="pdf-output">

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

        <PdfOutputActions :state="pdfOutputState" :handlers="pdfOutputHandlers" />
      </div>
    </section>
  </main>
</template>
