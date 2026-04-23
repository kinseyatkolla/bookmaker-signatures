import {
  clip,
  degrees,
  drawImage as pdfDrawImageOperators,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from "pdf-lib";

export function toPoints(inches) {
  return inches * 72;
}

export function formatInchesLabel(value) {
  const rounded = Number(value);
  if (!Number.isFinite(rounded)) {
    return "0";
  }
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, "");
}

export function impositionRasterRotationDegrees(plateRotationDegrees) {
  const base = Number(plateRotationDegrees) + 180;
  return ((base % 360) + 360) % 360;
}

export async function rotateImageFileToPngBytes(file, rotationDegreesValue) {
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

export async function embedPreparedImage(pdfDocument, file, rotationDegreesValue) {
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
    return pdfDocument.embedPng(await file.arrayBuffer());
  }
  if (normalized === 0 && isJpg) {
    return pdfDocument.embedJpg(await file.arrayBuffer());
  }

  const rotatedBytes = await rotateImageFileToPngBytes(file, normalized);
  return pdfDocument.embedPng(rotatedBytes);
}

export function drawCropMarks(
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

export function drawPdfImageCreeped(page, image, options) {
  const {
    clipX,
    clipY,
    clipW,
    clipH,
    drawX,
    drawY,
    drawW,
    drawH,
    rotate = degrees(0),
    clipToSlot = false,
  } = options;

  if (!clipToSlot) {
    page.drawImage(image, {
      x: drawX,
      y: drawY,
      width: drawW,
      height: drawH,
      rotate,
    });
    return;
  }

  const xObjectKey = page.node.newXObject("Image", image.ref);
  const contentStream = page.getContentStream();
  contentStream.push(
    pushGraphicsState(),
    rectangle(clipX, clipY, clipW, clipH),
    clip(),
    endPath(),
  );
  contentStream.push(
    ...pdfDrawImageOperators(xObjectKey, {
      x: drawX,
      y: drawY,
      width: drawW,
      height: drawH,
      rotate,
      xSkew: degrees(0),
      ySkew: degrees(0),
    }),
  );
  contentStream.push(popGraphicsState());
}

export function getSheetCreepOffsetPoints({
  sheetNumber,
  foldHorizontal,
  pageIndexWithinSheet,
  pageDepthInches,
}) {
  const sheetIndex0 = Math.max(0, Math.floor(Number(sheetNumber) || 1) - 1);
  const creepPoints = toPoints(sheetIndex0 * Number(pageDepthInches || 0));
  if (!creepPoints) {
    return { dx: 0, dy: 0 };
  }
  if (foldHorizontal) {
    return {
      dx: 0,
      dy: pageIndexWithinSheet === 0 ? creepPoints : -creepPoints,
    };
  }
  return {
    dx: pageIndexWithinSheet === 0 ? creepPoints : -creepPoints,
    dy: 0,
  };
}
