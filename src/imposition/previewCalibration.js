const PREVIEW_SCALE_STORAGE_KEY = "bookmaker.previewPhysicalScale.v1";
const MIN_PREVIEW_SCALE = 0.25;
const MAX_PREVIEW_SCALE = 4;

function clampScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, numeric));
}

export function loadPreviewPhysicalScale() {
  if (typeof window === "undefined") {
    return 1;
  }
  const saved = window.localStorage.getItem(PREVIEW_SCALE_STORAGE_KEY);
  if (saved == null) {
    return 1;
  }
  return clampScale(saved);
}

export function savePreviewPhysicalScale(scale) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(PREVIEW_SCALE_STORAGE_KEY, String(clampScale(scale)));
}

export function calibratePreviewScale({
  currentScale,
  expectedInches,
  measuredInches,
}) {
  const expected = Number(expectedInches);
  const measured = Number(measuredInches);
  if (!Number.isFinite(expected) || !Number.isFinite(measured) || measured <= 0) {
    return clampScale(currentScale);
  }
  const ratio = expected / measured;
  return clampScale(Number(currentScale) * ratio);
}
