export const MOON_TITHI_STEPS = [
  { number: 1, name: "S1", colorKey: "blue" },
  { number: 2, name: "S2", colorKey: "green" },
  { number: 3, name: "S3", colorKey: "green" },
  { number: 4, name: "S4", colorKey: "red" },
  { number: 5, name: "S5", colorKey: "green" },
  { number: 6, name: "S6", colorKey: "green" },
  { number: 7, name: "S7", colorKey: "green" },
  { number: 8, name: "S8", colorKey: "red" },
  { number: 9, name: "S9", colorKey: "red" },
  { number: 10, name: "S10", colorKey: "green" },
  { number: 11, name: "S11", colorKey: "blue" },
  { number: 12, name: "S12", colorKey: "blue" },
  { number: 13, name: "S13", colorKey: "green" },
  { number: 14, name: "S14", colorKey: "red" },
  { number: 15, name: "S15", colorKey: "blue" },
  { number: 16, name: "K1", colorKey: "blue" },
  { number: 17, name: "K2", colorKey: "green" },
  { number: 18, name: "K3", colorKey: "green" },
  { number: 19, name: "K4", colorKey: "red" },
  { number: 20, name: "K5", colorKey: "green" },
  { number: 21, name: "K6", colorKey: "blue" },
  { number: 22, name: "K7", colorKey: "blue" },
  { number: 23, name: "K8", colorKey: "red" },
  { number: 24, name: "K9", colorKey: "red" },
  { number: 25, name: "K10", colorKey: "blue" },
  { number: 26, name: "K11", colorKey: "red" },
  { number: 27, name: "K12", colorKey: "red" },
  { number: 28, name: "K13", colorKey: "red" },
  { number: 29, name: "K14", colorKey: "red" },
  { number: 30, name: "K15", colorKey: "red" },
];

export const getMoonTithiStep = (tithiNumber) => {
  if (typeof tithiNumber !== "number" || tithiNumber < 1 || tithiNumber > 30) {
    return null;
  }
  return MOON_TITHI_STEPS.find((step) => step.number === tithiNumber) ?? null;
};
