import {
  Button,
  Combobox,
  Field,
  Option,
  Skeleton,
  SkeletonItem,
  Tag,
  TagGroup,
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
        validationState={!validActivityKinds(value) ? "error" : "none"}
        validationMessage={
          !validActivityKinds(value)
            ? "Use unique, nonblank kinds of up to 200 characters each."
            : undefined
        }
      >
        <div className="tag-list-picker activity-kinds-control">
          {value.length > 0 && (
            <TagGroup
              aria-label="Selected kinds"
              className="tag-list-tags"
              dismissible
              onDismiss={(_, data) =>
                !disabled &&
                onChange(value.filter((kind) => kind !== data.value))
              }
            >
              {value.map((kind) => (
                <Tag
                  key={kind}
                  value={kind}
                  size="small"
                  disabled={disabled}
                  aria-label={`Remove ${kind}`}
                  title={kind}
                  className="activity-kind-tag"
                >
                  {kind}
                </Tag>
              ))}
            </TagGroup>
          )}
          <Combobox
            inlinePopup
            disableAutoFocus
            multiselect
            disabled={disabled}
            selectedOptions={value}
            open={open && !disabled}
            onOpenChange={(_, data) => setOpen(data.open)}
            onOptionSelect={(_, data) => {
              if (!data.optionValue || disabled) return;
              onChange(data.selectedOptions);
              setInputValue("");
            }}
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
            onKeyDownCapture={(event) => {
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                event.target instanceof HTMLInputElement &&
                !event.target.getAttribute("aria-activedescendant")
              ) {
                event.preventDefault();
                event.stopPropagation();
                commit();
              }
            }}
          >
            {suggestions.map((kind) => (
              <Option key={kind} value={kind} text={kind}>
                {kind}
              </Option>
            ))}
            {canAdd && !suggestions.includes(query) && (
              <Option value={query} text={query}>{`Add “${query}”`}</Option>
            )}
            {loading && (
              <div className="activity-kind-suggestion-loading">
                <Skeleton aria-label="Loading kind suggestions">
                  <SkeletonItem size={16} />
                </Skeleton>
              </div>
            )}
          </Combobox>
        </div>
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
