import { Checkbox } from 'primereact/checkbox';

/** Checkbox + label + optional trailing count, used by filters and the shelf picker. */
export default function CheckRow({
  id,
  label,
  count,
  checked,
  onChange
}: {
  id: string;
  label: string;
  count?: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex align-items-center gap-2">
      <Checkbox inputId={id} checked={checked} onChange={event => onChange(Boolean(event.checked))} />
      <label
        htmlFor={id}
        className={`flex-1 min-w-0 cursor-pointer text-xs white-space-nowrap overflow-hidden text-overflow-ellipsis${
          checked ? ' font-semibold' : ''
        }`}
        title={label}
      >
        {label}
      </label>
      {count !== undefined && <span className="text-color-secondary" style={{ fontSize: '0.7rem' }}>{count}</span>}
    </div>
  );
}
