export type NoteType = 'highlight' | 'note';
export const NOTE_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface Note {
  id: number;
  bookId: number;
  type: NoteType;
  quote: string;
  text: string;
  color: NoteColor;
  location?: string;
  chapter?: string;
  percentage?: number;
  /** Set when the note was imported from a PDF annotation. */
  source?: { kind: 'pdf'; annotationId: string };
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  bookId: number;
  type: NoteType;
  quote: string;
  text: string;
  color: NoteColor;
  location?: string;
  chapter?: string;
  percentage?: number;
}

export type Mood = 'great' | 'good' | 'okay' | 'low';

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

/** A remark about one book on one day. */
export interface BookNote {
  bookId: number;
  title: string;
  text: string;
}

export interface NotebookEntry {
  date: string;
  todos: TodoItem[];
  mood: Mood | null;
  reflection: string;
  thoughts: string;
  bookNotes: BookNote[];
  updatedAt: string;
}

/** What the month list carries per day: enough for the history list, no file reads. */
export interface NotebookSummary {
  date: string;
  todos: number;
  done: number;
  mood: Mood | null;
  books: number;
  hasText: boolean;
}

export interface NotebookMonth {
  month: string;
  days: Record<string, NotebookSummary>;
}

export interface BookDayActivity {
  seconds: number;
  startPct: number;
  endPct: number;
}

export interface ActivityDay {
  seconds: number;
  books: Record<string, BookDayActivity>;
}

export type ActivityDays = Record<string, ActivityDay>;
