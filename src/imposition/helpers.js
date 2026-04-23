const PAGES_PER_SHEET = 4;

function normalizePositiveInteger(value, fallback = 1) {
  const normalized = Math.floor(Number(value) || fallback);
  return Math.max(1, normalized);
}

/**
 * Zigzag nesting: sheet index 0 is outer (high|low), last index innermost.
 * Front pair high|low. Back pair order depends on fold axis: vertical fold places
 * page halves left|right, so verso reads (low+1)|(high-1); horizontal fold stacks
 * halves, so verso keeps (high-1) above (low+1) in slot order for duplex.
 */
export function buildSignatureSheets({
  signatureIndex,
  sheetsPerSignature,
  foldAxis,
  buildSheetSlot,
}) {
  const signatureSheetCount = normalizePositiveInteger(sheetsPerSignature, 1);
  const signaturePageCount = signatureSheetCount * PAGES_PER_SHEET;
  const signatureOffset = signatureIndex * signaturePageCount;
  const foldVertical = foldAxis === "vertical";

  return Array.from({ length: signatureSheetCount }, (_, sheetIndex) => {
    const lowPage = sheetIndex * 2 + 1;
    const highPage = signaturePageCount - sheetIndex * 2;
    const versoFirst = foldVertical ? lowPage + 1 : highPage - 1;
    const versoSecond = foldVertical ? highPage - 1 : lowPage + 1;

    return {
      sheetNumber: sheetIndex + 1,
      front: [
        buildSheetSlot(signatureOffset, highPage),
        buildSheetSlot(signatureOffset, lowPage),
      ],
      back: [
        buildSheetSlot(signatureOffset, versoFirst),
        buildSheetSlot(signatureOffset, versoSecond),
      ],
    };
  });
}

/**
 * Maps physical sheets (sequential after zigzag build) onto output grid cells.
 * Front: each row right-to-left. Back: left-to-right, rows top-to-bottom.
 * Row-major sheetIndex is row * cols + col (matches placeSheetsOnOutputSheet).
 */
export function layoutSheetsOnOutputGrid(physicalSheets, side, pattern) {
  const sheetCols = Math.max(1, Math.floor(Number(pattern?.sheetCols) || 1));
  const sheetRows = Math.max(1, Math.floor(Number(pattern?.sheetRows) || 1));
  const gridSlots = sheetCols * sheetRows;
  const n = physicalSheets.length;

  const visitOrder = [];
  if (side === "front") {
    for (let row = 0; row < sheetRows; row += 1) {
      for (let col = sheetCols - 1; col >= 0; col -= 1) {
        visitOrder.push(row * sheetCols + col);
      }
    }
  } else {
    for (let row = 0; row < sheetRows; row += 1) {
      for (let col = 0; col < sheetCols; col += 1) {
        visitOrder.push(row * sheetCols + col);
      }
    }
  }

  const out = Array.from({ length: gridSlots }, () => null);
  for (let i = 0; i < n && i < visitOrder.length; i += 1) {
    out[visitOrder[i]] = physicalSheets[i];
  }
  return out;
}

export function placeSheetsOnOutputSheet({ sheets, side, pattern, foldAxis }) {
  const sheetCols = Math.max(1, Math.floor(Number(pattern?.sheetCols) || 1));
  const sheetRows = Math.max(1, Math.floor(Number(pattern?.sheetRows) || 1));
  const targetSheetCount = sheetCols * sheetRows;
  const placedSlots = [];

  for (let sheetIndex = 0; sheetIndex < targetSheetCount; sheetIndex += 1) {
    const sheet = sheets[sheetIndex];
    if (!sheet) {
      continue;
    }

    const sheetRow = Math.floor(sheetIndex / sheetCols);
    const sheetCol = sheetIndex % sheetCols;
    const slotPair = side === "front" ? sheet.front : sheet.back;

    for (let pageIndex = 0; pageIndex < slotPair.length; pageIndex += 1) {
      const slot = slotPair[pageIndex];
      placedSlots.push({
        ...slot,
        sheetNumber: sheet?.sheetNumber,
        gridRow: sheetRow,
        sheetCol,
        pageIndexWithinSheet: pageIndex,
      });
    }
  }

  return {
    slots: placedSlots,
    rowCount: sheetRows,
    sheetCols,
    foldAxis,
  };
}

export function buildImpositionOutputs({
  templateMatchesCurrentInputs,
  outputLayoutPattern,
  numberOfSignatures,
  sheetsPerSignature,
  foldAxis,
  buildSheetSlot,
}) {
  if (!templateMatchesCurrentInputs) {
    return [];
  }

  const normalizedSheetsPerOutput =
    outputLayoutPattern.sheetCols * outputLayoutPattern.sheetRows;
  const allPhysicalSheets = [];

  for (
    let signatureIndex = 0;
    signatureIndex < numberOfSignatures;
    signatureIndex += 1
  ) {
    allPhysicalSheets.push(
      ...buildSignatureSheets({
        signatureIndex,
        sheetsPerSignature,
        foldAxis,
        buildSheetSlot,
      }),
    );
  }

  const outputCount = Math.ceil(
    allPhysicalSheets.length / normalizedSheetsPerOutput,
  );
  const outputs = [];

  for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
    const start = outputIndex * normalizedSheetsPerOutput;
    const end = start + normalizedSheetsPerOutput;
    const outputSheets = allPhysicalSheets.slice(start, end);
    const frontSheets = layoutSheetsOnOutputGrid(
      outputSheets,
      "front",
      outputLayoutPattern,
    );
    const backSheets = layoutSheetsOnOutputGrid(
      outputSheets,
      "back",
      outputLayoutPattern,
    );

    outputs.push({
      plateNumber: outputIndex + 1,
      front: placeSheetsOnOutputSheet({
        sheets: frontSheets,
        side: "front",
        pattern: outputLayoutPattern,
        foldAxis,
      }),
      back: placeSheetsOnOutputSheet({
        sheets: backSheets,
        side: "back",
        pattern: outputLayoutPattern,
        foldAxis,
      }),
    });
  }

  return outputs;
}
