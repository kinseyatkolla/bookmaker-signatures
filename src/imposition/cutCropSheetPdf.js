import { PDFDocument, rgb } from "pdf-lib";
import { drawCropMarks, toPoints } from "./pdfUtils";

function rangesOverlap(minA, maxA, minB, maxB) {
  return Math.min(maxA, maxB) > Math.max(minA, minB);
}

function hasNeighbor(rectangles, currentRect, side, epsilon = 0.01) {
  return rectangles.some((candidate) => {
    if (candidate === currentRect) {
      return false;
    }
    const candidateRight = candidate.x + candidate.width;
    const candidateTop = candidate.y + candidate.height;
    const currentRight = currentRect.x + currentRect.width;
    const currentTop = currentRect.y + currentRect.height;

    if (side === "left") {
      return (
        Math.abs(candidateRight - currentRect.x) <= epsilon &&
        rangesOverlap(candidate.y, candidateTop, currentRect.y, currentTop)
      );
    }
    if (side === "right") {
      return (
        Math.abs(candidate.x - currentRight) <= epsilon &&
        rangesOverlap(candidate.y, candidateTop, currentRect.y, currentTop)
      );
    }
    if (side === "top") {
      return (
        Math.abs(candidate.y - currentTop) <= epsilon &&
        rangesOverlap(candidate.x, candidateRight, currentRect.x, currentRight)
      );
    }
    return (
      Math.abs(candidateTop - currentRect.y) <= epsilon &&
      rangesOverlap(candidate.x, candidateRight, currentRect.x, currentRight)
    );
  });
}

function downloadPdfBlob(pdfBytes, fileName) {
  const blobUrl = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}

export async function generateCutCropSheetPdf({
  layoutPreview,
  outputWidthInches,
  outputHeightInches,
  showCropMarks,
  cropMarkOffsetInches,
  cropMarkLengthInches,
  fileName = "cut-crop-sheet.pdf",
}) {
  const sheets = layoutPreview?.sheets ?? [];
  if (sheets.length === 0) {
    throw new Error("Nothing to render for cut/crop sheet.");
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([toPoints(outputWidthInches), toPoints(outputHeightInches)]);
  const trimBorderColor = rgb(0.1, 0.1, 0.1);
  const foldBorderColor = rgb(0.1, 0.27, 0.75);
  const fillColor = rgb(0.78, 0.78, 0.8);
  const rectangles = [];

  for (const sheet of sheets) {
    rectangles.push(sheet.pageA, sheet.pageB);
  }

  for (const rect of rectangles) {
    const x = toPoints(rect.x);
    const y = toPoints(rect.y);
    const width = toPoints(rect.width);
    const height = toPoints(rect.height);

    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: fillColor,
      borderColor: trimBorderColor,
      borderWidth: 0.8,
    });

    if (showCropMarks) {
      drawCropMarks(
        page,
        x,
        y,
        width,
        height,
        toPoints(cropMarkOffsetInches),
        toPoints(cropMarkLengthInches),
        {
          top: !hasNeighbor(rectangles, rect, "top"),
          bottom: !hasNeighbor(rectangles, rect, "bottom"),
          left: !hasNeighbor(rectangles, rect, "left"),
          right: !hasNeighbor(rectangles, rect, "right"),
        },
      );
    }
  }

  for (const sheet of sheets) {
    if (layoutPreview.foldHorizontal) {
      const yFold = toPoints(sheet.pageA.y + sheet.pageA.height);
      page.drawLine({
        start: { x: toPoints(sheet.pageA.x), y: yFold },
        end: { x: toPoints(sheet.pageA.x + sheet.pageA.width), y: yFold },
        thickness: 1.2,
        color: foldBorderColor,
      });
    } else {
      const xFold = toPoints(sheet.pageA.x + sheet.pageA.width);
      page.drawLine({
        start: { x: xFold, y: toPoints(sheet.pageA.y) },
        end: { x: xFold, y: toPoints(sheet.pageA.y + sheet.pageA.height) },
        thickness: 1.2,
        color: foldBorderColor,
      });
    }
  }

  const bytes = await pdf.save();
  downloadPdfBlob(bytes, fileName);
}
