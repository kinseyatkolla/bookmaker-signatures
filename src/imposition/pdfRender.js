import {
  drawCropMarks,
  drawPdfImageCreeped,
  impositionRasterRotationDegrees,
  toPoints,
} from "./pdfUtils";

export async function renderImpositionSide({
  page,
  pdfDocument,
  sideLayout,
  rotationDegreesValue,
  getOutputPageSizeInches,
  getLayoutSlotForGridInches,
  verticalGap,
  horizontalGap,
  cropMarkOffset,
  cropMarkLength,
  showCropMarks,
  resolveSlotAsset,
  getSlotOffset = () => ({ dx: 0, dy: 0 }),
  getRasterRotation = impositionRasterRotationDegrees,
  clipOnOffset = true,
  bleedInches = null,
  pageTrimInches = null,
}) {
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
  const gapBetweenColsPoints = toPoints(Math.max(0, Number(verticalGap)));
  const gapBetweenRowsPoints = toPoints(Math.max(0, Number(horizontalGap)));

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
  const markOffsetPoints = toPoints(cropMarkOffset);
  const markLengthPoints = toPoints(cropMarkLength);

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
      x = cellBaseX + pageIndexWithinSheet * (slotWidthPoints + gapAtFoldPoints);
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

    if (showCropMarks) {
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

    const rasterRotation = foldHorizontal ? getRasterRotation(rotationDegreesValue) : 0;
    const asset = await resolveSlotAsset({
      slot,
      rasterRotation,
      pdfDocument,
      page,
      x,
      y,
      slotWidthPoints,
      slotHeightPoints,
      pageIndexWithinSheet,
      foldHorizontal,
      row,
      sheetCol,
      rowCount,
      sheetCols,
    });

    if (!asset?.image) {
      continue;
    }

    const fitMode = asset.fitMode === "fill-slot" ? "fill-slot" : "contain";
    let drawW = slotWidthPoints;
    let drawH = slotHeightPoints;
    let drawX = x;
    let drawY = y;
    let bleedActive = false;

    if (fitMode === "contain") {
      const imageWidth = asset.image.width;
      const imageHeight = asset.image.height;
      const scale = Math.min(slotWidthPoints / imageWidth, slotHeightPoints / imageHeight);
      drawW = imageWidth * scale;
      drawH = imageHeight * scale;
      drawX = x + (slotWidthPoints - drawW) / 2;
      drawY = y + (slotHeightPoints - drawH) / 2;
    }

    if (fitMode === "contain" && bleedInches && pageTrimInches) {
      const bleed = mapBleedForRotation(
        bleedInches,
        foldHorizontal ? getRasterRotation(rotationDegreesValue) : 0,
      );
      const trim = mapTrimForRotation(
        pageTrimInches,
        foldHorizontal ? getRasterRotation(rotationDegreesValue) : 0,
      );
      const hasBleed =
        bleed.left > 0 || bleed.right > 0 || bleed.top > 0 || bleed.bottom > 0;
      if (hasBleed && trim.width > 0 && trim.height > 0) {
        drawW =
          slotWidthPoints * ((trim.width + bleed.left + bleed.right) / trim.width);
        drawH =
          slotHeightPoints * ((trim.height + bleed.top + bleed.bottom) / trim.height);
        drawX = x - slotWidthPoints * (bleed.left / trim.width);
        drawY = y - slotHeightPoints * (bleed.bottom / trim.height);
        bleedActive = true;
      }
    }

    const offset = getSlotOffset({
      slot,
      foldHorizontal,
      pageIndexWithinSheet,
      slotWidthPoints,
      slotHeightPoints,
      drawX,
      drawY,
      drawW,
      drawH,
    });
    const dx = Number(offset?.dx) || 0;
    const dy = Number(offset?.dy) || 0;
    const clipToSlot =
      (clipOnOffset && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) || bleedActive;

    drawPdfImageCreeped(page, asset.image, {
      clipX: x,
      clipY: y,
      clipW: slotWidthPoints,
      clipH: slotHeightPoints,
      drawX: drawX + dx,
      drawY: drawY + dy,
      drawW,
      drawH,
      clipToSlot,
    });
  }
}

function mapTrimForRotation(trim, rotationDegrees) {
  const normalized = ((Number(rotationDegrees) % 360) + 360) % 360;
  const width = Number(trim?.width) || 0;
  const height = Number(trim?.height) || 0;
  if (normalized === 90 || normalized === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

function mapBleedForRotation(bleed, rotationDegrees) {
  const normalized = ((Number(rotationDegrees) % 360) + 360) % 360;
  const top = Math.max(0, Number(bleed?.top) || 0);
  const right = Math.max(0, Number(bleed?.right) || 0);
  const bottom = Math.max(0, Number(bleed?.bottom) || 0);
  const left = Math.max(0, Number(bleed?.left) || 0);

  if (normalized === 90) {
    return { top: left, right: top, bottom: right, left: bottom };
  }
  if (normalized === 180) {
    return { top: bottom, right: left, bottom: top, left: right };
  }
  if (normalized === 270) {
    return { top: right, right: bottom, bottom: left, left: top };
  }
  return { top, right, bottom, left };
}
