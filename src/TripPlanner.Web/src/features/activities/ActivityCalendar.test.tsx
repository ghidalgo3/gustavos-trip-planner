import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import ActivityCalendar from "./ActivityCalendar";
import {
  calendarDestination,
  calendarPlan,
} from "../../test/activityCalendarFixture";
import { calendarDayOptions } from "./activityCalendarModel";

test.each([false, true])(
  "flight links and transportation remain accessible on empty days (read only: %s)",
  (readOnly) => {
    const onEntry = vi.fn();
    const day = { ...calendarPlan.days[0], activityIds: [] };
    render(
      <MemoryRouter>
        <ActivityCalendar
          tripId="trip/one"
          plan={{ ...calendarPlan, days: [day] }}
          day={day}
          dayOptions={calendarDayOptions(
            calendarDestination.id,
            [day],
            [calendarDestination],
          )}
          activities={[]}
          scheduleNotices={[]}
          moreNoticeCount={0}
          onMoreNotices={vi.fn()}
          itinerary={{
            items: [
              {
                id: "flight",
                kind: "flight",
                name: "Flight AF 123",
                start: "2027-06-10T07:00:00Z",
                end: "2027-06-10T08:00:00Z",
              },
              {
                id: "train",
                kind: "transportation",
                name: "Airport express",
                start: "2027-06-10T08:30:00Z",
                duration: "PT30M",
                transportation: { name: "Airport express" },
              },
            ],
          }}
          readOnly={readOnly}
          busy={false}
          onDay={vi.fn()}
          onEvent={vi.fn()}
          onEntry={onEntry}
          onDayDetails={vi.fn()}
          onTiming={vi.fn()}
          onUnschedule={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Flight AF 123" })).toHaveAttribute(
      "href",
      "/trips/trip%2Fone/flights",
    );
    fireEvent.click(screen.getByRole("button", { name: "Airport express" }));
    expect(onEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "transportation",
        transportation: { name: "Airport express" },
      }),
    );
    expect(screen.queryByText("No events scheduled")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Resize (Flight|Airport)/ }),
    ).toBeNull();
  },
);
