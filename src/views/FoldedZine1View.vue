<script setup>
import { computed, ref } from "vue";
import { PDFDocument, rgb } from "pdf-lib";

/** Portrait letter 8.5×11: 2 cols × 4 rows, no gaps. Each cell 4.25×2.75 in. */
const OUTPUT_WIDTH_IN = 8.5;
const OUTPUT_HEIGHT_IN = 11;
const COLS = 2;
const ROWS = 4;
/** Exact cell size: 2×4.25 = 8.5, 4×2.75 = 11 */
const CELL_W_IN = OUTPUT_WIDTH_IN / COLS;
const CELL_H_IN = OUTPUT_HEIGHT_IN / ROWS;
/** Vertical dashed cut guide: length on the sheet, centered top-to-bottom on the page. */
const CUT_GUIDE_HEIGHT_IN = 5.5;

/**
 * row = 0 bottom … 3 top (PDF y). Base layout: left col 180°, right 0°; then all
 * pages rotated 90° CCW (−90°): left → 90°, right → 270°.
 * Left column top→bottom: 8,1,2,3. Right column top→bottom: 7,6,5,4.
 */
const ZINE8_SLOTS = [
  { page: 3, row: 0, col: 0, rotation: 90 },
  { page: 4, row: 0, col: 1, rotation: 270 },
  { page: 2, row: 1, col: 0, rotation: 90 },
  { page: 5, row: 1, col: 1, rotation: 270 },
  { page: 1, row: 2, col: 0, rotation: 90 },
  { page: 6, row: 2, col: 1, rotation: 270 },
  { page: 8, row: 3, col: 0, rotation: 90 },
  { page: 7, row: 3, col: 1, rotation: 270 },
];

const uploadedFiles = ref([]);
const numberOfPages = ref(8);
const showCenterCutGuide = ref(true);
const isGeneratingPdf = ref(false);
const pdfError = ref("");
const pdfUrl = ref("");

const uploadedPageCount = computed(() => uploadedFiles.value.length);
const sortedUploadedFiles = computed(() =>
  uploadedFiles.value.slice().sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  ),
);
const usingManualPageCount = computed(() => uploadedPageCount.value === 0);
const effectivePageCount = computed(() =>
  uploadedPageCount.value > 0
    ? uploadedPageCount.value
    : Math.min(8, Math.max(0, Math.floor(Number(numberOfPages.value) || 0))),
);

const formattedFilePreview = computed(() =>
  sortedUploadedFiles.value.slice(0, 6).map((file) => file.name),
);

function toPoints(inches) {
  return inches * 72;
}

function revokePdfUrl() {
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value);
    pdfUrl.value = "";
  }
}

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
  numberOfPages.value = Math.min(
    8,
    Math.max(0, Math.floor(Number(event.target.value) || 0)),
  );
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
  if (normalized === 0 && (isPng || isJpg)) {
    return embedFileImage(pdfDocument, file);
  }
  const rotatedBytes = await rotateImageFileToPngBytes(file, normalized);
  return pdfDocument.embedPng(rotatedBytes);
}

async function createZinePlaceholderPngBytes(pageNum, rotationDegreesValue) {
  const baseWidth = 700;
  const baseHeight = Math.round((baseWidth * CELL_H_IN) / CELL_W_IN);
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
  context.lineWidth = 3;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  const title = `Page ${pageNum}`;
  const sub = pageNum === 1 ? "Cover" : pageNum === 8 ? "Back cover" : "";
  context.fillStyle = "#31313a";
  context.font = "700 52px Helvetica, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(title, canvas.width / 2, canvas.height / 2 - (sub ? 18 : 0));
  if (sub) {
    context.fillStyle = "#5b5b63";
    context.font = "400 28px Helvetica, Arial, sans-serif";
    context.fillText(sub, canvas.width / 2, canvas.height / 2 + 28);
  }
  const normalized = ((Number(rotationDegreesValue) % 360) + 360) % 360;
  if (normalized === 0) {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error("Failed to convert placeholder."));
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
  const rc = rotatedCanvas.getContext("2d");
  if (!rc) {
    throw new Error("Canvas context unavailable.");
  }
  rc.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
  rc.rotate((normalized * Math.PI) / 180);
  rc.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  const rotatedBlob = await new Promise((resolve, reject) => {
    rotatedCanvas.toBlob((result) => {
      if (!result) {
        reject(new Error("Failed to rotate placeholder."));
        return;
      }
      resolve(result);
    }, "image/png");
  });
  return rotatedBlob.arrayBuffer();
}

function drawVerticalDashedLine(page, x, y1, y2, thickness, color) {
  const dash = 6;
  const gap = 4;
  let y = y1;
  while (y < y2 - 0.5) {
    const end = Math.min(y + dash, y2);
    page.drawLine({
      start: { x, y },
      end: { x, y: end },
      thickness,
      color,
    });
    y = end + gap;
  }
}

function getFileForPage(pageNum) {
  return sortedUploadedFiles.value[pageNum - 1] ?? null;
}

function hasSourceForPage(pageNum) {
  return pageNum <= effectivePageCount.value;
}

async function generateZinePdf() {
  isGeneratingPdf.value = true;
  pdfError.value = "";
  revokePdfUrl();
  try {
    const pdf = await PDFDocument.create();
    const pageW = toPoints(OUTPUT_WIDTH_IN);
    const pageH = toPoints(OUTPUT_HEIGHT_IN);
    const cellW = toPoints(CELL_W_IN);
    const cellH = toPoints(CELL_H_IN);
    const pdfPage = pdf.addPage([pageW, pageH]);

    for (const slot of ZINE8_SLOTS) {
      const { page: pageNum, row, col, rotation } = slot;
      const x = col * cellW;
      const y = row * cellH;
      const file = getFileForPage(pageNum);
      const needsContent = hasSourceForPage(pageNum);

      if (needsContent && file) {
        const embedded = await embedPreparedImage(pdf, file, rotation);
        if (embedded) {
          const iw = embedded.width;
          const ih = embedded.height;
          const scale = Math.min(cellW / iw, cellH / ih);
          const dw = iw * scale;
          const dh = ih * scale;
          const cx = x + (cellW - dw) / 2;
          const cy = y + (cellH - dh) / 2;
          pdfPage.drawImage(embedded, {
            x: cx,
            y: cy,
            width: dw,
            height: dh,
          });
          continue;
        }
      }

      if (needsContent) {
        const placeholderBytes = await createZinePlaceholderPngBytes(
          pageNum,
          rotation,
        );
        const placeholderImage = await pdf.embedPng(placeholderBytes);
        pdfPage.drawImage(placeholderImage, {
          x,
          y,
          width: cellW,
          height: cellH,
        });
      }
    }

    if (showCenterCutGuide.value) {
      const cutX = cellW;
      const cutColor = rgb(0.35, 0.35, 0.38);
      const guideLen = toPoints(CUT_GUIDE_HEIGHT_IN);
      const midY = pageH / 2;
      const y1 = midY - guideLen / 2;
      const y2 = midY + guideLen / 2;
      drawVerticalDashedLine(pdfPage, cutX, y1, y2, 0.8, cutColor);
    }

    const bytes = await pdf.save();
    pdfUrl.value = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
  } catch {
    pdfError.value =
      "Could not generate PDF. Use PNG or JPG images and try again.";
  } finally {
    isGeneratingPdf.value = false;
  }
}

function downloadPdf() {
  if (!pdfUrl.value) {
    return;
  }
  const link = document.createElement("a");
  link.href = pdfUrl.value;
  link.download = "zine-8-single-sided.pdf";
  link.click();
}
</script>

<template>
  <main class="page">
    <section class="card zine8-card">
      <h1>Folded Zine 1</h1>
      <p class="subtitle">
        Eight pages on one portrait 8.5″×11″ sheet (single-sided), 2 columns × 4
        rows. Each panel is 2.75″×4.25″ with no gaps.
      </p>

      <div class="grid">
        <label class="field">
          <span>Page images (folder)</span>
          <input
            type="file"
            webkitdirectory
            directory
            multiple
            accept="image/*"
            @change="onFolderUpload"
          />
          <small>Files are ordered by name; image 1 → page 1, etc.</small>
        </label>

        <label class="field">
          <span>Or select image files</span>
          <input
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,image/*"
            @change="onFileUpload"
          />
          <small
            >{{ uploadedPageCount }} image{{
              uploadedPageCount === 1 ? "" : "s"
            }}
            detected</small
          >
          <small v-if="formattedFilePreview.length > 0">
            Preview: {{ formattedFilePreview.join(", ")
            }}{{ uploadedPageCount > 6 ? "..." : "" }}
          </small>
        </label>

        <label class="field field-full">
          <span>Page count (when no images uploaded)</span>
          <input
            :value="numberOfPages"
            type="number"
            min="0"
            max="8"
            step="1"
            :disabled="uploadedPageCount > 0"
            @input="onNumberOfPagesInput"
          />
          <small v-if="uploadedPageCount > 0"
            >Using uploaded file count ({{ uploadedPageCount }}).</small
          >
          <small v-else
            >Placeholders for pages 1–{{ effectivePageCount }}; others
            blank.</small
          >
        </label>

        <label class="field field-full checkbox-field">
          <input id="cut-guide" v-model="showCenterCutGuide" type="checkbox" />
          <span
            >Include vertical center cut guide (5.5″ dashed line, centered on
            the sheet)</span
          >
        </label>
      </div>

      <div class="actions">
        <button
          type="button"
          class="primary-button"
          :disabled="isGeneratingPdf"
          @click="generateZinePdf"
        >
          {{ isGeneratingPdf ? "Generating…" : "Generate PDF" }}
        </button>
        <small v-if="pdfError" class="error-text">{{ pdfError }}</small>
      </div>

      <div v-if="pdfUrl" class="download-group">
        <button type="button" class="small-button" @click="downloadPdf">
          Download PDF (1 page)
        </button>
      </div>

      <div v-if="pdfUrl" class="pdf-preview-single">
        <section class="pdf-pane pdf-pane-wide">
          <h4>Preview</h4>
          <iframe :src="pdfUrl" title="Zine 8 PDF preview"></iframe>
        </section>
      </div>
    </section>
  </main>
</template>

<style scoped>
.zine8-card {
  width: min(920px, 100%);
}

.checkbox-field {
  flex-direction: row;
  align-items: flex-start;
  gap: 0.5rem;
}

.checkbox-field input {
  margin-top: 0.2rem;
}

.checkbox-field span {
  font-weight: 500;
  font-size: 0.92rem;
}
</style>
