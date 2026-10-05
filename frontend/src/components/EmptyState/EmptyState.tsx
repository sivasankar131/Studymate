import React from 'react';

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<Props> = ({ icon, title, description, action, className = '' }) => (
  <div className={`flex flex-col items-center justify-center text-center py-16 px-6 ${className}`}>
    {icon && (
      <div className="mb-4 text-surface-400 select-none" aria-hidden="true">{icon}</div>
    )}
    <h3 className="text-base font-bold text-surface-800 mb-2">{title}</h3>
    {description && (
      <p className="text-sm font-medium text-surface-600 max-w-xs leading-relaxed">{description}</p>
    )}
    {action && <div className="mt-6">{action}</div>}
  </div>
);

export default EmptyState;
