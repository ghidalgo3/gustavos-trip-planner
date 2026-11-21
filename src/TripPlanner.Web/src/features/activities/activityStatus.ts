import {
  Bookmark20Regular,
  CalendarCheckmark20Regular,
  SubtractCircle20Regular,
} from "@fluentui/react-icons";

export const activityStatuses = [
  { value: "Maybe", label: "Maybe", Icon: Bookmark20Regular },
  { value: "Yes", label: "Planned", Icon: CalendarCheckmark20Regular },
  { value: "No", label: "Not Interested", Icon: SubtractCircle20Regular },
] as const;

export function activityStatus(value: string) {
  return (
    activityStatuses.find((status) => status.value === value) ?? {
      value,
      label: value,
      Icon: Bookmark20Regular,
    }
  );
}
