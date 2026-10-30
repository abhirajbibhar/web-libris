import { lazy, Suspense } from 'react';
import { useNavigate, useParams } from '~/router/compat';
import { Button } from 'primereact/button';
import { useAuth } from '../auth/AuthContext';
import { useBook } from '../hooks/useApi';
import { bookProgressPercent, fileUrl } from '../api/types';
import CbxReader from './CbxReader';
import EbookReader from './EbookReader';
import { ReaderLoading, ReaderMessage } from './ReaderChrome';

// The EmbedPDF viewer is large; load it only when a PDF is opened.
const PdfReader = lazy(() => import('./PdfReader'));

const READABLE_TYPES = new Set(['EPUB', 'PDF', 'CBX']);

/** Loading / not-found / unsupported states stay inside the layout instead of covering it. */
function InlineStatus({ children }: { children: React.ReactNode }) {
  return <div className="relative flex-1 min-h-0">{children}</div>;
}

/** Route component: /read/:bookId — dispatches to the right reader. */
export default function ReaderPage() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const id = Number(bookId);
  const { data: book, isLoading } = useBook(id);

  if (isLoading) {
    return (
      <InlineStatus>
        <ReaderLoading label="Loading book…" />
      </InlineStatus>
    );
  }

  if (!book) {
    return (
      <InlineStatus>
        <ReaderMessage title="Book not found">
          <Button label="Back to books" link onClick={() => navigate('/all-books')} />
        </ReaderMessage>
      </InlineStatus>
    );
  }

  const bookType = book.primaryFile?.bookType;
  if (bookType && READABLE_TYPES.has(bookType)) {
    if (bookType === 'EPUB') return <EbookReader book={book} />;
    if (bookType === 'PDF') {
      return (
        <Suspense
          fallback={
            <InlineStatus>
              <ReaderLoading label="Opening PDF…" />
            </InlineStatus>
          }
        >
          <PdfReader key={book.id} book={book} />
        </Suspense>
      );
    }
    return <CbxReader book={book} />;
  }

  const canDownload = user?.permissions.canDownload || user?.permissions.admin;
  return (
    <InlineStatus>
      <ReaderMessage title="No reader for this format yet">
        <p className="m-0 line-height-3" style={{ maxWidth: '26rem' }}>
          <strong>{bookType ?? 'Unknown'}</strong> books cannot be opened in the browser. The EPUB, PDF and CBX readers
          are available; you can still download the file.
        </p>
        <div className="flex gap-2">
          <Button label="Back to book" outlined onClick={() => navigate(`/book/${book.id}`)} />
          {canDownload ? (
            <Button
              label="Download"
              icon="pi pi-download"
              onClick={() => {
                window.location.href = fileUrl(book.id);
              }}
            />
          ) : null}
        </div>
        <span className="text-sm">Reading progress: {bookProgressPercent(book)}%</span>
      </ReaderMessage>
    </InlineStatus>
  );
}
