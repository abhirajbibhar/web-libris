import { useState } from 'react';
import { Accordion, AccordionTab } from 'primereact/accordion';
import { Badge } from 'primereact/badge';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Sidebar } from 'primereact/sidebar';
import { buildFacets, FILTER_LABELS, isFilterActive, type FilterSelection, type FilterType } from '../utils/filters';
import type { Book } from '../api/types';
import { BELOW_TOPBAR_MASK } from '../layout/constants';
import { THIN_SCROLL } from '../utils/scroll';
import { tip } from '../utils/tooltip';
import CheckRow from './CheckRow';
import SearchField from './SearchField';

export default function BookFilterPanel({
  visible,
  onHide,
  books,
  selection,
  onSelectionChange,
  onClear,
  isMobile
}: {
  visible: boolean;
  onHide: () => void;
  books: Book[];
  selection: FilterSelection;
  onSelectionChange: (selection: FilterSelection) => void;
  onClear: () => void;
  isMobile: boolean;
}) {
  const [scopeSearch, setScopeSearch] = useState('');
  const [closed, setClosed] = useState<Set<FilterType>>(new Set());
  const facets = buildFacets(books, selection);

  const toggleValue = (type: FilterType, id: string | number) => {
    const current = selection[type] ?? [];
    const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id];
    onSelectionChange({ ...selection, [type]: next });
  };

  const needle = scopeSearch.trim().toLowerCase();
  const visibleFacets = facets
    .map(facet => ({
      ...facet,
      values: needle ? facet.values.filter(value => value.name.toLowerCase().includes(needle)) : facet.values
    }))
    .filter(facet => facet.values.length > 0);

  const openIndexes = visibleFacets.flatMap((facet, index) => (closed.has(facet.type) ? [] : [index]));

  const body = (
    <div className="flex flex-column gap-2">
      <div className="flex align-items-center gap-1">
        <SearchField
          value={scopeSearch}
          onChange={setScopeSearch}
          placeholder="Find a filter value"
          className="flex-1"
        />
        {isFilterActive(selection) && (
          <Button
            icon="pi pi-filter-slash"
            text
            severity="secondary"
            onClick={onClear}
            aria-label="Clear all filters"
            {...tip('Clear all filters')}
          />
        )}
      </div>
      {visibleFacets.length === 0 ? (
        <span className="text-color-secondary text-sm">No filter values available.</span>
      ) : (
        <Accordion
          multiple
          activeIndex={openIndexes}
          onTabChange={event => {
            const open = new Set(event.index as number[]);
            setClosed(new Set(visibleFacets.filter((_, index) => !open.has(index)).map(facet => facet.type)));
          }}
        >
          {visibleFacets.map(facet => {
            const selected = selection[facet.type] ?? [];
            return (
              <AccordionTab
                key={facet.type}
                pt={{
                  root: { className: 'mb-0 border-bottom-1 surface-border' },
                  headerAction: {
                    className:
                      'bg-transparent border-none border-noround px-0 py-2 text-xs uppercase font-semibold text-color-secondary'
                  },
                  content: { className: 'bg-transparent border-none px-0 pt-1 pb-3' }
                }}
                header={
                  <span className="flex align-items-center justify-content-between gap-2 w-full">
                    <span>{FILTER_LABELS[facet.type]}</span>
                    {selected.length > 0 && <Badge value={selected.length} />}
                  </span>
                }
              >
                <div className="flex flex-column gap-1 overflow-y-auto" style={{ maxHeight: '14rem', ...THIN_SCROLL }}>
                  {facet.values.map(value => (
                    <CheckRow
                      key={String(value.id)}
                      id={`filter-${facet.type}-${String(value.id)}`}
                      label={value.name}
                      count={value.bookCount}
                      checked={selected.includes(value.id)}
                      onChange={() => toggleValue(facet.type, value.id)}
                    />
                  ))}
                </div>
              </AccordionTab>
            );
          })}
        </Accordion>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sidebar
        visible={visible}
        onHide={onHide}
        position="right"
        className="w-20rem"
        blockScroll
        showCloseIcon={false}
        pt={{
          mask: { style: BELOW_TOPBAR_MASK },
          header: { className: 'hidden' },
          content: { className: 'p-3', style: THIN_SCROLL }
        }}
      >
        {body}
      </Sidebar>
    );
  }

  if (!visible) return null;
  // Starts with the search field, grows with its content and stops at the screen edge
  // (the parent row has a fixed height, so maxHeight 100% scrolls inside the card).
  return (
    <div className="flex-shrink-0 overflow-y-auto" style={{ width: '16rem', maxHeight: '100%', ...THIN_SCROLL }}>
      <Card pt={{ body: { className: 'px-3 py-2' }, content: { className: 'p-0' } }}>{body}</Card>
    </div>
  );
}
