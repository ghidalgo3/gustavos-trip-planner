import { Button, Field, Slider, Text } from "@fluentui/react-components";
import {
  durationFromMinutes,
  durationMinutes,
} from "../../shared/time/durations";

function label(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours
    ? `${hours} ${hours === 1 ? "hour" : "hours"}${remainder ? ` ${remainder} min` : ""}`
    : `${minutes} min`;
}

export default function ActivityDurationSlider({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const minutes = durationMinutes(value);
  const hours = Math.min(
    12,
    Math.max(0.5, Math.round((minutes ?? 30) / 30) / 2),
  );
  return (
    <Field
      className="activity-duration-field"
      label="Duration"
      hint={
        minutes !== null && minutes !== hours * 60
          ? "Existing duration is kept until you adjust it. The slider uses 30-minute steps."
          : "30-minute steps"
      }
    >
      <div className="activity-duration-value">
        <Text weight="semibold" aria-live="polite">
          {minutes === null ? "Not set" : label(minutes)}
        </Text>
        <Button
          size="small"
          disabled={disabled}
          onClick={() =>
            onChange(minutes === null ? durationFromMinutes(30) : null)
          }
        >
          {minutes === null ? "Use 30 min" : "Clear duration"}
        </Button>
      </div>
      <Slider
        aria-label="Duration"
        aria-valuetext={label(hours * 60)}
        min={0.5}
        max={12}
        step={0.5}
        value={hours}
        disabled={disabled}
        onChange={(_, data) => onChange(durationFromMinutes(data.value * 60))}
      />
      <div className="activity-duration-limits" aria-hidden="true">
        <span>30 min</span>
        <span>12 hours</span>
      </div>
    </Field>
  );
}
