import { useState } from "react";
import {
  Combobox,
  Option,
  Tag,
  TagGroup,
  Text,
} from "@fluentui/react-components";

const airlines: Record<string, string> = {
  AA: "American Airlines",
  AC: "Air Canada",
  AF: "Air France",
  AI: "Air India",
  AM: "Aeroméxico",
  AS: "Alaska Airlines",
  AV: "Avianca",
  AY: "Finnair",
  AZ: "ITA Airways",
  BA: "British Airways",
  BR: "EVA Air",
  B6: "JetBlue",
  CA: "Air China",
  CI: "China Airlines",
  CM: "Copa Airlines",
  CX: "Cathay Pacific",
  CZ: "China Southern",
  DL: "Delta Air Lines",
  EK: "Emirates",
  ET: "Ethiopian Airlines",
  EY: "Etihad Airways",
  F9: "Frontier Airlines",
  FI: "Icelandair",
  FR: "Ryanair",
  G3: "GOL",
  HA: "Hawaiian Airlines",
  IB: "Iberia",
  JL: "Japan Airlines",
  KE: "Korean Air",
  KL: "KLM",
  LA: "LATAM Airlines",
  LH: "Lufthansa",
  LO: "LOT Polish Airlines",
  LX: "Swiss International Air Lines",
  LY: "El Al",
  MH: "Malaysia Airlines",
  MS: "Egyptair",
  MU: "China Eastern",
  NH: "All Nippon Airways",
  NZ: "Air New Zealand",
  OS: "Austrian Airlines",
  OZ: "Asiana Airlines",
  PR: "Philippine Airlines",
  QR: "Qatar Airways",
  QF: "Qantas",
  SA: "South African Airways",
  SK: "SAS",
  SN: "Brussels Airlines",
  SQ: "Singapore Airlines",
  SU: "Aeroflot",
  SV: "Saudia",
  TK: "Turkish Airlines",
  TP: "TAP Air Portugal",
  UA: "United Airlines",
  UX: "Air Europa",
  VA: "Virgin Australia",
  VS: "Virgin Atlantic",
  VY: "Vueling",
  WN: "Southwest Airlines",
  WS: "WestJet",
  W6: "Wizz Air",
  Y4: "Volaris",
};

export type AirlineChoice = { value: string; label: string };
const catalogChoices: AirlineChoice[] = Object.entries(airlines).map(
  ([code, name]) => ({ value: code, label: `${name} (${code})` }),
);

export default function AirlineCombobox({
  value,
  onChange,
  options = catalogChoices,
  allowCustomCode = true,
  ariaLabel = "Search preferred airlines",
  tagsLabel = "Preferred airlines",
  placeholder = "Search airline name or code",
  disabled = false,
}: {
  value: string[];
  onChange: (codes: string[]) => void;
  options?: AirlineChoice[];
  allowCustomCode?: boolean;
  ariaLabel?: string;
  tagsLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const matches = options.filter((option) =>
    `${option.label} ${option.value}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const customCode = query.trim().toUpperCase();
  const canAddCode =
    allowCustomCode &&
    /^[A-Z0-9]{2}$/.test(customCode) &&
    !options.some((option) => option.value === customCode);
  const addCode = (code: string) => {
    onChange([...new Set([...value, code])]);
    setQuery("");
  };
  const labelFor = (code: string) =>
    options.find((option) => option.value === code)?.label ??
    (airlines[code] ? `${airlines[code]} (${code})` : code);
  return (
    <div className="tag-list-picker">
      {value.length > 0 && (
        <TagGroup
          className="tag-list-tags"
          aria-label={tagsLabel}
          dismissible
          onDismiss={(_, data) =>
            !disabled && onChange(value.filter((code) => code !== data.value))
          }
        >
          {value.map((code) => (
            <Tag key={code} value={code} size="small" disabled={disabled}>
              {labelFor(code)}
            </Tag>
          ))}
        </TagGroup>
      )}
      <Combobox
        disabled={disabled}
        multiselect
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={query}
        selectedOptions={value}
        onChange={(event) => setQuery(event.target.value)}
        onOptionSelect={(_, data) => {
          onChange(data.selectedOptions);
          setQuery("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && canAddCode) {
            event.preventDefault();
            addCode(customCode);
          }
        }}
      >
        {matches.map((option) => (
          <Option key={option.value} value={option.value} text={option.label}>
            {option.label}
          </Option>
        ))}
      </Combobox>
      {canAddCode && <Text size={200}>Press Enter to add {customCode}.</Text>}
    </div>
  );
}
