export interface Quote {
  text: string;
  author: string;
  source?: string;
}

/** A small, well-attested set of classics about reading and attention (all public domain, one translated line). */
export const QUOTES: Quote[] = [
  { text: 'Some books are to be tasted, others to be swallowed, and some few to be chewed and digested.', author: 'Francis Bacon', source: 'Of Studies' },
  { text: 'Books are the best of things, well used; abused, among the worst.', author: 'Ralph Waldo Emerson', source: 'Books' },
  { text: 'Read the best books first, or you may not have a chance to read them at all.', author: 'Henry David Thoreau', source: 'A Week on the Concord and Merrimack Rivers' },
  { text: 'If you have a garden and a library, you have everything you need.', author: 'Cicero', source: 'Letters to Friends (translation)' },
  { text: 'A book must be the axe for the frozen sea within us.', author: 'Franz Kafka', source: 'Letter to Oskar Pollak, 1904' },
  { text: 'First say to yourself what you would be; and then do what you have to do.', author: 'Epictetus', source: 'Discourses' },
  { text: 'Reading maketh a full man; conference a ready man; and writing an exact man.', author: 'Francis Bacon', source: 'Of Studies' },
  { text: 'A good book is the precious life-blood of a master spirit, embalmed and treasured up on purpose to a life beyond life.', author: 'John Milton', source: 'Areopagitica' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', author: 'Will Durant', source: 'The Story of Philosophy (on Aristotle)' },
  { text: 'There is no frigate like a book to take us lands away.', author: 'Emily Dickinson' },
];
