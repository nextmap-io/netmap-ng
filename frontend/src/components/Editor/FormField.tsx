import { useId } from "react";
import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  labelClassName?: string;
  children: (id: string) => ReactNode;
}

/**
 * Associates a <label> with its control via a generated id.
 * Use when the control is rendered as a sibling rather than wrapped by the label.
 */
export function FormField({ label, labelClassName = "noc-label mb-1 block", children }: FormFieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}
