import { expect, test } from "vitest";
import { activityMapLink } from "./activityMapLink";

test.each(["iPhone", "iPad", "Macintosh", "Android"])(
  "map links preserve the activity coordinates on %s",
  (device) => {
    const url = new URL(
      activityMapLink(
        { type: "Point", coordinates: [2.33, 48.86] },
        "Museum & gardens",
        device,
      )!,
    );
    if (device === "Android") {
      expect(url.hostname).toBe("www.google.com");
      expect(url.searchParams.get("query")).toBe("48.86,2.33");
      expect(url.searchParams.get("api")).toBe("1");
    } else {
      expect(url.hostname).toBe("maps.apple.com");
      expect(url.searchParams.get("ll")).toBe("48.86,2.33");
      expect(url.searchParams.get("q")).toBe("Museum & gardens");
    }
  },
);

test.each<[number, number] | null>([null, [181, 0], [0, 91], [NaN, 0]])(
  "does not link a missing or invalid location %s",
  (coordinates) => {
    expect(
      activityMapLink(
        coordinates ? { type: "Point", coordinates } : null,
        "Museum",
        "Android",
      ),
    ).toBeUndefined();
  },
);
