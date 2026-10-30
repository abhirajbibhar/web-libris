import { BookRecord, LibraryRecord, Metadata, ShelfRecord, UserRecord } from './types';

export interface ShelfDto {
  id: number;
  name: string;
  icon?: string | null;
  iconType?: 'PRIME_NG' | 'CUSTOM_SVG' | null;
  publicShelf?: boolean;
  userId?: number;
  bookCount?: number;
}

export interface LibraryDto {
  id: number;
  name: string;
  icon?: string | null;
  iconType?: 'PRIME_NG' | 'CUSTOM_SVG' | null;
  bookCount?: number;
}

export interface UserDto {
  id: number;
  username: string;
  name: string;
  email: string;
  permissions: UserRecord['permissions'];
  assignedLibraryIds: number[] | null;
}

export interface BookFileDto {
  id: number;
  bookId: number;
  bookType: BookRecord['bookType'];
  fileName: string;
  extension: string;
  fileSizeKb?: number;
}

export interface BookDto {
  id: number;
  libraryId: number;
  libraryName: string;
  fileName: string;
  fileSizeKb?: number;
  addedOn: string;
  lastReadTime?: string;
  primaryFile: BookFileDto;
  metadata: Metadata & { bookId: number };
  shelves: ShelfDto[];
  personalRating?: number | null;
  readStatus: BookRecord['readStatus'];
  readStatusModifiedTime?: string;
  dateFinished?: string;
  coverUpdatedOn?: string;
  /** Extension of the stored cover image (jpg/png/webp…); absent = no cover. */
  coverExt?: string;
  epubProgress?: BookRecord['epubProgress'];
  pdfProgress?: BookRecord['pdfProgress'];
  cbxProgress?: BookRecord['cbxProgress'];
  annotationCount?: number;
}

export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    permissions: user.permissions,
    assignedLibraryIds: user.assignedLibraryIds
  };
}

export function toShelfDto(shelf: ShelfRecord, bookCount: number): ShelfDto {
  return {
    id: shelf.id,
    name: shelf.name,
    icon: shelf.icon,
    iconType: shelf.iconType,
    publicShelf: shelf.publicShelf,
    userId: shelf.userId,
    bookCount
  };
}

export function toLibraryDto(library: LibraryRecord, bookCount: number): LibraryDto {
  return {
    id: library.id,
    name: library.name,
    icon: library.icon,
    iconType: library.iconType,
    bookCount
  };
}

export function toBookDto(record: BookRecord, libraryName: string, shelves: ShelfRecord[]): BookDto {
  return {
    id: record.id,
    libraryId: record.libraryId,
    libraryName,
    fileName: record.fileName,
    fileSizeKb: record.fileSizeKb,
    addedOn: record.addedOn,
    lastReadTime: record.lastReadTime,
    primaryFile: {
      id: record.id,
      bookId: record.id,
      bookType: record.bookType,
      fileName: record.fileName,
      extension: record.fileName.split('.').pop() ?? '',
      fileSizeKb: record.fileSizeKb
    },
    metadata: { ...record.metadata, bookId: record.id },
    shelves: shelves.map(s => toShelfDto(s, 0)),
    personalRating: record.personalRating,
    readStatus: record.readStatus,
    readStatusModifiedTime: record.readStatusModifiedTime,
    dateFinished: record.dateFinished,
    coverUpdatedOn: record.coverUpdatedOn,
    coverExt: record.coverExt,
    epubProgress: record.epubProgress,
    pdfProgress: record.pdfProgress,
    cbxProgress: record.cbxProgress,
    annotationCount: record.annotationCount
  };
}
