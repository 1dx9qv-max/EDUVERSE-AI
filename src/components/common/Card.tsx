import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  hover?: boolean;
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  glow = false,
  hover = false,
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 p-5 transition-all duration-150 shadow-xs dark:shadow-none ${
        glow ? 'border-indigo-500/40 dark:border-indigo-500/35 ring-1 ring-indigo-500/10' : ''
      } ${
        hover
          ? 'hover:border-indigo-500/50 dark:hover:border-indigo-500/40 hover:shadow-md dark:hover:bg-slate-900 cursor-pointer'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  );
};
