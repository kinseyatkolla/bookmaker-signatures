<script setup>
import { computed, ref, watch } from "vue";
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
const sheetWidth = ref(5);
const sheetHeight = ref(3.5);
const sheetsPerOutput = ref(4);
const expectedImagesPerSignature = 16;
const frontRotationDegrees = ref(90);
const backRotationDegrees = ref(-90);
const cropMarkOffset = ref(0.08);
const cropMarkLength = ref(0.18);
const horizontalGap = ref(0.08);
const verticalGap = ref(0.08);
const isGeneratingPdf = ref(false);
const pdfError = ref("");
const combinedPdfUrl = ref("");

// Template for your provided 16-page layout (2 columns x 4 rows).
const frontPattern = [2, 4, 15, 13, 6, 8, 11, 9];
const backPattern = [3, 1, 14, 16, 7, 5, 10, 12];

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
const templateMatchesCurrentInputs = computed(
  () =>
    sheetsPerSignature.value === 4 &&
    sheetsPerOutput.value === 4 &&
    pagesPerSignature.value === expectedImagesPerSignature,
);

const formattedFilePreview = computed(() =>
  sortedUploadedFiles.value.slice(0, 6).map((file) => file.name),
);

const impositionOutputs = computed(() => {
  if (!templateMatchesCurrentInputs.value) {
    return [];
  }

  return Array.from(
    { length: numberOfSignatures.value },
    (_, signatureIndex) => {
      const signatureOffset = signatureIndex * expectedImagesPerSignature;

      const buildSlot = (relativePageNumber) => {
        const absolutePageNumber = signatureOffset + relativePageNumber;
        const imageFile =
          sortedUploadedFiles.value[absolutePageNumber - 1] ?? null;
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
      };

      return {
        signatureNumber: signatureIndex + 1,
        front: frontPattern.map(buildSlot),
        back: backPattern.map(buildSlot),
      };
    },
  );
});

function getRequiredLayoutForRotation(rotationDegreesValue) {
  const slot = getRotatedSlotSizeInches(rotationDegreesValue);
  const gapX = Math.max(0, Number(horizontalGap.value));
  const gapY = Math.max(0, Number(verticalGap.value));
  return {
    requiredWidth: slot.width * 2 + gapX,
    // Vertical sheet gap is only between sheet blocks, not between the fold halves.
    requiredHeight: slot.height * 4 + gapY,
  };
}

const layoutFit = computed(() => {
  const output = getOutputPageSizeInches();
  const frontRequired = getRequiredLayoutForRotation(
    frontRotationDegrees.value,
  );
  const backRequired = getRequiredLayoutForRotation(backRotationDegrees.value);
  const requiredWidth = Math.max(
    frontRequired.requiredWidth,
    backRequired.requiredWidth,
  );
  const requiredHeight = Math.max(
    frontRequired.requiredHeight,
    backRequired.requiredHeight,
  );

  return {
    outputWidth: output.width,
    outputHeight: output.height,
    requiredWidth,
    requiredHeight,
    fits: requiredWidth <= output.width && requiredHeight <= output.height,
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
  slots,
  rotationDegreesValue,
) {
  const outputSize = getOutputPageSizeInches();
  const outputWidthPoints = toPoints(outputSize.width);
  const outputHeightPoints = toPoints(outputSize.height);
  const slotSize = getRotatedSlotSizeInches(rotationDegreesValue);
  const slotWidthPoints = toPoints(slotSize.width);
  const slotHeightPoints = toPoints(slotSize.height);
  const gapXPoints = toPoints(Math.max(0, Number(horizontalGap.value)));
  const gapYPoints = toPoints(Math.max(0, Number(verticalGap.value)));

  const totalGridWidthPoints = slotWidthPoints * 2 + gapXPoints;
  // Apply one vertical gap between the 2 sheet rows (rows 1 and 2), not between every page row.
  const totalGridHeightPoints = slotHeightPoints * 4 + gapYPoints;
  const startX = (outputWidthPoints - totalGridWidthPoints) / 2;
  const startY = (outputHeightPoints - totalGridHeightPoints) / 2;
  const markOffsetPoints = toPoints(cropMarkOffset.value);
  const markLengthPoints = toPoints(cropMarkLength.value);

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const row = Math.floor(slotIndex / 2);
    const col = slotIndex % 2;
    const x = startX + col * (slotWidthPoints + gapXPoints);
    const rowFromBottom = 3 - row;
    const sheetRowOffset = Math.floor(rowFromBottom / 2) * gapYPoints;
    const y = startY + rowFromBottom * slotHeightPoints + sheetRowOffset;
    const slot = slots[slotIndex];

    drawCropMarks(
      page,
      x,
      y,
      slotWidthPoints,
      slotHeightPoints,
      markOffsetPoints,
      markLengthPoints,
      {
        top: row === 0,
        bottom: row === 3,
        left: col === 0,
        right: col === 1,
      },
    );

    if (!slot.file && slot.hasSourcePage) {
      const placeholderBytes = await createPagePlaceholderPngBytes(
        slot,
        rotationDegreesValue,
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
      rotationDegreesValue,
    );

    if (!embeddedImage && slot.hasSourcePage) {
      const placeholderBytes = await createPagePlaceholderPngBytes(
        slot,
        rotationDegreesValue,
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
      "PDF output currently supports only 4 sheets/signature and 4 sheets/output.";
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
        backRotationDegrees.value,
      );
      await drawImpositionSide(
        secondOutputSheetPage,
        pdf,
        output.front,
        frontRotationDegrees.value,
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
      <h1>Bookmaker Signatures</h1>
      <p class="subtitle">
        Upload a folder of sequential page images, set your layout variables,
        and prepare for signature imposition.
      </p>

      <div class="grid">
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

        <label class="field field-full">
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
            >Auto-calculated from uploaded pages and fixed signatures.</small
          >
        </label>

        <div class="field">
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
            <h3>Sheet</h3>
            <label class="field">
              <span>Width (inches)</span>
              <input
                v-model.number="sheetWidth"
                type="number"
                min="0.1"
                step="0.1"
              />
            </label>
            <label class="field">
              <span>Height (inches)</span>
              <input
                v-model.number="sheetHeight"
                type="number"
                min="0.1"
                step="0.1"
              />
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
            <label class="field">
              <span>Sheets Per Output</span>
              <input
                v-model.number="sheetsPerOutput"
                type="number"
                min="1"
                step="1"
              />
            </label>
          </section>
        </div>
      </div>

      <hr />

      <div class="stats">
        <p><strong>Pages per sheet:</strong> {{ pagesPerSheet }}</p>
        <p><strong>Pages per signature:</strong> {{ pagesPerSignature }}</p>
        <p><strong>Total page capacity:</strong> {{ totalCapacityPages }}</p>
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

      <hr />

      <!-- <div class="imposition">
        
      </div> -->

      <div class="pdf-output">
        <h2>Actual-Size PDF Output</h2>
        <p class="note" :class="{ 'warning-inline': !layoutFit.fits }">
          Required layout size (current rotation):
          {{ layoutFit.requiredWidth.toFixed(2) }}" x
          {{ layoutFit.requiredHeight.toFixed(2) }}". Output page:
          {{ layoutFit.outputWidth.toFixed(2) }}" x
          {{ layoutFit.outputHeight.toFixed(2) }}".
        </p>
        <p v-if="!layoutFit.fits" class="warning">
          This combination overflows the output page at actual size, which
          causes clipped scaling/crop marks. Reduce page size, rotation
          footprint, or gap values.
        </p>

        <div class="pdf-controls">
          <label class="field">
            <span>Sheet Orientation (Front, degrees)</span>
            <select v-model.number="frontRotationDegrees">
              <option :value="0">0°</option>
              <option :value="90">90° CW</option>
              <option :value="-90">90° CCW</option>
              <option :value="180">180°</option>
            </select>
          </label>

          <label class="field">
            <span>Sheet Orientation (Back, degrees)</span>
            <select v-model.number="backRotationDegrees">
              <option :value="0">0°</option>
              <option :value="90">90° CW</option>
              <option :value="-90">90° CCW</option>
              <option :value="180">180°</option>
            </select>
          </label>

          <label class="field">
            <span>Crop Mark Offset (in)</span>
            <input
              v-model.number="cropMarkOffset"
              type="number"
              min="0.01"
              step="0.01"
            />
          </label>

          <label class="field">
            <span>Crop Mark Length (in)</span>
            <input
              v-model.number="cropMarkLength"
              type="number"
              min="0.01"
              step="0.01"
            />
          </label>

          <label class="field">
            <span>Horizontal Gap (in)</span>
            <input
              v-model.number="horizontalGap"
              type="number"
              min="0"
              step="0.01"
            />
          </label>

          <label class="field">
            <span>Vertical Gap (in)</span>
            <input
              v-model.number="verticalGap"
              type="number"
              min="0"
              step="0.01"
            />
            <small
              >Applied only between sheet rows, not at the fold center.</small
            >
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
