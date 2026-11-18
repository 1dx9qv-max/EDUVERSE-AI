import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppRoute } from '../types/modules';

interface RouterContextType {
  currentRoute: AppRoute;
  searchString: string;
  searchParams: URLSearchParams;
  navigate: (route: AppRoute | (string & {}), query?: Record<string, string | undefined>) => void;
}

const RouterContext = createContext<RouterContextType | undefined>(undefined);

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const normalizePath = (path: string): AppRoute => {
    // If empty or root
    if (!path || path === '') return '/';
    // Strip trailing slash if present (except root)
    const cleaned = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    const validRoutes: AppRoute[] = [
      '/',
      '/login',
      '/signup',
      '/dashboard',
      '/ai-teacher',
      '/doubt-solver',
      '/visual-lab',
      '/practice',
      '/learning-intelligence',
      '/memory-booster',
      '/mindmaps',
      '/exam-simulator',
      '/voice-learning',
      '/collaborative-learning',
      '/achievements',
      '/guardian',
      '/settings',
      '/admin',
    ];
    if (validRoutes.includes(cleaned as AppRoute)) {
      return cleaned as AppRoute;
    }
    return '/';
  };

  const [currentRoute, setCurrentRoute] = useState<AppRoute>(() => {
    return normalizePath(window.location.pathname);
  });
  const [searchString, setSearchString] = useState<string>(() => window.location.search || '');

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(normalizePath(window.location.pathname));
      setSearchString(window.location.search || '');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);

  const navigate = (route: AppRoute | (string & {}), query?: Record<string, string | undefined>) => {
    const [rawPath, inlineQuery] = String(route).split('?');
    const targetRoute = normalizePath(rawPath);

    let nextSearch = '';
    if (query) {
      const sp = new URLSearchParams(inlineQuery || '');
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== '') sp.set(k, v);
      });
      const qs = sp.toString();
      nextSearch = qs ? `?${qs}` : '';
    } else if (inlineQuery) {
      nextSearch = `?${inlineQuery}`;
    }

    if (targetRoute === currentRoute && nextSearch === searchString) return;
    window.history.pushState({}, '', `${targetRoute}${nextSearch}`);
    setCurrentRoute(targetRoute);
    setSearchString(nextSearch);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <RouterContext.Provider value={{ currentRoute, searchString, searchParams, navigate }}>
      {children}
    </RouterContext.Provider>
  );
};

export const useRouter = () => {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return context;
};

export const Link: React.FC<{
  to: AppRoute;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}> = ({ to, children, className = '', onClick }) => {
  const { navigate } = useRouter();

  return (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        if (onClick) onClick();
        navigate(to);
      }}
      className={className}
    >
      {children}
    </a>
  );
};
