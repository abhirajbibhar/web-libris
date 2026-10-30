import { IconField } from 'primereact/iconfield';
import { InputIcon } from 'primereact/inputicon';
import { InputText } from 'primereact/inputtext';

/** Search box: magnifier when empty, a clickable clear icon once there is text. */
export default function SearchField({
  value,
  onChange,
  placeholder,
  className
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <IconField iconPosition="right" className={className}>
      {value ? (
        <InputIcon
          className="pi pi-times cursor-pointer"
          onClick={() => onChange('')}
          aria-label="Clear search"
        />
      ) : (
        <InputIcon className="pi pi-search" />
      )}
      <InputText
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full"
      />
    </IconField>
  );
}
