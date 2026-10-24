import { Tab, TabList } from "@fluentui/react-components";

export default function FlightLegTabs({
  legCount,
  step,
  label,
  routes = [],
  chosen,
  busy = false,
  onRevisit,
}: {
  legCount: number;
  step: number;
  label: string;
  routes?: string[];
  chosen?: readonly (string | null)[];
  busy?: boolean;
  onRevisit: (index: number) => void;
}) {
  if (legCount < 1) return null;
  const reviewing = step >= legCount;
  return (
    <TabList
      className="flight-leg-tabs"
      aria-label={`${label} flight steps`}
      selectedValue={reviewing ? "review" : String(step)}
      onTabSelect={(_, data) => {
        const index = Number(data.value);
        if (
          !busy &&
          Number.isInteger(index) &&
          index >= 0 &&
          (index < step || chosen?.[index])
        )
          onRevisit(index);
      }}
    >
      {Array.from({ length: legCount }, (_, index) => (
        <Tab
          key={index}
          value={String(index)}
          disabled={
            (index > step && !chosen?.[index]) ||
            (busy && (index < step || !!chosen?.[index]))
          }
        >
          <span className="flight-leg-tab-label">
            <span>Flight {index + 1}</span>
            <span className="flight-leg-tab-detail">
              {(chosen ? !!chosen[index] : index < step)
                ? "Chosen"
                : index === step
                  ? "Choose now"
                  : "Upcoming"}
              {routes[index] && ` · ${routes[index]}`}
            </span>
          </span>
        </Tab>
      ))}
      <Tab value="review" disabled={!reviewing}>
        Review route
      </Tab>
    </TabList>
  );
}
