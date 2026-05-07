<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { PDFDocument, rgb } from "pdf-lib";
import PdfOutputActions from "../components/PdfOutputActions.vue";
import {
  drawCropMarks,
  drawPdfImageCreeped,
  embedPreparedImage,
  toPoints,
} from "../imposition/pdfUtils";

const outputWidth = ref(8.5);
const outputHeight = ref(11);
const pageWidth = ref(3.5);
const pageHeight = ref(2.5);
const marginTop = ref(0.25);
const marginRight = ref(0.25);
const marginBottom = ref(0.25);
const marginLeft = ref(0.25);
const horizontalGap = ref(0);
const verticalGap = ref(0);
const rowsPerSheet = ref(4);
const colsPerSheet = ref(2);
const manualPageCount = ref(8);
const showCropMarks = ref(true);
const cropMarkOffset = ref(0.08);
const cropMarkLength = ref(0.18);
const bleedTop = ref(0.125);
const bleedRight = ref(0.125);
const bleedBottom = ref(0.125);
const bleedLeft = ref(0.125);
const uploadedFiles = ref([]);

const isGeneratingPdf = ref(false);
const pdfError = ref("");
const combinedPdfUrl = ref("");

const sortedUploadedFiles = computed(() =>
  uploadedFiles.value.slice().sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  ),
);

const usableWidth = computed(
  () => Math.max(0, Number(outputWidth.value) - Number(marginLeft.value) - Number(marginRight.value)),
);
const usableHeight = computed(
  () => Math.max(0, Number(outputHeight.value) - Number(marginTop.value) - Number(marginBottom.value)),
);

function requiredLayoutWidthForCols(cols) {
  if (cols <= 0) {
    return 0;
  }
  const trimW = Math.max(0.0001, Number(pageWidth.value) || 0);
  const gap = Math.max(0, Number(verticalGap.value) || 0);
  const bL = Math.max(0, Number(bleedLeft.value) || 0);
  const bR = Math.max(0, Number(bleedRight.value) || 0);
  return cols * trimW + (cols - 1) * (gap + bL + bR) + bL + bR;
}

function requiredLayoutHeightForRows(rows) {
  if (rows <= 0) {
    return 0;
  }
  const trimH = Math.max(0.0001, Number(pageHeight.value) || 0);
  const gap = Math.max(0, Number(horizontalGap.value) || 0);
  const bT = Math.max(0, Number(bleedTop.value) || 0);
  const bB = Math.max(0, Number(bleedBottom.value) || 0);
  return rows * trimH + (rows - 1) * (gap + bT + bB) + bT + bB;
}

function maxCountThatFits(limit, requiredForCount) {
  let count = 0;
  while (requiredForCount(count + 1) <= limit + 1e-8) {
    count += 1;
    if (count >= 1000) {
      break;
    }
  }
  return count;
}

const maxColsThatFit = computed(() =>
  maxCountThatFits(usableWidth.value, requiredLayoutWidthForCols),
);

const maxRowsThatFit = computed(() =>
  maxCountThatFits(usableHeight.value, requiredLayoutHeightForRows),
);

watch(
  [maxColsThatFit, maxRowsThatFit],
  ([maxCols, maxRows]) => {
    colsPerSheet.value = Math.max(1, Math.min(Number(colsPerSheet.value) || 1, maxCols || 1));
    rowsPerSheet.value = Math.max(1, Math.min(Number(rowsPerSheet.value) || 1, maxRows || 1));
  },
  { immediate: true },
);

const pageCapacity = computed(() => Math.max(1, rowsPerSheet.value * colsPerSheet.value));
const uploadedPageCount = computed(() => sortedUploadedFiles.value.length);
const usingManualPageCount = computed(() => uploadedPageCount.value === 0);
const effectivePageCount = computed(() =>
  usingManualPageCount.value
    ? Math.max(1, Math.min(pageCapacity.value, Math.floor(Number(manualPageCount.value) || 1)))
    : Math.min(pageCapacity.value, uploadedPageCount.value),
);
const blankPagesNeeded = computed(() => Math.max(0, pageCapacity.value - effectivePageCount.value));

watch(pageCapacity, (capacity) => {
  manualPageCount.value = Math.max(1, Math.min(Math.floor(Number(manualPageCount.value) || 1), capacity));
});

const filePreview = computed(() => sortedUploadedFiles.value.slice(0, 6).map((file) => file.name));

const slotFrames = computed(() => {
  const slots = [];
  const cols = colsPerSheet.value;
  const rows = rowsPerSheet.value;
  const bT = Math.max(0, Number(bleedTop.value) || 0);
  const bR = Math.max(0, Number(bleedRight.value) || 0);
  const bB = Math.max(0, Number(bleedBottom.value) || 0);
  const bL = Math.max(0, Number(bleedLeft.value) || 0);
  const trimW = Math.max(0.0001, Number(pageWidth.value) || 0);
  const trimH = Math.max(0.0001, Number(pageHeight.value) || 0);
  const xStep = trimW + Math.max(0, Number(verticalGap.value) || 0) + bL + bR;
  const yStep = trimH + Math.max(0, Number(horizontalGap.value) || 0) + bT + bB;
  const startX = Number(marginLeft.value) + bL;
  const topY = Number(outputHeight.value) - Number(marginTop.value) - bT;

  let absolute = 1;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = startX + col * xStep;
      const y = topY - trimH - row * yStep;
      const isActive = absolute <= effectivePageCount.value;
      slots.push({
        index: absolute,
        x,
        y,
        width: trimW,
        height: trimH,
        isActive,
        file: sortedUploadedFiles.value[absolute - 1] ?? null,
      });
      absolute += 1;
    }
  }
  return slots;
});

const layoutFits = computed(() => maxColsThatFit.value > 0 && maxRowsThatFit.value > 0);

const previewScale = computed(() => 44);
const previewWidthPx = computed(() => Number(outputWidth.value) * previewScale.value);
const previewHeightPx = computed(() => Number(outputHeight.value) * previewScale.value);
const bleedPreviewActive = computed(
  () =>
    Number(bleedTop.value) > 0 ||
    Number(bleedRight.value) > 0 ||
    Number(bleedBottom.value) > 0 ||
    Number(bleedLeft.value) > 0,
);

function onFileUpload(event) {
  const files = Array.from(event?.target?.files ?? []);
  uploadedFiles.value = files.filter((file) => file.type.startsWith("image/"));
}

function onFolderUpload(event) {
  onFileUpload(event);
}

function getBleedPreviewRect(slot) {
  const trimW = Math.max(0.0001, Number(pageWidth.value));
  const trimH = Math.max(0.0001, Number(pageHeight.value));
  const bT = Math.max(0, Number(bleedTop.value) || 0);
  const bR = Math.max(0, Number(bleedRight.value) || 0);
  const bB = Math.max(0, Number(bleedBottom.value) || 0);
  const bL = Math.max(0, Number(bleedLeft.value) || 0);

  const bleedWidth = slot.width * ((trimW + bL + bR) / trimW);
  const bleedHeight = slot.height * ((trimH + bT + bB) / trimH);
  const bleedX = slot.x - slot.width * (bL / trimW);
  const bleedY = slot.y - slot.height * (bB / trimH);

  return { x: bleedX, y: bleedY, width: bleedWidth, height: bleedHeight };
}

function revokeCombinedPdfUrl() {
  if (combinedPdfUrl.value) {
    URL.revokeObjectURL(combinedPdfUrl.value);
    combinedPdfUrl.value = "";
  }
}

onBeforeUnmount(() => {
  revokeCombinedPdfUrl();
});

function drawPlaceholder(page, slot) {
  page.drawRectangle({
    x: toPoints(slot.x),
    y: toPoints(slot.y),
    width: toPoints(slot.width),
    height: toPoints(slot.height),
    color: rgb(0.86, 0.87, 0.89),
    borderColor: rgb(0.7, 0.72, 0.75),
    borderWidth: 0.75,
  });
}

function drawImageContain(page, image, slot) {
  const slotW = toPoints(slot.width);
  const slotH = toPoints(slot.height);
  const trimW = Math.max(0.0001, Number(pageWidth.value));
  const trimH = Math.max(0.0001, Number(pageHeight.value));
  const bT = Math.max(0, Number(bleedTop.value) || 0);
  const bR = Math.max(0, Number(bleedRight.value) || 0);
  const bB = Math.max(0, Number(bleedBottom.value) || 0);
  const bL = Math.max(0, Number(bleedLeft.value) || 0);
  const hasBleed = bT > 0 || bR > 0 || bB > 0 || bL > 0;

  let fitRectW = slotW;
  let fitRectH = slotH;
  let fitRectX = toPoints(slot.x);
  let fitRectY = toPoints(slot.y);

  if (hasBleed) {
    fitRectW = slotW * ((trimW + bL + bR) / trimW);
    fitRectH = slotH * ((trimH + bT + bB) / trimH);
    fitRectX = toPoints(slot.x) - slotW * (bL / trimW);
    fitRectY = toPoints(slot.y) - slotH * (bB / trimH);
  }

  const widthScale = fitRectW / image.width;
  const heightScale = fitRectH / image.height;
  const scale = Math.min(widthScale, heightScale);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const drawX = fitRectX + (fitRectW - drawW) / 2;
  const drawY = fitRectY + (fitRectH - drawH) / 2;

  const clipX = hasBleed ? fitRectX : toPoints(slot.x);
  const clipY = hasBleed ? fitRectY : toPoints(slot.y);
  const clipW = hasBleed ? fitRectW : slotW;
  const clipH = hasBleed ? fitRectH : slotH;

  drawPdfImageCreeped(page, image, {
    clipX,
    clipY,
    clipW,
    clipH,
    drawX,
    drawY,
    drawW,
    drawH,
    clipToSlot: hasBleed,
  });
}

async function generatePdfOutput() {
  if (!layoutFits.value) {
    pdfError.value = "Current sizes/margins do not fit on the output sheet.";
    return;
  }

  isGeneratingPdf.value = true;
  pdfError.value = "";
  revokeCombinedPdfUrl();

  try {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([toPoints(Number(outputWidth.value)), toPoints(Number(outputHeight.value))]);

    for (const slot of slotFrames.value) {
      if (!slot.isActive) {
        continue;
      }

      const embedded = slot.file ? await embedPreparedImage(pdf, slot.file, 0) : null;
      if (embedded) {
        drawImageContain(page, embedded, slot);
      } else {
        drawPlaceholder(page, slot);
      }

      if (showCropMarks.value) {
        drawCropMarks(
          page,
          toPoints(slot.x),
          toPoints(slot.y),
          toPoints(slot.width),
          toPoints(slot.height),
          toPoints(Number(cropMarkOffset.value)),
          toPoints(Number(cropMarkLength.value)),
          { top: true, right: true, bottom: true, left: true },
        );
      }
    }

    const bytes = await pdf.save();
    combinedPdfUrl.value = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  } catch (error) {
    pdfError.value = "Could not generate PDF output. Try PNG/JPG images and check inputs.";
  } finally {
    isGeneratingPdf.value = false;
  }
}

function triggerDownload(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadCombinedPdf() {
  if (!combinedPdfUrl.value) {
    return;
  }
  triggerDownload(combinedPdfUrl.value, "bookmaker-flat-fit.pdf");
}

const pdfOutputState = computed(() => ({
  isGeneratingPdf: isGeneratingPdf.value,
  pdfError: pdfError.value,
  combinedPdfUrl: combinedPdfUrl.value,
  combinedPdfPageCount: combinedPdfUrl.value ? 1 : 0,
  rasterizeProgressActive: false,
  rasterizeProgressCurrent: 0,
  rasterizeProgressTotal: 0,
  rasterizeProgressPercent: 0,
}));

const pdfOutputHandlers = {
  generatePdfOutput,
  downloadCombinedPdf,
};
</script>

<template>
  <main class="page">
    <section class="card">
      <h1>Flat Fit</h1>
      <p class="subtitle">
        Single-sided page packing for flat sheets. This version skips fold logic and lays out as many
        pages as fit based on your size, margins, gaps, and row/column settings.
      </p>

      <div class="grid">
        <div class="field field-full size-groups">
          <section class="size-group">
            <h3>Page</h3>
            <label class="field">
              <span>Width (in)</span>
              <input v-model.number="pageWidth" type="number" step="0.01" min="0.1" />
            </label>
            <label class="field">
              <span>Height (in)</span>
              <input v-model.number="pageHeight" type="number" step="0.01" min="0.1" />
            </label>
          </section>
          <section class="size-group">
            <h3>Output</h3>
            <label class="field">
              <span>Width (in)</span>
              <input v-model.number="outputWidth" type="number" step="0.01" min="1" />
            </label>
            <label class="field">
              <span>Height (in)</span>
              <input v-model.number="outputHeight" type="number" step="0.01" min="1" />
            </label>
          </section>
          <section class="size-group size-group--gaps">
            <h3>Gaps</h3>
            <label class="field">
              <span>Vertical Gap (in)</span>
              <input v-model.number="verticalGap" type="number" step="0.01" min="0" />
            </label>
            <label class="field">
              <span>Horizontal Gap (in)</span>
              <input v-model.number="horizontalGap" type="number" step="0.01" min="0" />
            </label>
          </section>
          <section class="size-group size-group--gaps">
            <h3>Output Sheet Grid</h3>
            <label class="field">
              <span>Columns Per Sheet</span>
              <input
                v-model.number="colsPerSheet"
                type="number"
                step="1"
                min="1"
                :max="Math.max(1, maxColsThatFit)"
              />
              <small>Max fit: {{ Math.max(1, maxColsThatFit) }}</small>
            </label>
            <label class="field">
              <span>Rows Per Sheet</span>
              <input
                v-model.number="rowsPerSheet"
                type="number"
                step="1"
                min="1"
                :max="Math.max(1, maxRowsThatFit)"
              />
              <small>Max fit: {{ Math.max(1, maxRowsThatFit) }}</small>
            </label>
          </section>
        </div>

        <div class="field field-full size-groups">
          <section class="size-group size-group--gaps">
            <h3>Margins (in)</h3>
            <label class="field">
              <span>Top</span>
              <input v-model.number="marginTop" type="number" step="0.01" min="0" />
            </label>
            <label class="field">
              <span>Right</span>
              <input v-model.number="marginRight" type="number" step="0.01" min="0" />
            </label>
            <label class="field">
              <span>Bottom</span>
              <input v-model.number="marginBottom" type="number" step="0.01" min="0" />
            </label>
            <label class="field">
              <span>Left</span>
              <input v-model.number="marginLeft" type="number" step="0.01" min="0" />
            </label>
          </section>
          <section class="size-group size-group--gaps">
            <h3>Crop Marks</h3>
            <label class="field checkbox-field" for="flat-fit-show-crop-marks">
              <input
                id="flat-fit-show-crop-marks"
                v-model="showCropMarks"
                type="checkbox"
                name="flat-fit-show-crop-marks"
              />
              <span>Show crop marks</span>
            </label>
            <label class="field">
              <span>Offset (in)</span>
              <input
                v-model.number="cropMarkOffset"
                type="number"
                step="0.01"
                min="0"
                :disabled="!showCropMarks"
              />
            </label>
            <label class="field">
              <span>Length (in)</span>
              <input
                v-model.number="cropMarkLength"
                type="number"
                step="0.01"
                min="0"
                :disabled="!showCropMarks"
              />
            </label>
          </section>
          <section class="size-group size-group--gaps">
            <h3>Image Bleed (in)</h3>
            <label class="field">
              <span>Top</span>
              <input v-model.number="bleedTop" type="number" step="0.01" min="0" />
            </label>
            <label class="field">
              <span>Right</span>
              <input v-model.number="bleedRight" type="number" step="0.01" min="0" />
            </label>
            <label class="field">
              <span>Bottom</span>
              <input v-model.number="bleedBottom" type="number" step="0.01" min="0" />
            </label>
            <label class="field">
              <span>Left</span>
              <input v-model.number="bleedLeft" type="number" step="0.01" min="0" />
            </label>
          </section>
          <section class="size-group size-group--summary">
            <h3>Flat Fit Summary</h3>
            <div class="stats stats--summary">
              <p><strong>Capacity:</strong> {{ pageCapacity }} page{{ pageCapacity === 1 ? "" : "s" }}</p>
              <p><strong>Placed:</strong> {{ effectivePageCount }}</p>
              <p><strong>Blank slots:</strong> {{ blankPagesNeeded }}</p>
              <p><strong>Grid:</strong> {{ colsPerSheet }} x {{ rowsPerSheet }}</p>
            </div>
            <small>Default example: 2.5 x 3.5 on 8.5 x 11 with 0.25 margins => 3 x 3 (9-up)</small>
            <label class="field" v-if="usingManualPageCount">
              <span>Proof Page Count (no uploads)</span>
              <input v-model.number="manualPageCount" type="number" step="1" min="1" :max="pageCapacity" />
              <small>Default matches capacity so you can proof the full sheet.</small>
            </label>
            <div v-else class="field">
              <span>Page Count Source</span>
              <small>Using uploaded images (up to capacity).</small>
              <small>Uploaded: {{ uploadedPageCount }} page{{ uploadedPageCount === 1 ? "" : "s" }}</small>
            </div>
            <small>
              Expected source image size: width = page width + left + right bleed; height = page
              height + top + bottom bleed.
            </small>
          </section>
        </div>
      </div>

      <div class="grid" style="margin-top: 1rem">
        <label class="field">
          <span>Page Images Folder</span>
          <input type="file" webkitdirectory directory multiple accept="image/*" @change="onFolderUpload" />
          <small>Select a folder with sequential image pages.</small>
        </label>
        <label class="field">
          <span>Or Select Image Files Directly</span>
          <input
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,image/*"
            @change="onFileUpload"
          />
          <small>{{ uploadedPageCount }} image page{{ uploadedPageCount === 1 ? "" : "s" }} detected</small>
          <small v-if="filePreview.length > 0">
            Preview: {{ filePreview.join(", ") }}{{ uploadedPageCount > 6 ? "..." : "" }}
          </small>
        </label>
      </div>

      <div v-if="!layoutFits" class="error-text" style="margin-top: 0.75rem">
        Current dimensions do not fit at least one page in each direction.
      </div>

      <div class="flat-fit-preview">
        <p v-if="bleedPreviewActive" class="note flat-fit-preview-note">
          Dashed blue outline shows bleed extent; solid gray box shows trim.
        </p>
        <svg
          :viewBox="`0 0 ${previewWidthPx} ${previewHeightPx}`"
          :width="previewWidthPx"
          :height="previewHeightPx"
          aria-label="Flat fit preview"
        >
          <rect
            x="1"
            y="1"
            :width="previewWidthPx - 2"
            :height="previewHeightPx - 2"
            fill="#f8f9fc"
            stroke="#8793aa"
            stroke-width="2"
          />
          <g v-for="slot in slotFrames" :key="slot.index">
            <rect
              v-if="slot.isActive && bleedPreviewActive"
              :x="getBleedPreviewRect(slot).x * previewScale"
              :y="
                previewHeightPx -
                (getBleedPreviewRect(slot).y + getBleedPreviewRect(slot).height) *
                  previewScale
              "
              :width="getBleedPreviewRect(slot).width * previewScale"
              :height="getBleedPreviewRect(slot).height * previewScale"
              fill="none"
              stroke="#3b82f6"
              stroke-width="1.2"
              stroke-dasharray="5 3"
            />
            <rect
              :x="slot.x * previewScale"
              :y="previewHeightPx - (slot.y + slot.height) * previewScale"
              :width="slot.width * previewScale"
              :height="slot.height * previewScale"
              :fill="slot.isActive ? '#d8dbe2' : '#f0f1f5'"
              :stroke="slot.isActive ? '#7b8598' : '#c6cbd6'"
              stroke-width="1.2"
            />
            <text
              v-if="slot.isActive"
              :x="(slot.x + slot.width / 2) * previewScale"
              :y="previewHeightPx - (slot.y + slot.height / 2) * previewScale"
              text-anchor="middle"
              dominant-baseline="middle"
              font-size="11"
              fill="#2b3242"
            >
              {{ slot.file ? slot.file.name : `Page ${slot.index}` }}
            </text>
          </g>
        </svg>
      </div>

      <div class="pdf-output">
        <PdfOutputActions :state="pdfOutputState" :handlers="pdfOutputHandlers" />
      </div>
    </section>
  </main>
</template>

<style scoped>
.flat-fit-preview {
  margin-top: 1rem;
  width: 100%;
  overflow: auto;
  border: 1px solid #dde2ee;
  border-radius: 0.75rem;
  background: #ffffff;
  padding: 0.75rem;
}

.flat-fit-preview-note {
  margin: 0 0 0.5rem;
}

.flat-fit-preview svg {
  max-width: 100%;
  height: auto;
  display: block;
}
</style>
