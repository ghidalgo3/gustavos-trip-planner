import {
  Button,
  Field,
  Skeleton,
  SkeletonItem,
  Tag,
  TagPicker,
  TagPickerControl,
  TagPickerGroup,
  TagPickerInput,
  TagPickerList,
  TagPickerOption,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { listActivityKinds } from "./activityKindsApi";
import { validActivityKinds } from "./activityKinds";

export default function ActivityKindsPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    query: string;
    kinds: string[];
    error?: string;
  }>();
  const query = inputValue.trim();
  const current = result?.query === query ? result : undefined;
  const loading = open && !current;

  useEffect(() => {
    if (!open || disabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      listActivityKinds({ search: query }, controller.signal)
        .then(({ kinds }) => {
          if (!controller.signal.aborted) setResult({ query, kinds });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setResult({
              query,
              kinds: [],
              error: "Kind suggestions are unavailable.",
            });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [disabled, open, query, retry]);

  const suggestions =
    current?.kinds.filter((kind) => !value.includes(kind)) ?? [];
  const canAdd =
    query.length > 0 && query.length <= 200 && !value.includes(query);
  function commit() {
    if (disabled) return;
    if (canAdd) onChange([...value, query]);
    setInputValue("");
    setOpen(false);
  }

  return (
    <div
      className="activity-kinds-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) commit();
      }}
    >
      <Field
        label="Kinds"
        required
        validationState={!validActivityKinds(value) ? "error" : "none"}
        validationMessage={
          !validActivityKinds(value) ? "Add at least one kind." : undefined
        }
      >
        <TagPicker
          inline
          disableAutoFocus
          disabled={disabled}
          selectedOptions={value}
          open={open && !disabled}
          onOpenChange={(_, data) => setOpen(data.open)}
          onOptionSelect={(_, data) => {
            onChange(data.selectedOptions);
            if (!value.includes(data.value)) setInputValue("");
          }}
        >
          <TagPickerControl className="activity-kinds-control">
            <TagPickerGroup
              aria-label="Selected kinds"
              className="activity-kind-tags"
            >
              {value.map((kind) => (
                <Tag
                  key={kind}
                  value={kind}
                  dismissible
                  disabled={disabled}
                  aria-label={`Remove ${kind}`}
                  title={kind}
                  className="activity-kind-tag"
                >
                  {kind}
                </Tag>
              ))}
            </TagPickerGroup>
            <TagPickerInput
              aria-label="Kinds"
              placeholder="Add a kind"
              value={inputValue}
              maxLength={200}
              className="activity-kinds-input"
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setInputValue(event.target.value);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  !event.currentTarget.getAttribute("aria-activedescendant")
                ) {
                  event.preventDefault();
                  commit();
                }
              }}
            />
          </TagPickerControl>
          <TagPickerList>
            {suggestions.map((kind) => (
              <TagPickerOption key={kind} value={kind}>
                {kind}
              </TagPickerOption>
            ))}
            {canAdd && !suggestions.includes(query) && (
              <TagPickerOption
                value={query}
                text={query}
              >{`Add “${query}”`}</TagPickerOption>
            )}
            {loading && (
              <div className="activity-kind-suggestion-loading">
                <Skeleton aria-label="Loading kind suggestions">
                  <SkeletonItem size={16} />
                </Skeleton>
              </div>
            )}
          </TagPickerList>
        </TagPicker>
      </Field>
      {current?.error && (
        <div role="status">
          <span>{current.error}</span>
          <Button
            disabled={disabled}
            onClick={() => {
              setResult(undefined);
              setRetry((attempt) => attempt + 1);
              setOpen(true);
            }}
          >
            Retry kind suggestions
          </Button>
        </div>
      )}
    </div>
  );
}
