import { readFile, writeFile } from "node:fs/promises";

// RFC 4180 fields can contain commas, quotes, and embedded newlines.
function csv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(field); field = ""; }
    else if (character === "\n" && !quoted) { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (quoted) throw new Error("Unterminated CSV field");
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const header = rows.shift();
  return rows.filter((row) => row.length === header.length).map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])));
}

const [airportPath, zonePath, destination] = process.argv.slice(2);
const [airportText, zoneText] = await Promise.all([readFile(airportPath, "utf8"), readFile(zonePath, "utf8")]);
const timeZones = new Map(csv(zoneText).filter((a) => a.iata && a.tz).map((a) => [a.iata, a.tz]));
const airports = new Map();
for (const airport of csv(airportText)) {
  const code = airport.iata_code;
  const timeZone = timeZones.get(code);
  if (!/^[A-Z]{3}$/.test(code ?? "") || !timeZone || airport.type === "closed" || airport.scheduled_service !== "yes") continue;
  if (!airport.longitude_deg?.trim() || !airport.latitude_deg?.trim()) continue;
  const longitude = Number(airport.longitude_deg), latitude = Number(airport.latitude_deg);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) continue;
  new Intl.DateTimeFormat("en", { timeZone });
  airports.set(code, { code, name: airport.name, city: airport.municipality || airport.name,
    country: airport.iso_country, longitude, latitude, timeZone, major: airport.type === "large_airport", keywords: airport.ident });
}
if (airports.size < 1000) throw new Error(`Airport refresh returned only ${airports.size} airports; refusing an incomplete catalog`);
await writeFile(destination, JSON.stringify([...airports.values()].sort((a,b) => a.code.localeCompare(b.code))) + "\n");
process.stdout.write(`Refreshed ${airports.size} IATA airports.\n`);
