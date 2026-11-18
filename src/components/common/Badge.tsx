import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'info' | 'purple' | 'rose';
  size?: 'sm' | 'md';
  className?: string;
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  dot = false,
}) => {
  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 font-medium',
    md: 'text-xs px-2.5 py-1 font-semibold',
  };

  const variantStyles = {
    default: 'bg-slate-800 text-slate-300 border border-slate-700/60',
    info: 'bg-blue-500/10 text-blue-400 border border-blue-500/25',
    purple: 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/25',
    success: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
    warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
    rose: 'bg-rose-500/10 text-rose-400 border border-rose-500/25',
  };

  const dotColors = {
    default: 'bg-slate-400',
    info: 'bg-blue-400',
    purple: 'bg-indigo-400',
    success: 'bg-emerald-400',
    warning: 'bg-amber-400',
    rose: 'bg-rose-400',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />}
      {children}
    </span>
  );
};
