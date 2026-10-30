export interface QuoteItem {
  id: number;
  text: string;
  author: string;
  /** Where it came from: a book title, an article, a speech… */
  source: string;
  bookId?: number;
  location?: string;
  tags: string[];
  favorite: boolean;
  origin: 'manual' | 'note';
  noteId?: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteInput {
  text: string;
  author?: string;
  source?: string;
  bookId?: number | null;
  location?: string;
  tags?: string[];
  favorite?: boolean;
}
