// DOM helpers: building controls and formatting text. No state lives here.
import { OUTCOME_LABELS } from "./config.js";

export const byId = (id) => document.getElementById(id);

export function formatClock(totalSeconds) {
  const seconds = Math.round(totalSeconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatShortDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Outcome and length first: the select is narrow, and these are what tell matches apart.
export function describeMatch(match) {
  const players = match.humans > 1 ? `${match.humans} humans` : `${match.bots} bot paths`;
  return `${OUTCOME_LABELS[match.outcome]} · ${formatClock(match.durationSec)} · ${players} · ${formatShortDate(match.date)} · #${match.id.slice(0, 6)}`;
}

export function countBy(items, keyOf) {
  const counts = {};
  for (const item of items) counts[keyOf(item)] = (counts[keyOf(item)] || 0) + 1;
  return counts;
}

export function fillSelect(select, options, selectedValue) {
  select.replaceChildren(...options.map(({ value, label }) => new Option(label, value)));
  select.value = selectedValue;
}

export function markerGlyph(icon, color) {
  return `<svg class="glyph" viewBox="-2 -2 28 28" aria-hidden="true"><path d="${icon}" fill="${color}" stroke="#000" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/></svg>`;
}

export function renderLayerRadios(container, layers, selectedKey, onSelect) {
  container.innerHTML = layers
    .map((layer) => `<label class="choice" title="${layer.help}"><input type="radio" name="layer" value="${layer.key}" ${layer.key === selectedKey ? "checked" : ""}> ${layer.label}</label>`)
    .join("");
  container.addEventListener("change", (event) => onSelect(event.target.value));
}

export function renderMarkerChecks(container, markerTypes, enabledKeys, onToggle) {
  container.innerHTML = markerTypes
    .map((type) => `<label class="choice"><input type="checkbox" value="${type.key}" ${enabledKeys.has(type.key) ? "checked" : ""}> ${markerGlyph(type.icon, type.color)} ${type.label}</label>`)
    .join("");
  container.addEventListener("change", (event) => onToggle(event.target.value, event.target.checked));
}

export function setMarkerChecks(container, enabledKeys) {
  container.querySelectorAll("input").forEach((box) => (box.checked = enabledKeys.has(box.value)));
}
