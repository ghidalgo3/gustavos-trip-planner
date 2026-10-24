import { useState, type ComponentProps } from "react";
import ActivityPlanning from "./ActivityPlanning";

// Lazy mount once per trip, then hide without tearing down the SDK or unsaved edits.
export default function ActivityPlanningTab(
  props: ComponentProps<typeof ActivityPlanning> & { active: boolean },
) {
  const [visited, setVisited] = useState(props.active);
  if (props.active && !visited) setVisited(true);
  return visited ? (
    <div hidden={!props.active} className="retained-activity-panel">
      <ActivityPlanning {...props} />
    </div>
  ) : null;
}
