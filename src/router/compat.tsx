/**
 * The pages were written against `react-router-dom`. Keeping that vocabulary
 * on top of TanStack Router means the ported UI stays unchanged, while
 * TanStack Router remains the single source of truth for navigation,
 * matching, params and history.
 *
 * Deliberately thin: these helpers read router state and push URLs; they do
 * not re-implement route matching.
 */
import { useRouter, useRouterState } from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useMemo,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode
} from 'react';

export interface Location {
  pathname: string;
  search: string;
  hash: string;
  href: string;
  state: unknown;
  key: string;
}

export function useLocation(): Location {
  const location = useRouterState({ select: state => state.location });
  return {
    pathname: location.pathname,
    search: location.searchStr,
    hash: location.hash,
    href: location.href,
    state: location.state,
    key: ''
  };
}

type NavigateOptions = { replace?: boolean; state?: unknown };

export function useNavigate() {
  const router = useRouter();
  return useCallback(
    (to: string | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        router.history.go(to);
        return;
      }
      if (options?.replace) router.history.replace(to);
      else router.history.push(to);
    },
    [router]
  );
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  replace?: boolean;
  state?: unknown;
  children?: ReactNode;
}

function useLinkClick(to: string, replace?: boolean) {
  const router = useRouter();
  return useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainLeftClick(event)) return;
      event.preventDefault();
      if (replace) router.history.replace(to);
      else router.history.push(to);
    },
    [router, to, replace]
  );
}

export function Link({ to, replace, state: _state, onClick, ...rest }: LinkProps) {
  const handleClick = useLinkClick(to, replace);
  return (
    <a
      href={to}
      {...rest}
      onClick={event => {
        onClick?.(event);
        handleClick(event);
      }}
    />
  );
}

interface NavLinkProps extends Omit<LinkProps, 'className' | 'children'> {
  className?: string | ((state: { isActive: boolean }) => string);
  activeClassName?: string;
  end?: boolean;
  children?: ReactNode;
}

export function NavLink({
  to,
  replace,
  state,
  className,
  activeClassName,
  end,
  onClick,
  children,
  ...rest
}: NavLinkProps) {
  const { pathname } = useLocation();
  const target = to.split('?')[0];
  const isActive = end
    ? pathname === target
    : pathname === target || pathname.startsWith(target.endsWith('/') ? target : `${target}/`);
  const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className;
  const handleClick = useLinkClick(to, replace);
  return (
    <a
      href={to}
      {...rest}
      className={[resolvedClassName, isActive ? activeClassName : undefined].filter(Boolean).join(' ') || undefined}
      onClick={event => {
        onClick?.(event);
        handleClick(event);
      }}
    >
      {children}
    </a>
  );
}

export function Navigate({ to, replace }: { to: string; replace?: boolean; state?: unknown }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace: replace ?? true });
  }, [navigate, to, replace]);
  return null;
}

export { Outlet } from '@tanstack/react-router';

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const matches = useRouterState({ select: state => state.matches });
  const params: Record<string, string | undefined> = {};
  for (const match of matches) Object.assign(params, match.params);
  return params as T;
}

type SearchParamsInit =
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined>
  | string
  | ((previous: URLSearchParams) => URLSearchParams);

export function useSearchParams(): [URLSearchParams, (next: SearchParamsInit, options?: { replace?: boolean }) => void] {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const setParams = useCallback(
    (next: SearchParamsInit, options?: { replace?: boolean }) => {
      const resolved: URLSearchParams =
        typeof next === 'function'
          ? next(new URLSearchParams(search))
          : next instanceof URLSearchParams
            ? next
            : typeof next === 'string'
              ? new URLSearchParams(next)
              : new URLSearchParams(
                  Object.entries(next).flatMap(([key, value]) =>
                    value === null || value === undefined ? [] : [[key, String(value)] as [string, string]]
                  )
                );
      const query = resolved.toString();
      navigate(`${pathname}${query ? `?${query}` : ''}`, { replace: options?.replace });
    },
    [navigate, pathname, search]
  );

  return [params, setParams];
}
