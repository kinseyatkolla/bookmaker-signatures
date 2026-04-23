const zodiacElementBySign = {
  Aries: "fire",
  Leo: "fire",
  Sagittarius: "fire",
  Taurus: "earth",
  Virgo: "earth",
  Capricorn: "earth",
  Gemini: "air",
  Libra: "air",
  Aquarius: "air",
  Cancer: "water",
  Scorpio: "water",
  Pisces: "water",
};

function titleCaseWord(word) {
  if (!word) return "";
  const lower = String(word).toLowerCase();
  if (lower === "rx") return "Rx";
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatPlanetLabel(planet) {
  if (!planet) return "";
  if (String(planet).toLowerCase() === "northnode") return "N. Node";
  return titleCaseWord(planet);
}

export const NATAL_CHART_PREVIEW_KEYS = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];

export function signElementClass(signName) {
  const element = zodiacElementBySign[signName];
  if (!element) return "";
  return `sign-${element}`;
}

/**
 * @param {object | null | undefined} data
 * @returns {Array<{ id: string, label: string, position: string, elementClass: string }>}
 */
export function buildNatalChartPreviewRows(data) {
  if (!data?.planets) return [];

  const rows = [];
  for (const key of NATAL_CHART_PREVIEW_KEYS) {
    const planet = data.planets[key];
    if (!planet) continue;
    const sign = planet.zodiacSignName;
    rows.push({
      id: key,
      label: formatPlanetLabel(key),
      position: `${planet.degreeFormatted || ""} ${sign || ""}`.trim(),
      elementClass: signElementClass(sign),
    });
  }

  const houses = data.houses;
  if (houses?.ascendantSign) {
    rows.push({
      id: "asc",
      label: "Ascendant",
      position:
        `${houses.ascendantDegree || ""} ${houses.ascendantSign}`.trim(),
      elementClass: signElementClass(houses.ascendantSign),
    });
  }
  if (houses?.mcSign) {
    rows.push({
      id: "mc",
      label: "Midheaven",
      position: `${houses.mcDegree || ""} ${houses.mcSign}`.trim(),
      elementClass: signElementClass(houses.mcSign),
    });
  }

  return rows;
}
