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
      className={`relative rounded-2xl bg-slate-900/80 backdrop-blur-md border border-slate-800/80 p-5 transition-all duration-200 ${
        glow ? 'shadow-lg shadow-indigo-500/10 border-indigo-500/30' : ''
      } ${
        hover
          ? 'hover:border-indigo-500/40 hover:bg-slate-900/95 hover:shadow-xl hover:shadow-indigo-500/5 hover:-translate-y-0.5 cursor-pointer'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  );
};
