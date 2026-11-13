import { Textarea } from "@fluentui/react-components";
import { useLayoutEffect, useRef } from "react";

export default function ActivityTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const fitContent = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    fitContent();
    if (typeof ResizeObserver === "undefined") return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      fitContent();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value]);

  return (
    <label>
      {label}
      <Textarea
        className="activity-text-field"
        textarea={{ ref: textareaRef }}
        maxLength={10000}
        value={value}
        onChange={(_, data) => onChange(data.value)}
      />
    </label>
  );
}
