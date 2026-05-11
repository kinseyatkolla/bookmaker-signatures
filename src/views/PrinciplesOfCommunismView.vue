<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import html2canvas from "html2canvas";
import QRCode from "qrcode";
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
  buildDomPreviewContentFrameStyle,
  DEFAULT_DOM_PREVIEW_MARGIN_IN,
} from "../imposition/domPreviewMargins";
import SignatureImpositionControls from "../components/SignatureImpositionControls.vue";
import PdfOutputActions from "../components/PdfOutputActions.vue";
import {
  titlePage,
  contentBlocks,
} from "../data/principlesOfCommunism";

const RASTER_SCALE = 2;

const sheetsPerSignature = ref(4);
const numberOfSignatures = ref(1);
const signatureCalcMode = ref("signatures-fixed");
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
const bleedTop = ref(0);
const bleedRight = ref(0);
const bleedBottom = ref(0);
const bleedLeft = ref(0);
const horizontalGap = ref(0.5);
const verticalGap = ref(0.75);
const isGeneratingPdf = ref(false);
const pdfError = ref("");
const combinedPdfUrl = ref("");
const pageDepthInches = ref(0.25 / 25);
const enableCreepNudge = ref(true);
const rasterizedPageFiles = ref([]);
const rasterizeProgressCurrent = ref(0);
const rasterizeProgressTotal = ref(0);
const rasterizeProgressActive = ref(false);
const domPreviewMarginTop = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const domPreviewMarginRight = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const domPreviewMarginBottom = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);
const domPreviewMarginLeft = ref(DEFAULT_DOM_PREVIEW_MARGIN_IN);

const pagesPerSheet = 4;
const pagesPerSignature = computed(
  () => Math.max(1, sheetsPerSignature.value) * pagesPerSheet,
);

const fontSize = ref(8);

const MEASURE_REF_WIDTH_PX = 1000;

const pageCardRefs = ref({});

function setPageCardRef(key, el) {
  if (el) {
    pageCardRefs.value[key] = el;
  } else {
    delete pageCardRefs.value[key];
  }
}

function getContentDimensionsIn() {
  const w =
    Math.max(0.1, Number(pageWidth.value)) -
    Math.max(0, Number(domPreviewMarginLeft.value)) -
    Math.max(0, Number(domPreviewMarginRight.value));
  const h =
    Math.max(0.1, Number(pageHeight.value)) -
    Math.max(0, Number(domPreviewMarginTop.value)) -
    Math.max(0, Number(domPreviewMarginBottom.value));
  return { w, h };
}

function getMeasureFontSizes() {
  const { w } = getContentDimensionsIn();
  const basePx = (fontSize.value / 72) * (MEASURE_REF_WIDTH_PX / w);
  return {
    body: basePx,
    heading: basePx * 1.25,
    subheading: basePx * 1.1,
  };
}

function getMeasurePageHeightPx() {
  const { w, h } = getContentDimensionsIn();
  return (h / w) * MEASURE_REF_WIDTH_PX;
}

const contentPageCount = ref(1);
const SOURCE_URL = "https://www.marxists.org/archive/marx/works/1847/11/prin-com.htm";
const qrDataUrl = ref("");

async function generateQrCode() {
  qrDataUrl.value = await QRCode.toDataURL(SOURCE_URL, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
    color: { dark: "#1d1d1f", light: "#ffffff" },
  });
}

async function repaginate() {
  await nextTick();
  try {
    await document.fonts.load('16px "Saira"');
  } catch (_) { /* font may already be loaded */ }

  const sizes = getMeasureFontSizes();
  const pageH = getMeasurePageHeightPx();

  const container = document.createElement("div");
  container.style.cssText = `
    position:absolute; left:-99999px; top:0;
    width:${MEASURE_REF_WIDTH_PX}px; height:${pageH}px;
    visibility:hidden; pointer-events:none;
    font-family:"Saira","Inter",sans-serif;
    column-width:${MEASURE_REF_WIDTH_PX}px;
    column-fill:auto; column-gap:0;
  `;
  document.body.appendChild(container);

  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i];
    const tag = block.type === "heading" ? "h3" : block.type === "subheading" ? "h4" : "p";
    const el = document.createElement(tag);
    if (block.type === "heading") {
      el.style.cssText = `font-size:${sizes.heading}px; font-weight:700; line-height:1.1; white-space:pre-line; text-align:center; margin:0; margin-bottom:0.35em;`;
      if (i > 0) el.style.breakBefore = "column";
    } else if (block.type === "subheading") {
      el.style.cssText = `font-size:${sizes.subheading}px; font-weight:600; font-style:italic; line-height:1.15; margin:0; margin-top:0.3em;`;
    } else {
      el.style.cssText = `font-size:${sizes.body}px; font-weight:400; line-height:1.2; text-align:justify; white-space:pre-line; margin:0; margin-top:0.15em;`;
    }
    el.textContent = block.text;
    container.appendChild(el);
  }

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const pages = Math.max(1, Math.round(container.scrollWidth / MEASURE_REF_WIDTH_PX));

  document.body.removeChild(container);

  contentPageCount.value = pages;
}

const rasterPages = computed(() => {
  const pages = [
    { key: "title", kind: "title", pageIndex: 0 },
    { key: "blank-1", kind: "blank" },
    { key: "colophon", kind: "colophon" },
    { key: "blank-2", kind: "blank" },
  ];
  for (let i = 0; i < contentPageCount.value; i++) {
    pages.push({
      key: `content-${i}`,
      kind: "content",
      pageIndex: i,
    });
  }
  pages.push({ key: "blank-3", kind: "blank" });
  pages.push({ key: "qr-back", kind: "qr" });
  return pages;
});

const requiredPageCount = computed(() => rasterPages.value.length);
const numberOfPages = ref(0);

watch(requiredPageCount, (v) => {
  numberOfPages.value = v;
}, { immediate: true });

const uploadedPageCount = computed(() => 0);
const effectivePageCount = computed(() => requiredPageCount.value);
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
      const fixedSheets = Math.max(1, Math.floor(Number(sheetsPerSignature.value) || 1));
      if (sheetsPerSignature.value !== fixedSheets) sheetsPerSignature.value = fixedSheets;
      const pagesPerSig = fixedSheets * pagesPerSheet;
      const nextSigs = effectivePageCount.value === 0
        ? 1
        : Math.max(1, Math.ceil(effectivePageCount.value / pagesPerSig));
      if (numberOfSignatures.value !== nextSigs) numberOfSignatures.value = nextSigs;
      return;
    }
    const fixedSigs = Math.max(1, Math.floor(Number(numberOfSignatures.value) || 1));
    if (numberOfSignatures.value !== fixedSigs) numberOfSignatures.value = fixedSigs;
    const target = effectivePageCount.value === 0
      ? pagesPerSheet
      : Math.ceil(effectivePageCount.value / fixedSigs);
    const next = Math.max(1, Math.ceil(target / pagesPerSheet));
    if (sheetsPerSignature.value !== next) sheetsPerSignature.value = next;
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
  const n = Math.floor(Number(value) || fallback);
  return Math.max(1, n);
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
  if (!layoutSelectDragging.value) return false;
  const { minCol, maxCol, minRow, maxRow } = layoutSelectionBounds();
  return col >= minCol && col <= maxCol && row >= minRow && row <= maxRow;
}

function layoutCellCommitted(col, row) {
  if (layoutSelectDragging.value) return false;
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
  if (!layoutSelectDragging.value) return;
  layoutSelectEnd.value = { col, row };
}

function commitOutputLayoutSelection() {
  if (!layoutSelectDragging.value) return;
  const { minCol, maxCol, minRow, maxRow } = layoutSelectionBounds();
  outputLayoutCols.value = maxCol - minCol + 1;
  outputLayoutRows.value = maxRow - minRow + 1;
  layoutSelectDragging.value = false;
}

function onOutputLayoutPointerUpGlobal() {
  commitOutputLayoutSelection();
}

onMounted(() => {
  window.addEventListener("pointerup", onOutputLayoutPointerUpGlobal);
  window.addEventListener("pointercancel", onOutputLayoutPointerUpGlobal);
  repaginate();
  generateQrCode();
});

watch(
  [pageWidth, pageHeight, bleedTop, bleedRight, bleedBottom, bleedLeft,
   domPreviewMarginTop, domPreviewMarginRight, domPreviewMarginBottom,
   domPreviewMarginLeft, fontSize],
  () => { repaginate(); },
);

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
      (hasSourcePage ? `Page ${absolutePageNumber}` : "Blank"),
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

function getOutputPageSizeInches() {
  return { width: Number(outputWidth.value), height: Number(outputHeight.value) };
}

function getRotatedSlotSizeInches(rotationDegrees) {
  const normalized = ((rotationDegrees % 360) + 360) % 360;
  const swaps = normalized === 90 || normalized === 270;
  return swaps
    ? { width: pageHeight.value, height: pageWidth.value }
    : { width: pageWidth.value, height: pageHeight.value };
}

function getLayoutSlotForGridInches(rotationDegreesValue) {
  return outputFoldAxis.value === "vertical"
    ? getRotatedSlotSizeInches(0)
    : getRotatedSlotSizeInches(rotationDegreesValue);
}

function getRequiredLayoutForOutput() {
  const pattern = getOutputLayoutPattern();
  const gapCols = Math.max(0, Number(verticalGap.value));
  const gapRows = Math.max(0, Number(horizontalGap.value));
  const frontSlot = getLayoutSlotForGridInches(PLATE_FRONT_ROTATION_DEG);
  const backSlot = getLayoutSlotForGridInches(PLATE_BACK_ROTATION_DEG);
  const slot = {
    width: Math.max(frontSlot.width, backSlot.width),
    height: Math.max(frontSlot.height, backSlot.height),
  };
  const stacked = outputFoldAxis.value === "horizontal";
  const sheetW = stacked ? slot.width : slot.width * 2;
  const sheetH = stacked ? slot.height * 2 : slot.height;
  return {
    requiredWidth: sheetW * pattern.sheetCols + gapCols * Math.max(0, pattern.sheetCols - 1),
    requiredHeight: sheetH * pattern.sheetRows + gapRows * Math.max(0, pattern.sheetRows - 1),
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
  const sheetLayoutWidth = foldHorizontal ? slot.width : slot.width * 2 + gapAtFold;
  const sheetLayoutHeight = foldHorizontal ? slot.height * 2 + gapAtFold : slot.height;
  const requiredWidth =
    sheetLayoutWidth * pattern.sheetCols + gapBetweenCols * Math.max(0, pattern.sheetCols - 1);
  const requiredHeight =
    sheetLayoutHeight * pattern.sheetRows + gapBetweenRows * Math.max(0, pattern.sheetRows - 1);
  const offsetX = (output.width - requiredWidth) / 2;
  const offsetY = (output.height - requiredHeight) / 2;
  const sheets = Array.from({ length: normalizedSheetsPerOutput }, (_, index) => {
    const sheetCol = index % pattern.sheetCols;
    const sheetRow = Math.floor(index / pattern.sheetCols);
    const x = offsetX + sheetCol * (sheetLayoutWidth + gapBetweenCols);
    const y = offsetY + sheetRow * (sheetLayoutHeight + gapBetweenRows);
    const pageA = { x, y, width: slot.width, height: slot.height };
    const pageB = foldHorizontal
      ? { x, y: y + slot.height + gapAtFold, width: slot.width, height: slot.height }
      : { x: x + slot.width + gapAtFold, y, width: slot.width, height: slot.height };
    return {
      x, y, width: sheetLayoutWidth, height: sheetLayoutHeight,
      pageA, pageB,
      label: `${formatInchesLabel(sheetLayoutWidth)}" x ${formatInchesLabel(sheetLayoutHeight)}"`,
    };
  });
  return {
    outputWidth: output.width, outputHeight: output.height,
    requiredWidth, requiredHeight, sheets,
    gapAtFold, gapBetweenCols, gapBetweenRows,
    slotWidth: slot.width, slotHeight: slot.height,
    sheetLayoutWidth, sheetLayoutHeight,
    fits: requiredWidth <= output.width && requiredHeight <= output.height,
    pattern, foldHorizontal,
  };
});

function revokeCombinedPdfUrl() {
  if (combinedPdfUrl.value) {
    URL.revokeObjectURL(combinedPdfUrl.value);
    combinedPdfUrl.value = "";
  }
}

const combinedPdfPageCount = computed(() => impositionOutputs.value.length * 2);
const rasterizeProgressPercent = computed(() => {
  if (rasterizeProgressTotal.value <= 0) return 0;
  return Math.round((rasterizeProgressCurrent.value / rasterizeProgressTotal.value) * 100);
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

const pdfOutputHandlers = { generatePdfOutput, downloadCombinedPdf };

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
  onNumberOfPagesInput: () => {},
  onSheetsPerSignatureInput(event) {
    sheetsPerSignature.value = Math.max(1, Math.floor(Number(event.target.value) || 1));
  },
  onNumberOfSignaturesInput(event) {
    numberOfSignatures.value = Math.max(1, Math.floor(Number(event.target.value) || 1));
  },
  onOutputLayoutPointerDown,
  onOutputLayoutPointerEnter,
  onGenerateCutCropSheet,
};

function onImpositionControlFieldUpdate({ key, value }) {
  const fieldMap = {
    signatureCalcMode: () => { signatureCalcMode.value = value; },
    pageWidth: () => { pageWidth.value = value; },
    pageHeight: () => { pageHeight.value = value; },
    outputWidth: () => { outputWidth.value = value; },
    outputHeight: () => { outputHeight.value = value; },
    verticalGap: () => { verticalGap.value = value; },
    horizontalGap: () => { horizontalGap.value = value; },
    showCropMarks: () => { showCropMarks.value = value; },
    cropMarkOffset: () => { cropMarkOffset.value = value; },
    cropMarkLength: () => { cropMarkLength.value = value; },
    pageDepthInches: () => { pageDepthInches.value = Math.max(0, Number(value) || 0); },
    enableCreepNudge: () => { enableCreepNudge.value = Boolean(value); },
    bleedTop: () => { bleedTop.value = Math.max(0, Number(value) || 0); },
    bleedRight: () => { bleedRight.value = Math.max(0, Number(value) || 0); },
    bleedBottom: () => { bleedBottom.value = Math.max(0, Number(value) || 0); },
    bleedLeft: () => { bleedLeft.value = Math.max(0, Number(value) || 0); },
    outputFoldAxis: () => { outputFoldAxis.value = value; },
    domPreviewMarginTop: () => { domPreviewMarginTop.value = Math.max(0, Number(value) || 0); },
    domPreviewMarginRight: () => { domPreviewMarginRight.value = Math.max(0, Number(value) || 0); },
    domPreviewMarginBottom: () => { domPreviewMarginBottom.value = Math.max(0, Number(value) || 0); },
    domPreviewMarginLeft: () => { domPreviewMarginLeft.value = Math.max(0, Number(value) || 0); },
  };
  fieldMap[key]?.();
}

function triggerDownload(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
}

function downloadCombinedPdf() {
  if (!combinedPdfUrl.value) return;
  triggerDownload(
    combinedPdfUrl.value,
    `principles-of-communism-${impositionOutputs.value.length * 2}p.pdf`,
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
    fileName: "principles-cut-crop-sheet.pdf",
  });
}

async function drawImpositionSide(page, pdfDocument, sideLayout, rotationDegreesValue) {
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
      if (!slot.file) return null;
      const image = await embedPreparedImage(doc, slot.file, rasterRotation);
      return image ? { image, fitMode: "contain" } : null;
    },
  });
}

async function rasterizeTextPages() {
  await nextTick();
  const files = [];
  rasterizeProgressCurrent.value = 0;
  rasterizeProgressTotal.value = rasterPages.value.length;
  rasterizeProgressActive.value = true;
  await nextTick();

  try {
    for (let i = 0; i < rasterPages.value.length; i++) {
      const pageData = rasterPages.value[i];
      const card = pageCardRefs.value[pageData.key];
      if (!card) throw new Error(`Page card "${pageData.key}" is not ready for rasterization.`);

      const canvas = await html2canvas(card, {
        scale: RASTER_SCALE,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
          if (!result) {
            reject(new Error("Could not convert page to image."));
            return;
          }
          resolve(result);
        }, "image/png");
      });
      files.push(
        new File(
          [blob],
          `text-page-${String(i + 1).padStart(4, "0")}.png`,
          { type: "image/png" },
        ),
      );
      rasterizeProgressCurrent.value = i + 1;
    }
  } finally {
    rasterizeProgressActive.value = false;
  }

  rasterizedPageFiles.value = files;
}

async function generatePdfOutput() {
  if (!templateMatchesCurrentInputs.value) {
    pdfError.value = "Please use positive whole numbers for sheets per signature and for the output layout.";
    return;
  }
  if (rasterPages.value.length === 0) {
    pdfError.value = "No pages to render.";
    return;
  }
  if (!layoutFit.value.fits) {
    pdfError.value = "Current size/orientation cannot fit the true-size layout.";
    return;
  }

  isGeneratingPdf.value = true;
  pdfError.value = "";
  revokeCombinedPdfUrl();

  try {
    await rasterizeTextPages();

    const outputSize = getOutputPageSizeInches();
    const pageSize = [toPoints(outputSize.width), toPoints(outputSize.height)];
    const pdf = await PDFDocument.create();

    for (const output of impositionOutputs.value) {
      const firstPage = pdf.addPage(pageSize);
      const secondPage = pdf.addPage(pageSize);
      await drawImpositionSide(firstPage, pdf, output.back, PLATE_BACK_ROTATION_DEG);
      await drawImpositionSide(secondPage, pdf, output.front, PLATE_FRONT_ROTATION_DEG);
    }

    const bytes = await pdf.save();
    combinedPdfUrl.value = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
  } catch (error) {
    pdfError.value =
      error instanceof Error
        ? error.message
        : "Could not generate PDF output from text pages.";
  } finally {
    isGeneratingPdf.value = false;
  }
}

const calendarTrimGuideStyle = computed(() => {
  const trimW = Math.max(0.01, Number(pageWidth.value) || 0.01);
  const trimH = Math.max(0.01, Number(pageHeight.value) || 0.01);
  const bT = Math.max(0, Number(bleedTop.value) || 0);
  const bR = Math.max(0, Number(bleedRight.value) || 0);
  const bB = Math.max(0, Number(bleedBottom.value) || 0);
  const bL = Math.max(0, Number(bleedLeft.value) || 0);
  const totalW = trimW + bL + bR;
  const totalH = trimH + bT + bB;
  return {
    "--trim-guide-top": `${(bT / totalH) * 100}%`,
    "--trim-guide-right": `${(bR / totalW) * 100}%`,
    "--trim-guide-bottom": `${(bB / totalH) * 100}%`,
    "--trim-guide-left": `${(bL / totalW) * 100}%`,
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

function buildPagesPreviewStyle() {
  const trimW = Math.max(0.1, Number(pageWidth.value) || 2.5);
  const trimH = Math.max(0.1, Number(pageHeight.value) || 3.5);
  const bT = Math.max(0, Number(bleedTop.value) || 0);
  const bR = Math.max(0, Number(bleedRight.value) || 0);
  const bB = Math.max(0, Number(bleedBottom.value) || 0);
  const bL = Math.max(0, Number(bleedLeft.value) || 0);
  const totalW = trimW + bL + bR;
  const totalH = trimH + bT + bB;
  let gridTemplateColumns;
  if (totalW >= 8) {
    gridTemplateColumns = "minmax(0, 1fr)";
  } else if (totalW >= 4.25) {
    gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  } else {
    gridTemplateColumns = "repeat(auto-fill, minmax(220px, 1fr))";
  }
  return {
    "--calendar-page-aspect-w": String(totalW),
    "--calendar-page-aspect-h": String(totalH),
    gridTemplateColumns,
  };
}

const pagesPreviewStyle = computed(() => buildPagesPreviewStyle());

/**
 * Font size as cqi units: the content frame is the container, so 100cqi = frame width.
 * Frame width in inches = contentW. So 1 inch = 100/contentW cqi.
 * The pagination font size in inches = fontSize/72.
 * Therefore font size in cqi = (fontSize/72) * (100/contentW).
 */
const textFontSizeCqi = computed(() => {
  const contentW =
    Math.max(0.1, Number(pageWidth.value)) -
    Math.max(0, Number(domPreviewMarginLeft.value)) -
    Math.max(0, Number(domPreviewMarginRight.value));
  return (fontSize.value / 72) * (100 / contentW);
});

const contentFontVars = computed(() => ({
  "--text-font-size": `${textFontSizeCqi.value}cqi`,
  "--text-heading-size": `${textFontSizeCqi.value * 1.25}cqi`,
  "--text-subheading-size": `${textFontSizeCqi.value * 1.1}cqi`,
  "--text-title-size": `${textFontSizeCqi.value * 2.2}cqi`,
  "--text-title-author-size": `${textFontSizeCqi.value * 1.4}cqi`,
  "--text-title-year-size": `${textFontSizeCqi.value * 1.2}cqi`,
  "--text-title-attr-size": `${textFontSizeCqi.value * 0.65}cqi`,
}));
</script>

<template>
  <main class="page">
    <section class="card">
      <div class="page-header">
        <RouterLink to="/political" class="back-link">&larr; Political</RouterLink>
      </div>
      <h1>The Principles of Communism</h1>
      <p class="subtitle">
        Frederick Engels, 1847 &mdash; Text flows through imposable signature
        pages for printing.
      </p>

      <SignatureImpositionControls
        :form="impositionControlForm"
        :summary="impositionControlSummary"
        :layout="impositionControlLayout"
        :handlers="impositionControlHandlers"
        :show-dom-preview-margins="true"
        @update:field="onImpositionControlFieldUpdate"
      />

      <div class="pdf-output">
        <div class="grid" style="margin-top: 1rem">
          <label class="field">
            <span>Font Size (pt)</span>
            <input
              v-model.number="fontSize"
              type="number"
              min="4"
              max="24"
              step="0.5"
            />
            <small>Controls text size on rendered pages.</small>
          </label>
          <div class="field">
            <span>Text Pages</span>
            <p class="note" style="margin: 0">
              {{ rasterPages.length }} page{{ rasterPages.length === 1 ? "" : "s" }}
              (1 title + {{ contentPageCount }} content)
            </p>
          </div>
        </div>

        <PdfOutputActions :state="pdfOutputState" :handlers="pdfOutputHandlers" />
      </div>

      <hr />

      <h2>Page Preview</h2>
      <p class="note">
        Each card matches the page aspect ratio and is rasterized at PDF generation.
      </p>

      <!-- Visible page preview grid -->
      <div class="calendar-pages-grid" :style="pagesPreviewStyle">
        <article
          v-for="page in rasterPages"
          :key="page.key"
          :ref="(el) => setPageCardRef(page.key, el)"
          :style="calendarTrimGuideStyle"
          :class="[
            'calendar-day-card',
            page.kind === 'title' ? 'text-page--title' : 'text-page--content',
            rasterizeProgressActive ? 'calendar-day-card--rasterizing' : '',
          ]"
        >
          <div class="calendar-trim-guide" aria-hidden="true" />
          <div class="calendar-content-frame" :style="[contentFrameBoxStyle, contentFontVars]">
            <!-- Title page -->
            <section v-if="page.kind === 'title'" class="text-title-page">
              <div class="text-title-spacer" />
              <h2 class="text-title-main">{{ titlePage.title }}</h2>
              <p class="text-title-author">{{ titlePage.author }}</p>
              <p class="text-title-year">{{ titlePage.year }}</p>
              <div class="text-title-spacer" />
            </section>

            <!-- Blank page -->
            <section v-else-if="page.kind === 'blank'" class="text-blank-page" />

            <!-- Colophon / attribution page -->
            <section v-else-if="page.kind === 'colophon'" class="text-colophon-page">
              <div class="text-title-spacer" />
              <ul v-if="titlePage.attribution" class="text-colophon-list">
                <li
                  v-for="(line, aIdx) in titlePage.attribution"
                  :key="aIdx"
                >{{ line }}</li>
              </ul>
              <div class="text-title-spacer" />
            </section>

            <!-- QR back page -->
            <section v-else-if="page.kind === 'qr'" class="text-qr-page">
              <div class="text-title-spacer" />
              <img
                v-if="qrDataUrl"
                class="text-qr-image"
                :src="qrDataUrl"
                alt="QR code linking to source text"
                draggable="false"
              />
              <p class="text-qr-label">Scan to read online</p>
              <div class="text-title-spacer" />
            </section>

            <!-- Content page: CSS columns flow, showing column N -->
            <section v-else class="text-content-page">
              <div
                class="text-column-flow"
                :style="{
                  '--total-pages': contentPageCount,
                  '--page-offset': page.pageIndex,
                }"
              >
                <template
                  v-for="(block, bIdx) in contentBlocks"
                  :key="`b-${bIdx}`"
                >
                  <h3
                    v-if="block.type === 'heading'"
                    :class="['text-heading', bIdx > 0 ? 'text-heading--chapter' : '']"
                    v-text="block.text"
                  />
                  <h4
                    v-else-if="block.type === 'subheading'"
                    class="text-subheading"
                    v-text="block.text"
                  />
                  <p
                    v-else
                    class="text-paragraph"
                    v-text="block.text"
                  />
                </template>
              </div>
            </section>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page-header {
  margin-bottom: 0.5rem;
}

.back-link {
  font-size: 0.88rem;
  color: #4a4a4f;
  text-decoration: none;
}

.back-link:hover {
  color: #1d1d1f;
}

/* Page preview grid — reuses calendar grid pattern */
.calendar-pages-grid {
  margin-top: 0.75rem;
  display: grid;
  gap: 0.75rem;
}

.calendar-day-card {
  position: relative;
  width: 100%;
  min-width: 0;
  background: #ffffff;
  border: 1px solid #d5d5d8;
  border-radius: 6px;
  overflow: hidden;
  aspect-ratio: var(--calendar-page-aspect-w) / var(--calendar-page-aspect-h);
  height: auto;
  min-height: 0;
  box-sizing: border-box;
}

.calendar-trim-guide {
  position: absolute;
  z-index: 30;
  border: 1px dashed #e74c8b;
  pointer-events: none;
  top: var(--trim-guide-top, 0%);
  right: var(--trim-guide-right, 0%);
  bottom: var(--trim-guide-bottom, 0%);
  left: var(--trim-guide-left, 0%);
}

.calendar-content-frame {
  position: absolute;
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
  border: 1.5px dashed #2563eb;
  pointer-events: auto;
  container-type: inline-size;
}

.calendar-day-card--rasterizing {
  border: none !important;
  border-radius: 0 !important;
  outline: none !important;
}

.calendar-day-card--rasterizing .calendar-trim-guide {
  display: none;
}

.calendar-day-card--rasterizing .calendar-content-frame {
  border-color: transparent;
}

/* Title page styling */
.text-title-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 6% 8%;
}

.text-title-spacer {
  flex: 1;
}

.text-title-main {
  margin: 0;
  font-family: "Saira", "Inter", sans-serif;
  font-weight: 700;
  font-size: var(--text-title-size, 1rem);
  line-height: 1.15;
  color: #1d1d1f;
}


.text-title-author {
  margin: 0.3em 0 0;
  font-family: "Saira", "Inter", sans-serif;
  font-weight: 500;
  font-size: var(--text-title-author-size, 0.8rem);
  color: #4a4a4f;
}

.text-title-year {
  margin: 0.15em 0 0;
  font-family: "Saira", "Inter", sans-serif;
  font-weight: 400;
  font-size: var(--text-title-year-size, 0.7rem);
  color: #66666b;
}


/* Blank page */
.text-blank-page {
  height: 100%;
}

/* Colophon / attribution page styling */
.text-colophon-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 6% 8%;
}

.text-colophon-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-family: "Saira", "Inter", sans-serif;
  font-weight: 400;
  font-size: var(--text-title-attr-size, 0.45rem);
  line-height: 1.5;
  color: #4a4a4f;
}

.text-colophon-list li + li {
  margin-top: 0.5em;
}

/* QR back page styling */
.text-qr-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 6% 8%;
}

.text-qr-image {
  width: 60cqi;
  height: 60cqi;
  max-width: 100%;
  object-fit: contain;
}

.text-qr-label {
  margin: 0.5em 0 0;
  font-family: "Saira", "Inter", sans-serif;
  font-weight: 500;
  font-size: var(--text-font-size, 0.6rem);
  color: #4a4a4f;
}

/* Content page styling — CSS multi-column layout */
.text-content-page {
  height: 100%;
  overflow: hidden;
}

.text-column-flow {
  height: 100%;
  column-fill: auto;
  column-gap: 0;
  column-width: 100cqi;
  width: calc(var(--total-pages, 1) * 100cqi);
  transform: translateX(calc(var(--page-offset, 0) * -100cqi));
}

.text-heading {
  margin: 0 0 0.35em;
  font-family: "Saira", "Inter", sans-serif;
  font-weight: 700;
  font-size: var(--text-heading-size, 0.7rem);
  line-height: 1.1;
  color: #1d1d1f;
  white-space: pre-line;
  text-align: center;
}

.text-heading--chapter {
  break-before: column;
}

.text-subheading {
  margin: 0;
  margin-top: 0.3em;
  font-family: "Saira", "Inter", sans-serif;
  font-weight: 600;
  font-style: italic;
  font-size: var(--text-subheading-size, 0.65rem);
  line-height: 1.15;
  color: #31313a;
}

.text-paragraph {
  margin: 0;
  margin-top: 0.15em;
  font-family: "Saira", "Inter", sans-serif;
  font-weight: 400;
  font-size: var(--text-font-size, 0.6rem);
  line-height: 1.2;
  color: #2b2b30;
  text-align: justify;
  white-space: pre-line;
}
</style>
