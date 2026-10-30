import type { ReactNode } from 'react';

/** Label stacked above a PrimeReact input. */
export default function FormField({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-column gap-2">
      <label htmlFor={htmlFor} className="font-medium text-sm">
        {label}
      </label>
      {children}
    </div>
  );
}
