import { Button, Field, Input } from "@fluentui/react-components";
import { Add20Regular } from "@fluentui/react-icons";
import type { ActivityLink } from "./activitiesApi";
import { validActivityLink } from "./activityLinks";
export default function ActivityLinksEditor({
  links,
  onChange,
}: {
  links: ActivityLink[];
  onChange: (links: ActivityLink[]) => void;
}) {
  function update(index: number, changes: Partial<ActivityLink>) {
    onChange(
      links.map((link, i) => (i === index ? { ...link, ...changes } : link)),
    );
  }
  return (
    <section className="activity-links-editor" aria-label="Activity links">
      <strong>Links</strong>
      <span>Attach activity information, bookings, or tickets.</span>
      {links.map((link, index) => (
        <div className="activity-link-editor" key={index}>
          <Field
            label={`Link URL ${index + 1}`}
            validationState={
              link.url && !validActivityLink(link) ? "error" : "none"
            }
            validationMessage={
              link.url && !validActivityLink(link)
                ? "Use an http:// or https:// URL without a username or password."
                : undefined
            }
          >
            <Input
              type="url"
              value={link.url}
              maxLength={2048}
              placeholder="https://…"
              onChange={(_, data) => update(index, { url: data.value })}
            />
          </Field>
          <Field label={`Link label ${index + 1}`} hint="Optional">
            <Input
              value={link.label ?? ""}
              maxLength={200}
              placeholder="Tickets, website, booking…"
              onChange={(_, data) => update(index, { label: data.value })}
            />
          </Field>
          <Button
            appearance="subtle"
            onClick={() => onChange(links.filter((_, i) => i !== index))}
          >
            Remove link {index + 1}
          </Button>
        </div>
      ))}
      <Button
        icon={<Add20Regular />}
        disabled={links.length >= 20}
        onClick={() => onChange([...links, { url: "", label: "" }])}
      >
        Add link
      </Button>
    </section>
  );
}
