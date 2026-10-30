import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { PrimeReactProvider } from 'primereact/api';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import 'primeflex/primeflex.css';
import { AuthProvider } from '~/auth/AuthContext';
import { ThemeProvider } from '~/theme/ThemeContext';
import { Navigate } from '~/router/compat';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

/**
 * Runs before first paint and creates the PrimeReact theme stylesheet for the
 * reader's saved mode (defaulting to the OS preference). The link is created
 * here rather than rendered by React so React never owns that stylesheet —
 * theme switching can then swap its href without hydration conflicts.
 * The storage key and file names must stay in sync with
 * src/theme/ThemeContext.tsx.
 */
const THEME_BOOTSTRAP = `(function () {
  var mode = 'light';
  try {
    var stored = localStorage.getItem('web-libris.theme');
    mode = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  } catch (e) {}
  var link = document.createElement('link');
  link.id = 'theme-link';
  link.rel = 'stylesheet';
  link.href = '/themes/lara-' + mode + '-amber.css';
  document.head.appendChild(link);
})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { name: 'theme-color', content: '#ffffff' },
      { title: 'Web Libris' }
    ],
    links: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    scripts: [{ children: THEME_BOOTSTRAP }]
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => <Navigate to="/dashboard" replace />
});

function RootDocument({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="m-0 surface-ground text-color">
        <PrimeReactProvider>
          <ThemeProvider>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                {children ?? <Outlet />}
              </AuthProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </PrimeReactProvider>
        <Scripts />
      </body>
    </html>
  );
}
