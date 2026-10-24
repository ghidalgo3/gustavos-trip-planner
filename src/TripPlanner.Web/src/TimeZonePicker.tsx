import { Combobox, Field, Option } from "@fluentui/react-components";
import { isTimeZoneId, timeZoneIds } from "./timeZones";

export default function TimeZonePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const normalize = (text: string) => text.toLowerCase().replaceAll("_", " ");
  const query = normalize(value ?? "").trim();
  const matches = timeZoneIds.filter((id) => normalize(id).includes(query));
  const valid = isTimeZoneId(value);

  return (
    <Field
      className="timezone-picker"
      label="Destination timezone"
      hint="Search by city or timezone, for example Tokyo or Asia/Tokyo."
      validationState={valid ? "none" : "error"}
      validationMessage={
        valid ? undefined : "Choose a timezone from the suggestions."
      }
    >
      <Combobox
        aria-label="Destination timezone"
        placeholder="Search timezones"
        value={value ?? ""}
        selectedOptions={value && valid ? [value] : []}
        inlinePopup
        onChange={(event) => onChange(event.target.value || null)}
        onOptionSelect={(_, data) => {
          if (data.optionValue) onChange(data.optionValue);
        }}
      >
        {matches.map((id) => (
          <Option key={id} value={id}>
            {id}
          </Option>
        ))}
        {matches.length === 0 && (
          <Option disabled>No matching timezones</Option>
        )}
      </Combobox>
    </Field>
  );
}
