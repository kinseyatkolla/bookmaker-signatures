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
  const slotBounds = slots.map((slot) => {
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

    return {
      slot,
      x,
      y,
      width: slotWidthPoints,
      height: slotHeightPoints,
      x2: x + slotWidthPoints,
      y2: y + slotHeightPoints,
    };
  });

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    const currentBounds = slotBounds[slotIndex];
    const row = slot.gridRow;
    const sheetCol = slot.sheetCol;
    const pageIndexWithinSheet = slot.pageIndexWithinSheet;
    const { x, y, x2, y2 } = currentBounds;

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

    const pw = Number(asset.pixelWidth);
    const ph = Number(asset.pixelHeight);
    const imageWidth =
      Number.isFinite(pw) && pw > 0 ? pw : asset.image.width;
    const imageHeight =
      Number.isFinite(ph) && ph > 0 ? ph : asset.image.height;

    if (fitMode === "contain") {
      let fitRectX = x;
      let fitRectY = y;
      let fitRectW = slotWidthPoints;
      let fitRectH = slotHeightPoints;

      if (bleedInches && pageTrimInches) {
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
          fitRectW =
            slotWidthPoints * ((trim.width + bleed.left + bleed.right) / trim.width);
          fitRectH =
            slotHeightPoints * ((trim.height + bleed.top + bleed.bottom) / trim.height);
          fitRectX = x - slotWidthPoints * (bleed.left / trim.width);
          fitRectY = y - slotHeightPoints * (bleed.bottom / trim.height);
          bleedActive = true;
        }
      }

      const scale = Math.min(
        fitRectW / imageWidth,
        fitRectH / imageHeight,
      );
      drawW = imageWidth * scale;
      drawH = imageHeight * scale;
      drawX = fitRectX + (fitRectW - drawW) / 2;
      drawY = fitRectY + (fitRectH - drawH) / 2;
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
    const clipBounds = bleedActive
      ? getSafeBleedClipBounds({
          currentBounds,
          allBounds: slotBounds,
          outputWidthPoints,
          outputHeightPoints,
        })
      : null;

    drawPdfImageCreeped(page, asset.image, {
      clipX: clipBounds?.clipX ?? x,
      clipY: clipBounds?.clipY ?? y,
      clipW: clipBounds?.clipW ?? slotWidthPoints,
      clipH: clipBounds?.clipH ?? slotHeightPoints,
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

function rangesOverlap(minA, maxA, minB, maxB) {
  return Math.min(maxA, maxB) > Math.max(minA, minB);
}

function getSafeBleedClipBounds({
  currentBounds,
  allBounds,
  outputWidthPoints,
  outputHeightPoints,
}) {
  let minX = 0;
  let maxX = outputWidthPoints;
  let minY = 0;
  let maxY = outputHeightPoints;

  for (const bounds of allBounds) {
    if (bounds === currentBounds) {
      continue;
    }

    const overlapsY = rangesOverlap(
      currentBounds.y,
      currentBounds.y2,
      bounds.y,
      bounds.y2,
    );
    if (overlapsY) {
      if (bounds.x2 <= currentBounds.x) {
        minX = Math.max(minX, bounds.x2);
      }
      if (bounds.x >= currentBounds.x2) {
        maxX = Math.min(maxX, bounds.x);
      }
    }

    const overlapsX = rangesOverlap(
      currentBounds.x,
      currentBounds.x2,
      bounds.x,
      bounds.x2,
    );
    if (overlapsX) {
      if (bounds.y2 <= currentBounds.y) {
        minY = Math.max(minY, bounds.y2);
      }
      if (bounds.y >= currentBounds.y2) {
        maxY = Math.min(maxY, bounds.y);
      }
    }
  }

  const clipX = Math.max(0, Math.min(currentBounds.x, minX));
  const clipY = Math.max(0, Math.min(currentBounds.y, minY));
  const clipW = Math.max(0.01, Math.min(outputWidthPoints, maxX) - clipX);
  const clipH = Math.max(0.01, Math.min(outputHeightPoints, maxY) - clipY);

  return { clipX, clipY, clipW, clipH };
}
