import { useCallback, useState } from "react";
import {
  Button,
  Card,
  Spinner,
  Text,
  Title3,
} from "@fluentui/react-components";
import AsyncAutocomplete from "./AsyncAutocomplete";
import {
  changePartyMember,
  searchUsers,
  type PlanningParty,
  type UserSearchResult,
} from "./planningApi";

export default function PartySelector({
  userId,
  tripId,
  party,
  index,
  onChanged,
}: {
  userId: string;
  tripId: string;
  party: PlanningParty;
  index: number;
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<UserSearchResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const owner = party.members.find((member) => member.id === userId);
  const search = useCallback(
    (text: string, signal: AbortSignal) =>
      searchUsers(text, signal).then((users) =>
        users.filter(
          (user) => !party.members.some((member) => member.id === user.id),
        ),
      ),
    [party.members],
  );

  async function change(memberId: string, add: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await changePartyMember(userId, tripId, party.id, memberId, add);
      await onChanged();
      setQuery("");
      setSelected(undefined);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update the party.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="party-compact" aria-label={`Party ${index + 1}`}>
      <div className="planning-section-heading">
        <Title3 as="h2">Party {index + 1}</Title3>
        <Text size={200}>
          {party.members.length} traveler{party.members.length === 1 ? "" : "s"}
        </Text>
      </div>
      <div className="party-members">
        {party.members.map((member) => (
          <span className="party-member" key={member.id}>
            {member.name}
            {member.id === userId ? " (you)" : ""}
            {member.id !== userId && (
              <Button
                appearance="subtle"
                size="small"
                aria-label={`Remove ${member.name} from party`}
                disabled={busy}
                onClick={() => void change(member.id, false)}
              >
                Remove
              </Button>
            )}
          </span>
        ))}
      </div>
      <Text size={200}>
        Everyone departs from your home city
        {owner?.homeCity ? `, ${owner.homeCity}` : ""}.
      </Text>
      <div className="party-add-row">
        <AsyncAutocomplete
          label="Add traveler"
          placeholder="Search people by name"
          inputValue={query}
          selectedOptionValue={selected?.id}
          selectedOptionLabel={
            selected ? `${selected.name} · ${selected.email}` : undefined
          }
          search={search}
          getOptionValue={(user) => user.id}
          getOptionText={(user) => `${user.name} · ${user.email}`}
          onInputChange={(value) => {
            setQuery(value);
            setSelected(undefined);
            setError(undefined);
          }}
          onOptionSelect={(user) => {
            setSelected(user);
            setQuery(`${user.name} · ${user.email}`);
            setError(undefined);
          }}
          debounceMs={300}
        />
        <Button
          appearance="primary"
          disabled={!selected || busy || party.members.length >= 9}
          onClick={() => selected && void change(selected.id, true)}
        >
          Add
        </Button>
      </div>
      {party.members.length >= 9 && <Text size={200}>This party is full.</Text>}
      {busy && <Spinner size="tiny" label="Updating party" />}
      {error && <Text role="alert">{error}</Text>}
    </Card>
  );
}
