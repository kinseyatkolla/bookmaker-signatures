<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import html2canvas from "html2canvas";
import QRCode from "qrcode";
import { PDFDocument } from "pdf-lib";
import {
  buildPinterestAuthorizeUrl,
  fetchBoardPinsAll,
  fetchImageAsFile,
  getStoredPinterestTokenBundle,
  issueClientCredentialsToken,
  normalizeBoardIdOrUrl,
  refreshAccessToken,
  storePinterestTokenBundle,
} from "../lib/pinterestClient";
import { buildImpositionOutputs } from "../imposition/helpers";
import {
  formatInchesLabel,
  getSheetCreepOffsetPoints,
  rotateImageFileToPngBytes,
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

const route = useRoute();
const router = useRouter();

const pinterestAuthMessage = ref("");
const pinterestLoadError = ref("");
const pinterestBusy = ref(false);
const boardIdOrUrl = ref("");
const pinPages = ref([]);
const tokenBundle = ref(getStoredPinterestTokenBundle());

const sheetsPerSignature = ref(4);
const numberOfSignatures = ref(1);
const signatureCalcMode = ref("sheets-fixed");
const outputWidth = ref(8.5);
const outputHeight = ref(11);
/** Pinterest booklet preset: 4.25" × 5.5" trim pages */
const pageWidth = ref(4.25);
const pageHeight = ref(5.5);
/** Output layout: 1 × 2 (cols × rows in imposition summary) */
const outputLayoutCols = ref(1);
const outputLayoutRows = ref(2);
const outputFoldAxis = ref("vertical");
const OUTPUT_LAYOUT_GRID_MAX = 8;
const layoutSelectDragging = ref(false);
const layoutSelectAnchor = ref({ col: 0, row: 0 });
const layoutSelectEnd = ref({ col: 0, row: 1 });
const PLATE_FRONT_ROTATION_DEG = 90;
const PLATE_BACK_ROTATION_DEG = -90;
const cropMarkOffset = ref(0.08);
const cropMarkLength = ref(0.18);
const showCropMarks = ref(true);
const bleedTop = ref(0);
const bleedRight = ref(0.25);
const bleedBottom = ref(0);
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

const uploadedPageCount = computed(() => pinPages.value.length);
const effectivePageCount = computed(() => pinPages.value.length);
const numberOfPages = computed(() => pinPages.value.length);
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
  tokenBundle.value = getStoredPinterestTokenBundle();
  const oauth = String(route.query.oauth || "");
  if (oauth === "ok") {
    pinterestAuthMessage.value = "Pinterest account connected.";
  } else if (oauth === "error" && route.query.msg) {
    pinterestLoadError.value = String(route.query.msg);
  } else if (oauth === "state_mismatch") {
    pinterestLoadError.value =
      "OAuth state did not match. Try connecting again.";
  } else if (oauth === "missing_code") {
    pinterestLoadError.value =
      "Pinterest did not return an authorization code.";
  }
  if (oauth) {
    router.replace({ path: route.path, query: {} });
  }
  window.addEventListener("pointerup", onOutputLayoutPointerUpGlobal);
  window.addEventListener("pointercancel", onOutputLayoutPointerUpGlobal);
});

onUnmounted(() => {
  for (const page of pinPages.value) {
    if (page.previewUrl) {
      URL.revokeObjectURL(page.previewUrl);
    }
  }
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
      (hasSourcePage ? `Pinterest Pin ${absolutePageNumber}` : "Blank"),
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
  triggerDownload(combinedPdfUrl.value, `pinterest-board-pins-output-${pageCount}p.pdf`);
}

async function onGenerateCutCropSheet() {
  await generateCutCropSheetPdf({
    layoutPreview: layoutPreview.value,
    outputWidthInches: Number(outputWidth.value),
    outputHeightInches: Number(outputHeight.value),
    showCropMarks: Boolean(showCropMarks.value),
    cropMarkOffsetInches: Number(cropMarkOffset.value),
    cropMarkLengthInches: Number(cropMarkLength.value),
    fileName: "pinterest-board-pins-cut-crop-sheet.pdf",
  });
}

/**
 * Pinterest-only: embed raster bytes once, measure decoded pixel size for pdfRender
 * contain math (matches DOM aspect), same rules as embedPreparedImage.
 */
async function embedPinRasterForPdf(doc, file, rasterRotationDegrees) {
  const lower = file.name.toLowerCase();
  const normalized =
    ((Number(rasterRotationDegrees) % 360) + 360) % 360;
  const isPng = file.type === "image/png" || lower.endsWith(".png");
  const isJpg =
    file.type === "image/jpeg" ||
    file.type === "image/jpg" ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg");
  if (!isPng && !isJpg) {
    return null;
  }

  const embedBytes =
    normalized === 0
      ? await file.arrayBuffer()
      : await rotateImageFileToPngBytes(file, normalized);
  const mime =
    normalized !== 0 ? "image/png" : isPng ? "image/png" : "image/jpeg";
  const blob = new Blob([embedBytes], { type: mime });

  let pixelWidth = 0;
  let pixelHeight = 0;
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        pixelWidth = bitmap.width;
        pixelHeight = bitmap.height;
      } finally {
        bitmap.close();
      }
    } catch {
      pixelWidth = 0;
      pixelHeight = 0;
    }
  }
  if (!(pixelWidth > 0 && pixelHeight > 0)) {
    const imageUrl = URL.createObjectURL(blob);
    try {
      const imageElement = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () =>
          reject(new Error("Failed to decode pin raster for sizing."));
        img.src = imageUrl;
      });
      pixelWidth = imageElement.naturalWidth;
      pixelHeight = imageElement.naturalHeight;
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  let image;
  if (normalized === 0 && isJpg) {
    image = await doc.embedJpg(embedBytes);
  } else {
    image = await doc.embedPng(embedBytes);
  }

  return { image, pixelWidth, pixelHeight };
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
      const embedded = await embedPinRasterForPdf(doc, slot.file, rasterRotation);
      return embedded
        ? {
            image: embedded.image,
            fitMode: "contain",
            pixelWidth: embedded.pixelWidth,
            pixelHeight: embedded.pixelHeight,
          }
        : null;
    },
  });
}

const pinCardRefs = ref({});

function setPinCardRef(pinId, element) {
  if (element) {
    pinCardRefs.value[pinId] = element;
    return;
  }
  delete pinCardRefs.value[pinId];
}

async function rasterizePinPages() {
  await nextTick();
  const files = [];
  rasterizeProgressCurrent.value = 0;
  rasterizeProgressTotal.value = pinPages.value.length;
  rasterizeProgressActive.value = true;
  await nextTick();

  try {
    for (let pageIndex = 0; pageIndex < pinPages.value.length; pageIndex += 1) {
      const pageData = pinPages.value[pageIndex];
      const card = pinCardRefs.value[pageData.id];
      if (!card) {
        throw new Error("Pin page card is not ready for rasterization.");
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
            reject(new Error("Could not convert pin page to image."));
            return;
          }
          resolve(result);
        }, "image/png");
      });
      files.push(
        new File(
          [blob],
          `pinterest-pin-${String(pageIndex + 1).padStart(4, "0")}.png`,
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

  if (pinPages.value.length === 0) {
    pdfError.value = "Load pins from a board before generating a PDF.";
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
    await rasterizePinPages();

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
        : "Could not generate PDF output from Pinterest pin pages.";
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

const OAUTH_STATE_KEY = "pinterest_oauth_state";

function buildPinterestPinPageUrl(pinId) {
  if (pinId === undefined || pinId === null || pinId === "") {
    return "";
  }
  return `https://www.pinterest.com/pin/${String(pinId)}/`;
}

function pickBestImageUrlFromPin(pin) {
  const media = pin?.media;
  const images = media?.images;
  if (!images || typeof images !== "object") {
    return pin?.image_url || "";
  }
  let bestUrl = "";
  let bestArea = 0;
  for (const value of Object.values(images)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const url = value.url || value.URL;
    if (!url) {
      continue;
    }
    const w = Number(value.width) || 0;
    const h = Number(value.height) || 0;
    const area = w * h;
    if (area >= bestArea) {
      bestArea = area;
      bestUrl = url;
    }
  }
  return bestUrl || pin?.image_url || "";
}

async function ensureFreshAccessToken() {
  const bundle = tokenBundle.value;
  if (!bundle?.access_token) {
    throw new Error("Connect to Pinterest first.");
  }
  const expiresAt = bundle.expires_at_ms;
  if (expiresAt && Date.now() < expiresAt - 60_000) {
    return bundle.access_token;
  }
  if (!bundle.refresh_token) {
    return bundle.access_token;
  }
  const next = await refreshAccessToken(bundle.refresh_token);
  tokenBundle.value = next;
  storePinterestTokenBundle(next);
  return next.access_token;
}

function disconnectPinterest() {
  tokenBundle.value = null;
  storePinterestTokenBundle(null);
  pinPages.value = [];
  pinterestAuthMessage.value = "";
  pinterestLoadError.value = "";
}

async function connectClientCredentialsFlow() {
  pinterestAuthMessage.value = "";
  pinterestLoadError.value = "";
  pinterestBusy.value = true;
  try {
    const next = await issueClientCredentialsToken();
    tokenBundle.value = next;
    storePinterestTokenBundle(next);
    pinterestAuthMessage.value =
      "Connected with client credentials (app owner token). Use OAuth if you need a different Pinterest user.";
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Client credentials failed.";
    const lower = raw.toLowerCase();
    const hint =
      lower.includes("two-factor") || lower.includes("2fa")
        ? " Complete any Pinterest prompts for the business account that owns the app (developers.pinterest.com), or ignore this button and keep using OAuth."
        : lower.includes("unauthorized") || raw.includes("401")
          ? " Check PINTEREST_APP_ID and PINTEREST_APP_SECRET in .env, or use OAuth instead."
          : "";
    pinterestLoadError.value = raw + hint;
  } finally {
    pinterestBusy.value = false;
  }
}

function startPinterestOAuth() {
  pinterestAuthMessage.value = "";
  pinterestLoadError.value = "";
  const state =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  const url = buildPinterestAuthorizeUrl({ state });
  window.location.assign(url);
}

async function loadPinsFromBoard() {
  pinterestLoadError.value = "";
  const boardId = normalizeBoardIdOrUrl(boardIdOrUrl.value);
  if (!boardId) {
    pinterestLoadError.value = "Enter a board URL or board id (for example username/board-slug).";
    return;
  }
  pinterestBusy.value = true;
  for (const page of pinPages.value) {
    if (page.previewUrl) {
      URL.revokeObjectURL(page.previewUrl);
    }
  }
  pinPages.value = [];
  try {
    const accessToken = await ensureFreshAccessToken();
    const pins = await fetchBoardPinsAll(accessToken, boardId);
    if (!pins.length) {
      pinterestLoadError.value = "No pins returned for that board.";
      return;
    }
    const nextPages = [];
    for (let index = 0; index < pins.length; index += 1) {
      const pin = pins[index];
      const imageUrl = pickBestImageUrlFromPin(pin);
      if (!imageUrl) {
        continue;
      }
      const file = await fetchImageAsFile({
        imageUrl,
        fileName: `pin-${String(index + 1).padStart(4, "0")}.jpg`,
      });
      const previewUrl = URL.createObjectURL(file);
      const pinId = pin.id ?? `pin-${index}`;
      const pinUrl = buildPinterestPinPageUrl(pin.id);
      let qrDataUrl = "";
      if (pinUrl) {
        qrDataUrl = await QRCode.toDataURL(pinUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 128,
          color: { dark: "#111827", light: "#ffffff" },
        });
      }
      nextPages.push({
        id: pinId,
        title: pin.title || pin.description || `Pin ${index + 1}`,
        pinUrl,
        qrDataUrl,
        imageUrl,
        previewUrl,
        file,
      });
    }
    if (!nextPages.length) {
      pinterestLoadError.value = "Pins were found but none had downloadable images.";
      return;
    }
    pinPages.value = nextPages;
  } catch (error) {
    pinterestLoadError.value =
      error instanceof Error ? error.message : "Could not load board pins.";
  } finally {
    pinterestBusy.value = false;
  }
}

</script>

<template>
  <main class="page">
    <section class="card">
      <div class="calendar-header">
        <h1>Pinterest Board Pins</h1>
        <RouterLink class="small-button" to="/pinterest">Back to Pinterest</RouterLink>
      </div>
      <p class="subtitle">
        Connect with the Pinterest API (dev server), load every pin image from a board,
        then use the same imposition controls as the calendar booklets. Each page shows the
        pin image and a QR code that opens the original pin on Pinterest (attribution).
      </p>

      <section class="pinterest-connect card-nested">
        <h2 class="pinterest-section-title">Pinterest connection</h2>
        <p class="note">
          OAuth and token exchange use your app secret on the Vite dev server only
          (see <code>.env.example</code>). Register the same redirect URI in the Pinterest
          developer portal.
        </p>
        <div class="pinterest-token-row">
          <span class="pinterest-token-label">Status:</span>
          <span v-if="tokenBundle?.access_token" class="pinterest-token-ok">Connected</span>
          <span v-else class="pinterest-token-missing">Not connected</span>
        </div>
        <div class="pinterest-actions">
          <button
            type="button"
            class="primary-button"
            :disabled="pinterestBusy"
            @click="startPinterestOAuth"
          >
            Connect with Pinterest (OAuth)
          </button>
          <button
            type="button"
            class="secondary-button"
            title="Optional: machine token for the Pinterest business account that owns the app. Often blocked or requires 2FA on Pinterest’s side. Use OAuth for personal boards."
            :disabled="pinterestBusy"
            @click="connectClientCredentialsFlow"
          >
            Client credentials (app owner)
          </button>
          <button
            type="button"
            class="secondary-button"
            :disabled="pinterestBusy || !tokenBundle?.access_token"
            @click="disconnectPinterest"
          >
            Disconnect
          </button>
        </div>
        <p class="note pinterest-connect-note">
          For <strong>your own pins and boards</strong>, use <strong>Connect with Pinterest (OAuth)</strong>.
          The “client credentials” option asks Pinterest for a token without a browser login; they often
          reject it with <em>Two-factor authentication required</em> or similar until that flow is satisfied
          on the business account that owns the app—and it is not the same as logging in as your personal
          profile. If you already show <strong>Connected</strong>, you can load boards; you do not need
          client credentials.
        </p>
        <p v-if="pinterestAuthMessage" class="pinterest-message">{{ pinterestAuthMessage }}</p>
        <p v-if="pinterestLoadError" class="pinterest-error">{{ pinterestLoadError }}</p>
      </section>

      <section class="pinterest-board card-nested">
        <h2 class="pinterest-section-title">Board pins</h2>
        <label class="field field-full" for="pinterest-board-id">
          <span>Board URL or board id</span>
          <input
            id="pinterest-board-id"
            v-model="boardIdOrUrl"
            type="text"
            name="pinterest-board-id"
            placeholder="https://www.pinterest.com/username/board-name/"
            autocomplete="off"
          />
        </label>
        <div class="pinterest-actions">
          <button
            type="button"
            class="primary-button"
            :disabled="pinterestBusy || !tokenBundle?.access_token"
            @click="loadPinsFromBoard"
          >
            Load all pins from board
          </button>
        </div>
      </section>

      <SignatureImpositionControls
        :form="impositionControlForm"
        :summary="impositionControlSummary"
        :layout="impositionControlLayout"
        :handlers="impositionControlHandlers"
        :show-dom-preview-margins="true"
        @update:field="onImpositionControlFieldUpdate"
      />

      <PdfOutputActions :state="pdfOutputState" :handlers="pdfOutputHandlers" />

      <section class="calendar-pages-section">
        <h2>Pin DOM pages</h2>
        <p class="note">
          Each card matches the page aspect ratio (image uses contain inside the trim frame),
          with a small QR linking to the pin on Pinterest. Cards are rasterized when you
          generate the PDF.
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
            v-for="(page, pinPageIndex) in pinPages"
            :key="page.id"
            :ref="(el) => setPinCardRef(page.id, el)"
            :style="calendarTrimGuideStyle"
            :class="[
              'calendar-day-card',
              rasterizeProgressActive ? 'calendar-day-card--rasterizing' : '',
            ]"
          >
            <div class="calendar-trim-guide" aria-hidden="true" />
            <div
              class="calendar-content-frame pinterest-pin-frame"
              :style="contentFrameBoxStyle"
            >
              <div class="pinterest-pin-media-wrap">
                <img
                  class="pinterest-pin-image"
                  :src="page.previewUrl"
                  :alt="page.title"
                  crossorigin="anonymous"
                  draggable="false"
                />
              </div>
              <div
                class="pinterest-pin-footer"
                :class="
                  (pinPageIndex + 1) % 2 === 1
                    ? 'pinterest-pin-footer--odd'
                    : 'pinterest-pin-footer--even'
                "
              >
                <a
                  v-if="page.pinUrl"
                  class="pinterest-pin-sr-only"
                  :href="page.pinUrl"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  View this pin on Pinterest ({{ page.title }})
                </a>
                <img
                  v-if="page.qrDataUrl"
                  class="pinterest-pin-qr"
                  :src="page.qrDataUrl"
                  alt="QR code: open this pin on Pinterest"
                  draggable="false"
                />
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

.calendar-day-number {
  margin: 0;
  font-size: clamp(3rem, 8vw, 5.4rem);
  line-height: 0.95;
  font-weight: 800;
  color: #1f2f55;
}

.calendar-day-label {
  margin: 0.75rem 0 0;
  font-size: 0.95rem;
  line-height: 1.35;
  color: #1d222f;
}

.calendar-day-iso {
  margin: 0.45rem 0 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 0.72rem;
  line-height: 1.25;
  color: #535a69;
  overflow-wrap: anywhere;
}

.card-nested {
  margin: 1rem 0;
  padding: 0.85rem 1rem;
  border: 1px solid #e2e6ef;
  border-radius: 10px;
  background: #fafbff;
}

.pinterest-section-title {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
}

.pinterest-token-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.35rem 0 0.6rem;
  font-size: 0.9rem;
}

.pinterest-token-label {
  color: #4b5563;
}

.pinterest-token-ok {
  color: #047857;
  font-weight: 600;
}

.pinterest-token-missing {
  color: #92400e;
}

.pinterest-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.35rem;
}

.pinterest-message {
  color: #065f46;
  margin: 0.5rem 0 0;
  font-size: 0.9rem;
}

.pinterest-error {
  color: #b91c1c;
  margin: 0.5rem 0 0;
  font-size: 0.9rem;
}

/*
 * Pin frame: must stay position:absolute (same as .calendar-content-frame globally).
 * A bare .pinterest-pin-frame { position:relative } was overriding absolute (equal
 * specificity, later stylesheet wins) so top/right/bottom/left % did not bound the box
 * and image sizing never “saw” a fixed height — layout looked unchanged.
 *
 * Grid + minmax(0,1fr) replaces flex so the image row can shrink below intrinsic height.
 */
.calendar-content-frame.pinterest-pin-frame {
  position: absolute;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 0.2rem;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  align-content: stretch;
  box-sizing: border-box;
}

.pinterest-pin-media-wrap {
  grid-row: 1;
  grid-column: 1;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: #f3f4f6;
}

.pinterest-pin-image {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
}

.pinterest-pin-footer {
  position: relative;
  grid-row: 2;
  grid-column: 1;
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: flex-end;
  justify-content: flex-end;
  padding-top: 0.1rem;
  min-height: calc(52px + 0.15rem);
  box-sizing: border-box;
}

.pinterest-pin-footer--odd {
  justify-content: flex-end;
}

.pinterest-pin-footer--even {
  justify-content: flex-start;
}

.pinterest-pin-qr {
  width: 52px;
  height: 52px;
  min-width: 52px;
  min-height: 52px;
  max-width: 52px;
  max-height: 52px;
  display: block;
  object-fit: contain;
  image-rendering: pixelated;
  border-radius: 4px;
  border: 1px solid #e5e7eb;
  background: #fff;
  box-sizing: border-box;
}

.pinterest-pin-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
