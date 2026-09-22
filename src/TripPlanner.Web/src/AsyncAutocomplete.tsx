import { useEffect, useState, type ReactNode } from "react";
import {
  Combobox,
  Field,
  Option,
  Spinner,
  Text,
} from "@fluentui/react-components";

type Props<OptionType> = {
  label: string;
  placeholder: string;
  inputValue: string;
  selectedOptionValue?: string;
  selectedOptionLabel?: string;
  search: (query: string, signal: AbortSignal) => Promise<OptionType[]>;
  getOptionValue: (option: OptionType) => string;
  getOptionText: (option: OptionType) => string;
  renderOption?: (option: OptionType) => ReactNode;
  onInputChange: (value: string) => void;
  onOptionSelect: (option: OptionType) => void;
  hint?: string;
  emptyMessage?: string;
  error?: string;
  debounceMs?: number;
};

export default function AsyncAutocomplete<OptionType>({
  label,
  placeholder,
  inputValue,
  selectedOptionValue,
  selectedOptionLabel,
  search,
  getOptionValue,
  getOptionText,
  renderOption,
  onInputChange,
  onOptionSelect,
  hint,
  emptyMessage,
  error,
  debounceMs = 250,
}: Props<OptionType>) {
  const [suggestions, setSuggestions] = useState<OptionType[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const message = error ?? searchError;

  useEffect(() => {
    const query = inputValue.trim();
    if (
      query.length < 2 ||
      (selectedOptionValue && selectedOptionLabel === inputValue)
    )
      return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(undefined);
      search(query, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setSuggestions(results);
          setSearched(true);
          setOpen(results.length > 0);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setSearchError(
              reason instanceof Error
                ? reason.message
                : `${label} search is unavailable.`,
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    debounceMs,
    inputValue,
    label,
    search,
    selectedOptionLabel,
    selectedOptionValue,
  ]);

  return (
    <>
      <Field
        label={label}
        hint={hint}
        validationState={message ? "error" : "none"}
        validationMessage={message}
      >
        <Combobox
          aria-label={label}
          placeholder={placeholder}
          value={inputValue}
          selectedOptions={selectedOptionValue ? [selectedOptionValue] : []}
          open={open}
          inlinePopup
          onOpenChange={(_, data) =>
            setOpen(data.open && suggestions.length > 0)
          }
          onChange={(event) => {
            onInputChange(event.target.value);
            setSuggestions([]);
            setOpen(false);
            setSearching(false);
            setSearched(false);
            setSearchError(undefined);
          }}
          onOptionSelect={(_, data) => {
            const option = suggestions.find(
              (candidate) => getOptionValue(candidate) === data.optionValue,
            );
            if (!option) return;
            onOptionSelect(option);
            setOpen(false);
            setSearchError(undefined);
          }}
        >
          {suggestions.map((option) => (
            <Option
              key={getOptionValue(option)}
              value={getOptionValue(option)}
              text={getOptionText(option)}
            >
              {renderOption?.(option) ?? getOptionText(option)}
            </Option>
          ))}
        </Combobox>
      </Field>
      {searching && <Spinner size="tiny" label={`Searching ${label}`} />}
      {searched && suggestions.length === 0 && !message && emptyMessage && (
        <Text role="status">{emptyMessage}</Text>
      )}
    </>
  );
}
