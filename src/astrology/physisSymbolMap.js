export const getPlanetKeysFromNames = () => ({
  Sun: "r",
  Moon: "q",
  Mercury: "w",
  Venus: "e",
  Mars: "t",
  Jupiter: "y",
  Saturn: "u",
  Uranus: "i",
  Neptune: "o",
  Pluto: "p",
  Chiron: "T",
  "N. Node": "]",
  "North Node": "]",
  NorthNode: "]",
  SouthNode: "[",
  Ascendant: "!",
  Midheaven: "@",
  midheaven: "@",
});

export const getZodiacKeysFromNames = () => ({
  Aries: "a",
  Taurus: "s",
  Gemini: "d",
  Cancer: "f",
  Leo: "g",
  Virgo: "h",
  Libra: "j",
  Scorpio: "k",
  Sagittarius: "l",
  Capricorn: ";",
  Aquarius: "'",
  Pisces: "z",
});

export const getPlanetUnicodeFallback = () => ({
  sun: "☉",
  moon: "☽",
  mercury: "☿",
  venus: "♀",
  mars: "♂",
  jupiter: "♃",
  saturn: "♄",
  uranus: "♅",
  neptune: "♆",
  pluto: "♇",
  northnode: "☊",
});

export const getZodiacUnicodeFallback = () => ({
  Aries: "♈",
  Taurus: "♉",
  Gemini: "♊",
  Cancer: "♋",
  Leo: "♌",
  Virgo: "♍",
  Libra: "♎",
  Scorpio: "♏",
  Sagittarius: "♐",
  Capricorn: "♑",
  Aquarius: "♒",
  Pisces: "♓",
});

const ASPECT_PHYSIS_KEYS = {
  conjunct: "☌",
  opposition: "☍",
  trine: "△",
  square: "□",
  sextile: "✶",
};

export function getAspectPhysisKey(aspectName) {
  const normalized = String(aspectName || "")
    .toLowerCase()
    .replace(/^whole sign /i, "")
    .trim();
  return ASPECT_PHYSIS_KEYS[normalized] || "";
}
