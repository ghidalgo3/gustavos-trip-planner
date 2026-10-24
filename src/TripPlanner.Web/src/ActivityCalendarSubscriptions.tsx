import { useActionToast } from "./useActionToast";
import { useState } from "react";
import { planningRequest, type CalendarSubscription } from "./activityPlanApi";

export default function ActivityCalendarSubscriptions({
  tripId,
}: {
  tripId: string;
}) {
  const [items, setItems] = useState<CalendarSubscription[]>();
  const [url, setUrl] = useState<string>();
  const { notify, toaster } = useActionToast();
  const [busy, setBusy] = useState(false);
  const path = `/trips/${encodeURIComponent(tripId)}/calendar-subscriptions`;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    setItems((await planningRequest<CalendarSubscription[]>(path)).data);
  }
  return (
    <section className="planning-calendar">
      <button
        type="button"
        disabled={busy}
        aria-expanded={items !== undefined}
        onClick={() => (items ? setItems(undefined) : void run(load))}
      >
        Calendar subscriptions
      </button>
      {toaster}
      {items && (
        <div>
          <p>
            Subscribe to saved dated activities across this trip. Proposals stay
            out of your calendar. Each traveller manages their own private link.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const created = (
                  await planningRequest<CalendarSubscription>(path, {
                    method: "POST",
                  })
                ).data;
                setUrl(created.url ?? undefined);
                await load();
                notify("Calendar subscription created.");
              })
            }
          >
            Create my subscription
          </button>
          {url && (
            <label>
              Copy this private subscription URL into your calendar app. It is
              shown only now.
              <input readOnly value={url} onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => setUrl(undefined)}>
                Hide private URL
              </button>
            </label>
          )}
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                Created {new Date(item.createdAt).toLocaleDateString()}{" "}
                {item.revokedAt ? (
                  "· Revoked"
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await planningRequest(`${path}/${item.id}`, {
                          method: "DELETE",
                        });
                        setUrl(undefined);
                        await load();
                        notify("Calendar subscription revoked.");
                      })
                    }
                  >
                    Revoke subscription
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
