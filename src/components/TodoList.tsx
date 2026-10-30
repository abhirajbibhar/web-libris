import { useState } from 'react';
import { Button } from 'primereact/button';
import { Checkbox } from 'primereact/checkbox';
import { InputText } from 'primereact/inputtext';
import { ProgressBar } from 'primereact/progressbar';
import type { TodoItem } from '../api/journal';

/** Checklist with quick add; the parent owns persistence. */
export default function TodoList({
  todos,
  onChange,
  idPrefix,
  placeholder = 'Add a to-do and press Enter'
}: {
  todos: TodoItem[];
  onChange: (todos: TodoItem[]) => void;
  idPrefix: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const done = todos.filter(t => t.done).length;

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...todos, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, done: false }]);
    setDraft('');
  };

  return (
    <div className="flex flex-column gap-3">
      {todos.length > 0 && (
        <div className="flex align-items-center gap-2">
          <ProgressBar value={Math.round((done / todos.length) * 100)} showValue={false} className="flex-1" style={{ height: '0.4rem' }} />
          <span className="text-xs text-color-secondary white-space-nowrap">
            {done}/{todos.length} done
          </span>
        </div>
      )}

      <div className="flex flex-column gap-1">
        {todos.map(todo => (
          <div key={todo.id} className="flex align-items-center gap-2 py-1">
            <Checkbox
              inputId={`${idPrefix}-${todo.id}`}
              checked={todo.done}
              onChange={event => onChange(todos.map(t => (t.id === todo.id ? { ...t, done: Boolean(event.checked) } : t)))}
            />
            <label
              htmlFor={`${idPrefix}-${todo.id}`}
              className={`flex-1 min-w-0 cursor-pointer text-sm${todo.done ? ' line-through text-color-secondary' : ''}`}
              style={{ overflowWrap: 'anywhere' }}
            >
              {todo.text}
            </label>
            <Button
              icon="pi pi-times"
              text
              severity="secondary"
              aria-label={`Remove ${todo.text}`}
              onClick={() => onChange(todos.filter(t => t.id !== todo.id))}
            />
          </div>
        ))}
        {todos.length === 0 && <span className="text-sm text-color-secondary">Nothing planned yet.</span>}
      </div>

      <div className="flex gap-2">
        <InputText
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          maxLength={300}
          className="flex-1 min-w-0 p-inputtext-sm"
          aria-label="New to-do"
        />
        <Button icon="pi pi-plus" onClick={add} disabled={!draft.trim()} aria-label="Add to-do" />
      </div>
    </div>
  );
}
